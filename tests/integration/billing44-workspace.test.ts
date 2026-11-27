import { afterAll, beforeAll, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { workspace } from "../support/workspace";
import { runtimeConfig } from "../support/runtime-config";
import { totp } from "../support/totp";
import { createApp } from "../../apps/api/src/app";
import { scoped, type Claims } from "../../apps/api/src/db";
import {
  lineFiscalInput,
  receiverInput,
} from "../../packages/domain/src/invoice-fiscal";
import { otherChargeInput } from "../../packages/domain/src/invoice-extras";

let f: Awaited<ReturnType<typeof workspace>>,
  app: Awaited<ReturnType<typeof createApp>>,
  cookie = "",
  csrf = "",
  department = "",
  otherDepartment = "",
  previousActor = "",
  claims: Claims;
const request = (
  path: string,
  method = "GET",
  payload?: any,
  tenant?: string,
) =>
  app.inject({
    method: method as any,
    url: `/api/companies/${tenant ?? f.tenants[0]}${path}`,
    headers: { cookie, origin: f.config.APP_ORIGIN, "x-csrf-token": csrf },
    payload,
  });
async function permissions(...codes: string[]) {
  await f.pool.query(
    "delete from public.role_permissions where tenant_id=$1 and role_id=(select id from public.roles where tenant_id=$1 and code='operative') and permission like 'invoices.%'",
    [f.tenants[0]],
  );
  await f.pool.query(
    "insert into public.role_permissions(tenant_id,role_id,permission) select tenant_id,id,p from public.roles cross join unnest($2::text[]) p where tenant_id=$1 and code='operative' on conflict do nothing",
    [f.tenants[0], codes],
  );
}
const line = (extra: Record<string, unknown> = {}) => ({
  description: "Servicio de prueba",
  quantity: "2",
  unit_price: "1000",
  fiscal: lineFiscalInput.parse({
    cabys: "5000000000001",
    unit: "Unid",
    treatment: "taxable",
    tariff_code: "08",
  }),
  ...extra,
});
const draftInput = (extra: Record<string, unknown> = {}) => ({
  operation_id: randomUUID(),
  receiver_mode: "occasional",
  receiver: receiverInput.parse({
    name: "Cliente de prueba",
    identification_type: "01",
    identification: "123456789",
    phone_country_code: "506",
    phone: "22223333",
  }),
  department_id: department,
  currency: "CRC",
  lines: [line()],
  ...extra,
});
const updateInput = (item: any, extra: Record<string, unknown> = {}) => ({
  version: item.version,
  customer_id: item.customer_id,
  receiver_mode: item.receiver_mode,
  receiver: item.customer_snapshot,
  document_type: item.document_type,
  department_id: item.department_id,
  currency: item.currency,
  notes: item.notes,
  commercial: item.commercial,
  other_charges: item.other_charges,
  lines: item.lines.map((l: any) => ({
    catalog_item_id: l.catalog_item_id,
    description: l.description,
    quantity: l.quantity,
    unit_price: l.unit_price,
    fiscal: l.fiscal,
  })),
  ...extra,
});
beforeAll(async () => {
  f = await workspace({ role: "operative", companies: 2 });
  const previousUser = await f.admin.auth.admin.createUser({
    email: `legacy-query-${f.tag}@example.test`,
    password: randomUUID() + "aA!",
    email_confirm: true,
  });
  if (previousUser.error) throw previousUser.error;
  previousActor = previousUser.data.user.id;
  await f.pool.query(
    "insert into public.profiles(id,name) values($1,'Actor anterior de prueba')",
    [previousActor],
  );
  [department, otherDepartment] = (
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Ventas'),($1,'Otro') returning id",
      [f.tenants[0]],
    )
  ).rows.map((r) => r.id);
  app = await createApp({
    ...(await runtimeConfig(f.config)),
    HACIENDA_SOFTWARE_PROVIDER_ID: "206910803",
  });
  ({ cookie, csrf } = await f.login(app));
  const headers = { cookie, origin: f.config.APP_ORIGIN, "x-csrf-token": csrf };
  const enrollment = await app.inject({
    method: "POST",
    url: "/api/auth/mfa/enroll",
    headers,
  });
  const verified = await app.inject({
    method: "POST",
    url: "/api/auth/mfa/verify",
    headers,
    payload: {
      factorId: enrollment.json().factorId,
      code: totp(enrollment.json().secret),
    },
  });
  expect(verified.statusCode, verified.body).toBe(200);
  csrf = (
    await app.inject({ url: "/api/auth/session", headers: { cookie } })
  ).json().csrf;
  claims = {
    sub: f.userId,
    aal: "aal2",
    session_id: (
      await f.pool.query(
        "select auth_session_id from private.sessions where user_id=$1 and revoked_at is null order by last_seen desc limit 1",
        [f.userId],
      )
    ).rows[0].auth_session_id,
  };
});
afterAll(async () => {
  await app?.close();
  await f?.pool.end();
});

