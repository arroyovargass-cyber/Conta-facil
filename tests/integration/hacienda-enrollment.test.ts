import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { createApp } from "../../apps/api/src/app";
import { scoped } from "../../apps/api/src/db";
import { CredentialStore } from "../../apps/api/src/services/credential-store";
import type { CredentialEnrollmentInput } from "../../apps/api/src/services/credential-store";
import type { HaciendaEnvironment } from "../../packages/domain/src/hacienda-environment";
import { runtimeConfig } from "../support/runtime-config";
import { syntheticPkcs12 } from "../support/pkcs12";
import { totp } from "../support/totp";
import { workspace } from "../support/workspace";

let f: Awaited<ReturnType<typeof workspace>>,
  config: Awaited<ReturnType<typeof runtimeConfig>>,
  app: Awaited<ReturnType<typeof createApp>>,
  cookie = "",
  csrf = "",
  file = "",
  claims: { sub: string; aal: string; session_id: string };
const probeEnvironments: string[] = [];
const request = (
  path = "",
  method = "GET",
  payload?: Record<string, unknown>,
) =>
  app.inject({
    method: method as any,
    url: "/api/companies/" + f.tenants[0] + "/hacienda" + path,
    headers: { cookie, origin: config.APP_ORIGIN, "x-csrf-token": csrf },
    payload,
  });
const credentials = (environment: string, revision = 0) => ({
  environment,
  expected_revision: revision,
  username: "synthetic-enrollment-user",
  password: "synthetic-enrollment-password",
  pin: "1234",
  pkcs12_base64: file,
});
const enroll = (
  environment: HaciendaEnvironment = "test",
  revision = 1,
): CredentialEnrollmentInput => ({
  environment,
  expected_revision: revision,
  confirmed: true,
  evidence_reference: "Revisión administrativa sintética 2026-11-25",
});
beforeAll(async () => {
  f = await workspace({ role: "admin", systemAdmin: true });
  await f.pool.query(
    "update public.tenants set identification_type='01',identification=$2 where id=$1",
    [
      f.tenants[0],
      "8" + (BigInt("0x" + f.tag) % 100000000n).toString().padStart(8, "0"),
    ],
  );
  config = await runtimeConfig({
    ...f.config,
    NODE_ENV: "test",
    HACIENDA_KEYRING: JSON.stringify({ v1: randomBytes(32).toString("hex") }),
    HACIENDA_ACTIVE_KEY_ID: "v1",
    HACIENDA_STAG_PROBE_ENABLED: "true",
    HACIENDA_PRODUCTION_PROBE_ENABLED: "true",
  });
  app = await createApp(config, {
    haciendaIdp: {
      async probe(_access, environment = "test") {
        probeEnvironments.push(environment);
        return { status: "success", sessionClosed: true };
      },
    },
  });
  ({ cookie, csrf } = await f.login(app));
  const factor = (
    await app.inject({
      method: "POST",
      url: "/api/auth/mfa/enroll",
      headers: { cookie, origin: config.APP_ORIGIN, "x-csrf-token": csrf },
    })
  ).json();
  const verified = await app.inject({
    method: "POST",
    url: "/api/auth/mfa/verify",
    headers: { cookie, origin: config.APP_ORIGIN, "x-csrf-token": csrf },
    payload: { factorId: factor.factorId, code: totp(factor.secret) },
  });
  expect(verified.statusCode, verified.body).toBe(200);
  csrf = (
    await app.inject({ url: "/api/auth/session", headers: { cookie } })
  ).json().csrf;
  const session = (
    await f.pool.query(
      "select auth_session_id from private.sessions where user_id=$1 and revoked_at is null order by last_seen desc limit 1",
      [f.userId],
    )
  ).rows[0].auth_session_id;
  claims = { sub: f.userId, aal: "aal2", session_id: session };
  file = (await syntheticPkcs12({ pin: "1234" })).toString("base64");
  // Match hosted Supabase: the API role cannot enter the managed Auth schema.
  await f.pool.query("revoke usage on schema auth from conta_facil_api");
});
beforeEach(async () => {
  const keys = ["credentials", "probe"]
    .flatMap((kind) => [
      `hacienda:${kind}:tenant:${f.tenants[0]}`,
      `hacienda:${kind}:user:${f.userId}`,
    ])
    .map((value) => createHash("sha256").update(value).digest("hex"));
  await f.pool.query(
    "delete from private.rate_limits where key=any($1::text[])",
    [keys],
  );
});
afterAll(async () => {
  await f?.pool.query("grant usage on schema auth to conta_facil_api");
  await app?.close();
  await f?.pool.end();
});

