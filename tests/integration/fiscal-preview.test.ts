import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { workspace } from "../support/workspace";
import { runtimeConfig } from "../support/runtime-config";
import { createApp } from "../../apps/api/src/app";
let f: Awaited<ReturnType<typeof workspace>>,
  app: Awaited<ReturnType<typeof createApp>>,
  cookie = "",
  csrf = "",
  dep: string,
  otherDep: string,
  draft: string,
  otherDraft: string;
const body = (version = 1) => ({
  profile: "FE_CRC_CASH_IVA13",
  expected_version: version,
  confirmed_general_vat: true,
});
const request = (
  id = draft,
  input: any = body(),
  tenant?: string,
  headers?: Record<string, string>,
) =>
  app.inject({
    method: "POST",
    url:
      "/api/companies/" +
      (tenant ?? f.tenants[0]) +
      "/invoice-drafts/" +
      id +
      "/fiscal-preview",
    headers: {
      cookie,
      origin: f.config.APP_ORIGIN,
      "x-csrf-token": csrf,
      ...headers,
    },
    payload: input,
  });
async function insertDraft(
  tenant: string,
  department: string,
  price = "1000",
  currency = "CRC",
) {
  const c = (
    await f.pool.query(
      "insert into public.customers(tenant_id,name) values($1,'Cliente simulado') returning id",
      [tenant],
    )
  ).rows[0].id;
  const d = (
    await f.pool.query(
      "insert into public.invoice_drafts(tenant_id,customer_id,department_id,currency,customer_snapshot,created_by,updated_by,operation_id,request_hash) values($1,$2,$3,$4,'{\"name\":\"Cliente simulado\"}',$5,$5,$6,'fixture') returning id",
      [tenant, c, department, currency, f.userId, randomUUID()],
    )
  ).rows[0].id;
  await f.pool.query(
    "insert into public.invoice_draft_lines(tenant_id,draft_id,position,description,quantity,unit_price) values($1,$2,1,'Servicio de prueba',1,$3)",
    [tenant, d, price],
  );
  return d;
}
beforeAll(async () => {
  f = await workspace({ role: "accountant", companies: 2 });
  // Exercise a reader that has no tax settings permission or mutation capability.
  await f.pool.query(
    "delete from public.role_permissions where tenant_id=any($1::uuid[]) and permission='tax.read'",
    [f.tenants],
  );
  [dep, otherDep] = (
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Autorizado'),($1,'Privado') returning id",
      [f.tenants[0]],
    )
  ).rows.map((r) => r.id);
  draft = await insertDraft(f.tenants[0], dep);
  otherDraft = await insertDraft(f.tenants[0], otherDep);
  await f.pool.query(
    "update public.memberships set scope='departments' where user_id=$1",
    [f.userId],
  );
  await f.pool.query(
    "insert into public.membership_departments values($1,$2,$3)",
    [f.tenants[0], f.userId, dep],
  );
  app = await createApp(await runtimeConfig(f.config));
  ({ cookie, csrf } = await f.login(app));
});
afterAll(async () => {
  await app?.close();
  await f?.pool.end();
});
it("calculates for a read-only departmental user without tax permission and does not persist changes", async () => {
  const before = await f.pool.query(
    "select row_to_json(d) doc from public.invoice_drafts d where id=$1",
    [draft],
  );
  const auditBefore = (
    await f.pool.query(
      "select count(*)::int n from public.audit_events where tenant_id=$1",
      [f.tenants[0]],
    )
  ).rows[0].n;
  for (let i = 0; i < 2; i++) {
    const r = await request();
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      draft_id: draft,
      draft_version: 1,
      calculation: { base: "1000", vat: "130", total: "1130" },
      readiness: {
        canGenerateXml: false,
        xsdValidation: "not_run",
        signature: "missing",
        haciendaStatus: "not_sent",
      },
    });
    expect(r.json()).not.toHaveProperty("notes");
  }
  expect(
    (
      await f.pool.query(
        "select row_to_json(d) doc from public.invoice_drafts d where id=$1",
        [draft],
      )
    ).rows,
  ).toEqual(before.rows);
  expect(
    (
      await f.pool.query(
        "select count(*)::int n from public.audit_events where tenant_id=$1",
        [f.tenants[0]],
      )
    ).rows[0].n,
  ).toBe(auditBefore);
  const perms = (
    await f.pool.query(
      "select p.permission from public.membership_roles r join public.role_permissions p on p.role_id=r.role_id where r.tenant_id=$1 and r.user_id=$2",
      [f.tenants[0], f.userId],
    )
  ).rows.map((r) => r.permission);
  expect(perms).not.toContain("tax.read");
  expect(perms).not.toContain("invoices.manage");
});
it("rejects inaccessible objects, foreign tenant paths and stale versions", async () => {
  expect((await request(otherDraft)).statusCode).toBe(404);
  expect((await request(randomUUID())).statusCode).toBe(404);
  expect((await request(draft, body(), f.tenants[1])).statusCode).toBe(404);
  expect((await request(draft, body(99))).statusCode).toBe(409);
});
it("requires authenticated session, CSRF, Origin and the strict confirmed contract", async () => {
  expect(
    (await request(draft, body(), undefined, { cookie: "" })).statusCode,
  ).toBe(401);
  expect(
    (await request(draft, body(), undefined, { "x-csrf-token": "wrong" }))
      .statusCode,
  ).toBe(403);
  expect(
    (await request(draft, body(), undefined, { origin: "https://other.test" }))
      .statusCode,
  ).toBe(403);
  for (const extra of [
    { confirmed_general_vat: false },
    { vat: 13 },
    { total: "100" },
    { xml: "<test/>" },
  ])
    expect((await request(draft, { ...body(), ...extra })).statusCode).toBe(
      400,
    );
});
it("keeps decimal strings exact and permits archived reads without restoring or mutating", async () => {
  const id = await insertDraft(f.tenants[0], dep, "0.2");
  await f.pool.query(
    "update public.invoice_draft_lines set quantity=0.1 where draft_id=$1",
    [id],
  );
  await f.pool.query(
    "update public.invoice_drafts set archived_at=now() where id=$1",
    [id],
  );
  const r = await request(id);
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json().calculation).toMatchObject({
    base: "0.02",
    vat: "0.0026",
    total: "0.0226",
  });
  expect(r.json().calculation.lines[0].base).toBeTypeOf("string");
  expect(
    (
      await f.pool.query(
        "select archived_at from public.invoice_drafts where id=$1",
        [id],
      )
    ).rows[0].archived_at,
  ).not.toBeNull();
});
it("reports unsupported currency and precision without publishing any total", async () => {
  for (const [price, currency, code] of [
    ["1000", "USD", "UNSUPPORTED_CURRENCY"],
    ["0.00001", "CRC", "ROUNDING_POLICY_PENDING"],
  ]) {
    const id = await insertDraft(f.tenants[0], dep, price, currency),
      r = await request(id);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().calculation).toEqual({
      status: "blocked",
      currency: "CRC",
    });
    expect(r.json().readiness.issues.some((i: any) => i.code === code)).toBe(
      true,
    );
  }
});
it("returns header version and line values from the same committed snapshot during concurrent changes", async () => {
  const id = await insertDraft(f.tenants[0], dep, "1");
  const writer = (async () => {
    const db = await f.pool.connect();
    try {
      for (let v = 2; v <= 16; v++) {
        await db.query("begin");
        await db.query(
          "update public.invoice_drafts set version=$2 where id=$1",
          [id, v],
        );
        await db.query(
          "update public.invoice_draft_lines set unit_price=$2 where draft_id=$1",
          [id, String(v)],
        );
        await db.query("commit");
      }
    } finally {
      db.release();
    }
  })();
  const results = await Promise.all(
    Array.from({ length: 16 }, (_, i) => request(id, body(i + 1))),
  );
  await writer;
  for (const [i, r] of results.entries()) {
    expect([200, 409], r.body).toContain(r.statusCode);
    if (r.statusCode === 200) {
      expect(r.json().draft_version).toBe(i + 1);
      expect(r.json().calculation.base).toBe(String(i + 1));
    }
  }
  const final = await request(id, body(16));
  expect(final.statusCode, final.body).toBe(200);
  expect(final.json().calculation.base).toBe("16");
});
it("loses access immediately after membership revocation", async () => {
  await f.pool.query(
    "update public.memberships set active=false where tenant_id=$1 and user_id=$2",
    [f.tenants[0], f.userId],
  );
  expect((await request()).statusCode).toBe(404);
});
