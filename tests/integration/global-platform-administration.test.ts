import { afterAll, beforeAll, expect, it } from "vitest";
import { randomInt, randomUUID } from "node:crypto";
import pg from "pg";
import { workspace } from "../support/workspace";
import { runtimeConfig } from "../support/runtime-config";
import { totp } from "../support/totp";
import { createApp } from "../../apps/api/src/app";
import { scoped } from "../../apps/api/src/db";
import {
  lineFiscalInput,
  receiverInput,
} from "../../packages/domain/src/invoice-fiscal";

type Actor = { cookie: string; csrf: string };
let owner: Awaited<ReturnType<typeof workspace>>;
let secondary: typeof owner;
let app: Awaited<ReturnType<typeof createApp>>;
let runtime: pg.Pool;
let runtimeUrl = "";
let restoreAuthUsage = false;
let actor: Actor;
let otherActor: Actor;
let factor: { factorId: string; secret: string };
let beforeMfa = 0;
let company: any;
let department = "";
const request = (path: string, method = "GET", payload?: any, as = actor) =>
  app.inject({
    method: method as any,
    url: "/api" + path,
    headers: {
      cookie: as.cookie,
      origin: owner.config.APP_ORIGIN,
      "x-csrf-token": as.csrf,
    },
    payload,
  });
async function authenticate(f: typeof owner, existing?: typeof factor) {
  const login = await f.login(app);
  const enrollment: { factorId: string; secret: string } =
    existing ?? (await request("/auth/mfa/enroll", "POST", {}, login)).json();
  const verified = await request(
    "/auth/mfa/verify",
    "POST",
    {
      factorId: enrollment.factorId,
      code: totp(enrollment.secret),
    },
    login,
  );
  expect(verified.statusCode, verified.body).toBe(200);
  return {
    actor: {
      cookie: login.cookie,
      csrf: (await request("/auth/session", "GET", undefined, login)).json()
        .csrf,
    },
    factor: enrollment,
  };
}
const companyBody = () => ({
  operation_id: randomUUID(),
  legal_name: "Empresa global " + randomUUID(),
  person_type: "legal",
  identification_type: "02",
  identification: String(randomInt(1000000000, 9999999999)),
});
const editable = (item: any): Record<string, any> => ({
  ...Object.fromEntries(
    [
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
    ].map((key) => [key, item[key]]),
  ),
  expected_version: item.configuration_version,
});
async function ownerTransaction(run: (db: pg.PoolClient) => Promise<void>) {
  const session = (
    await owner.pool.query(
      "select auth_session_id from private.sessions where user_id=$1 and revoked_at is null order by last_seen desc limit 1",
      [owner.userId],
    )
  ).rows[0].auth_session_id;
  const db = await runtime.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: owner.userId, aal: "aal2", session_id: session }),
    ]);
    expect(
      (await db.query("select private.is_system_administrator() allowed"))
        .rows[0].allowed,
    ).toBe(true);
    await run(db);
  } finally {
    await db.query("rollback");
    db.release();
  }
}
beforeAll(async () => {
  owner = await workspace({ companies: 0, systemAdmin: true });
  secondary = await workspace({ companies: 2, role: "admin" });
  const config = await runtimeConfig(owner.config);
  restoreAuthUsage = (
    await owner.pool.query(
      "select has_schema_privilege('conta_facil_api','auth','USAGE') allowed",
    )
  ).rows[0].allowed;
  await owner.pool.query("revoke usage on schema auth from conta_facil_api");
  runtimeUrl = config.DATABASE_URL;
  runtime = new pg.Pool({ connectionString: config.DATABASE_URL });
  app = await createApp({
    ...config,
    HACIENDA_STAG_EMISSION_ENABLED: "false",
    HACIENDA_PRODUCTION_EMISSION_ENABLED: "false",
  });
  const login = await owner.login(app);
  beforeMfa = (await request("/companies", "GET", undefined, login)).statusCode;
  const authenticated = await authenticate(owner);
  actor = authenticated.actor;
  factor = authenticated.factor;
  otherActor = (await authenticate(secondary)).actor;
  department = (
    await owner.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Ventas existentes') returning id",
      [secondary.tenants[0]],
    )
  ).rows[0].id;
});
afterAll(async () => {
  if (restoreAuthUsage)
    await owner.pool.query("grant usage on schema auth to conta_facil_api");
  await app?.close();
  await runtime?.end();
  await owner?.pool.end();
  await secondary?.pool.end();
});