it("separates preparing an existing draft from creating or editing drafts", async () => {
  await permissions("invoices.read", "invoices.create");
  const draft = (await request("/invoice-drafts", "POST", draftInput())).json()
    .item;
  const payload = {
    operation_id: randomUUID(),
    draft_id: draft.id,
    expected_version: draft.version,
    environment: "test",
  };
  expect((await request("/invoices", "POST", payload)).statusCode).toBe(403);
  await permissions("invoices.read", "invoices.prepare");
  expect((await request("/invoices", "POST", payload)).statusCode).toBe(200);
  expect(
    (await request("/invoice-drafts", "POST", draftInput())).statusCode,
  ).toBe(403);
  expect(
    (await request("/invoice-drafts/" + draft.id, "PATCH", updateInput(draft)))
      .statusCode,
  ).toBe(403);
});
it("persists commercial terms, charges, and receiver country prefix and freezes a TE preparation", async () => {
  await permissions(
    "invoices.read",
    "invoices.create",
    "invoices.prepare",
    "invoices.edit",
  );
  const input = draftInput({
    receiver_mode: "consumer_final",
    document_type: "TE",
    receiver: receiverInput.parse({}),
    commercial: {
      sale_condition: "02",
      credit_days: 30,
      branch_code: "001",
      terminal_code: "00001",
      issuer_activity: "4520.0",
    },
    other_charges: [
      otherChargeInput.parse({
        code: "06",
        description: "Servicio",
        mode: "percentage",
        percentage: "10",
        percentage_base: "2000",
      }),
    ],
  });
  const created = await request("/invoice-drafts", "POST", input);
  expect(created.statusCode, created.body).toBe(200);
  const draft = created.json().item;
  expect(draft.commercial).toMatchObject({
    sale_condition: "02",
    credit_days: 30,
    issuer_activity: "4520.0",
  });
  expect(draft.other_charges[0]).toMatchObject({
    percentage_base: "2000",
    percentage: "10",
  });
  expect(draft.fiscal_totals).toMatchObject({
    subtotal: "2000.00000",
    tax: "260.00000",
    otherCharges: "200.00000",
    total: "2460.00000",
  });
  expect((await request("/invoice-drafts", "POST", input)).json().item.id).toBe(
    draft.id,
  );
  const prep = await request("/invoices", "POST", {
    operation_id: randomUUID(),
    draft_id: draft.id,
    expected_version: draft.version,
  });
  expect(prep.statusCode, prep.body).toBe(200);
  const invoice = prep.json().item;
  expect(invoice.document_type).toBe("TE");
  expect(invoice.snapshot).toMatchObject({
    document_type: "TE",
    other_charges: draft.other_charges,
    receiver: { identification: "" },
    totals: { total: "2460.00000" },
  });
  expect(invoice.options).toMatchObject({
    ...draft.commercial,
    exchange_rate: "1",
  });
  const changed = await request(
    `/invoice-drafts/${draft.id}`,
    "PATCH",
    updateInput(draft, {
      commercial: { sale_condition: "01" },
      other_charges: [],
    }),
  );
  expect(changed.statusCode, changed.body).toBe(200);
  const frozen = (await request(`/invoices/${invoice.id}`)).json().item;
  expect(frozen.options.credit_days).toBe(30);
  expect(frozen.snapshot.other_charges).toEqual(draft.other_charges);
  const stale = await request("/invoices", "POST", {
    operation_id: randomUUID(),
    draft_id: draft.id,
    expected_version: draft.version,
  });
  expect(stale.statusCode).toBe(409);
  const customer = await request("/invoice-drafts", "POST", draftInput());
  expect(customer.json().item.customer_snapshot).toMatchObject({
    phone_country_code: "506",
    phone: "22223333",
  });
});

