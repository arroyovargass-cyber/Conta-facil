import { beforeAll, afterAll, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { HaciendaIdp } from "../apps/api/src/services/hacienda-idp";
let server: Server,
  base: string,
  mode = "ok",
  seen: URLSearchParams[] = [];
beforeAll(async () => {
  server = createServer(async (req, res) => {
    let body = "";
    for await (const b of req) body += b;
    seen.push(new URLSearchParams(body));
    if (req.url?.endsWith("/logout")) {
      res.writeHead(mode === "logout_failure" ? 500 : 204);
      res.end();
      return;
    }
    if (mode === "timeout") return;
    if (mode === "redirect") {
      res.writeHead(302, { location: base + "/steal" });
      res.end();
      return;
    }
    if (mode === "large") {
      res.end("a".repeat(65537));
      return;
    }
    if (mode === "not_json") {
      res.end("broken");
      return;
    }
    if (mode === "blocked") {
      res.writeHead(403);
      res.end("{}");
      return;
    }
    if (mode === "bad_credentials") {
      res.writeHead(400);
      res.end(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "SECRET-DESCRIPTION",
        }),
      );
      return;
    }
    res.end(
      JSON.stringify({
        access_token: "PRIVATE-ACCESS-TOKEN",
        refresh_token: "PRIVATE-REFRESH-TOKEN",
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + (server.address() as any).port;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});
const transport: typeof fetch = (url, init) => {
  expect(String(url)).toMatch(
    /^https:\/\/idp\.comprobanteselectronicos\.go\.cr\/auth\/realms\/rut-stag\/protocol\/openid-connect\/(token|logout)$/,
  );
  return fetch(base + new URL(String(url)).pathname, init);
};
const client = () =>
  new HaciendaIdp({ environment: "test", transport, timeoutMs: 100 });
it("sends form fields to fixed official endpoints and closes the test session without returning tokens", async () => {
  mode = "ok";
  seen = [];
  const result = await client().probe({
    username: " usuario+ñ ",
    password: " p&=contraseña! ",
  });
  expect(result).toEqual({ status: "success", sessionClosed: true });
  expect(seen[0].get("client_id")).toBe("api-stag");
  expect(seen[0].get("grant_type")).toBe("password");
  expect(seen[0].get("username")).toBe(" usuario+ñ ");
  expect(seen[0].get("password")).toBe(" p&=contraseña! ");
  expect(seen[1].get("refresh_token")).toBe("PRIVATE-REFRESH-TOKEN");
  expect(JSON.stringify(result)).not.toContain("PRIVATE-");
});
it("recognizes invalid_grant without exposing provider descriptions", async () => {
  mode = "bad_credentials";
  expect(await client().probe({ username: "u", password: "p" })).toEqual({
    status: "authentication_failed",
    sessionClosed: false,
  });
});
it("separates successful authentication from failed logout", async () => {
  mode = "logout_failure";
  expect(await client().probe({ username: "u", password: "p" })).toEqual({
    status: "success",
    sessionClosed: false,
  });
});
it("treats blocks, redirects, malformed or oversized replies and timeout as service failures", async () => {
  for (mode of ["blocked", "redirect", "not_json", "large", "timeout"])
    expect(await client().probe({ username: "u", password: "p" })).toEqual({
      status: "service_unavailable",
      sessionClosed: false,
    });
});
it("refuses injected transport and timeout overrides outside tests", () => {
  expect(
    () => new HaciendaIdp({ environment: "production", transport }),
  ).toThrow();
  expect(
    () => new HaciendaIdp({ environment: "production", timeoutMs: 1 }),
  ).toThrow();
});
it("uses the selected fiscal realm and client independently of the test runtime", async () => {
  const seen: { url: string; client: string | null }[] = [];
  const idp = new HaciendaIdp({
    environment: "test",
    transport: async (url, init) => {
      seen.push({
        url: String(url),
        client: (init!.body as URLSearchParams).get("client_id"),
      });
      return String(url).endsWith("/token")
        ? new Response(
            JSON.stringify({
              access_token: "ACCESS",
              refresh_token: "REFRESH",
            }),
          )
        : new Response(null, { status: 204 });
    },
  });
  expect(
    (await idp.probe({ username: "u", password: "p" }, "production")).status,
  ).toBe("success");
  expect((await idp.probe({ username: "u", password: "p" })).status).toBe(
    "success",
  );
  expect(seen).toEqual(
    ["token", "logout"]
      .map((path) => ({
        url:
          "https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/" +
          path,
        client: "api-prod",
      }))
      .concat(
        ["token", "logout"].map((path) => ({
          url:
            "https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/" +
            path,
          client: "api-stag",
        })),
      ),
  );
});
it("refuses real probing when TLS validation is disabled", async () => {
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return new Response("{}", { status: 503 });
    };
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    expect(
      await new HaciendaIdp({ environment: "test" }).probe(
        { username: "u", password: "p" },
        "production",
      ),
    ).toEqual({ status: "service_unavailable", sessionClosed: false });
    expect(calls).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
  }
});
it("refuses an injected probe transport after leaving the test runtime", async () => {
  const runtime = process.env.NODE_ENV;
  let calls = 0;
  const idp = new HaciendaIdp({
    environment: "test",
    transport: async () => {
      calls++;
      return new Response("{}", { status: 503 });
    },
  });
  try {
    process.env.NODE_ENV = "production";
    expect(
      await idp.probe({ username: "u", password: "p" }, "production"),
    ).toEqual({ status: "service_unavailable", sessionClosed: false });
    expect(calls).toBe(0);
  } finally {
    process.env.NODE_ENV = runtime;
  }
});