it("exposes the persistent platform role while retaining MFA and the restricted database login", async () => {
  const state = (await request("/auth/session")).json();
  expect(state.user.platform_role).toBe("SUPER_ADMIN_GLOBAL");
  expect(state.mfaRequired).toBe(true);
  expect(state.aal).toBe("aal2");
  expect(beforeMfa).toBe(403);
  const role = (
    await runtime.query(
      "select current_user,rolsuper,rolbypassrls,has_schema_privilege(current_user,'auth','USAGE') auth_usage from pg_roles where rolname=current_user",
    )
  ).rows[0];
  expect(role).toEqual({
    current_user: "conta_facil_api",
    rolsuper: false,
    rolbypassrls: false,
    auth_usage: false,
  });
});

it("lists and opens existing companies without any owner membership and grants registered permissions", async () => {
  expect(
    (
      await owner.pool.query(
        "select count(*)::int n from public.memberships where user_id=$1",
        [owner.userId],
      )
    ).rows[0].n,
  ).toBe(0);
  const list = await request("/companies");
  expect(list.statusCode, list.body).toBe(200);
  expect(list.json().items.map((v: any) => v.id)).toEqual(
    expect.arrayContaining(secondary.tenants),
  );
  for (const id of secondary.tenants) {
    const overview = await request(`/companies/${id}/overview`);
    expect(overview.statusCode, overview.body).toBe(200);
    expect(overview.json().permissions).toEqual(
      expect.arrayContaining([
        "company.manage",
        "invoices.emit",
        "invoices.prepare",
        "hacienda.credentials.manage",
        "users.manage",
      ]),
    );
    expect((await request(`/company-administration/${id}`)).statusCode).toBe(
      200,
    );
  }
});

it("saves the existing company's fiscal address without membership and preserves the other company", async () => {
  const before = (
    await owner.pool.query(
      "select to_jsonb(t) snapshot from public.tenants t where id=$1",
      [secondary.tenants[1]],
    )
  ).rows[0].snapshot;
  const read = await request(`/company-administration/${secondary.tenants[0]}`);
  expect(read.statusCode, read.body).toBe(200);
  const input = editable(read.json().item);
  input.address = "Dirección local de auditoría global";
  input.configuration.location = {
    province: "1",
    canton: "01",
    district: "01",
    neighborhood: "",
  };
  const saved = await request(
    `/company-administration/${secondary.tenants[0]}`,
    "PATCH",
    input,
  );
  expect(saved.statusCode, saved.body).toBe(200);
  expect(saved.json().item.configuration_version).toBe(
    input.expected_version + 1,
  );
  expect(saved.json().item.updated_by).toBe(owner.userId);
  expect(saved.json().item.updated_at).toBeTruthy();
  expect(
    (
      await owner.pool.query(
        "select to_jsonb(t) snapshot from public.tenants t where id=$1",
        [secondary.tenants[1]],
      )
    ).rows[0].snapshot,
  ).toEqual(before);
});

