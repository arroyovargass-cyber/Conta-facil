import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { workspace } from "../support/workspace";
import { runtimeConfig } from "../support/runtime-config";
import { totp } from "../support/totp";
import { createApp } from "../../apps/api/src/app";
import {
  lineFiscalInput,
  receiverInput,
} from "../../packages/domain/src/invoice-fiscal";
let f: Awaited<ReturnType<typeof workspace>>,
  app: Awaited<ReturnType<typeof createApp>>,
  cookie = "",
  csrf = "",
  dep = "",
  customer: any;
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
const fiscal = (tariff = "08", treatment = "taxable") =>
  lineFiscalInput.parse({
    cabys: "0000000000001",
    unit: "Unid",
    tariff_code: tariff,
    treatment,
  }); // Synthetic CABYS fixture, never declared catalog-verified.
const receiver = () =>
  receiverInput.parse({
    name: "Cliente ocasional",
    identification_type: "01",
    identification: "123456789",
    email: "cliente@example.test",
    economic_activity: "123456",
    province: "1",
    canton: "01",
    district: "01",
  });
const draft = (extra: any = {}) => ({
  operation_id: randomUUID(),
  customer_id: null,
  receiver_mode: "occasional",
  receiver: receiver(),
  department_id: dep,
  currency: "CRC",
  lines: [
    {
      description: "Servicio",
      quantity: "2",
      unit_price: "1000",
      fiscal: fiscal(),
    },
  ],
  ...extra,
});
beforeAll(async () => {
  f = await workspace({ role: "billing", companies: 2 });
  await f.pool.query(
    "insert into public.role_permissions select tenant_id,id,p from public.roles cross join unnest(array['customers.manage','catalog.manage']) p where tenant_id=$1 and code='billing' on conflict do nothing",
    [f.tenants[0]],
  );
  dep = (
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Ventas') returning id",
      [f.tenants[0]],
    )
  ).rows[0].id;
  app = await createApp(await runtimeConfig(f.config));
  ({ cookie, csrf } = await f.login(app));
  const enroll = await app.inject({
    method: "POST",
    url: "/api/auth/mfa/enroll",
    headers: { cookie, origin: f.config.APP_ORIGIN, "x-csrf-token": csrf },
  });
  const verify = await app.inject({
    method: "POST",
    url: "/api/auth/mfa/verify",
    headers: { cookie, origin: f.config.APP_ORIGIN, "x-csrf-token": csrf },
    payload: {
      factorId: enroll.json().factorId,
      code: totp(enroll.json().secret),
    },
  });
  expect(verify.statusCode).toBe(200);
  csrf = (
    await app.inject({ url: "/api/auth/session", headers: { cookie } })
  ).json().csrf;
});
afterAll(async () => {
  await app?.close();
  await f?.pool.end();
});
it("stores full fiscal customer data and product defaults without touching old commercial prices", async () => {
  const c = await request("/customers", "POST", {
    ...receiver(),
    trade_name: "Comercial",
    address: "Dirección",
    active: true,
  });
  expect(c.statusCode, c.body).toBe(200);
  customer = c.json().item;
  expect(customer.economic_activity).toBe("123456");
  const p = await request("/catalog-items", "POST", {
    code: "FISCAL-1",
    description: "Servicio",
    kind: "service",
    currency: "CRC",
    unit_price: "1000",
    cabys: "0000000000001",
    unit: "Unid",
    tax_defaults: fiscal(),
  });
  expect(p.statusCode, p.body).toBe(200);
  expect(p.json().item.tax_defaults.tariff_code).toBe("08");
});
it("saves a quick sale without creating a customer and computes 2000 + 260 = 2260", async () => {
  const before = Number(
    (
      await f.pool.query(
        "select count(*) from public.customers where tenant_id=$1",
        [f.tenants[0]],
      )
    ).rows[0].count,
  );
  const payload = draft();
  const response = await request("/invoice-drafts", "POST", payload);
  expect(response.statusCode, response.body).toBe(200);
  const item = response.json().item;
  expect(item.customer_id).toBeNull();
  expect(item.fiscal_totals).toMatchObject({
    status: "complete",
    subtotal: "2000.00000",
    tax: "260.00000",
    total: "2260.00000",
  });
  expect(
    Number(
      (
        await f.pool.query(
          "select count(*) from public.customers where tenant_id=$1",
          [f.tenants[0]],
        )
      ).rows[0].count,
    ),
  ).toBe(before);
  const repeated = await request("/invoice-drafts", "POST", payload);
  expect(repeated.json().item.id).toBe(item.id);
  const reopened = await request("/invoice-drafts/" + item.id);
  expect(reopened.json().item.customer_snapshot).toMatchObject(receiver());
  expect(reopened.json().item.lines[0].fiscal.cabys).toBe("0000000000001");
  const print = await request("/invoice-drafts/" + item.id + "/print");
  expect(print.statusCode).toBe(200);
  expect(print.body).toContain("2260.00000");
  expect(print.body).toContain("SIN VALIDEZ TRIBUTARIA");
});
it("optionally saves once and detects duplicates within the tenant atomically", async () => {
  const r = { ...receiver(), identification: "234567890" };
  const payload = draft({ receiver: r, save_customer: true });
  const a = await request("/invoice-drafts", "POST", payload);
  expect(a.statusCode, a.body).toBe(200);
  const replay = await request("/invoice-drafts", "POST", payload);
  expect(replay.statusCode).toBe(200);
  expect(
    (
      await f.pool.query(
        "select count(*) from public.customers where tenant_id=$1 and identification='234567890'",
        [f.tenants[0]],
      )
    ).rows[0].count,
  ).toBe("1");
  const duplicate = await request(
    "/invoice-drafts",
    "POST",
    draft({ receiver: r, save_customer: true }),
  );
  expect(duplicate.statusCode).toBe(409);
});
it("uses a registered customer snapshot and preserves it after catalog changes", async () => {
  const response = await request(
    "/invoice-drafts",
    "POST",
    draft({
      receiver_mode: "registered",
      customer_id: customer.id,
      receiver: undefined,
    }),
  );
  expect(response.statusCode, response.body).toBe(200);
  const item = response.json().item;
  expect(item.customer_snapshot.trade_name).toBe("Comercial");
  await request("/customers/" + customer.id, "PATCH", {
    version: customer.version,
    trade_name: "Nombre nuevo",
  });
  const reopened = (await request("/invoice-drafts/" + item.id)).json().item;
  expect(reopened.customer_snapshot.trade_name).toBe("Comercial");
  const update = await request("/invoice-drafts/" + item.id, "PATCH", {
    customer_id: customer.id,
    receiver_mode: "registered",
    department_id: dep,
    currency: "CRC",
    lines: draft().lines,
    version: item.version,
  });
  expect(update.statusCode, update.body).toBe(200);
  expect(update.json().item.customer_snapshot.trade_name).toBe("Comercial");
});
it("preserves different tariff groups, discounts, exempt and non-subject treatments", async () => {
  const lines = [
    {
      description: "IVA13",
      quantity: "2",
      unit_price: "1000",
      fiscal: {
        ...fiscal(),
        discount_amount: "100",
        discount_code: "07",
        discount_reason: "Comercial",
      },
    },
    {
      description: "IVA1",
      quantity: "1",
      unit_price: "1000",
      fiscal: fiscal("02"),
    },
    {
      description: "Exenta",
      quantity: "1",
      unit_price: "100",
      fiscal: fiscal("10", "exempt"),
    },
    {
      description: "No sujeta",
      quantity: "1",
      unit_price: "100",
      fiscal: fiscal("11", "non_subject"),
    },
  ];
  const response = await request("/invoice-drafts", "POST", draft({ lines }));
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().item.fiscal_totals).toMatchObject({
    subtotal: "3100.00000",
    discounts: "100.00000",
    tax: "257.00000",
    total: "3357.00000",
  });
  expect(response.json().item.fiscal_totals.groups).toHaveLength(4);
});
it("saves incomplete drafts without assuming tax or inventing receiver identity", async () => {
  const response = await request(
    "/invoice-drafts",
    "POST",
    draft({
      document_type: "TE",
      receiver: receiverInput.parse({}),
      lines: [{ description: "", quantity: null, unit_price: null }],
    }),
  );
  expect(response.statusCode, response.body).toBe(200);
  const item = response.json().item;
  expect(item.customer_id).toBeNull();
  expect(item.fiscal_totals.status).toBe("blocked");
  expect(item.subtotal).toBeNull();
  expect(item.lines[0].fiscal).toBeNull();
  expect(item.document_type).toBe("TE");
});
it("isolates documents and printing between tenants and rejects forged totals", async () => {
  const result = await request("/invoice-drafts", "POST", draft());
  const id = result.json().item.id;
  expect(
    (await request("/invoice-drafts/" + id, "GET", undefined, f.tenants[1]))
      .statusCode,
  ).toBe(404);
  expect(
    (
      await request(
        "/invoice-drafts/" + id + "/print",
        "GET",
        undefined,
        f.tenants[1],
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await request(
        "/invoice-drafts",
        "POST",
        draft({ fiscal_totals: { total: "1" } }),
      )
    ).statusCode,
  ).toBe(400);
  const bad = draft();
  (bad.lines[0].fiscal as any).tax_amount = "1";
  expect((await request("/invoice-drafts", "POST", bad)).statusCode).toBe(400);
});
it("escapes recipient and line text in the printable document", async () => {
  const payload = draft({
    receiver: { ...receiver(), name: "Cliente <script>alert(1)</script>" },
    lines: [
      {
        description: "<img src=x onerror=alert(1)>",
        quantity: "1",
        unit_price: "1000",
        fiscal: fiscal(),
      },
    ],
  });
  const a = await request("/invoice-drafts", "POST", payload);
  expect(a.statusCode, a.body).toBe(200);
  const print = await request("/invoice-drafts/" + a.json().item.id + "/print");
  expect(print.body).not.toContain("<script>");
  expect(print.body).toContain("&lt;script&gt;");
  expect(print.body).not.toContain("<img src=x");
});
it("preserves the foreign address in the saved and printable receiver", async () => {
  const response = await request(
    "/invoice-drafts",
    "POST",
    draft({
      receiver: {
        ...receiver(),
        identification_type: "05",
        identification: "FOREIGN-XYZ",
        domicile: "foreign",
        foreign_address: "123 Main Street, Ciudad extranjera",
        province: "",
        canton: "",
        district: "",
      },
    }),
  );
  expect(response.statusCode, response.body).toBe(200);
  const saved = response.json().item;
  expect(saved.customer_snapshot.foreign_address).toBe(
    "123 Main Street, Ciudad extranjera",
  );
  const print = await request("/invoice-drafts/" + saved.id + "/print");
  expect(print.body).toContain("123 Main Street, Ciudad extranjera");
});
it("keeps invalid location hierarchy as an explicit draft readiness issue", async () => {
  const response = await request(
    "/invoice-drafts",
    "POST",
    draft({
      receiver: {
        ...receiver(),
        domicile: "domestic",
        address: "Dirección pendiente de corregir",
        province: "7",
        canton: "99",
        district: "99",
      },
    }),
  );
  expect(response.statusCode, response.body).toBe(200);
  expect(
    response
      .json()
      .item.readiness.issues.some(
        (i: any) => i.code === "LOCATION_HIERARCHY_INVALID",
      ),
  ).toBe(true);
});
it("stores and prints partial exoneration separately from gross IVA", async () => {
  const response = await request(
    "/invoice-drafts",
    "POST",
    draft({
      lines: [
        {
          description: "Servicio exonerado parcialmente",
          quantity: "1",
          unit_price: "1000",
          fiscal: {
            ...fiscal(),
            treatment: "exonerated",
            exoneration: {
              document_type: "01",
              document_number: "SYNTHETIC-01",
              institution: "01",
              issue_date: "2026-01-01T00:00:00-06:00",
              rate: "8",
            },
          },
        },
      ],
    }),
  );
  expect(response.statusCode, response.body).toBe(200);
  const item = response.json().item;
  expect(item.fiscal_totals).toMatchObject({
    subtotal: "1000.00000",
    tax: "130.00000",
    exonerations: "80.00000",
    total: "1050.00000",
  });
  const print = await request("/invoice-drafts/" + item.id + "/print");
  expect(print.body).toContain("1050.00000");
  expect(print.body).toContain("80.00000");
});
it("handles simultaneous quick-sale retries without duplicate documents or customers", async () => {
  const payload = draft({
    receiver: { ...receiver(), identification: "345678901" },
    save_customer: true,
  });
  const [a, b] = await Promise.all([
    request("/invoice-drafts", "POST", payload),
    request("/invoice-drafts", "POST", payload),
  ]);
  expect(a.statusCode, a.body).toBe(200);
  expect(b.statusCode, b.body).toBe(200);
  expect(a.json().item.id).toBe(b.json().item.id);
  expect(
    (
      await f.pool.query(
        "select count(*) from public.customers where tenant_id=$1 and identification='345678901'",
        [f.tenants[0]],
      )
    ).rows[0].count,
  ).toBe("1");
});
it("allows occasional drafting but denies optional customer creation without its permission", async () => {
  await f.pool.query(
    "delete from public.role_permissions where tenant_id=$1 and permission='customers.manage' and role_id in(select id from public.roles where tenant_id=$1 and code='billing')",
    [f.tenants[0]],
  );
  const plain = await request(
    "/invoice-drafts",
    "POST",
    draft({ receiver: { ...receiver(), identification: "456789012" } }),
  );
  expect(plain.statusCode, plain.body).toBe(200);
  const saved = await request(
    "/invoice-drafts",
    "POST",
    draft({
      receiver: { ...receiver(), identification: "456789012" },
      save_customer: true,
    }),
  );
  expect(saved.statusCode).toBe(403);
  expect(
    (
      await f.pool.query(
        "select count(*) from public.customers where tenant_id=$1 and identification='456789012'",
        [f.tenants[0]],
      )
    ).rows[0].count,
  ).toBe("0");
});
it("keeps product CABYS and unit consistent with its fiscal defaults", async () => {
  // Permission revoked in previous test only affects customers, not catalog.
  const response = await request("/catalog-items", "POST", {
    code: "CLASS-2",
    description: "Clasificación",
    kind: "service",
    currency: "CRC",
    unit_price: "1",
    cabys: "0000000000002",
    unit: "Sp",
    tax_defaults: { ...fiscal(), cabys: "", unit: "" },
  });
  expect(response.statusCode, response.body).toBe(200);
  const item = response.json().item;
  expect(item.tax_defaults.cabys).toBe("0000000000002");
  expect(item.tax_defaults.unit).toBe("Sp");
  const update = await request("/catalog-items/" + item.id, "PATCH", {
    version: item.version,
    unit: "Unid",
  });
  expect(update.statusCode, update.body).toBe(200);
  expect(update.json().item.tax_defaults.unit).toBe("Unid");
  const conflict = await request("/catalog-items", "POST", {
    code: "CLASS-3",
    description: "Conflicto",
    kind: "service",
    currency: "CRC",
    unit_price: "1",
    cabys: "0000000000002",
    unit: "Sp",
    tax_defaults: fiscal(),
  });
  expect(conflict.statusCode).toBe(400);
});
it("requires module read permission as well as membership for fiscal lookups", async () => {
  await f.pool.query(
    "delete from public.role_permissions where tenant_id=$1 and permission in('customers.read','catalog.read','invoices.read') and role_id in(select id from public.roles where tenant_id=$1 and code='billing')",
    [f.tenants[0]],
  );
  expect((await request("/locations")).statusCode).toBe(403);
  expect((await request("/cabys?search=abc")).statusCode).toBe(403);
  expect(
    (await request("/locations", "GET", undefined, randomUUID())).statusCode,
  ).toBe(403);
});
