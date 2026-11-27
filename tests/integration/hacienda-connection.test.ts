import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { randomBytes, createHash } from "node:crypto";
import { workspace } from "../support/workspace";
import { runtimeConfig } from "../support/runtime-config";
import { totp } from "../support/totp";
import { syntheticPkcs12 } from "../support/pkcs12";
import { createApp } from "../../apps/api/src/app";
let f: Awaited<ReturnType<typeof workspace>>,
  app: Awaited<ReturnType<typeof createApp>>,
  config: import("../../apps/api/src/config").AppConfig,
  cookie = "",
  csrf = "",
  calls = 0,
  file = "";
let release: (() => void) | undefined,
  entered: (() => void) | undefined,
  hold: Promise<void> | undefined;
const idp = {
  async probe(access: { username: string; password: string }) {
    calls++;
    expect(access).toEqual({
      username: "synthetic-api-user",
      password: "synthetic-api-password",
    });
    entered?.();
    await hold;
    return { status: "success" as const, sessionClosed: true };
  },
};
const request = (
  path = "",
  method = "GET",
  payload?: Record<string, unknown>,
  instance = app,
) =>
  instance.inject({
    method: method as any,
    url: "/api/companies/" + f.tenants[0] + "/hacienda" + path,
    headers: { cookie, origin: f.config.APP_ORIGIN, "x-csrf-token": csrf },
    payload,
  });