it("creates a company once with its own complete safe initial structure and unconfirmed fiscal prerequisites", async () => {
  const body = companyBody();
  const responses = await Promise.all([
    request("/company-administration", "POST", body),
    request("/company-administration", "POST", body),
  ]);
  for (const response of responses)
    expect(response.statusCode, response.body).toBe(200);
  company = responses[0].json().item;
  expect(responses[1].json().item.id).toBe(company.id);
  expect(company.configuration.billing).toMatchObject({
    branch_code: "001",
    terminal_code: "00001",
    environment: "test",
    email_delivery_enabled: false,
  });
  const setup = (
    await owner.pool.query(
      `select
    (select count(*)::int from public.roles where tenant_id=$1) roles,
    (select count(*)::int from public.departments where tenant_id=$1 and active) departments,
    (select count(*)::int from public.branches where tenant_id=$1 and active) branches,
    (select count(*)::int from public.terminals where tenant_id=$1 and active) terminals,
    (select count(*)::int from public.tax_settings where tenant_id=$1 and status='draft') tax_settings,
    (select count(*)::int from public.hacienda_configuration where tenant_id=$1 and active_version is null and api_status='not_tested') hacienda,
    (select count(*)::int from public.document_routes where tenant_id=$1 and not enabled) routes,
    (select count(*)::int from private.hacienda_credential_versions where tenant_id=$1) credentials,
    (select count(*)::int from private.emission_sequences where tenant_id=$1) confirmed_sequences`,
      [company.id],
    )
  ).rows[0];
  expect(setup).toEqual({
    roles: 7,
    departments: 3,
    branches: 1,
    terminals: 1,
    tax_settings: 2,
    hacienda: 2,
    routes: 2,
    credentials: 0,
    confirmed_sequences: 0,
  });
  const oldOverview = (
    await request(`/companies/${secondary.tenants[0]}/overview`)
  ).json();
  const newOverview = (
    await request(`/companies/${company.id}/overview`)
  ).json();
  expect(newOverview.permissions.sort()).toEqual(
    oldOverview.permissions.sort(),
  );
  const duplicate = await request("/company-administration", "POST", {
    ...body,
    operation_id: randomUUID(),
  });
  expect(duplicate.statusCode).toBe(409);
});

it("initializes an inactive company without enabling its Hacienda access and can reactivate it", async () => {
  const response = await request("/company-administration", "POST", {
    ...companyBody(),
    active: false,
  });
  expect(response.statusCode, response.body).toBe(200);
  const item = response.json().item;
  expect(item.active).toBe(false);
  expect(item.configuration_version).toBe(1);
  expect(
    (
      await owner.pool.query(
        "select count(*)::int n from public.hacienda_configuration where tenant_id=$1 and revision=0 and active_version is null",
        [item.id],
      )
    ).rows[0].n,
  ).toBe(2);
  expect(
    (
      await owner.pool.query(
        "select count(*)::int n from public.document_routes where tenant_id=$1 and not enabled and assignee_id is null",
        [item.id],
      )
    ).rows[0].n,
  ).toBe(2);
  expect(
    (await request(`/companies/${item.id}/hacienda?environment=test`))
      .statusCode,
  ).toBe(403);
  expect(
    (await request("/companies"))
      .json()
      .items.some((row: any) => row.id === item.id),
  ).toBe(false);
  const activated = await request(
    `/company-administration/${item.id}`,
    "PATCH",
    { ...editable(item), active: true },
  );
  expect(activated.statusCode, activated.body).toBe(200);
  expect(
    (await request(`/companies/${item.id}/hacienda?environment=test`))
      .statusCode,
  ).toBe(200);
});

