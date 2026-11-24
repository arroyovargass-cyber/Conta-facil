import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { randomBytes, createHash } from "node:crypto";
import { workspace } from "../support/workspace";
import { runtimeConfig } from "../support/runtime-config";
import { totp } from "../support/totp";
import { syntheticPkcs12 } from "../support/pkcs12";
import { createApp } from "../../apps/api/src/app";
let f: Awaited<ReturnType<typeof workspace>>,
  app: Awaited<ReturnType<typeof createApp>>,
  cookie = "",
  csrf = "",
  file: string;
let runtime: import("../../apps/api/src/config").AppConfig;
const key = randomBytes(32).toString("hex");
const request = (
  path = "",
  method = "GET",
  payload?: Record<string, unknown>,
  tenant?: string,
  instance = app,
) =>
  instance.inject({
    method: method as any,
    url: "/api/companies/" + (tenant ?? f.tenants[0]) + "/hacienda" + path,
    headers: { cookie, origin: f.config.APP_ORIGIN, "x-csrf-token": csrf },
    payload,
  });
const input = (revision: number) => ({
  environment: "test",
  expected_revision: revision,
  username: "usuario-prueba-api",
  password: " CONTRASEÑA-PRIVADA-Ñ! ",
  pin: "1234",
  pkcs12_base64: file,
});
const hidden = (body: string) => {
  for (const s of [
    input(0).password,
    "usuario-prueba-api",
    file,
    "PRIVATE KEY",
    "pkcs12_base64",
    "api_ciphertext",
    "pkcs12_ciphertext",
  ])
    expect(body).not.toContain(s);
};
beforeAll(async () => {
  f = await workspace({ role: "admin", companies: 2, systemAdmin: true });
  runtime = await runtimeConfig({
    ...f.config,
    NODE_ENV: "test",
    HACIENDA_KEYRING: JSON.stringify({ v1: key }),
    HACIENDA_ACTIVE_KEY_ID: "v1",
  });
  app = await createApp(runtime);
  ({ cookie, csrf } = await f.login(app));
  const enrollment = await app.inject({
    method: "POST",
    url: "/api/auth/mfa/enroll",
    headers: { cookie, origin: f.config.APP_ORIGIN, "x-csrf-token": csrf },
  });
  const verified = await app.inject({
    method: "POST",
    url: "/api/auth/mfa/verify",
    headers: { cookie, origin: f.config.APP_ORIGIN, "x-csrf-token": csrf },
    payload: {
      factorId: enrollment.json().factorId,
      code: totp(enrollment.json().secret),
    },
  });
  expect(verified.statusCode, verified.body).toBe(200);
  csrf = (
    await app.inject({ url: "/api/auth/session", headers: { cookie } })
  ).json().csrf;
  file = (await syntheticPkcs12({ pin: "1234" })).toString("base64");
});
beforeEach(async () => {
  const keys = [
    "hacienda:credentials:tenant:" + f.tenants[0],
    "hacienda:credentials:tenant:" + f.tenants[1],
    "hacienda:credentials:user:" + f.userId,
  ].map((s) => createHash("sha256").update(s).digest("hex"));
  await f.pool.query(
    "delete from private.rate_limits where key=any($1::text[])",
    [keys],
  );
});
afterAll(async () => {
  await app?.close();
  await f?.pool.end();
});
it("returns empty configuration and disabled fiscal capabilities without secrets", async () => {
  const r = await request();
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json()).toMatchObject({
    configuration: { revision: 0, active_version: null },
    capabilities: { can_emit: false, can_test_connection: false },
  });
  hidden(r.body);
});
it("stores separately encrypted payloads and returns public certificate metadata only", async () => {
  const r = await request("/credentials", "POST", input(0));
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json().configuration).toMatchObject({
    revision: 1,
    active_version: 1,
    certificate_metadata: {
      technical_status: "valid_local",
      identity_status: "pending",
    },
    api_status: "not_tested",
  });
  hidden(r.body);
  const rows = (
    await f.pool.query(
      "select * from private.hacienda_credential_versions where tenant_id=$1",
      [f.tenants[0]],
    )
  ).rows;
  expect(rows).toHaveLength(1);
  for (const field of ["api_ciphertext", "pkcs12_ciphertext"]) {
    expect(rows[0][field]).toBeInstanceOf(Buffer);
    expect(rows[0][field].includes(Buffer.from(input(0).password))).toBe(false);
  }
  hidden((await request()).body);
  const audit = await f.pool.query(
    "select details from public.audit_events where tenant_id=$1 and entity='hacienda_credentials'",
    [f.tenants[0]],
  );
  expect(audit.rows.length).toBeGreaterThan(0);
  hidden(JSON.stringify(audit.rows));
  expect(
    (await request("", "GET", undefined, f.tenants[1])).json().configuration
      .active_version,
  ).toBe(null);
});
it("preserves active material after a bad PIN and rejects stale revisions", async () => {
  const bad = await request("/credentials", "POST", {
    ...input(1),
    pin: "PIN-SECRETO-INCORRECTO",
  });
  expect(bad.statusCode, bad.body).toBe(400);
  expect(bad.body).not.toContain("PIN-SECRETO-INCORRECTO");
  hidden(bad.body);
  expect((await request()).json().configuration.revision).toBe(1);
  expect((await request("/credentials", "POST", input(0))).statusCode).toBe(
    409,
  );
});
it("rejects production, unknown fields, noncanonical base64 and oversized requests", async () => {
  for (const payload of [
    { ...input(1), environment: "production" },
    { ...input(1), extra: "PRIVATE-EXTRA" },
    { ...input(1), pkcs12_base64: file + "\n" },
  ]) {
    const r = await request("/credentials", "POST", payload);
    expect(r.statusCode, r.body).toBe(400);
    hidden(r.body);
  }
  const huge = await request("/credentials", "POST", {
    ...input(1),
    pkcs12_base64: "a".repeat(3 * 1024 * 1024),
  });
  expect(huge.statusCode, huge.body).toBe(413);
  hidden(huge.body);
});
it("activates exactly one version when concurrent replacements use the same revision", async () => {
  const results = await Promise.all([
    request("/credentials", "POST", input(1)),
    request("/credentials", "POST", input(1)),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  const rows = (
    await f.pool.query(
      "select version,active from private.hacienda_credential_versions where tenant_id=$1 order by version",
      [f.tenants[0]],
    )
  ).rows;
  expect(rows).toEqual([
    { version: 1, active: false },
    { version: 2, active: true },
  ]);
});
it("deactivates locally without deleting history or claiming official revocation", async () => {
  const r = await request("/credentials/deactivate", "POST", {
    environment: "test",
    expected_revision: 2,
  });
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json().configuration).toMatchObject({
    revision: 3,
    active_version: null,
    certificate_metadata: null,
    api_status: "not_tested",
  });
  expect(r.json().official_revocation).toBe(false);
  hidden(r.body);
  const rows = await f.pool.query(
    "select active from private.hacienda_credential_versions where tenant_id=$1",
    [f.tenants[0]],
  );
  expect(rows.rows).toHaveLength(2);
  expect(rows.rows.every((r) => !r.active)).toBe(true);
});
it("fails closed without a vault keyring", async () => {
  const bare = await createApp({
    ...appConfig(),
    HACIENDA_KEYRING: undefined,
    HACIENDA_ACTIVE_KEY_ID: undefined,
  });
  try {
    const r = await request(
      "/credentials",
      "POST",
      input(0),
      f.tenants[1],
      bare,
    );
    expect(r.statusCode, r.body).toBe(503);
    hidden(r.body);
  } finally {
    await bare.close();
  }
});
function appConfig() {
  return {
    ...runtime,
    NODE_ENV: "test" as const,
    HACIENDA_KEYRING: JSON.stringify({ v1: key }),
    HACIENDA_ACTIVE_KEY_ID: "v1",
  };
}
it("keeps development snapshots disabled outside the automated test environment", async () => {
  const development = await createApp({
    ...appConfig(),
    NODE_ENV: "development",
  });
  try {
    const metadata = await request(
      "",
      "GET",
      undefined,
      undefined,
      development,
    );
    expect(metadata.json().capabilities).toMatchObject({
      can_store_credentials: false,
      reason: "inspector_validation_pending",
    });
    const response = await request(
      "/credentials",
      "POST",
      input(0),
      f.tenants[1],
      development,
    );
    expect(response.statusCode, response.body).toBe(503);
  } finally {
    await development.close();
  }
});
it("denies Hacienda metadata and mutations after permission revocation", async () => {
  await f.pool.query(
    "delete from public.role_permissions where tenant_id=$1 and permission in('hacienda.read','hacienda.credentials.manage')",
    [f.tenants[1]],
  );
  try {
    expect((await request("", "GET", undefined, f.tenants[1])).statusCode).toBe(
      403,
    );
    expect(
      (await request("/credentials", "POST", input(0), f.tenants[1]))
        .statusCode,
    ).toBe(403);
  } finally {
    await f.pool.query(
      "insert into public.role_permissions select tenant_id,id,p from public.roles cross join unnest(array['hacienda.read','hacienda.credentials.manage']) p where tenant_id=$1 and code='admin' on conflict do nothing",
      [f.tenants[1]],
    );
  }
});
it("limits failed credential attempts without replacing or leaking material", async () => {
  for (let i = 0; i < 5; i++) {
    const r = await request(
      "/credentials",
      "POST",
      { ...input(0), pin: "WRONG-PIN" },
      f.tenants[1],
    );
    expect(r.statusCode, r.body).toBe(400);
    hidden(r.body);
  }
  expect(
    (await request("/credentials", "POST", input(0), f.tenants[1])).statusCode,
  ).toBe(429);
  expect(
    (await request("", "GET", undefined, f.tenants[1])).json().configuration
      .active_version,
  ).toBe(null);
});
it("checks session authorization again immediately before committing a privileged operation", async () => {
  const { CredentialStore } =
    await import("../../apps/api/src/services/credential-store");
  const pg = await import("pg");
  const pool = new pg.default.Pool({ connectionString: runtime.DATABASE_URL });
  const session = (
    await f.pool.query(
      "select auth_session_id from private.sessions where user_id=$1 and revoked_at is null order by last_seen desc limit 1",
      [f.userId],
    )
  ).rows[0].auth_session_id;
  const store = new CredentialStore(pool, runtime);
  try {
    await expect(
      store.transaction(
        { sub: f.userId, aal: "aal2", session_id: session },
        f.tenants[1],
        "hacienda.credentials.manage",
        async () => {
          await f.pool.query(
            "update private.sessions set revoked_at=now() where auth_session_id=$1 and user_id=$2",
            [session, f.userId],
          );
          return "must not commit";
        },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  } finally {
    await f.pool.query(
      "update private.sessions set revoked_at=null where auth_session_id=$1 and user_id=$2",
      [session, f.userId],
    );
    await pool.end();
  }
});
it("reads older API keys after key rotation and fails closed on damaged ciphertext", async () => {
  const registered = await request(
    "/credentials",
    "POST",
    input(0),
    f.tenants[1],
  );
  expect(registered.statusCode, registered.body).toBe(200);
  const { CredentialStore } =
    await import("../../apps/api/src/services/credential-store");
  const pg = await import("pg");
  const pool = new pg.default.Pool({ connectionString: runtime.DATABASE_URL });
  const session = (
    await f.pool.query(
      "select auth_session_id from private.sessions where user_id=$1 and revoked_at is null order by last_seen desc limit 1",
      [f.userId],
    )
  ).rows[0].auth_session_id;
  const claims = { sub: f.userId, aal: "aal2", session_id: session };
  const rotated = new CredentialStore(pool, {
    ...runtime,
    HACIENDA_KEYRING: JSON.stringify({
      v1: key,
      v2: randomBytes(32).toString("hex"),
    }),
    HACIENDA_ACTIVE_KEY_ID: "v2",
  });
  try {
    const result = await rotated.withApiAccess(
      claims,
      f.tenants[1],
      1,
      async (access) => {
        expect(access).toEqual({
          username: input(0).username,
          password: input(0).password,
        });
        return { status: "local_adapter_only" };
      },
    );
    expect(result).toEqual({ status: "local_adapter_only" });
    // Simulate storage corruption in this synthetic local row, without disabling any persistent trigger.
    const db = await f.pool.connect();
    try {
      await db.query("begin");
      await db.query("set local session_replication_role='replica'");
      await db.query(
        "update private.hacienda_credential_versions set api_ciphertext=set_byte(api_ciphertext,20,get_byte(api_ciphertext,20)#1) where tenant_id=$1",
        [f.tenants[1]],
      );
      await db.query("commit");
    } catch (e) {
      await db.query("rollback");
      throw e;
    } finally {
      db.release();
    }
    await expect(
      rotated.withApiAccess(claims, f.tenants[1], 1, async () => {
        throw Error("must not invoke adapter");
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      message: "No se pudo abrir la versión protegida.",
    });
  } finally {
    await pool.end();
  }
});
it("requires MFA even for metadata and rejects an unauthorized company", async () => {
  const { CredentialStore } =
    await import("../../apps/api/src/services/credential-store");
  const pg = await import("pg");
  const pool = new pg.default.Pool({ connectionString: runtime.DATABASE_URL });
  const session = (
    await f.pool.query(
      "select auth_session_id from private.sessions where user_id=$1 and revoked_at is null order by last_seen desc limit 1",
      [f.userId],
    )
  ).rows[0].auth_session_id;
  try {
    await expect(
      new CredentialStore(pool, runtime).metadata(
        { sub: f.userId, aal: "aal1", session_id: session },
        f.tenants[0],
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(
      (
        await request(
          "",
          "GET",
          undefined,
          "00000000-0000-4000-8000-000000000099",
        )
      ).statusCode,
    ).toBe(403);
  } finally {
    await pool.end();
  }
});
