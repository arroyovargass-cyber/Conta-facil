import { afterAll, beforeAll, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { createApp } from "../../apps/api/src/app";
import { runtimeConfig } from "../support/runtime-config";
import { totp } from "../support/totp";
import { workspace } from "../support/workspace";

let owner: Awaited<ReturnType<typeof workspace>>;
let other: Awaited<ReturnType<typeof workspace>>;
let app: Awaited<ReturnType<typeof createApp>>;
let session: { cookie: string; csrf: string };
let outsider: { cookie: string; csrf: string };
let restoreUsage = false;
const keys = [
  "legal_name",
  "trade_name",
  "person_type",
  "identification_type",
  "identification",
  "contact_email",
  "phone",
  "address",
  "active",
  "configuration",
  "activities",
];
const request = (id: string, method = "GET", body?: any, actor = session) =>
  app.inject({
    method: method as any,
    url: "/api/company-administration/" + id,
    headers: {
      cookie: actor.cookie,
      origin: owner.config.APP_ORIGIN,
      "x-csrf-token": actor.csrf,
    },
    payload: body,
  });
async function login(f: typeof owner) {
  const actor = await f.login(app);
  const headers = {
    cookie: actor.cookie,
    origin: f.config.APP_ORIGIN,
    "x-csrf-token": actor.csrf,
  };
  const factor = (
    await app.inject({ method: "POST", url: "/api/auth/mfa/enroll", headers })
  ).json();
  const verified = await app.inject({
    method: "POST",
    url: "/api/auth/mfa/verify",
    headers,
    payload: { factorId: factor.factorId, code: totp(factor.secret) },
  });
  expect(verified.statusCode, verified.body).toBe(200);
  return {
    cookie: actor.cookie,
    csrf: (
      await app.inject({
        url: "/api/auth/session",
        headers: { cookie: actor.cookie },
      })
    ).json().csrf,
  };
}
async function update(change: (value: any) => void, id = owner.tenants[0]) {
  const read = await request(id);
  expect(read.statusCode, read.body).toBe(200);
  const old = read.json().item;
  const body: any = Object.fromEntries(keys.map((key) => [key, old[key]]));
  change(body);
  return {
    old,
    body,
    response: await request(id, "PATCH", {
      ...body,
      expected_version: old.configuration_version,
    }),
  };
}
async function history() {
  const rows = await owner.pool.query(
    `select jsonb_build_object(
    'credentials',(select jsonb_agg(to_jsonb(v) order by version) from private.hacienda_credential_versions v where tenant_id=$1),
    'invoices',(select jsonb_agg(to_jsonb(i) order by id) from public.electronic_invoices i where tenant_id=$1),
    'sequences',(select jsonb_agg(to_jsonb(s) order by document_type) from public.document_sequences s where tenant_id=$1),
    'electronic_sequences',(select jsonb_agg(to_jsonb(s) order by environment,branch_code,terminal_code) from private.emission_sequences s where tenant_id=$1)) as data`,
    [owner.tenants[0]],
  );
  return createHash("sha256")
    .update(JSON.stringify(rows.rows[0].data))
    .digest("hex");
}
beforeAll(async () => {
  owner = await workspace({ role: "admin", companies: 2, systemAdmin: true });
  other = await workspace({ role: "admin", companies: 1 });
  const runtime = await runtimeConfig(owner.config);
  app = await createApp(runtime);
  session = await login(owner);
  outsider = await login(other);
  restoreUsage = (
    await owner.pool.query(
      "select has_schema_privilege('conta_facil_api','auth','USAGE') allowed",
    )
  ).rows[0].allowed;
  await owner.pool.query("revoke usage on schema auth from conta_facil_api");
  const tenant = owner.tenants[0];
  const branch = (
    await owner.pool.query(
      "insert into public.branches(tenant_id,code,name) values($1,'001','Sucursal existente') returning id",
      [tenant],
    )
  ).rows[0].id;
  const terminal = (
    await owner.pool.query(
      "insert into public.terminals(tenant_id,branch_id,code,name) values($1,$2,'00001','Terminal existente') returning id",
      [tenant, branch],
    )
  ).rows[0].id;
  await owner.pool.query(
    "insert into public.document_sequences(tenant_id,branch_id,terminal_id,document_type,last_value) values($1,$2,$3,'FE',37)",
    [tenant, branch, terminal],
  );
  await owner.pool.query(
    "insert into private.emission_sequences(tenant_id,environment,branch_code,terminal_code,last_value,confirmed_by,confirmed_at,legacy_floor) values($1,'test','001','00001',37,$2,now(),37)",
    [tenant, owner.userId],
  );
  const department = (
    await owner.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Ventas de prueba') returning id",
      [tenant],
    )
  ).rows[0].id;
  const draft = (
    await owner.pool.query(
      "insert into public.invoice_drafts(tenant_id,department_id,currency,customer_snapshot,created_by,updated_by,operation_id,request_hash) values($1,$2,'CRC','{}',$3,$3,$4,'fixture-local') returning id",
      [tenant, department, owner.userId, randomUUID()],
    )
  ).rows[0].id;
  await owner.pool.query(
    "insert into public.electronic_invoices(tenant_id,draft_id,draft_version,department_id,snapshot,options,created_by,operation_id,request_hash) values($1,$2,1,$3,$4,'{}',$5,$6,$7)",
    [
      tenant,
      draft,
      department,
      { fixture: "Historial sintético local, sin emisión" },
      owner.userId,
      randomUUID(),
      "c".repeat(64),
    ],
  );
  await owner.pool.query(
    "insert into public.hacienda_configuration(tenant_id) values($1)",
    [tenant],
  );
  await owner.pool.query(
    "insert into private.hacienda_credential_versions(tenant_id,environment,version,api_key_id,api_ciphertext,pkcs12_key_id,pkcs12_ciphertext,created_by) values($1,'test',1,'LOCAL_TEST',$2,'LOCAL_TEST',$2,$3)",
    [tenant, Buffer.alloc(28), owner.userId],
  );
});
afterAll(async () => {
  if (restoreUsage)
    await owner?.pool.query("grant usage on schema auth to conta_facil_api");
  await app?.close();
  await owner?.pool.end();
  await other?.pool.end();
});

