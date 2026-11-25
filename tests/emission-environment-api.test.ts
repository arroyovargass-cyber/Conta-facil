import Fastify from "fastify";
import { afterEach, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { emissionRoutes } from "../apps/api/src/modules/emission";
import { emissionNumberingRoutes } from "../apps/api/src/modules/emission-numbering";
import { xmlFixture } from "./support/invoice-fixture";

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function fixture() {
  const app = Fastify();
  apps.push(app);
  const xml = xmlFixture(),
    tenantId = randomUUID(),
    userId = randomUUID();
  const draft = {
    id: randomUUID(),
    version: 1,
    tenant_id: tenantId,
    department_id: randomUUID(),
    document_type: "FE",
    currency: "CRC",
    customer_snapshot: xml.snapshot.receiver,
    lines: xml.snapshot.lines,
  };
  const invoices: any[] = [],
    numbers = new Map<string, string>();
  const claims = { sub: userId, aal: "aal2", session_id: randomUUID() };
  const principal = { userId, claims };
  const issuer = { ...xml.snapshot.issuer, configuration_version: 1 };
  const db = {
    async query(sql: string, values: any[] = []) {
      if (
        /^(begin|commit|rollback|set local|reset role|select set_config)/.test(
          sql,
        )
      )
        return { rows: [] };
      if (sql.includes("private.has_access"))
        return { rows: [{ allowed: true, aal: "aal2" }] };
      if (sql.includes("private.invoice_emission_metadata"))
        return { rows: [{ metadata: {} }] };
      if (sql.includes("private.invoice_artifact_kinds"))
        return { rows: [{ kinds: [] }] };
      if (sql.includes("from public.document_work_items")) return { rows: [] };
      if (sql.includes("from public.invoice_drafts d"))
        return {
          rows: values[0] === tenantId && values[1] === draft.id ? [draft] : [],
        };
      if (sql.includes("from public.tenants")) return { rows: [issuer] };
      if (sql.includes("from public.electronic_invoices")) {
        let rows = invoices.filter((row) => row.tenant_id === values[0]);
        if (sql.includes("created_by=$2 and operation_id=$3"))
          rows = rows.filter(
            (row) =>
              row.created_by === values[1] && row.operation_id === values[2],
          );
        else if (sql.includes("draft_id=$2"))
          rows = rows.filter((row) => row.draft_id === values[1]);
        else if (sql.includes("id=$2"))
          rows = rows.filter((row) => row.id === values[1]);
        const filter = sql.match(/environment=\$(\d+)/);
        if (filter)
          rows = rows.filter(
            (row) => row.environment === values[Number(filter[1]) - 1],
          );
        return { rows };
      }
      if (sql.startsWith("insert into public.electronic_invoices")) {
        const columns = sql
          .match(/electronic_invoices\(([^)]+)\)/)![1]
          .split(",");
        const row = {
          id: randomUUID(),
          environment: "test",
          document_type: "FE",
          version: 1,
          document_status: "prepared",
          transmission_status: "not_sent",
          ...Object.fromEntries(
            columns.map((column, index) => [column, values[index]]),
          ),
        };
        invoices.push(row);
        return { rows: [row] };
      }
      if (sql.includes("private.confirm_emission_numbering")) {
        numbers.set(values[4] ?? "test", values[3]);
        return { rows: [] };
      }
      if (sql.includes("from public.branches b"))
        return {
          rows: [
            {
              branch_code: "001",
              terminal_code: "00001",
              last_value: numbers.get(values[1] ?? "test") ?? "0",
              legacy_floor: "0",
            },
          ],
        };
      throw new Error("Unexpected fixture query: " + sql);
    },
    release() {},
  };
  const pool: any = { connect: async () => db };
  const auth: any = { authenticate: async () => principal };
  app.addHook("onRequest", async (req) => {
    req.principal = principal as any;
  });
  app.setErrorHandler((error, _req, reply) => {
    reply
      .code(
        error instanceof z.ZodError ? 400 : ((error as any).statusCode ?? 500),
      )
      .send({ message: (error as Error).message });
  });
  emissionNumberingRoutes(app, pool, auth);
  emissionRoutes(app, pool, auth, {} as any);
  const payload = () => ({
    operation_id: randomUUID(),
    draft_id: draft.id,
    expected_version: 1,
    options: xml.options,
  });
  const request = (url: string, method = "GET", body?: any) =>
    app.inject({
      method: method as any,
      url: `/api/companies/${tenantId}${url}`,
      payload: body,
    });
  return { app, draft, tenantId, userId, issuer, invoices, payload, request };
}

