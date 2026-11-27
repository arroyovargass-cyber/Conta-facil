import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { workspace } from "../support/workspace";
import { runtimeConfig } from "../support/runtime-config";
import { createApp } from "../../apps/api/src/app";

let f: Awaited<ReturnType<typeof workspace>>,
  app: Awaited<ReturnType<typeof createApp>>,
  cookie = "",
  department = "",
  hidden = "";
const ids: Record<string, string> = {};
const request = (query = "", tenant?: string) =>
  app.inject({
    url: `/api/companies/${tenant ?? f.tenants[0]}/invoices?environment=test${query}`,
    headers: { cookie },
  });
// Administrative synthetic fixtures exercise reads only. They are never signed,
// transmitted, emailed or used as evidence of a real acceptance by Hacienda.
async function record(
  name: string,
  input: {
    tenant?: string;
    department?: string;
    status?: string;
    document?: string;
    currency?: string;
    total?: string;
    tax?: string;
    exonerations?: string;
    sale?: string;
  } = {},
) {
  const tenant = input.tenant ?? f.tenants[0],
    dep = input.department ?? department;
  const draft = (
    await f.pool.query(
      "insert into public.invoice_drafts(tenant_id,department_id,currency,customer_snapshot,created_by,updated_by,operation_id,request_hash) values($1,$2,'CRC','{}',$3,$3,$4,'history-test') returning id",
      [tenant, dep, f.userId, randomUUID()],
    )
  ).rows[0].id;
  const status = input.status ?? "accepted";
  ids[name] = (
    await f.pool.query(
      `insert into public.electronic_invoices(tenant_id,draft_id,draft_version,department_id,document_type,snapshot,options,created_by,operation_id,request_hash,document_status,hacienda_status,issued_by,issued_at,consecutivo,clave)
     values($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
      [
        tenant,
        draft,
        dep,
        input.document ?? "FE",
        {
          receiver: { name, identification: "123456789" },
          currency: input.currency ?? "CRC",
          totals: {
            status: "complete",
            total: input.total ?? "2260.00000",
            tax: input.tax ?? "260.00000",
            exonerations: input.exonerations ?? "0.00000",
          },
        },
        { sale_condition: input.sale ?? "01" },
        f.userId,
        randomUUID(),
        "a".repeat(64),
        status === "prepared" ? "prepared" : "issued",
        status === "prepared" ? "pending" : status,
        status === "prepared" ? null : f.userId,
        status === "prepared" ? null : "2026-11-27T05:00:00Z",
        status === "prepared"
          ? null
          : "0010000101" +
            String(Object.keys(ids).length + 1).padStart(10, "0"),
        status === "prepared"
          ? null
          : String(Object.keys(ids).length + 1).padStart(50, "0"),
      ],
    )
  ).rows[0].id;
}
beforeAll(async () => {
  f = await workspace({ role: "operative", companies: 2 });
  await f.pool.query(
    "insert into public.role_permissions select tenant_id,id,p from public.roles cross join unnest(array['invoices.read','reports.read']) p where tenant_id=any($1::uuid[]) and code='operative'",
    [f.tenants],
  );
  [department, hidden] = (
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Visible'),($1,'Oculto') returning id",
      [f.tenants[0]],
    )
  ).rows.map((r) => r.id);
  const other = (
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Externo') returning id",
      [f.tenants[1]],
    )
  ).rows[0].id;
  await record("Aceptada CRC");
  await record("Aceptada USD", {
    document: "TE",
    currency: "USD",
    total: "11.30000",
    tax: "1.30000",
    sale: "02",
  });
  await record("Rechazada", {
    status: "rejected",
    total: "1130.00000",
    tax: "130.00000",
  });
  await record("Pendiente", {
    status: "pending",
    total: "3390.00000",
    tax: "390.00000",
  });
  await record("Preparada", { status: "prepared", total: "900.00000" });
  await record("Departamento no autorizado", {
    department: hidden,
    total: "77777.00000",
  });
  await record("Empresa distinta", {
    tenant: f.tenants[1],
    department: other,
    total: "99999.00000",
  });
  await f.pool.query(
    "update public.memberships set scope='departments' where tenant_id=$1 and user_id=$2",
    [f.tenants[0], f.userId],
  );
  await f.pool.query(
    "insert into public.membership_departments values($1,$2,$3)",
    [f.tenants[0], f.userId, department],
  );
  app = await createApp(await runtimeConfig(f.config));
  ({ cookie } = await f.login(app));
});
afterAll(async () => {
  await app?.close();
  await f?.pool.end();
});

it("counts preparations separately and totals only accepted issued sales in each currency and authorized department", async () => {
  const response = await request("&include_summary=true");
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().items).toHaveLength(5);
  expect(response.json().summary).toMatchObject({
    counts: {
      prepared: 1,
      accepted: 2,
      rejected: 1,
      pending: 1,
      cash: 1,
      credit: 1,
    },
    amounts: [
      {
        currency: "CRC",
        total: "2260.00000",
        tax: "260.00000",
        cash: "2260.00000",
        credit: "0",
      },
      {
        currency: "USD",
        total: "11.30000",
        tax: "1.30000",
        cash: "0",
        credit: "11.30000",
      },
    ],
  });
  expect(response.body).not.toContain("77777");
  expect(response.body).not.toContain("99999");
});
it("filters emission dates in Costa Rica, recipient, document, sale, issuer and currency on the server", async () => {
  const query =
    "&from=2026-11-26&to=2026-11-26&document_type=TE&currency=USD&sale_condition=02&hacienda_status=accepted&document_status=issued&identification=123456789&issued_by=" +
    f.userId;
  const response = await request(query + "&include_summary=true");
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().items.map((r: any) => r.id)).toEqual([
    ids["Aceptada USD"],
  ]);
  expect(response.json().summary.counts.accepted).toBe(1);
  expect(response.json().summary.amounts).toHaveLength(1);
  const byNumber = await request("&consecutivo=00100001010000000001");
  expect(byNumber.json().items.map((r: any) => r.id)).toEqual([
    ids["Aceptada CRC"],
  ]);
  const byKey = await request("&clave=" + "1".padStart(50, "0"));
  expect(byKey.json().items.map((r: any) => r.id)).toEqual([
    ids["Aceptada CRC"],
  ]);
  expect((await request("&search=%25")).json().items).toEqual([]);
  expect(
    (await request("&from=2026-11-27")).json().items.map((r: any) => r.id),
  ).not.toContain(ids["Aceptada CRC"]);
});
it("reports net taxes after full and partial exonerations, matching the XML", async () => {
  await record("Exoneración completa", {
    total: "2000.00000",
    exonerations: "260.00000",
  });
  await record("Exoneración parcial", {
    total: "2100.00000",
    exonerations: "160.00000",
  });
  const response = await request(
    "&include_summary=true&search=Exoneraci%C3%B3n",
  );
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().summary.amounts[0]).toMatchObject({
    total: "4100.00000",
    tax: "100.00000",
  });
});
it("requires report permission independently of invoice read permission", async () => {
  await f.pool.query(
    "delete from public.role_permissions where tenant_id=$1 and permission='reports.read'",
    [f.tenants[0]],
  );
  const result = await request("&include_summary=true");
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().items.length).toBeGreaterThan(0);
  expect(result.json().summary).toBeNull();
});
it("rejects impossible date ranges and never reports another company's totals", async () => {
  expect((await request("&from=2026-02-30")).statusCode).toBe(400);
  expect((await request("&from=2026-11-27&to=2026-11-26")).statusCode).toBe(
    400,
  );
  const other = await request("&include_summary=true", f.tenants[1]);
  expect(other.statusCode, other.body).toBe(200);
  expect(other.json().items).toHaveLength(1);
  expect(other.body).not.toContain(ids["Aceptada CRC"]);
});
