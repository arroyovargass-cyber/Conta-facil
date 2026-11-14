import { beforeAll, afterAll, it, expect } from "vitest";
import { createApp } from "../../apps/api/src/app";
import { workspace } from "../support/workspace";
import { runtimeConfig } from "../support/runtime-config";
let fixture: Awaited<ReturnType<typeof workspace>>,
  app: Awaited<ReturnType<typeof createApp>>;
beforeAll(async () => {
  fixture = await workspace();
  app = await createApp(await runtimeConfig(fixture.config));
});
afterAll(async () => {
  await app?.close();
  await fixture?.pool.end();
});
it("keeps both tabs valid when reading the session repeatedly", async () => {
  const session = await fixture.login(app);
  const a = await app.inject({
      url: "/api/auth/session",
      headers: { cookie: session.cookie },
    }),
    b = await app.inject({
      url: "/api/auth/session",
      headers: { cookie: session.cookie },
    });
  expect(a.statusCode, a.body).toBe(200);
  expect(b.json().csrf).toBe(a.json().csrf);
  expect(a.json().csrf).toBe(session.csrf);
  const logout = await app.inject({
    method: "POST",
    url: "/api/auth/logout",
    headers: {
      origin: fixture.config.APP_ORIGIN,
      cookie: session.cookie,
      "x-csrf-token": session.csrf,
    },
    payload: {},
  });
  expect(logout.statusCode, logout.body).toBe(200);
});
it("clears the cookie and completes logout even after server revocation", async () => {
  const session = await fixture.login(app);
  await fixture.pool.query(
    "update private.sessions set revoked_at=now() where user_id=$1",
    [fixture.userId],
  );
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/logout",
    headers: {
      origin: fixture.config.APP_ORIGIN,
      cookie: session.cookie,
      "x-csrf-token": session.csrf,
    },
    payload: {},
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.cookies.find((c) => c.name === "cf_session")?.value).toBe("");
});
it("still rejects invalid CSRF on active sessions and external logout origins", async () => {
  const session = await fixture.login(app);
  const invalid = await app.inject({
    method: "POST",
    url: "/api/auth/logout",
    headers: {
      origin: fixture.config.APP_ORIGIN,
      cookie: session.cookie,
      "x-csrf-token": "invalid",
    },
    payload: {},
  });
  expect(invalid.statusCode).toBe(403);
  const external = await app.inject({
    method: "POST",
    url: "/api/auth/logout",
    headers: {
      origin: "https://evil.example",
      cookie: session.cookie,
      "x-csrf-token": session.csrf,
    },
    payload: {},
  });
  expect(external.statusCode).toBe(403);
  expect(
    (
      await app.inject({
        url: "/api/auth/session",
        headers: { cookie: session.cookie },
      })
    ).statusCode,
  ).toBe(200);
});