it("requires explicit TE for consumer final without manufacturing a customer identity", async () => {
  await permissions("invoices.read", "invoices.create");
  const implicit = await request(
    "/invoice-drafts",
    "POST",
    draftInput({
      receiver_mode: "consumer_final",
      receiver: receiverInput.parse({}),
    }),
  );
  expect(implicit.statusCode, implicit.body).toBe(400);
  const explicit = await request(
    "/invoice-drafts",
    "POST",
    draftInput({
      receiver_mode: "consumer_final",
      document_type: "TE",
      receiver: receiverInput.parse({}),
    }),
  );
  expect(explicit.statusCode, explicit.body).toBe(200);
  expect(explicit.json().item.customer_id).toBeNull();
  expect(explicit.json().item.customer_snapshot.identification).toBe("");
});

it("replays historical operation hashes without accepting newly different commercial data", async () => {
  await permissions("invoices.read", "invoices.create", "invoices.prepare");
  const payload = {
    operation_id: randomUUID(),
    department_id: department,
    currency: "CRC",
    lines: [
      {
        description: "Original",
        quantity: null,
        unit_price: null,
        fiscal: null,
      },
    ],
  };
  const created = await request("/invoice-drafts", "POST", payload);
  expect(created.statusCode, created.body).toBe(200);
  const historical = {
    customer_id: null,
    receiver_mode: "registered",
    save_customer: false,
    document_type: "FE",
    department_id: department,
    currency: "CRC",
    notes: "",
    lines: [
      {
        catalog_item_id: null,
        description: "Original",
        quantity: null,
        unit_price: null,
        fiscal: null,
      },
    ],
    operation_id: payload.operation_id,
  };
  await f.pool.query(
    "update public.invoice_drafts set request_hash=$2 where id=$1",
    [
      created.json().item.id,
      createHash("sha256").update(JSON.stringify(historical)).digest("hex"),
    ],
  );
  const replay = await request("/invoice-drafts", "POST", payload);
  expect(replay.statusCode, replay.body).toBe(200);
  expect(replay.json().item.id).toBe(created.json().item.id);
  expect(
    (
      await request("/invoice-drafts", "POST", {
        ...payload,
        commercial: { sale_condition: "02", credit_days: 30 },
      })
    ).statusCode,
  ).toBe(409);
  const preparation = {
    operation_id: randomUUID(),
    draft_id: created.json().item.id,
    expected_version: 1,
    options: {},
  };
  const prepared = await request("/invoices", "POST", preparation);
  expect(prepared.statusCode, prepared.body).toBe(200);
  const historicalPreparation = {
    ...preparation,
    options: {
      sale_condition: "01",
      credit_days: null,
      exchange_rate: "",
      payment_methods: [],
      branch_code: "",
      terminal_code: "",
      issuer_activity: "",
    },
  };
  await f.pool.query(
    "update public.electronic_invoices set request_hash=$2 where id=$1",
    [
      prepared.json().item.id,
      createHash("sha256")
        .update(JSON.stringify(historicalPreparation))
        .digest("hex"),
    ],
  );
  const preparedReplay = await request("/invoices", "POST", preparation);
  expect(preparedReplay.statusCode, preparedReplay.body).toBe(200);
  expect(preparedReplay.json().item.id).toBe(prepared.json().item.id);
  expect(
    (
      await request("/invoices", "POST", {
        ...preparation,
        options: { references: [{ document_type: "01", number: "X" }] },
      })
    ).statusCode,
  ).toBe(409);
});