it("prepares and lists the same draft independently in tests and production", async () => {
  const f = fixture();
  const test = await f.request("/invoices", "POST", f.payload());
  expect(test.statusCode, test.body).toBe(200);
  expect(test.json().item.environment).toBe("test");
  const production = await f.request("/invoices", "POST", {
    ...f.payload(),
    environment: "production",
  });
  expect(production.statusCode, production.body).toBe(200);
  expect(production.json().item.environment).toBe("production");
  expect(production.json().item.id).not.toBe(test.json().item.id);
  expect(
    (await f.request("/invoices")).json().items.map((i: any) => i.id),
  ).toEqual([test.json().item.id]);
  expect(
    (await f.request("/invoices?environment=production"))
      .json()
      .items.map((i: any) => i.id),
  ).toEqual([production.json().item.id]);
  const detail = await f.request("/invoices/" + production.json().item.id);
  expect(detail.json().item.environment).toBe("production");
});

it("replays a legacy test preparation hash with omitted or explicit test environment", async () => {
  const f = fixture(),
    payload = f.payload();
  const legacy = {
    id: randomUUID(),
    tenant_id: f.tenantId,
    created_by: f.userId,
    environment: "test",
    operation_id: payload.operation_id,
    request_hash: createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex"),
    draft_id: f.draft.id,
    draft_version: 1,
    department_id: f.draft.department_id,
    document_type: "FE",
    document_status: "prepared",
    version: 1,
    options: payload.options,
    snapshot: { ...xmlFixture().snapshot, issuer: f.issuer },
  };
  f.invoices.push(legacy);
  for (const body of [payload, { ...payload, environment: "test" }]) {
    const replay = await f.request("/invoices", "POST", body);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().item.id).toBe(legacy.id);
  }
  expect(f.invoices).toHaveLength(1);
  const cross = await f.request("/invoices", "POST", {
    ...payload,
    environment: "production",
  });
  expect(cross.statusCode, cross.body).toBe(409);
  expect(f.invoices).toHaveLength(1);
});

it("rejects reuse of a production preparation operation in tests", async () => {
  const f = fixture(),
    payload = f.payload();
  expect(
    (
      await f.request("/invoices", "POST", {
        ...payload,
        environment: "production",
      })
    ).statusCode,
  ).toBe(200);
  expect((await f.request("/invoices", "POST", payload)).statusCode).toBe(409);
  expect(f.invoices).toHaveLength(1);
});

it("keeps numbering confirmation and options in the requested environment", async () => {
  const f = fixture(),
    body = { branch_code: "001", terminal_code: "00001", starting_value: "7" };
  const test = await f.request("/invoices/numbering", "POST", body);
  expect(test.json()).toEqual({ confirmed: true, environment: "test" });
  const production = await f.request("/invoices/numbering", "POST", {
    ...body,
    starting_value: "11",
    environment: "production",
  });
  expect(production.statusCode, production.body).toBe(200);
  expect(production.json()).toEqual({
    confirmed: true,
    environment: "production",
  });
  expect((await f.request("/invoices/numbering-options")).json()).toMatchObject(
    { environment: "test", items: [{ last_value: "7" }] },
  );
  expect(
    (
      await f.request("/invoices/numbering-options?environment=production")
    ).json(),
  ).toMatchObject({ environment: "production", items: [{ last_value: "11" }] });
});

it("rejects unsupported fiscal environments before database writes", async () => {
  const f = fixture();
  for (const url of [
    "/invoices?environment=staging",
    "/invoices/numbering-options?environment=staging",
  ])
    expect((await f.request(url)).statusCode).toBe(400);
  expect(
    (
      await f.request("/invoices", "POST", {
        ...f.payload(),
        environment: "staging",
      })
    ).statusCode,
  ).toBe(400);
  expect(f.invoices).toHaveLength(0);
});
