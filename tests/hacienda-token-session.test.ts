import { it, expect } from "vitest";
import {
  HaciendaTokenSession,
  TokenSessionError,
} from "../apps/api/src/services/hacienda-token-session";
const access = { username: "private-user", password: "private-pass" };
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
const tokens = { access_token: "ACCESS", refresh_token: "REFRESH" };
it("opens a bounded isolated session then closes it at the fixed endpoints", async () => {
  const seen: string[] = [];
  const session = new HaciendaTokenSession({
    environment: "test",
    transport: async (url, init) => {
      seen.push(String(url));
      expect(init?.redirect).toBe("error");
      const body = init?.body as URLSearchParams;
      expect(body.get("client_id")).toBe("api-stag");
      if (String(url).endsWith("/token")) {
        expect(body.get("username")).toBe(access.username);
        expect(body.get("password")).toBe(access.password);
        return reply(tokens);
      }
      expect(body.get("refresh_token")).toBe("REFRESH");
      return new Response(null, { status: 204 });
    },
  });
  expect(
    await session.withAccess(access, async (token) => {
      expect(token).toBe("ACCESS");
      return 42;
    }),
  ).toBe(42);
  expect(seen).toEqual([
    "https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token",
    "https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/logout",
  ]);
});
it("does not call user code for invalid credentials or malformed tokens and returns safe typed errors", async () => {
  for (const [response, code] of [
    [
      reply({ error: "invalid_grant", error_description: "private-pass" }, 401),
      "AUTHENTICATION_FAILED",
    ],
    [reply({ error: "invalid_grant" }, 400), "AUTHENTICATION_FAILED"],
    [reply({ error: "other" }, 401), "SERVICE_UNAVAILABLE"],
    [new Response("bad"), "SERVICE_UNAVAILABLE"],
    [new Response("x".repeat(65537)), "SERVICE_UNAVAILABLE"],
    [reply({ ...tokens, access_token: "a b" }), "SERVICE_UNAVAILABLE"],
    [
      reply({ ...tokens, refresh_token: "a".repeat(16385) }),
      "SERVICE_UNAVAILABLE",
    ],
  ] as const) {
    let used = false;
    const session = new HaciendaTokenSession({
      environment: "test",
      transport: async () => response,
    });
    const error = await session
      .withAccess(access, async () => {
        used = true;
      })
      .catch((e) => e);
    expect(error).toBeInstanceOf(TokenSessionError);
    expect(error.code).toBe(code);
    expect(error.message).not.toContain("private");
    expect(used).toBe(false);
  }
});
it("always logs out and preserves the callback failure if logout fails", async () => {
  let logout = 0;
  const failure = new Error("caller-failure");
  const session = new HaciendaTokenSession({
    environment: "test",
    transport: async (url) => {
      if (String(url).endsWith("/token")) return reply(tokens);
      logout++;
      throw Error("logout-error");
    },
  });
  await expect(
    session.withAccess(access, async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(logout).toBe(1);
});
it("returns successful use despite logout failure, without caching tokens between sessions", async () => {
  let login = 0,
    logout = 0;
  const session = new HaciendaTokenSession({
    environment: "test",
    transport: async (url) => {
      if (String(url).endsWith("/token")) {
        login++;
        return reply(tokens);
      }
      logout++;
      return reply({}, 503);
    },
  });
  for (let i = 0; i < 2; i++)
    expect(await session.withAccess(access, async () => 7)).toBe(7);
  expect(login).toBe(2);
  expect(logout).toBe(2);
});
it("bounds login timeout and rejects production overrides", async () => {
  const session = new HaciendaTokenSession({
    environment: "test",
    timeoutMs: 1,
    transport: async () => new Promise(() => {}),
  });
  await expect(session.withAccess(access, async () => 0)).rejects.toMatchObject(
    { code: "SERVICE_UNAVAILABLE" },
  );
  expect(
    () =>
      new HaciendaTokenSession({ environment: "production", transport: fetch }),
  ).toThrow();
  expect(
    () => new HaciendaTokenSession({ environment: "production", timeoutMs: 1 }),
  ).toThrow();
});