beforeAll(async () => {
  f = await workspace({ role: "admin", systemAdmin: true });
  config = await runtimeConfig({
    ...f.config,
    NODE_ENV: "test",
    HACIENDA_KEYRING: JSON.stringify({ v1: randomBytes(32).toString("hex") }),
    HACIENDA_ACTIVE_KEY_ID: "v1",
    HACIENDA_STAG_PROBE_ENABLED: "true",
  });
  app = await createApp(config, { haciendaIdp: idp });
  ({ cookie, csrf } = await f.login(app));
  const enrollment = await app.inject({
    method: "POST",
    url: "/api/auth/mfa/enroll",
    headers: { cookie, origin: config.APP_ORIGIN, "x-csrf-token": csrf },
  });
  const verified = await app.inject({
    method: "POST",
    url: "/api/auth/mfa/verify",
    headers: { cookie, origin: config.APP_ORIGIN, "x-csrf-token": csrf },
    payload: {
      factorId: enrollment.json().factorId,
      code: totp(enrollment.json().secret),
    },
  });
  expect(verified.statusCode).toBe(200);
  csrf = (
    await app.inject({ url: "/api/auth/session", headers: { cookie } })
  ).json().csrf;
  file = (await syntheticPkcs12({ pin: "1234" })).toString("base64");
  const saved = await request("/credentials", "POST", {
    environment: "test",
    expected_revision: 0,
    username: "synthetic-api-user",
    password: "synthetic-api-password",
    pin: "1234",
    pkcs12_base64: file,
  });
  expect(saved.statusCode, saved.body).toBe(200);
});
beforeEach(async () => {
  const keys = [
    "hacienda:probe:tenant:" + f.tenants[0],
    "hacienda:probe:user:" + f.userId,
  ].map((s) => createHash("sha256").update(s).digest("hex"));
  await f.pool.query(
    "delete from private.rate_limits where key=any($1::text[])",
    [keys],
  );
  hold = undefined;
  entered = undefined;
  release = undefined;
});
afterAll(async () => {
  release?.();
  await app?.close();
  await f?.pool.end();
});
it("rejects injectable dependencies outside the test environment", async () => {
  await expect(
    createApp({ ...config, NODE_ENV: "production" }, { haciendaIdp: idp }),
  ).rejects.toThrow("pruebas");
});
it("returns unavailable without running a provider when the deployment flag is off", async () => {
  const disabled = await createApp(
    { ...config, HACIENDA_STAG_PROBE_ENABLED: "false" },
    { haciendaIdp: idp },
  );
  const before = calls;
  try {
    const r = await request(
      "/connection-test",
      "POST",
      { environment: "test", expected_revision: 1 },
      disabled,
    );
    expect(r.statusCode, r.body).toBe(503);
    expect(calls).toBe(before);
  } finally {
    await disabled.close();
  }
});
it("stores only final API access status while emission and identity remain blocked", async () => {
  const r = await request("/connection-test", "POST", {
    environment: "test",
    expected_revision: 1,
  });
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json()).toMatchObject({
    configuration: {
      api_status: "success",
      session_closed: true,
      certificate_metadata: { identity_status: "pending" },
    },
    capabilities: { can_emit: false },
  });
  for (const secret of [
    "synthetic-api-user",
    "synthetic-api-password",
    "access_token",
    "refresh_token",
    "PRIVATE KEY",
  ])
    expect(r.body).not.toContain(secret);
});
it("does not start a stale probe or a probe after platform authority is revoked", async () => {
  const before = calls;
  expect(
    (
      await request("/connection-test", "POST", {
        environment: "test",
        expected_revision: 0,
      })
    ).statusCode,
  ).toBe(409);
  expect(calls).toBe(before);
  await f.pool.query(
    "delete from public.role_permissions where tenant_id=$1 and permission='hacienda.connection.test'",
    [f.tenants[0]],
  );
  try {
    await f.pool.query(
      "delete from private.platform_operators where user_id=$1",
      [f.userId],
    );
    expect(
      (
        await request("/connection-test", "POST", {
          environment: "test",
          expected_revision: 1,
        })
      ).statusCode,
    ).toBe(403);
    expect(calls).toBe(before);
  } finally {
    await f.pool.query(
      "insert into private.platform_operators(user_id) values($1) on conflict do nothing",
      [f.userId],
    );
    await f.pool.query(
      "insert into public.role_permissions select tenant_id,id,'hacienda.connection.test' from public.roles where tenant_id=$1 and code='admin'",
      [f.tenants[0]],
    );
  }
});
it("drops results when credentials are deactivated while the probe is in progress", async () => {
  hold = new Promise<void>((r) => (release = r));
  const started = new Promise<void>((r) => (entered = r));
  const running = request("/connection-test", "POST", {
    environment: "test",
    expected_revision: 1,
  }).then((r) => r);
  await Promise.race([
    started,
    running.then((r) => {
      throw Error("Probe did not enter provider: " + r.statusCode);
    }),
  ]);
  const disabled = await request("/credentials/deactivate", "POST", {
    environment: "test",
    expected_revision: 1,
  });
  expect(disabled.statusCode, disabled.body).toBe(200);
  release!();
  expect((await running).statusCode).toBe(409);
  expect((await request()).json().configuration).toMatchObject({
    revision: 2,
    active_version: null,
    api_status: "not_tested",
    api_checked_at: null,
  });
});
const credentialPayload = (revision: number) => ({
  environment: "test",
  expected_revision: revision,
  username: "synthetic-api-user",
  password: "synthetic-api-password",
  pin: "1234",
  pkcs12_base64: file,
});
async function startHeldProbe(revision: number) {
  hold = new Promise<void>((r) => (release = r));
  const started = new Promise<void>((r) => (entered = r));
  const running = request("/connection-test", "POST", {
    environment: "test",
    expected_revision: revision,
  }).then((r) => r);
  await Promise.race([
    started,
    running.then((r) => {
      throw Error("Probe failed before provider: " + r.statusCode);
    }),
  ]);
  return { running };
}
it("drops a probe result after credentials are replaced", async () => {
  const saved = await request("/credentials", "POST", credentialPayload(2));
  expect(saved.statusCode, saved.body).toBe(200);
  const { running } = await startHeldProbe(3);
  try {
    const replaced = await request(
      "/credentials",
      "POST",
      credentialPayload(3),
    );
    expect(replaced.statusCode, replaced.body).toBe(200);
  } finally {
    release!();
  }
  expect((await running).statusCode).toBe(409);
  expect((await request()).json().configuration).toMatchObject({
    revision: 4,
    api_status: "not_tested",
    api_checked_at: null,
  });
});
it("does not persist a result after the caller session is revoked", async () => {
  const session = (
    await f.pool.query(
      "select auth_session_id from private.sessions where user_id=$1 and revoked_at is null order by last_seen desc limit 1",
      [f.userId],
    )
  ).rows[0].auth_session_id;
  const { running } = await startHeldProbe(4);
  try {
    await f.pool.query(
      "update private.sessions set revoked_at=now() where auth_session_id=$1 and user_id=$2",
      [session, f.userId],
    );
    release!();
    expect((await running).statusCode).toBe(403);
  } finally {
    release!();
    await f.pool.query(
      "update private.sessions set revoked_at=null where auth_session_id=$1 and user_id=$2",
      [session, f.userId],
    );
  }
  expect((await request()).json().configuration).toMatchObject({
    revision: 4,
    api_status: "not_tested",
    api_checked_at: null,
  });
});
it("limits probes per company and user without reaching the provider again", async () => {
  const before = calls;
  for (let i = 0; i < 5; i++) {
    const r = await request("/connection-test", "POST", {
      environment: "test",
      expected_revision: 4,
    });
    expect(r.statusCode, r.body).toBe(200);
  }
  expect(
    (
      await request("/connection-test", "POST", {
        environment: "test",
        expected_revision: 4,
      })
    ).statusCode,
  ).toBe(429);
  expect(calls - before).toBe(5);
});