it("authorized superadministrator saves fiscal address with the hosted restricted role and keeps audit attribution", async () => {
  const acl = (
    await owner.pool
      .query(`select has_schema_privilege('conta_facil_api','auth','USAGE') auth_usage,
    has_table_privilege('conta_facil_api','public.tenants','UPDATE') can_update,
    (select rolbypassrls from pg_roles where rolname='conta_facil_api') bypass_rls`)
  ).rows[0];
  expect(acl).toEqual({
    auth_usage: false,
    can_update: true,
    bypass_rls: false,
  });
  const { old, response } = await update((v) => {
    v.address = "Domicilio fiscal de prueba en San José";
    v.configuration.location = {
      province: "1",
      canton: "01",
      district: "01",
      neighborhood: "",
    };
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().item).toMatchObject({
    address: "Domicilio fiscal de prueba en San José",
    configuration_version: old.configuration_version + 1,
    updated_by: owner.userId,
  });
  expect(Date.parse(response.json().item.updated_at)).toBeGreaterThanOrEqual(
    Date.parse(old.updated_at),
  );
  const audit = (
    await owner.pool.query(
      "select actor_id from public.audit_events where tenant_id=$1 and entity='tenants' order by id desc limit 1",
      [owner.tenants[0]],
    )
  ).rows[0];
  expect(audit.actor_id).toBe(owner.userId);
});

it("saves the existing parameters from every company tab without modifying credentials, invoices or counters", async () => {
  const before = await history();
  const changes = [
    (v: any) => {
      v.trade_name = "Nombre comercial actualizado";
    },
    (v: any) => {
      v.address = "Dirección fiscal actualizada";
    },
    (v: any) => {
      v.configuration.tax.regime = "Régimen declarado de prueba";
    },
    (v: any) => {
      v.configuration.billing.branch_code = "001";
      v.configuration.billing.terminal_code = "00001";
      v.configuration.billing.documents = ["FE"];
    },
    (v: any) => {
      v.configuration.accounting.banks = true;
    },
    (_v: any) => {}, // Usuarios y permisos has no company fields of its own.
  ];
  for (const change of changes) {
    const { old, body, response } = await update(change);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().item.configuration_version).toBe(
      old.configuration_version + 1,
    );
    expect(response.json().item.updated_by).toBe(owner.userId);
    expect(
      Object.fromEntries(keys.map((key) => [key, response.json().item[key]])),
    ).toEqual(body);
    expect(await history()).toBe(before);
  }
});

