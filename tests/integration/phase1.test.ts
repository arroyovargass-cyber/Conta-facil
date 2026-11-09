import { beforeAll, afterAll, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { randomUUID, randomBytes, createHmac } from "node:crypto";
import { createApp } from "../../apps/api/src/app";
import { loadConfig } from "../../apps/api/src/config";
const config = loadConfig(),
  pool = new pg.Pool({ connectionString: config.DATABASE_URL });
const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let app: Awaited<ReturnType<typeof createApp>>;
const origin = config.APP_ORIGIN,
  tag = randomUUID().slice(0, 8),
  password = randomBytes(20).toString("hex") + "aA!";
let tenantA: string,
  tenantB: string,
  depA: string,
  depB: string,
  adminId: string,
  workerId: string,
  adminRole: string,
  workerRole: string,
  sessionCookie = "",
  csrf = "",
  token = "";
function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=/g, ""))
    bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const n = Buffer.alloc(8);
  n.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = createHmac("sha1", key).update(n).digest(),
    offset = mac[19] & 15;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}
async function user(identity: string, name: string) {
  const email = identity + "@example.test";
  const r = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (r.error) throw r.error;
  const id = r.data.user.id;
  await pool.query("insert into public.profiles(id,name) values($1,$2)", [
    id,
    name,
  ]);
  await pool.query(
    "insert into private.login_directory values($1,'CR','other',$2,$3)",
    [id, identity, email],
  );
  return id;
}
async function login(identity: string) {
  const r = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    remoteAddress: "127.25.1." + ((parseInt(tag.slice(0, 2), 16) % 250) + 1),
    headers: { origin },
    payload: {
      type: "other",
      country: "CR",
      identification: identity,
      password,
    },
  });
  expect(r.statusCode, r.body).toBe(200);
  return {
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: r.json().csrf,
  };
}
const request = (url: string, method = "GET", payload?: any) =>
  app.inject({
    method: method as any,
    url,
    headers: { origin, cookie: sessionCookie, "x-csrf-token": csrf },
    payload,
  });