it("requires active technically inspected credentials and a same-environment connection test", async () => {
  expect(
    (await request("/credentials/enroll", "POST", enroll("test", 0)))
      .statusCode,
  ).toBe(409);
  for (const environment of ["test", "production"]) {
    const saved = await request(
      "/credentials",
      "POST",
      credentials(environment),
    );
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().configuration.enrollment).toBeNull();
    expect(saved.json().capabilities.can_enroll).toBe(false);
  }
  expect(
    (await request("/credentials/enroll", "POST", enroll())).statusCode,
  ).toBe(409);
  const tested = await request("/connection-test", "POST", {
    environment: "test",
    expected_revision: 1,
  });
  expect(tested.statusCode, tested.body).toBe(200);
  expect(tested.json().capabilities.can_enroll).toBe(true);
  expect(probeEnvironments).toEqual(["test"]);
  expect(
    (await request("/credentials/enroll", "POST", enroll("production")))
      .statusCode,
  ).toBe(409);
  expect(
    (await request("?environment=production")).json().configuration,
  ).toMatchObject({ api_status: "not_tested", enrollment: null });
});

it("refuses review while the current certificate is expired or technically invalid", async () => {
  const certificate = (
    await f.pool.query(
      "select certificate_metadata from public.hacienda_configuration where tenant_id=$1 and environment='test'",
      [f.tenants[0]],
    )
  ).rows[0].certificate_metadata;
  try {
    for (const patch of [
      { valid_until: "2000-01-01T00:00:00Z" },
      { technical_status: "invalid_local" },
    ]) {
      await f.pool.query(
        "update public.hacienda_configuration set certificate_metadata=$2 where tenant_id=$1 and environment='test'",
        [f.tenants[0], JSON.stringify({ ...certificate, ...patch })],
      );
      expect((await request()).json().capabilities.can_enroll).toBe(false);
      expect(
        (await request("/credentials/enroll", "POST", enroll())).statusCode,
      ).toBe(409);
    }
  } finally {
    await f.pool.query(
      "update public.hacienda_configuration set certificate_metadata=$2 where tenant_id=$1 and environment='test'",
      [f.tenants[0], JSON.stringify(certificate)],
    );
  }
});

it("records one explicit administrative review without claiming Hacienda identity validation", async () => {
  const reviewed = await request("/credentials/enroll", "POST", enroll());
  expect(reviewed.statusCode, reviewed.body).toBe(200);
  const configuration = reviewed.json().configuration;
  const tenant = (
    await f.pool.query(
      "select identification,identification_type from public.tenants where id=$1",
      [f.tenants[0]],
    )
  ).rows[0];
  expect(configuration.enrollment).toMatchObject({
    environment: "test",
    version: 1,
    status: "operator_verified",
    issuer_identification: tenant.identification,
    issuer_identification_type: tenant.identification_type,
    certificate_fingerprint: configuration.certificate_metadata.fingerprint
      .replace(/:/g, "")
      .toLowerCase(),
    confirmed_by: f.userId,
    evidence_reference: enroll().evidence_reference,
  });
  expect(configuration.enrollment.confirmed_at).toEqual(expect.any(String));
  expect(configuration.certificate_metadata.identity_status).toBe("pending");
  const repeated = await request("/credentials/enroll", "POST", {
    ...enroll(),
    evidence_reference: "Una referencia posterior no cambia el historial",
  });
  expect(repeated.statusCode, repeated.body).toBe(200);
  expect(repeated.json().configuration.enrollment).toEqual(
    configuration.enrollment,
  );
  expect(
    (
      await f.pool.query(
        "select count(*)::int total from private.hacienda_credential_enrollments where tenant_id=$1",
        [f.tenants[0]],
      )
    ).rows[0].total,
  ).toBe(1);
  for (const secret of [
    "synthetic-enrollment-user",
    "synthetic-enrollment-password",
    file,
    "pkcs12_ciphertext",
    "api_ciphertext",
  ])
    expect(reviewed.body).not.toContain(secret);
});

it("rejects stale revisions, missing confirmation and empty or unbounded review references", async () => {
  expect(
    (await request("/credentials/enroll", "POST", enroll("test", 0)))
      .statusCode,
  ).toBe(409);
  for (const body of [
    { ...enroll(), confirmed: false },
    { ...enroll(), confirmed: undefined },
    { ...enroll(), evidence_reference: "  " },
    { ...enroll(), evidence_reference: "x".repeat(501) },
    { ...enroll(), evidence_reference: "referencia\nextra" },
    { ...enroll(), evidence_reference: "\nreferencia" },
  ])
    expect(
      (await request("/credentials/enroll", "POST", body)).statusCode,
    ).toBe(400);
});