it("uses the existing branch/terminal mechanism and never resets an existing consecutive", async () => {
  const { response } = await update((v) => {
    v.configuration.billing.branch_code = "002";
    v.configuration.billing.terminal_code = "00002";
    v.configuration.billing.documents = ["FE", "TE"];
  });
  expect(response.statusCode, response.body).toBe(200);
  const branches = (
    await owner.pool.query(
      "select b.code branch,t.code terminal,s.last_value::text last_value from public.branches b join public.terminals t on t.tenant_id=b.tenant_id and t.branch_id=b.id join public.document_sequences s on s.tenant_id=b.tenant_id and s.branch_id=b.id and s.terminal_id=t.id where b.tenant_id=$1 order by b.code,s.document_type",
      [owner.tenants[0]],
    )
  ).rows;
  expect(branches).toEqual([
    { branch: "001", terminal: "00001", last_value: "37" },
    { branch: "002", terminal: "00002", last_value: "0" },
    { branch: "002", terminal: "00002", last_value: "0" },
  ]);
});

it("denies ordinary administrators and lets the global owner edit another company independently", async () => {
  const read = (await request(owner.tenants[0])).json().item;
  const body = Object.fromEntries(keys.map((key) => [key, read[key]]));
  const payload = { ...body, expected_version: read.configuration_version };
  expect(
    (await request(owner.tenants[0], "PATCH", payload, outsider)).statusCode,
  ).toBe(403);
  const foreign = await request(other.tenants[0]);
  expect(foreign.statusCode, foreign.body).toBe(200);
  const item = foreign.json().item;
  const update = await request(other.tenants[0], "PATCH", {
    ...Object.fromEntries(keys.map((key) => [key, item[key]])),
    trade_name: "Edición global independiente",
    expected_version: item.configuration_version,
  });
  expect(update.statusCode, update.body).toBe(200);
  expect(update.json().item.updated_by).toBe(owner.userId);
  const unchanged = (await request(owner.tenants[0])).json().item;
  expect(unchanged.configuration_version).toBe(read.configuration_version);
});

it("rejects partial activities in Spanish without changing the company version", async () => {
  const { old, response } = await update((value) => {
    value.activities = [
      {
        code: "123456",
        name: "",
        active: true,
        primary: false,
        source_url: "",
      },
    ];
  });
  expect(response.statusCode).toBe(400);
  expect(response.json().fields).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "activities.0.name",
        message: "Indica la descripción de la actividad.",
      }),
    ]),
  );
  expect(
    (await request(owner.tenants[0])).json().item.configuration_version,
  ).toBe(old.configuration_version);
});

it("does not let the platform operator save from a new session before completing MFA", async () => {
  const old = (await request(owner.tenants[0])).json().item;
  const body = Object.fromEntries(keys.map((key) => [key, old[key]]));
  const unverified = await owner.login(app);
  const response = await request(
    owner.tenants[0],
    "PATCH",
    { ...body, expected_version: old.configuration_version },
    unverified,
  );
  expect(response.statusCode).toBe(403);
  expect(
    (
      await owner.pool.query(
        "select configuration_version from public.tenants where id=$1",
        [owner.tenants[0]],
      )
    ).rows[0].configuration_version,
  ).toBe(old.configuration_version);
});