beforeAll(async () => {
  app = await createApp(config);
  adminId = await user("admin-" + tag, "Administrador de prueba");
  workerId = await user("worker-" + tag, "Operativo de prueba");
  tenantA = (
    await pool.query(
      `insert into public.tenants(legal_name,identification_type,identification) values($1,'other',$1) returning id`,
      ["A-" + tag],
    )
  ).rows[0].id;
  tenantB = (
    await pool.query(
      `insert into public.tenants(legal_name,identification_type,identification) values($1,'other',$1) returning id`,
      ["B-" + tag],
    )
  ).rows[0].id;
  for (const t of [tenantA, tenantB]) {
    await pool.query(
      "insert into public.memberships(tenant_id,user_id,scope) values($1,$2,'company')",
      [t, adminId],
    );
    await pool.query(
      "insert into public.membership_roles select tenant_id,$2,id from public.roles where tenant_id=$1 and code='admin'",
      [t, adminId],
    );
  }
  adminRole = (
    await pool.query(
      "select id from public.roles where tenant_id=$1 and code='admin'",
      [tenantA],
    )
  ).rows[0].id;
  workerRole = (
    await pool.query(
      "select id from public.roles where tenant_id=$1 and code='operative'",
      [tenantA],
    )
  ).rows[0].id;
  depA = (
    await pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Autorizado') returning id",
      [tenantA],
    )
  ).rows[0].id;
  depB = (
    await pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Restringido') returning id",
      [tenantA],
    )
  ).rows[0].id;
  await pool.query(
    "insert into public.memberships(tenant_id,user_id,scope) values($1,$2,'departments')",
    [tenantA, workerId],
  );
  await pool.query("insert into public.membership_roles values($1,$2,$3)", [
    tenantA,
    workerId,
    workerRole,
  ]);
  await pool.query(
    "insert into public.membership_departments values($1,$2,$3)",
    [tenantA, workerId, depA],
  );
  const s = await login("admin-" + tag);
  sessionCookie = s.cookie;
  csrf = s.csrf;
});
afterAll(async () => {
  await app?.close();
  await pool.end();
});
it("blocks admin access before MFA enrollment", async () => {
  expect((await request("/api/companies")).statusCode).toBe(403);
});
it("enrolls real TOTP and allows shared-company access", async () => {
  const enrollment = await request("/api/auth/mfa/enroll", "POST", {});
  expect(enrollment.statusCode, enrollment.body).toBe(200);
  const verified = await request("/api/auth/mfa/verify", "POST", {
    factorId: enrollment.json().factorId,
    code: totp(enrollment.json().secret),
  });
  expect(verified.statusCode, verified.body).toBe(200);
  const s = await request("/api/auth/session");
  csrf = s.json().csrf;
  expect(s.json().aal).toBe("aal2");
  const r = await request("/api/companies");
  expect(
    r
      .json()
      .items.map((i: any) => i.id)
      .sort(),
  ).toEqual([tenantA, tenantB].sort());
  const raw = await pool.query(
    "select encrypted_tokens from private.sessions where user_id=$1 order by last_seen desc limit 1",
    [adminId],
  );
  expect(raw.rows[0].encrypted_tokens).not.toContain("access_token");
});
it("creates organizations and records audit without content", async () => {
  const r = await request(
    "/api/companies/" + tenantA + "/departments",
    "POST",
    { name: "Mantenimiento" },
  );
  expect(r.statusCode, r.body).toBe(200);
  const audit = await request("/api/companies/" + tenantA + "/audit");
  expect(audit.json().items.some((a: any) => a.entity === "departments")).toBe(
    true,
  );
  expect(JSON.stringify(audit.json())).not.toContain("Mantenimiento");
});
it("rejects blank names and cross-company branch references", async () => {
  expect(
    (
      await request("/api/companies/" + tenantA + "/departments", "POST", {
        name: " ",
      })
    ).statusCode,
  ).toBe(400);
  const branch = await request(
    "/api/companies/" + tenantB + "/branches",
    "POST",
    { name: "Sucursal", code: "001" },
  );
  expect(branch.statusCode, branch.body).toBe(200);
  const terminal = await request(
    "/api/companies/" + tenantA + "/terminals",
    "POST",
    { name: "Terminal", code: "00001", branch_id: branch.json().item.id },
  );
  expect(terminal.statusCode, terminal.body).toBe(400);
});
it("separates tax environments and only saves drafts", async () => {
  for (const environment of ["test", "production"]) {
    const r = await request(
      "/api/companies/" + tenantA + "/tax-settings",
      "POST",
      { environment, currency: "CRC", notes: "Prueba", source_url: "" },
    );
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().item.status).toBe("draft");
  }
  expect(
    (await request("/api/companies/" + tenantA + "/tax-settings")).json().items,
  ).toHaveLength(2);
});
it("preserves last administrator and rolls back failed change", async () => {
  const r = await request(
    "/api/companies/" + tenantA + "/memberships/" + adminId,
    "PATCH",
    { active: false, scope: "company", role_id: adminRole, department_ids: [] },
  );
  expect(r.statusCode, r.body).toBe(400);
  expect(
    (
      await pool.query(
        "select active from public.memberships where tenant_id=$1 and user_id=$2",
        [tenantA, adminId],
      )
    ).rows[0].active,
  ).toBe(true);
});
it("enforces department scope and blocks elevation for operational user", async () => {
  const s = await login("worker-" + tag);
  const r = await app.inject({
    url: "/api/companies/" + tenantA + "/departments",
    headers: { cookie: s.cookie },
  });
  expect(r.json().items.map((d: any) => d.id)).toEqual([depA]);
  const foreign = await app.inject({
    url: "/api/companies/" + tenantB + "/overview",
    headers: { cookie: s.cookie },
  });
  expect(foreign.statusCode).toBe(404);
  const mutate = await app.inject({
    method: "PATCH",
    url: "/api/companies/" + tenantA + "/memberships/" + workerId,
    headers: { origin, cookie: s.cookie, "x-csrf-token": s.csrf },
    payload: {
      active: true,
      scope: "company",
      role_id: adminRole,
      department_ids: [],
    },
  });
  expect(mutate.statusCode, mutate.body).toBe(403);
  const db = await pool.query(
    "select encrypted_tokens from private.sessions where user_id=$1 order by last_seen desc limit 1",
    [workerId],
  );
  const { unseal } = await import("../../apps/api/src/security/crypto");
  token = unseal<any>(
    db.rows[0].encrypted_tokens,
    config.SESSION_KEY,
  ).access_token;
  const rest = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false },
  });
  const direct = await rest.from("departments").select("id");
  expect(direct.error).toBeNull();
  expect(direct.data?.map((d: any) => d.id)).toEqual([depA]);
  await pool.query(
    "update public.memberships set active=false where tenant_id=$1 and user_id=$2",
    [tenantA, workerId],
  );
  const denied = await rest.from("departments").select("id");
  expect(denied.data).toEqual([]);
});
it("returns existing role and department bindings so editing does not silently escalate", async () => {
  const response = await request("/api/companies/" + tenantA + "/memberships");
  const worker = response.json().items.find((m: any) => m.user_id === workerId);
  expect(worker.role_ids).toEqual([workerRole]);
  expect(worker.department_ids).toEqual([depA]);
});
it("serializes concurrent revocations and preserves one active administrator", async () => {
  const other = await user("second-" + tag, "Segundo administrador");
  await pool.query(
    "insert into public.memberships(tenant_id,user_id,scope) values($1,$2,'company')",
    [tenantA, other],
  );
  await pool.query("insert into public.membership_roles values($1,$2,$3)", [
    tenantA,
    other,
    adminRole,
  ]);
  const results = await Promise.all(
    [adminId, other].map((id) =>
      request("/api/companies/" + tenantA + "/memberships/" + id, "PATCH", {
        active: false,
        scope: "company",
        role_id: adminRole,
        department_ids: [],
      }),
    ),
  );
  expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
  expect(results.every((r) => [200, 400, 403].includes(r.statusCode))).toBe(
    true,
  );
  const remaining = await pool.query(
    "select count(*)::int n from public.memberships m join public.membership_roles mr using(tenant_id,user_id) join public.roles r on r.id=mr.role_id where m.tenant_id=$1 and m.active and r.code='admin'",
    [tenantA],
  );
  expect(remaining.rows[0].n).toBe(1);
});
it("revokes application sessions immediately on logout", async () => {
  const r = await request("/api/auth/logout", "POST", {});
  expect(r.statusCode, r.body).toBe(200);
  expect((await request("/api/companies")).statusCode).toBe(401);
});
