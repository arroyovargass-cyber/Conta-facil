import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { workspace } from "../support/workspace";
import { totp } from "../support/totp";
import { runtimeConfig } from "../support/runtime-config";
import { createApp } from "../../apps/api/src/app";
import {
  receiverInput,
  lineFiscalInput,
} from "../../packages/domain/src/invoice-fiscal";
let f: Awaited<ReturnType<typeof workspace>>,
  app: Awaited<ReturnType<typeof createApp>>,
  cookie = "",
  csrf = "",
  dep = "",
  draft: any;
const request = (
  path: string,
  method = "GET",
  payload?: any,
  tenant?: string,
) =>
  app.inject({
    method: method as any,
    url: "/api/companies/" + (tenant ?? f.tenants[0]) + path,
    headers: { cookie, origin: f.config.APP_ORIGIN, "x-csrf-token": csrf },
    payload,
  });
beforeAll(async () => {
  f = await workspace({ role: "billing", companies: 2 });
  dep = (
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Ventas') returning id",
      [f.tenants[0]],
    )
  ).rows[0].id;
  app = await createApp(await runtimeConfig(f.config));
  ({ cookie, csrf } = await f.login(app));
  const e = await app.inject({
    method: "POST",
    url: "/api/auth/mfa/enroll",
    headers: { cookie, origin: f.config.APP_ORIGIN, "x-csrf-token": csrf },
  });
  const v = await app.inject({
    method: "POST",
    url: "/api/auth/mfa/verify",
    headers: { cookie, origin: f.config.APP_ORIGIN, "x-csrf-token": csrf },
    payload: { factorId: e.json().factorId, code: totp(e.json().secret) },
  });
  expect(v.statusCode, v.body).toBe(200);
  csrf = (
    await app.inject({ url: "/api/auth/session", headers: { cookie } })
  ).json().csrf;
  draft = (
    await request("/invoice-drafts", "POST", {
      operation_id: randomUUID(),
      receiver_mode: "occasional",
      receiver: receiverInput.parse({
        name: "Cliente de prueba",
        identification_type: "01",
        identification: "123456789",
        domicile: "domestic",
        email: "cliente@example.test",
      }),
      department_id: dep,
      currency: "CRC",
      lines: [
        {
          description: "Servicio de prueba",
          quantity: "2",
          unit_price: "1000",
          fiscal: lineFiscalInput.parse({
            cabys: "0000000000001",
            unit: "Unid",
            treatment: "taxable",
            tariff_code: "08",
          }),
        },
      ],
    })
  ).json().item;
  expect(draft?.id).toBeTruthy();
});
afterAll(async () => {
  await app?.close();
  await f?.pool.end();
});
const input = () => ({
  operation_id: randomUUID(),
  draft_id: draft.id,
  expected_version: draft.version,
  options: {
    sale_condition: "01",
    payment_methods: [{ code: "01", amount: "2260" }],
    branch_code: "001",
    terminal_code: "00001",
    issuer_activity: "123456",
  },
});
it("prepares server-calculated snapshot, preserves receiver and prevents double-click duplication", async () => {
  const payload = input();
  const a = await request("/invoices", "POST", payload);
  expect(a.statusCode, a.body).toBe(200);
  const row = a.json().item;
  expect(row.snapshot.totals).toMatchObject({
    subtotal: "2000.00000",
    tax: "260.00000",
    total: "2260.00000",
  });
  expect(row.snapshot.receiver.name).toBe("Cliente de prueba");
  expect(row.hacienda_status).toBe("pending");
  expect(row.readiness.canEmit).toBe(false);
  const b = await request("/invoices", "POST", payload);
  expect(b.json().item.id).toBe(row.id);
  const c = await request("/invoices", "POST", { ...input() });
  expect(c.json().item.id).toBe(row.id);
  await f.pool.query(
    "update public.invoice_drafts set customer_snapshot=jsonb_set(customer_snapshot,'{name}','\"Nombre cambiado\"'),version=version+1 where id=$1",
    [draft.id],
  );
  const detail = await request("/invoices/" + row.id);
  expect(detail.json().item.snapshot.receiver.name).toBe("Cliente de prueba");
  const issue = await request("/invoices/" + row.id + "/issue", "POST", {
    version: row.version,
    operation_id: randomUUID(),
  });
  expect(issue.statusCode).toBe(403);
});
it("rejects stale version and cross-company drafts without leaking their details", async () => {
  const stale = await request("/invoices", "POST", input());
  expect(stale.statusCode).toBe(409);
  const newer = await request("/invoices", "POST", {
    ...input(),
    expected_version: draft.version + 1,
  });
  expect(newer.statusCode, newer.body).toBe(409);
  const cross = await request(
    "/invoices",
    "POST",
    { ...input(), expected_version: draft.version + 1 },
    f.tenants[1],
  );
  expect(cross.statusCode).toBe(404);
  const list = await request("/invoices");
  expect(list.statusCode, list.body).toBe(200);
  expect(list.json().items).toHaveLength(1);
  const other = await request(
    "/invoices/" + list.json().items[0].id,
    "GET",
    undefined,
    f.tenants[1],
  );
  expect(other.statusCode).toBe(404);
});
it("does not permit clients to set acceptance, totals or private preparation fields", async () => {
  const bad = await request("/invoices", "POST", {
    ...input(),
    hacienda_status: "accepted",
  });
  expect(bad.statusCode).toBe(400);
  const r = await f.pool.query(
    "select has_table_privilege('authenticated','public.electronic_invoices','INSERT') allowed",
  );
  expect(r.rows[0].allowed).toBe(false);
});
it("refreshes only a prepared copy using optimistic versions and current draft data", async () => {
  const row = (await request("/invoices")).json().items[0];
  const r = await request("/invoices/" + row.id, "PATCH", {
    version: row.version,
    expected_version: draft.version + 1,
    options: {
      sale_condition: "02",
      credit_days: 30,
      branch_code: "001",
      terminal_code: "00001",
      issuer_activity: "123456",
    },
  });
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json().item.version).toBe(row.version + 1);
  expect(r.json().item.snapshot.receiver.name).toBe("Nombre cambiado");
  expect(r.json().item.options.sale_condition).toBe("02");
  const stale = await request("/invoices/" + row.id, "PATCH", {
    version: row.version,
    expected_version: draft.version + 1,
    options: {},
  });
  expect(stale.statusCode).toBe(409);
});
it("hides documents after departmental scope is revoked", async () => {
  await f.pool.query(
    "update public.memberships set scope='departments' where tenant_id=$1 and user_id=$2",
    [f.tenants[0], f.userId],
  );
  expect((await request("/invoices")).json().items).toHaveLength(0);
  const r = await f.pool.query(
    "select id from public.electronic_invoices where tenant_id=$1",
    [f.tenants[0]],
  );
  expect((await request("/invoices/" + r.rows[0].id)).statusCode).toBe(404);
});
it("rejects unauthenticated invoice reads and artifact downloads", async () => {
  const r = await app.inject({
    url: "/api/companies/" + f.tenants[0] + "/invoices",
  });
  expect(r.statusCode).toBe(401);
  const row = (
    await f.pool.query(
      "select id from public.electronic_invoices where tenant_id=$1",
      [f.tenants[0]],
    )
  ).rows[0];
  const d = await request("/invoices/" + row.id + "/artifacts/signed_xml");
  expect([403, 404]).toContain(d.statusCode);
});
it("downloads only authorized artifacts and detects corrupted stored bytes", async () => {
  const { createHash } = await import("node:crypto");
  await f.pool.query(
    "update public.memberships set scope='company' where tenant_id=$1 and user_id=$2",
    [f.tenants[0], f.userId],
  );
  await f.pool.query(
    "insert into public.role_permissions select tenant_id,id,'invoices.download' from public.roles where tenant_id=$1 and code='billing' on conflict do nothing",
    [f.tenants[0]],
  );
  const row = (
    await f.pool.query(
      "select id from public.electronic_invoices where tenant_id=$1",
      [f.tenants[0]],
    )
  ).rows[0];
  const content = Buffer.from("<fixture/>");
  await f.pool.query(
    "insert into private.invoice_artifacts(tenant_id,invoice_id,kind,content,sha256) values($1,$2,'signed_xml',$3,$4)",
    [
      f.tenants[0],
      row.id,
      content,
      createHash("sha256").update(content).digest("hex"),
    ],
  );
  const r = await request("/invoices/" + row.id + "/artifacts/signed_xml");
  expect(r.statusCode, r.body).toBe(200);
  expect(r.body).toBe("<fixture/>");
  expect(r.headers["content-type"]).toContain("application/xml");
  const cross = await request(
    "/invoices/" + row.id + "/artifacts/signed_xml",
    "GET",
    undefined,
    f.tenants[1],
  );
  expect(cross.statusCode).toBe(404);
});
it("reserves numbering administration to the explicit owner and preserves confirmed values", async () => {
  expect((await request("/invoices/numbering-options")).json().canConfirm).toBe(
    false,
  );
  const payload = {
    branch_code: "001",
    terminal_code: "00001",
    starting_value: "0",
  };
  expect(
    (await request("/invoices/numbering", "POST", payload)).statusCode,
  ).toBe(403);
  await f.pool.query("insert into private.platform_operators values($1)", [
    f.userId,
  ]);
  await f.pool.query(
    "insert into public.membership_roles select tenant_id,$2,id from public.roles where tenant_id=$1 and code='admin' on conflict do nothing",
    [f.tenants[0], f.userId],
  );
  const branch = (
    await f.pool.query(
      "insert into public.branches(tenant_id,name,code) values($1,'Sucursal prueba','001') returning id",
      [f.tenants[0]],
    )
  ).rows[0].id;
  await f.pool.query(
    "insert into public.terminals(tenant_id,branch_id,name,code) values($1,$2,'Terminal prueba','00001')",
    [f.tenants[0], branch],
  );
  expect((await request("/invoices/numbering-options")).json().canConfirm).toBe(
    true,
  );
  const ok = await request("/invoices/numbering", "POST", {
    ...payload,
    starting_value: "5",
  });
  expect(ok.statusCode, ok.body).toBe(200);
  const lower = await request("/invoices/numbering", "POST", payload);
  expect(lower.statusCode).toBe(409);
  const other = await request(
    "/invoices/numbering-options",
    "GET",
    undefined,
    f.tenants[1],
  );
  expect(other.json().items).toHaveLength(0);
});
it("audits invoice state changes without copying recipient details or credentials", async () => {
  const rows = (
    await f.pool.query(
      "select actor_id,details from public.audit_events where tenant_id=$1 and entity='electronic_invoices' and action='INVOICE_PREPARED'",
      [f.tenants[0]],
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].actor_id).toBe(f.userId);
  expect(rows[0].details.document_status).toBe("prepared");
  expect(rows[0].details).not.toHaveProperty("snapshot");
  expect(JSON.stringify(rows[0].details)).not.toContain("cliente@example.test");
});