it("separates create, edit and archive permissions in the API and direct RLS", async () => {
  await permissions("invoices.read", "invoices.create", "invoices.prepare");
  const created = await request("/invoice-drafts", "POST", draftInput());
  expect(created.statusCode, created.body).toBe(200);
  let draft = created.json().item;
  expect(draft.lines).toHaveLength(1);
  const prepareInput = {
    operation_id: randomUUID(),
    draft_id: draft.id,
    expected_version: draft.version,
  };
  const prepared = await Promise.all([
    request("/invoices", "POST", prepareInput),
    request("/invoices", "POST", prepareInput),
  ]);
  expect(prepared[0].statusCode, prepared[0].body).toBe(200);
  expect(prepared[1].statusCode, prepared[1].body).toBe(200);
  expect(prepared[1].json().item.id).toBe(prepared[0].json().item.id);
  expect(
    (
      await request(`/invoices/${prepared[0].json().item.id}/issue`, "POST", {
        version: 1,
        operation_id: randomUUID(),
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await request(
        `/invoice-drafts/${draft.id}`,
        "PATCH",
        updateInput(draft, { notes: "Denegado" }),
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await request(`/invoice-drafts/${draft.id}`, "PATCH", {
        version: draft.version,
        archived: true,
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await scoped(f.pool, claims, (db) =>
        db.query(
          "update public.invoice_drafts set notes='Denegado' where id=$1",
          [draft.id],
        ),
      )
    ).rowCount,
  ).toBe(0);
  await expect(
    scoped(f.pool, claims, (db) =>
      db.query(
        "insert into public.invoice_draft_lines(tenant_id,draft_id,position,description,quantity,unit_price) values($1,$2,2,'Denegado',1,1)",
        [f.tenants[0], draft.id],
      ),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await permissions("invoices.read", "invoices.edit");
  expect(
    (await request("/invoice-drafts", "POST", draftInput())).statusCode,
  ).toBe(403);
  const edited = await request(
    `/invoice-drafts/${draft.id}`,
    "PATCH",
    updateInput(draft, { notes: "Editado" }),
  );
  expect(edited.statusCode, edited.body).toBe(200);
  draft = edited.json().item;
  expect(
    (
      await request(`/invoice-drafts/${draft.id}`, "PATCH", {
        version: draft.version,
        archived: true,
      })
    ).statusCode,
  ).toBe(403);
  await expect(
    scoped(f.pool, claims, (db) =>
      db.query(
        "update public.invoice_drafts set archived_at=now() where id=$1",
        [draft.id],
      ),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await permissions("invoices.read", "invoices.delete");
  const archived = await request(`/invoice-drafts/${draft.id}`, "PATCH", {
    version: draft.version,
    archived: true,
  });
  expect(archived.statusCode, archived.body).toBe(200);
  expect(archived.json().item.archived_at).toBeTruthy();
  expect(
    (
      await request(
        `/invoice-drafts/${draft.id}`,
        "PATCH",
        updateInput(archived.json().item, { notes: "Denegado" }),
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await scoped(f.pool, claims, (db) =>
        db.query(
          "select count(*)::int count from public.invoice_drafts where id=$1",
          [draft.id],
        ),
      )
    ).rows[0].count,
  ).toBe(1);
  const restored = await request(`/invoice-drafts/${draft.id}`, "PATCH", {
    version: archived.json().item.version,
    archived: false,
  });
  expect(restored.statusCode, restored.body).toBe(200);
  await expect(
    scoped(f.pool, claims, (db) =>
      db.query(
        "update public.invoice_drafts set notes='Denegado' where id=$1",
        [draft.id],
      ),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await permissions("invoices.read", "invoices.manage");
  expect(
    (await request("/invoice-drafts", "POST", draftInput())).statusCode,
  ).toBe(403);
});

it("does not turn archive and restore into draft creation authority for appending lines", async () => {
  await permissions("invoices.read", "invoices.create", "invoices.delete");
  const created = await request("/invoice-drafts", "POST", draftInput());
  expect(created.statusCode, created.body).toBe(200);
  const draft = created.json().item;
  expect(draft.lines).toHaveLength(1);
  await expect(
    scoped(f.pool, claims, async (db) => {
      await db.query(
        "update public.invoice_drafts set archived_at=now() where id=$1",
        [draft.id],
      );
      await db.query(
        "update public.invoice_drafts set archived_at=null where id=$1",
        [draft.id],
      );
      return (
        await db.query(
          "insert into public.invoice_draft_lines(tenant_id,draft_id,position,description,quantity,unit_price) values($1,$2,2,'Append without edit',1,1)",
          [f.tenants[0], draft.id],
        )
      ).rowCount;
    }),
  ).rejects.toMatchObject({ code: "42501" });
  expect(
    (
      await f.pool.query(
        "select count(*)::int count from public.invoice_draft_lines where tenant_id=$1 and draft_id=$2",
        [f.tenants[0], draft.id],
      )
    ).rows[0].count,
  ).toBe(1);

  // An explicit client value cannot forge the provenance of a newly inserted
  // draft. Its first lines remain authorized within that insertion transaction.
  await scoped(f.pool, claims, async (db) => {
    const fresh = (
      await db.query(
        "insert into public.invoice_drafts(tenant_id,department_id,currency,customer_snapshot,created_by,updated_by,operation_id,request_hash,creation_xid) values($1,$2,'CRC','{}',$3,$3,$4,'test','1'::xid8) returning id,creation_xid::text",
        [f.tenants[0], department, f.userId, randomUUID()],
      )
    ).rows[0];
    const current = (await db.query("select pg_current_xact_id()::text xid"))
      .rows[0].xid;
    expect(fresh.creation_xid).toBe(current);
    expect(
      (
        await db.query(
          "insert into public.invoice_draft_lines(tenant_id,draft_id,position,description,quantity,unit_price) values($1,$2,1,'Initial permitted line',1,1)",
          [f.tenants[0], fresh.id],
        )
      ).rowCount,
    ).toBe(1);
  });

  await permissions("invoices.read", "invoices.edit");
  expect(
    (
      await scoped(f.pool, claims, (db) =>
        db.query(
          "insert into public.invoice_draft_lines(tenant_id,draft_id,position,description,quantity,unit_price) values($1,$2,2,'Permitted edit',1,1)",
          [f.tenants[0], draft.id],
        ),
      )
    ).rowCount,
  ).toBe(1);
  await expect(
    scoped(f.pool, claims, (db) =>
      db.query(
        "update public.invoice_drafts set creation_xid=pg_current_xact_id() where id=$1",
        [draft.id],
      ),
    ),
  ).rejects.toMatchObject({ code: "42501" });
});

it("fences creation by MFA, live membership, assigned department and session expiry", async () => {
  await permissions("invoices.read", "invoices.create");
  const sql =
    "insert into public.invoice_drafts(tenant_id,department_id,currency,customer_snapshot,created_by,updated_by,operation_id,request_hash) values($1,$2,'CRC','{}',$3,$3,$4,'test')";
  await expect(
    scoped(f.pool, { ...claims, aal: "aal1" }, (db) =>
      db.query(sql, [f.tenants[0], department, f.userId, randomUUID()]),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await f.pool.query(
    "update public.memberships set scope='departments' where tenant_id=$1 and user_id=$2",
    [f.tenants[0], f.userId],
  );
  await f.pool.query(
    "insert into public.membership_departments(tenant_id,user_id,department_id) values($1,$2,$3)",
    [f.tenants[0], f.userId, department],
  );
  expect(
    (
      await request(
        "/invoice-drafts",
        "POST",
        draftInput({ department_id: otherDepartment }),
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (await request("/invoice-drafts", "POST", draftInput())).statusCode,
  ).toBe(200);
  const options = (await request("/invoice-options")).json();
  expect(options.departments.map((d: any) => d.id)).toEqual([department]);
  expect(options.departments[0]).toMatchObject({
    can_create: true,
    can_edit: false,
    can_delete: false,
    can_query: false,
  });
  await f.pool.query(
    "update public.memberships set active=false where tenant_id=$1 and user_id=$2",
    [f.tenants[0], f.userId],
  );
  await expect(
    scoped(f.pool, claims, (db) =>
      db.query(sql, [f.tenants[0], department, f.userId, randomUUID()]),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await f.pool.query(
    "update public.memberships set active=true,scope='company' where tenant_id=$1 and user_id=$2",
    [f.tenants[0], f.userId],
  );
  const expiry = (
    await f.pool.query(
      "update private.sessions set expires_at=now()-interval '1 minute' where auth_session_id=$1 returning expires_at",
      [claims.session_id],
    )
  ).rows[0];
  expect(expiry).toBeTruthy();
  await expect(
    scoped(f.pool, claims, (db) =>
      db.query(sql, [f.tenants[0], department, f.userId, randomUUID()]),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await f.pool.query(
    "update private.sessions set expires_at=now()+interval '1 hour' where auth_session_id=$1",
    [claims.session_id],
  );
});

it("saves a line to the same-tenant catalog only with explicit read/manage authority and deduplicates by internal code", async () => {
  await permissions("invoices.read", "invoices.create");
  const productLine = line();
  productLine.fiscal = {
    ...productLine.fiscal,
    internal_code: "BILL44-SERVICE",
  };
  const payload = draftInput({
    lines: [{ ...productLine, save_catalog_item: true }],
  });
  expect((await request("/invoice-drafts", "POST", payload)).statusCode).toBe(
    403,
  );
  await f.pool.query(
    "insert into public.role_permissions select tenant_id,id,p from public.roles cross join unnest(array['catalog.read','catalog.manage','customers.read','customers.manage']) p where tenant_id=$1 and code='operative'",
    [f.tenants[0]],
  );
  await f.pool.query(
    "insert into public.catalog_items(tenant_id,code,description,kind,currency,unit_price) values($1,'BILL44-SERVICE','Otra empresa','service','CRC',9)",
    [f.tenants[1]],
  );
  const first = await request("/invoice-drafts", "POST", payload);
  expect(first.statusCode, first.body).toBe(200);
  const second = await request("/invoice-drafts", "POST", {
    ...payload,
    operation_id: randomUUID(),
  });
  expect(second.statusCode, second.body).toBe(200);
  expect(second.json().item.lines[0].catalog_item_id).toBe(
    first.json().item.lines[0].catalog_item_id,
  );
  const catalog = (
    await f.pool.query(
      "select * from public.catalog_items where tenant_id=$1 and code='BILL44-SERVICE'",
      [f.tenants[0]],
    )
  ).rows;
  expect(catalog).toHaveLength(1);
  expect(catalog[0].tax_defaults).toMatchObject({
    tariff_code: "08",
    internal_code: "BILL44-SERVICE",
  });
  const savedCustomer = await request(
    "/invoice-drafts",
    "POST",
    draftInput({ save_customer: true }),
  );
  expect(savedCustomer.statusCode, savedCustomer.body).toBe(200);
  expect(
    (
      await f.pool.query(
        "select phone_country_code from public.customers where tenant_id=$1 and identification='123456789'",
        [f.tenants[0]],
      )
    ).rows[0].phone_country_code,
  ).toBe("506");
});

it("round-trips one thousand VIN values inside the existing request and prepared snapshot limits", async () => {
  await permissions("invoices.read", "invoices.create", "invoices.prepare");
  const vinNumbers = Array.from({ length: 1000 }, (_, i) =>
    String(i).padStart(17, "0"),
  );
  const payload = draftInput({
    lines: [line({ fiscal: { ...line().fiscal, vin_numbers: vinNumbers } })],
  });
  expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(262144);
  expect(
    Buffer.byteLength(JSON.stringify(payload.lines[0].fiscal)),
  ).toBeGreaterThan(16384);
  const created = await request("/invoice-drafts", "POST", payload);
  expect(created.statusCode, created.body).toBe(200);
  const draft = created.json().item;
  expect(draft.lines[0].fiscal.vin_numbers).toEqual(vinNumbers);
  const loaded = await request(`/invoice-drafts/${draft.id}`);
  expect(loaded.json().item.lines[0].fiscal.vin_numbers).toEqual(vinNumbers);
  const prepared = await request("/invoices", "POST", {
    operation_id: randomUUID(),
    draft_id: draft.id,
    expected_version: draft.version,
  });
  expect(prepared.statusCode, prepared.body).toBe(200);
  expect(prepared.json().item.snapshot.lines[0].fiscal.vin_numbers).toEqual(
    vinNumbers,
  );
});

it("classifies historical queries from their latest real manual action and fences the actor after migration", async () => {
  await permissions("invoices.read", "invoices.query");
  const db = await f.pool.connect();
  try {
    await db.query("begin");
    const jobs: any[] = [];
    for (const manual of [true, false]) {
      const source = (
        await db.query(
          "insert into public.invoice_drafts(tenant_id,department_id,currency,customer_snapshot,created_by,updated_by,operation_id,request_hash) values($1,$2,'CRC','{}',$3,$3,$4,'test') returning id",
          [f.tenants[0], department, f.userId, randomUUID()],
        )
      ).rows[0];
      const invoice = (
        await db.query(
          "insert into public.electronic_invoices(tenant_id,draft_id,draft_version,department_id,snapshot,options,created_by,operation_id,request_hash,document_status,signature_status,transmission_status,issued_by) values($1,$2,1,$3,'{}','{}',$4,$5,$6,'issued','signed','uncertain',$4) returning id",
          [
            f.tenants[0],
            source.id,
            department,
            f.userId,
            randomUUID(),
            "a".repeat(64),
          ],
        )
      ).rows[0];
      const job = (
        await db.query(
          "insert into private.emission_jobs(tenant_id,invoice_id,kind,status,lease_token,lease_until) values($1,$2,'query','leased',gen_random_uuid(),now()+interval '5 minutes') returning *",
          [f.tenants[0], invoice.id],
        )
      ).rows[0];
      if (manual) {
        // A real earlier actor is retained only in the immutable action log;
        // the later actor, who made the last request, owns the capability.
        await db.query(
          "insert into private.emission_actions(tenant_id,invoice_id,actor_id,operation_id,action,request_hash,created_at) values($1,$2,$3,$4,'query',$5,now()-interval '1 hour'),($1,$2,$6,$7,'query',$5,now())",
          [
            f.tenants[0],
            invoice.id,
            previousActor,
            randomUUID(),
            "b".repeat(64),
            f.userId,
            randomUUID(),
          ],
        );
      }
      jobs.push(job);
    }
    await db.query(
      readFileSync(
        "supabase/migrations/20261126164756_billing44_line_bounds_legacy_queries.sql",
        "utf8",
      ),
    );
    const migrated = (
      await db.query(
        "select id,request_origin,requested_by from private.emission_jobs where id=any($1::uuid[]) order by request_origin",
        [jobs.map((j) => j.id)],
      )
    ).rows;
    expect(migrated).toContainEqual({
      id: jobs[0].id,
      request_origin: "manual",
      requested_by: f.userId,
    });
    expect(migrated).toContainEqual({
      id: jobs[1].id,
      request_origin: "automatic",
      requested_by: null,
    });
    expect(
      (
        await db.query("select id from private.emission_job_document($1,$2)", [
          jobs[0].id,
          jobs[0].lease_token,
        ])
      ).rows[0].id,
    ).toBe(jobs[0].invoice_id);
    await db.query(
      "delete from public.role_permissions where tenant_id=$1 and role_id=(select id from public.roles where tenant_id=$1 and code='operative') and permission='invoices.query'",
      [f.tenants[0]],
    );
    expect(
      (
        await db.query("select id from private.emission_job_document($1,$2)", [
          jobs[0].id,
          jobs[0].lease_token,
        ])
      ).rows,
    ).toEqual([]);
    expect(
      (
        await db.query("select id from private.emission_job_document($1,$2)", [
          jobs[1].id,
          jobs[1].lease_token,
        ])
      ).rows[0].id,
    ).toBe(jobs[1].invoice_id);
  } finally {
    await db.query("rollback");
    db.release();
  }
});

it("allows a manual status query without emission authority and rechecks its classified worker actor", async () => {
  await permissions("invoices.read", "invoices.query");
  const source = (
    await f.pool.query(
      "insert into public.invoice_drafts(tenant_id,department_id,currency,customer_snapshot,created_by,updated_by,operation_id,request_hash) values($1,$2,'CRC','{}',$3,$3,$4,'test') returning id",
      [f.tenants[0], department, f.userId, randomUUID()],
    )
  ).rows[0];
  const invoice = (
    await f.pool.query(
      "insert into public.electronic_invoices(tenant_id,draft_id,draft_version,department_id,snapshot,options,created_by,operation_id,request_hash,document_status,signature_status,transmission_status,issued_by) values($1,$2,1,$3,'{}','{}',$4,$5,$6,'issued','signed','uncertain',$4) returning id",
      [
        f.tenants[0],
        source.id,
        department,
        f.userId,
        randomUUID(),
        "a".repeat(64),
      ],
    )
  ).rows[0];
  const path = `/invoices/${invoice.id}/actions`;
  expect((await request(path)).json().actions).toEqual(["query"]);
  const payload = { operation_id: randomUUID(), action: "query" };
  const queried = await request(path, "POST", payload);
  expect(queried.statusCode, queried.body).toBe(200);
  expect(
    (
      await request(path, "POST", {
        operation_id: randomUUID(),
        action: "retry_transmission",
      })
    ).statusCode,
  ).toBe(403);
  const job = (
    await f.pool.query(
      "update private.emission_jobs set status='leased',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes' where invoice_id=$1 returning *",
      [invoice.id],
    )
  ).rows[0];
  expect(job).toMatchObject({
    request_origin: "manual",
    requested_by: f.userId,
  });
  expect(
    (
      await f.pool.query(
        "select id from private.emission_job_document($1,$2)",
        [job.id, job.lease_token],
      )
    ).rows[0].id,
  ).toBe(invoice.id);
  await permissions("invoices.read");
  expect((await request(path, "POST", payload)).statusCode).toBe(403);
  expect(
    (
      await f.pool.query(
        "select id from private.emission_job_document($1,$2)",
        [job.id, job.lease_token],
      )
    ).rows,
  ).toEqual([]);
  await expect(
    f.pool.query(
      "update private.emission_jobs set request_origin='automatic',requested_by=null where id=$1",
      [job.id],
    ),
  ).rejects.toMatchObject({ code: "23514" });
  // A separate automatic reconciliation retains its existing evidence-only capability.
  await f.pool.query("delete from private.emission_jobs where id=$1", [job.id]);
  const automatic = (
    await f.pool.query(
      "insert into private.emission_jobs(tenant_id,invoice_id,kind,status,lease_token,lease_until) values($1,$2,'query','leased',gen_random_uuid(),now()+interval '5 minutes') returning *",
      [f.tenants[0], invoice.id],
    )
  ).rows[0];
  await f.pool.query(
    "update public.memberships set active=false where tenant_id=$1 and user_id=$2",
    [f.tenants[0], f.userId],
  );
  expect(
    (
      await f.pool.query(
        "select id from private.emission_job_document($1,$2)",
        [automatic.id, automatic.lease_token],
      )
    ).rows[0].id,
  ).toBe(invoice.id);
  await f.pool.query(
    "update public.memberships set active=true where tenant_id=$1 and user_id=$2",
    [f.tenants[0], f.userId],
  );
});

it("keeps independent FE/TE and test/production numbering and exposes authorized issuer choices", async () => {
  await permissions("invoices.read");
  await f.pool.query("insert into private.platform_operators values($1)", [
    f.userId,
  ]);
  await f.pool.query(
    "insert into public.membership_roles select tenant_id,$2,id from public.roles where tenant_id=$1 and code='admin'",
    [f.tenants[0], f.userId],
  );
  const branch = (
    await f.pool.query(
      "insert into public.branches(tenant_id,name,code) values($1,'Central','001') returning id",
      [f.tenants[0]],
    )
  ).rows[0].id;
  const terminal = (
    await f.pool.query(
      "insert into public.terminals(tenant_id,branch_id,name,code) values($1,$2,'Principal','00001') returning id",
      [f.tenants[0], branch],
    )
  ).rows[0].id;
  await f.pool.query(
    "insert into public.economic_activities(tenant_id,code,name,is_primary,source_url) values($1,'4520.0','Actividad verificada',true,'https://example.test/fixture')",
    [f.tenants[0]],
  );
  await f.pool.query(
    "insert into public.document_sequences(tenant_id,branch_id,terminal_id,document_type,last_value) values($1,$2,$3,'FE',9),($1,$2,$3,'TE',2)",
    [f.tenants[0], branch, terminal],
  );
  const numbering = (
    document_type: string,
    starting_value: string,
    environment = "test",
  ) =>
    request("/invoices/numbering", "POST", {
      branch_code: "001",
      terminal_code: "00001",
      document_type,
      starting_value,
      environment,
    });
  expect((await numbering("FE", "8")).statusCode).toBe(409);
  expect((await numbering("FE", "12")).statusCode).toBe(200);
  expect((await numbering("TE", "3")).statusCode).toBe(200);
  expect((await numbering("TE", "7", "production")).statusCode).toBe(200);
  expect((await request("/invoices/numbering-options")).json()).toMatchObject({
    document_type: "FE",
    items: [expect.objectContaining({ last_value: "12", legacy_floor: "9" })],
  });
  expect(
    (await request("/invoices/numbering-options?document_type=TE")).json(),
  ).toMatchObject({
    document_type: "TE",
    items: [expect.objectContaining({ last_value: "3", legacy_floor: "2" })],
  });
  expect(
    (
      await request(
        "/invoices/numbering-options?document_type=TE&environment=production",
      )
    ).json().items[0].last_value,
  ).toBe("7");
  const options = (await request("/invoice-options")).json();
  expect(options.activities).toContainEqual(
    expect.objectContaining({ code: "4520.0" }),
  );
  expect(options.terminals).toContainEqual(
    expect.objectContaining({ code: "00001", branch_code: "001" }),
  );
  expect(options.software_provider_id).toBe("206910803");
  expect(options.permissions).toContain("invoices.credit_note");
  expect(options.permissions).toContain("invoices.debit_note");
  expect(options.issuer).not.toHaveProperty("credentials");
  expect(Object.keys(options.issuer.configuration).sort()).toEqual([
    "billing",
    "location",
  ]);
  const cross = (
    await request("/invoice-options", "GET", undefined, f.tenants[1])
  ).json();
  expect(cross.issuer).toBeNull();
  expect(cross.activities).toEqual([]);
  expect(cross.terminals).toEqual([]);
});
