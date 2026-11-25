import { afterAll, beforeAll, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { workspace } from "../support/workspace";
import { runtimeConfig } from "../support/runtime-config";
import { totp } from "../support/totp";
import { createApp } from "../../apps/api/src/app";
let f: Awaited<ReturnType<typeof workspace>>,
  app: Awaited<ReturnType<typeof createApp>>,
  cookie = "",
  csrf = "",
  dep = "",
  customer = "";
const request = (id: string, payload?: any, tenant = f.tenants[0]) =>
  app.inject({
    method: payload ? "POST" : "GET",
    url: `/api/companies/${tenant}/invoices/${id}/actions`,
    headers: { cookie, origin: f.config.APP_ORIGIN, "x-csrf-token": csrf },
    payload,
  });
async function invoice(state: any = {}) {
  const draft = (
    await f.pool.query(
      "insert into public.invoice_drafts(tenant_id,customer_id,department_id,currency,customer_snapshot,created_by,updated_by,operation_id,request_hash) values($1,$2,$3,'CRC','{}',$4,$4,$5,'TEST') returning id",
      [f.tenants[0], customer, dep, f.userId, randomUUID()],
    )
  ).rows[0];
  return (
    await f.pool.query(
      "insert into public.electronic_invoices(tenant_id,draft_id,draft_version,department_id,snapshot,options,created_by,operation_id,request_hash,document_status,issued_by,signature_status,transmission_status,hacienda_status,email_status) values($1,$2,1,$3,$4,'{}',$5,$6,$7,'issued',$5,$8,$9,$10,$11) returning *",
      [
        f.tenants[0],
        draft.id,
        dep,
        { issuer: { configuration: { billing: { send_email: true } } } },
        f.userId,
        randomUUID(),
        "a".repeat(64),
        state.signature ?? "signed",
        state.transmission ?? "queued",
        state.hacienda ?? "pending",
        state.email ?? "not_queued",
      ],
    )
  ).rows[0];
}
async function job(id: string, kind: string, status = "failed") {
  await f.pool.query(
    "insert into private.emission_jobs(tenant_id,invoice_id,kind,status) values($1,$2,$3,$4)",
    [f.tenants[0], id, kind, status],
  );
}
beforeAll(async () => {
  f = await workspace({ role: "admin", companies: 2 });
  app = await createApp(await runtimeConfig(f.config));
  ({ cookie, csrf } = await f.login(app));
  const headers = { cookie, origin: f.config.APP_ORIGIN, "x-csrf-token": csrf };
  const enrollment = await app.inject({
    method: "POST",
    url: "/api/auth/mfa/enroll",
    headers,
  });
  const verify = await app.inject({
    method: "POST",
    url: "/api/auth/mfa/verify",
    headers,
    payload: {
      factorId: enrollment.json().factorId,
      code: totp(enrollment.json().secret),
    },
  });
  expect(verify.statusCode, verify.body).toBe(200);
  csrf = (
    await app.inject({ url: "/api/auth/session", headers: { cookie } })
  ).json().csrf;
  dep = (
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'TEST') returning id",
      [f.tenants[0]],
    )
  ).rows[0].id;
  customer = (
    await f.pool.query(
      "insert into public.customers(tenant_id,name) values($1,'TEST') returning id",
      [f.tenants[0]],
    )
  ).rows[0].id;
});
afterAll(async () => {
  await app?.close();
  await f?.pool.end();
});
it("retries safe technical failures and replays without resetting a leased job", async () => {
  const i = await invoice();
  await job(i.id, "transmit");
  const payload = { operation_id: randomUUID(), action: "retry_transmission" };
  expect((await request(i.id)).json().actions).toContain("retry_transmission");
  const r = await request(i.id, payload);
  expect(r.statusCode, r.body).toBe(200);
  await f.pool.query(
    "update private.emission_jobs set status='leased',attempts=2,lease_token=gen_random_uuid(),lease_until=now()+interval '1 hour' where invoice_id=$1",
    [i.id],
  );
  expect((await request(i.id, payload)).statusCode).toBe(200);
  const j = (
    await f.pool.query(
      "select * from private.emission_jobs where invoice_id=$1",
      [i.id],
    )
  ).rows[0];
  expect(j.status).toBe("leased");
  expect(j.attempts).toBe(2);
  expect(
    (await request(i.id, { ...payload, action: "query" })).statusCode,
  ).toBe(409);
  expect((await request(i.id, payload, f.tenants[1])).statusCode).toBe(404);
  expect(
    (
      await f.pool.query(
        "select count(*) from public.audit_events where entity_id=$1 and action='INVOICE_MANUAL_ACTION'",
        [i.id],
      )
    ).rows[0].count,
  ).toBe("1");
});
it("only queries uncertain transmissions and limits manual recovery requests", async () => {
  const i = await invoice({ transmission: "uncertain" });
  await job(i.id, "transmit", "uncertain");
  expect(
    (
      await request(i.id, {
        operation_id: randomUUID(),
        action: "retry_transmission",
      })
    ).statusCode,
  ).toBe(409);
  for (let n = 0; n < 3; n++) {
    const r = await request(i.id, {
      operation_id: randomUUID(),
      action: "query",
    });
    expect(r.statusCode, r.body).toBe(200);
  }
  expect(
    (await request(i.id, { operation_id: randomUUID(), action: "query" }))
      .statusCode,
  ).toBe(429);
});
it("resends complete accepted artifacts with a stable explicit dispatch and blocks uncertain email", async () => {
  const i = await invoice({
    transmission: "sent",
    hacienda: "accepted",
    email: "provider_accepted",
  });
  await job(i.id, "email", "completed");
  for (const kind of ["signed_xml", "hacienda_response", "pdf"]) {
    const bytes = Buffer.from("TEST " + kind);
    await f.pool.query(
      "insert into private.invoice_artifacts(tenant_id,invoice_id,kind,content,sha256) values($1,$2,$3,$4,$5)",
      [
        f.tenants[0],
        i.id,
        kind,
        bytes,
        createHash("sha256").update(bytes).digest("hex"),
      ],
    );
  }
  const payload = { operation_id: randomUUID(), action: "resend_email" };
  const r = await request(i.id, payload);
  expect(r.statusCode, r.body).toBe(200);
  expect((await request(i.id, payload)).statusCode).toBe(200);
  expect(
    (
      await f.pool.query(
        "select email_dispatch_id from public.electronic_invoices where id=$1",
        [i.id],
      )
    ).rows[0].email_dispatch_id,
  ).toBe(payload.operation_id);
  await f.pool.query(
    "update public.electronic_invoices set email_status='uncertain' where id=$1",
    [i.id],
  );
  expect(
    (await request(i.id, { ...payload, operation_id: randomUUID() }))
      .statusCode,
  ).toBe(409);
});
it("preserves pending query attempts and enforces lifetime caps", async () => {
  const i = await invoice({ transmission: "sent" });
  await job(i.id, "query", "pending");
  await f.pool.query(
    "update private.emission_jobs set attempts=4 where invoice_id=$1",
    [i.id],
  );
  const r = await request(i.id, {
    operation_id: randomUUID(),
    action: "query",
  });
  expect(r.statusCode, r.body).toBe(200);
  expect(
    (
      await f.pool.query(
        "select attempts from private.emission_jobs where invoice_id=$1",
        [i.id],
      )
    ).rows[0].attempts,
  ).toBe(4);
  for (let n = 0; n < 9; n++)
    await f.pool.query(
      "insert into private.emission_actions(tenant_id,invoice_id,actor_id,operation_id,action,request_hash,created_at) values($1,$2,$3,$4,'query',$5,now()-interval '2 hour')",
      [f.tenants[0], i.id, f.userId, randomUUID(), "b".repeat(64)],
    );
  expect(
    (await request(i.id, { operation_id: randomUUID(), action: "query" }))
      .statusCode,
  ).toBe(429);
});
it("retries only failed signatures without changing fiscal contents", async () => {
  const i = await invoice({ signature: "pending" });
  await job(i.id, "sign");
  const payload = { operation_id: randomUUID(), action: "retry_signature" };
  expect((await request(i.id, payload)).statusCode).toBe(200);
  const after = (
    await f.pool.query("select * from public.electronic_invoices where id=$1", [
      i.id,
    ])
  ).rows[0];
  expect(after.snapshot).toEqual(i.snapshot);
  expect(after.clave).toBe(i.clave);
  expect(after.credential_version).toBe(i.credential_version);
  const other = await invoice({ transmission: "sent" });
  expect(
    (await request(other.id, { ...payload, action: "query" })).statusCode,
  ).toBe(409);
});
it("rejects incomplete artifacts and active leased email jobs", async () => {
  const i = await invoice({
    hacienda: "accepted",
    transmission: "sent",
    email: "provider_accepted",
  });
  await job(i.id, "email", "completed");
  const payload = { operation_id: randomUUID(), action: "resend_email" };
  expect((await request(i.id, payload)).statusCode).toBe(409);
  for (const kind of ["signed_xml", "hacienda_response", "pdf"]) {
    const bytes = Buffer.from("TEST " + kind);
    await f.pool.query(
      "insert into private.invoice_artifacts(tenant_id,invoice_id,kind,content,sha256) values($1,$2,$3,$4,$5)",
      [
        f.tenants[0],
        i.id,
        kind,
        bytes,
        createHash("sha256").update(bytes).digest("hex"),
      ],
    );
  }
  await f.pool.query(
    "update private.emission_jobs set status='leased',lease_token=gen_random_uuid(),lease_until=now()+interval '1 hour' where invoice_id=$1",
    [i.id],
  );
  expect((await request(i.id, payload)).statusCode).toBe(409);
});
it("serializes two first email resends when no email job exists", async () => {
  const i = await invoice({
    hacienda: "accepted",
    transmission: "sent",
    email: "provider_accepted",
  });
  for (const kind of ["signed_xml", "hacienda_response", "pdf"]) {
    const bytes = Buffer.from("TEST " + kind);
    await f.pool.query(
      "insert into private.invoice_artifacts(tenant_id,invoice_id,kind,content,sha256) values($1,$2,$3,$4,$5)",
      [
        f.tenants[0],
        i.id,
        kind,
        bytes,
        createHash("sha256").update(bytes).digest("hex"),
      ],
    );
  }
  const blocker = await f.pool.connect();
  const first = { operation_id: randomUUID(), action: "resend_email" };
  const second = { operation_id: randomUUID(), action: "resend_email" };
  await blocker.query("begin");
  await blocker.query(
    "select id from public.electronic_invoices where id=$1 for update",
    [i.id],
  );
  const pending = [
    request(i.id, first).then((r) => r),
    request(i.id.toUpperCase(), second, f.tenants[0].toUpperCase()).then(
      (r) => r,
    ),
  ];
  try {
    let blocked = 0;
    for (let n = 0; n < 100 && blocked < 2; n++) {
      blocked = (
        await f.pool.query(
          "select count(*)::int n from pg_stat_activity where wait_event_type='Lock' and pid<>pg_backend_pid() and (query like '%electronic_invoices%for update%' or query like '%pg_advisory_xact_lock%')",
        )
      ).rows[0].n;
      if (blocked < 2) await new Promise((r) => setTimeout(r, 20));
    }
    expect(blocked).toBeGreaterThanOrEqual(2);
    const invoiceWaiters = (
      await f.pool.query(
        "select count(*)::int n from pg_stat_activity where wait_event_type='Lock' and query like '%electronic_invoices%for update%' and pid<>pg_backend_pid()",
      )
    ).rows[0].n;
    expect(invoiceWaiters).toBe(1);
  } finally {
    await blocker.query("commit");
    blocker.release();
  }
  const responses = await Promise.all(pending);
  for (const r of responses) expect(r.statusCode, r.body).toBe(200);
  const row = (
    await f.pool.query(
      "select email_dispatch_id from public.electronic_invoices where id=$1",
      [i.id],
    )
  ).rows[0];
  expect([first.operation_id, second.operation_id]).toContain(
    row.email_dispatch_id,
  );
  const dispatched = await f.pool.query(
    "select details from public.audit_events where entity_id=$1 and action='INVOICE_UPDATED' and details->>'email_status'='queued'",
    [i.id],
  );
  expect(dispatched.rowCount).toBe(1);
  await f.pool.query(
    "update private.emission_jobs set status='leased',lease_token=gen_random_uuid(),lease_until=now()+interval '1 hour' where invoice_id=$1",
    [i.id],
  );
  for (const payload of [first, second])
    expect((await request(i.id, payload)).statusCode).toBe(200);
  expect(
    (
      await f.pool.query(
        "select email_dispatch_id from public.electronic_invoices where id=$1",
        [i.id],
      )
    ).rows[0].email_dispatch_id,
  ).toBe(row.email_dispatch_id);
});
it("blocks requests from an expired interactive session", async () => {
  const i = await invoice({ transmission: "sent" });
  await f.pool.query(
    "update private.sessions set expires_at=now()-interval '1 second' where user_id=$1",
    [f.userId],
  );
  const r = await request(i.id, {
    operation_id: randomUUID(),
    action: "query",
  });
  expect(r.statusCode, r.body).toBe(401);
});
