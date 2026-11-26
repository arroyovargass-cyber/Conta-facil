import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
it("repairs hosted auth-schema drift so an authorized server can prepare without reading Auth tables", async () => {
  // Reproduce the hosted ACL exactly: EXECUTE is granted, but schema USAGE is absent.
  await f.pool.query("revoke usage on schema auth from conta_facil_api");
  try {
    const diagnostic = await f.pool.connect();
    try {
      await diagnostic.query("begin");
      await diagnostic.query("set local role conta_facil_api");
      await expect(diagnostic.query("select auth.uid()")).rejects.toMatchObject(
        { code: "42501" },
      );
    } finally {
      await diagnostic.query("rollback");
      diagnostic.release();
    }
    await f.pool.query(
      readFileSync(
        "supabase/migrations/20261126144207_runtime_request_context.sql",
        "utf8",
      ),
    );
    const payload = input();
    const fixed = await request("/invoices", "POST", payload);
    expect(fixed.statusCode, fixed.body).toBe(200);
    expect(fixed.json().item.snapshot.totals.total).toBe("2260.00000");
    expect(fixed.json().item.hacienda_status).toBe("pending");
    expect((await request("/invoices", "POST", payload)).json().item.id).toBe(
      fixed.json().item.id,
    );
    expect(
      (await request("/invoices", "POST", payload, f.tenants[1])).statusCode,
    ).toBe(404);
    const issue = await request(
      "/invoices/" + fixed.json().item.id + "/issue",
      "POST",
      { operation_id: randomUUID(), version: 1 },
    );
    expect(issue.statusCode).toBe(403);
    const acl = (
      await f.pool.query(`select
      has_schema_privilege('conta_facil_api','auth','USAGE') as usage,
      has_schema_privilege('conta_facil_api','auth','CREATE') as create_schema,
      has_table_privilege('conta_facil_api','auth.users','SELECT') as users_read,
      (select rolbypassrls from pg_roles where rolname='conta_facil_api') as bypass_rls`)
    ).rows[0];
    expect(acl).toEqual({
      usage: false,
      create_schema: false,
      users_read: false,
      bypass_rls: false,
    });
  } finally {
    await f.pool.query("grant usage on schema auth to conta_facil_api");
  }
});