it("limits inactive setup to empty metadata and disabled routes even for the platform owner", async () => {
  const id = (
    await owner.pool.query(
      "insert into public.tenants(legal_name,identification_type,identification,active) values('Configuración inactiva local','other',$1,false) returning id",
      [randomUUID()],
    )
  ).rows[0].id;
  const dep = (
    await owner.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Departamento inactivo de prueba') returning id",
      [id],
    )
  ).rows[0].id;
  await ownerTransaction(async (db) => {
    expect(
      (
        await db.query(
          "insert into public.hacienda_configuration(tenant_id,environment) values($1,'test')",
          [id],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await db.query(
          "update public.hacienda_configuration set api_status='success' where tenant_id=$1",
          [id],
        )
      ).rowCount,
    ).toBe(0);
  });
  for (const bad of [
    { revision: 1, status: "not_tested", certificate: null },
    { revision: 0, status: "success", certificate: null },
    { revision: 0, status: "not_tested", certificate: { unverified: true } },
  ])
    await ownerTransaction(async (db) => {
      await expect(
        db.query(
          "insert into public.hacienda_configuration(tenant_id,environment,revision,api_status,certificate_metadata) values($1,'test',$2,$3,$4)",
          [id, bad.revision, bad.status, bad.certificate],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  await ownerTransaction(async (db) => {
    expect(
      (
        await db.query(
          "insert into public.document_routes(tenant_id,flow,target_department_id) values($1,'collections',$2)",
          [id, dep],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await db.query(
          "update public.document_routes set enabled=true where tenant_id=$1",
          [id],
        )
      ).rowCount,
    ).toBe(0);
  });
  for (const bad of [
    { enabled: true, version: 1 },
    { enabled: false, version: 2 },
  ])
    await ownerTransaction(async (db) => {
      await expect(
        db.query(
          "insert into public.document_routes(tenant_id,flow,target_department_id,enabled,version) values($1,'collections',$2,$3,$4)",
          [id, dep, bad.enabled, bad.version],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
});

it("rolls back the entire company creation if initial structure cannot be completed", async () => {
  const body = companyBody();
  await owner.pool.query(
    "create function private.test_global_setup_failure() returns trigger language plpgsql as $$ begin if current_setting('application_name',true)='global-setup-failure' then raise exception 'TEST_SETUP_FAILURE'; end if; return new; end $$",
  );
  await owner.pool.query(
    "create trigger test_global_setup_failure before insert on public.departments for each row execute function private.test_global_setup_failure()",
  );
  const url = new URL(runtimeUrl);
  url.searchParams.set("application_name", "global-setup-failure");
  const failingApp = await createApp({
    ...owner.config,
    DATABASE_URL: url.toString(),
    HACIENDA_STAG_EMISSION_ENABLED: "false",
    HACIENDA_PRODUCTION_EMISSION_ENABLED: "false",
  });
  try {
    const response = await failingApp.inject({
      method: "POST",
      url: "/api/company-administration",
      headers: {
        cookie: actor.cookie,
        origin: owner.config.APP_ORIGIN,
        "x-csrf-token": actor.csrf,
      },
      payload: body,
    });
    expect(response.statusCode).toBe(500);
    expect(
      (
        await owner.pool.query(
          "select count(*)::int n from public.tenants where identification=$1",
          [body.identification],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await owner.pool.query(
          "select count(*)::int n from private.company_operations where actor_id=$1 and operation_id=$2",
          [owner.userId, body.operation_id],
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await failingApp.close();
    await owner.pool.query(
      "drop trigger test_global_setup_failure on public.departments; drop function private.test_global_setup_failure()",
    );
  }
});

it("allows actual catalog and occasional draft operations in an unassigned company", async () => {
  const id = secondary.tenants[0];
  const created = await request(`/companies/${id}/customers`, "POST", {
    name: "Cliente de prueba global",
  });
  expect(created.statusCode, created.body).toBe(200);
  const draft = await request(`/companies/${id}/invoice-drafts`, "POST", {
    operation_id: randomUUID(),
    customer_id: null,
    receiver_mode: "occasional",
    receiver: receiverInput.parse({
      name: "Cliente ocasional",
      identification_type: "01",
      identification: "123456789",
    }),
    department_id: department,
    currency: "CRC",
    lines: [
      {
        description: "Servicio local",
        quantity: "2",
        unit_price: "1000",
        fiscal: lineFiscalInput.parse({
          cabys: "0000000000001",
          unit: "Unid",
          tariff_code: "08",
          treatment: "taxable",
        }),
      },
    ],
  });
  expect(draft.statusCode, draft.body).toBe(200);
  const metadata = await request(`/companies/${id}/invoice-options`);
  expect(metadata.statusCode, metadata.body).toBe(200);
  const hacienda = await request(`/companies/${id}/hacienda?environment=test`);
  expect(hacienda.statusCode, hacienda.body).toBe(200);
  expect(
    (await request(`/companies/${company.id}/customers`))
      .json()
      .items.some((c: any) => c.id === created.json().item.id),
  ).toBe(false);
});

it("keeps secondary administrators scoped and ignores user editable global-role claims", async () => {
  await secondary.admin.auth.admin.updateUserById(secondary.userId, {
    user_metadata: { platform_role: "SUPER_ADMIN_GLOBAL" },
  });
  const state = (
    await request("/auth/session", "GET", undefined, otherActor)
  ).json();
  expect(state.user.platform_role).toBeNull();
  const client = await request(
    `/companies/${secondary.tenants[0]}/customers`,
    "POST",
    { name: "Cliente del administrador secundario" },
    otherActor,
  );
  expect(client.statusCode, client.body).toBe(200);
  const changed = await request(
    `/companies/${secondary.tenants[0]}/customers/${client.json().item.id}`,
    "PATCH",
    {
      name: "Cliente modificado por administrador secundario",
      version: client.json().item.version,
    },
    otherActor,
  );
  expect(changed.statusCode, changed.body).toBe(200);
  const list = (
    await request("/companies", "GET", undefined, otherActor)
  ).json();
  expect(list.items.map((v: any) => v.id).sort()).toEqual(
    [...secondary.tenants].sort(),
  );
  expect(
    (
      await request(
        `/companies/${secondary.tenants[0]}/overview`,
        "GET",
        undefined,
        otherActor,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await request(
        `/companies/${company.id}/overview`,
        "GET",
        undefined,
        otherActor,
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await request(
        "/company-administration",
        "POST",
        companyBody(),
        otherActor,
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await request(
        `/companies/${company.id}/customers`,
        "POST",
        { name: "Intrusión" },
        otherActor,
      )
    ).statusCode,
  ).toBe(403);
});

it("protects the platform role from writes by the real application database role", async () => {
  for (const query of [
    "insert into private.platform_operators(user_id) values($1)",
    "update private.platform_operators set user_id=$1",
    "delete from private.platform_operators where user_id=$1",
  ])
    await expect(runtime.query(query, [owner.userId])).rejects.toMatchObject({
      code: "42501",
    });
  expect(
    (
      await owner.pool.query(
        "select count(*)::int n from private.platform_operators where user_id=$1",
        [owner.userId],
      )
    ).rows[0].n,
  ).toBe(1);
});

it("authorizes a leased background job for the global issuer without company membership", async () => {
  const tenant = secondary.tenants[0];
  const draft = (
    await owner.pool.query(
      "insert into public.invoice_drafts(tenant_id,department_id,currency,customer_snapshot,created_by,updated_by,operation_id,request_hash) values($1,$2,'CRC','{}',$3,$3,$4,'TEST') returning id",
      [tenant, department, owner.userId, randomUUID()],
    )
  ).rows[0].id;
  const invoice = (
    await owner.pool.query(
      "insert into public.electronic_invoices(tenant_id,draft_id,draft_version,department_id,snapshot,options,created_by,operation_id,request_hash,document_status,issued_by,signature_status,transmission_status) values($1,$2,1,$3,'{}','{}',$4,$5,$6,'issued',$4,'signed','queued') returning id",
      [tenant, draft, department, owner.userId, randomUUID(), "a".repeat(64)],
    )
  ).rows[0].id;
  const token = randomUUID();
  const job = (
    await owner.pool.query(
      "insert into private.emission_jobs(tenant_id,invoice_id,kind,status,lease_token,lease_until) values($1,$2,'transmit','leased',$3,now()+interval '2 minutes') returning id",
      [tenant, invoice, token],
    )
  ).rows[0].id;
  expect(
    (
      await runtime.query(
        "select id from private.emission_job_document($1,$2)",
        [job, token],
      )
    ).rows.map((v) => v.id),
  ).toEqual([invoice]);
  const authSession = (
    await owner.pool.query(
      "select auth_session_id from private.sessions where user_id=$1 and revoked_at is null order by last_seen desc limit 1",
      [owner.userId],
    )
  ).rows[0].auth_session_id;
  const db = await runtime.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({
        sub: owner.userId,
        aal: "aal2",
        session_id: authSession,
      }),
    ]);
    expect(
      (
        await db.query(
          "select private.has_access($1,'invoices.emit',$2) allowed",
          [tenant, department],
        )
      ).rows[0].allowed,
    ).toBe(true);
    await expect(
      db.query(
        "update public.electronic_invoices set snapshot='{" +
          '"alterado":true' +
          "}'::jsonb where id=$1",
        [invoice],
      ),
    ).rejects.toMatchObject({ message: "ISSUED_INVOICE_IMMUTABLE" });
  } finally {
    await db.query("rollback");
    db.release();
  }
  await owner.pool.query(
    "delete from private.platform_operators where user_id=$1",
    [owner.userId],
  );
  try {
    expect(
      (
        await runtime.query(
          "select id from private.emission_job_document($1,$2)",
          [job, token],
        )
      ).rowCount,
    ).toBe(0);
  } finally {
    await owner.pool.query(
      "insert into private.platform_operators(user_id) values($1)",
      [owner.userId],
    );
  }
});

it("applies global RLS without exposing unknown permissions or allowing an AAL1 session", async () => {
  const id = (
    await owner.pool.query(
      "select auth_session_id from private.sessions where user_id=$1 and revoked_at is null order by last_seen desc limit 1",
      [owner.userId],
    )
  ).rows[0].auth_session_id;
  const claims = { sub: owner.userId, aal: "aal2", session_id: id };
  const row = await scoped(
    runtime,
    claims,
    async (db) =>
      (
        await db.query(
          "select private.has_access($1,'invoices.read',$2) allowed,private.has_access($1,'not.registered') unknown,(select count(*)::int from public.tenants where id=$1) companies",
          [secondary.tenants[0], department],
        )
      ).rows[0],
  );
  expect(row).toEqual({ allowed: true, unknown: false, companies: 1 });
  const futurePermission = "future_test." + randomUUID();
  await owner.pool.query(
    "insert into public.permission_catalog(code,module,action) values($1,'future_test','read')",
    [futurePermission],
  );
  try {
    for (const tenant of [secondary.tenants[0], company.id])
      expect(
        await scoped(
          runtime,
          claims,
          async (db) =>
            (
              await db.query("select private.has_access($1,$2) allowed", [
                tenant,
                futurePermission,
              ])
            ).rows[0].allowed,
        ),
      ).toBe(true);
  } finally {
    await owner.pool.query(
      "delete from public.permission_catalog where code=$1",
      [futurePermission],
    );
  }
  expect(
    await scoped(
      runtime,
      { ...claims, aal: "aal1" },
      async (db) =>
        (
          await db.query(
            "select private.has_access($1,'invoices.read',$2) allowed",
            [secondary.tenants[0], department],
          )
        ).rows[0].allowed,
    ),
  ).toBe(false);
});

it("retains the global role and all companies after a full logout and MFA login", async () => {
  const previous = actor;
  expect((await request("/auth/logout", "POST", {})).statusCode).toBe(200);
  expect(
    (await request("/companies", "GET", undefined, previous)).statusCode,
  ).toBe(401);
  actor = (await authenticate(owner, factor)).actor;
  expect((await request("/auth/session")).json().user.platform_role).toBe(
    "SUPER_ADMIN_GLOBAL",
  );
  expect(
    (await request("/companies")).json().items.map((v: any) => v.id),
  ).toEqual(expect.arrayContaining([...secondary.tenants, company.id]));
});