it("requires live owner permission and MFA for administrative enrollment", async () => {
  const pg = await import("pg");
  const pool = new pg.default.Pool({ connectionString: config.DATABASE_URL });
  try {
    const store = new CredentialStore(pool, config);
    await expect(
      store.enroll({ ...claims, aal: "aal1" }, f.tenants[0], enroll()),
    ).rejects.toMatchObject({ statusCode: 403 });
    await f.pool.query(
      "delete from private.platform_operators where user_id=$1",
      [f.userId],
    );
    try {
      expect(
        (await request("/credentials/enroll", "POST", enroll())).statusCode,
      ).toBe(403);
    } finally {
      await f.pool.query("insert into private.platform_operators values($1)", [
        f.userId,
      ]);
    }
  } finally {
    await pool.end();
  }
});

it("keeps enrollment private and immutable", async () => {
  await expect(
    scoped(f.pool, claims, (db) =>
      db.query("select * from private.hacienda_credential_enrollments"),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    f.pool.query(
      "update private.hacienda_credential_enrollments set evidence_reference='changed' where tenant_id=$1",
      [f.tenants[0]],
    ),
  ).rejects.toThrow("immutable");
  await expect(
    f.pool.query(
      "delete from private.hacienda_credential_enrollments where tenant_id=$1",
      [f.tenants[0]],
    ),
  ).rejects.toThrow("immutable");
});

it("does not expose an old review for a different current certificate fingerprint", async () => {
  const certificate = (
    await f.pool.query(
      "select certificate_metadata from public.hacienda_configuration where tenant_id=$1 and environment='test'",
      [f.tenants[0]],
    )
  ).rows[0].certificate_metadata;
  try {
    await f.pool.query(
      "update public.hacienda_configuration set certificate_metadata=$2 where tenant_id=$1 and environment='test'",
      [
        f.tenants[0],
        JSON.stringify({ ...certificate, fingerprint: "f".repeat(64) }),
      ],
    );
    const current = await request();
    expect(current.json().configuration.enrollment).toBeNull();
    expect(current.json().capabilities.can_enroll).toBe(false);
    expect(
      (await request("/credentials/enroll", "POST", enroll())).statusCode,
    ).toBe(409);
  } finally {
    await f.pool.query(
      "update public.hacienda_configuration set certificate_metadata=$2 where tenant_id=$1 and environment='test'",
      [f.tenants[0], JSON.stringify(certificate)],
    );
  }
});

it("invalidates a review when the tenant tax identity changes and preserves its history", async () => {
  const original = (
    await f.pool.query(
      "select identification from public.tenants where id=$1",
      [f.tenants[0]],
    )
  ).rows[0].identification;
  await f.pool.query(
    "update public.tenants set identification_type='02',identification=$2 where id=$1",
    [f.tenants[0], "3" + original],
  );
  const changed = await request();
  expect(changed.json().configuration.enrollment).toBeNull();
  expect(changed.json().capabilities.can_enroll).toBe(false);
  expect(
    (await request("/credentials/enroll", "POST", enroll())).statusCode,
  ).toBe(409);
  expect(
    (
      await f.pool.query(
        "select issuer_identification from private.hacienda_credential_enrollments where tenant_id=$1",
        [f.tenants[0]],
      )
    ).rows,
  ).toEqual([{ issuer_identification: original }]);
  // A new credential version is required to record a review for the changed issuer.
  const replaced = await request(
    "/credentials",
    "POST",
    credentials("test", 1),
  );
  expect(replaced.statusCode, replaced.body).toBe(200);
  expect(replaced.json().configuration).toMatchObject({
    active_version: 2,
    enrollment: null,
    api_status: "not_tested",
  });
});

it("enrolls production separately and invalidates only its active review on deactivation", async () => {
  const tested = await request("/connection-test", "POST", {
    environment: "production",
    expected_revision: 1,
  });
  expect(tested.statusCode, tested.body).toBe(200);
  expect(probeEnvironments).toEqual(["test", "production"]);
  const reviewed = await request(
    "/credentials/enroll",
    "POST",
    enroll("production"),
  );
  expect(reviewed.statusCode, reviewed.body).toBe(200);
  expect(reviewed.json().configuration.enrollment).toMatchObject({
    environment: "production",
    version: 1,
    status: "operator_verified",
    issuer_identification_type: "02",
  });
  const disabled = await request("/credentials/deactivate", "POST", {
    environment: "production",
    expected_revision: 1,
  });
  expect(disabled.statusCode, disabled.body).toBe(200);
  expect(disabled.json().configuration.enrollment).toBeNull();
  expect((await request()).json().configuration).toMatchObject({
    environment: "test",
    revision: 2,
    active_version: 2,
  });
  expect(
    (
      await f.pool.query(
        "select environment,version from private.hacienda_credential_enrollments where tenant_id=$1 order by environment",
        [f.tenants[0]],
      )
    ).rows,
  ).toEqual([
    { environment: "production", version: 1 },
    { environment: "test", version: 1 },
  ]);
});
