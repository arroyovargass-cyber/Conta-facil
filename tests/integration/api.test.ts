import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createApp } from "../../apps/api/src/app";
import { loadConfig } from "../../apps/api/src/config";
let app: Awaited<ReturnType<typeof createApp>>;
beforeAll(async () => {
  app = await createApp(loadConfig());
});
afterAll(async () => {
  await app?.close();
});
describe("API security", () => {
  it("reports readiness without secrets", async () => {
    const r = await app.inject("/api/health");
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.json()).toEqual({ name: "Conta Ágil", phase: 1, status: "ok" });
  });
  it("requires authentication", async () => {
    expect((await app.inject("/api/companies")).statusCode).toBe(401);
  });
  it("rejects foreign origins", async () => {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/login",
          headers: { origin: "https://evil.test" },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
  });
  it("rejects malformed login", async () => {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/login",
          headers: { origin: "http://localhost:5173" },
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
  });
  it("does not enumerate unknown users", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://localhost:5173" },
      payload: {
        country: "CR",
        type: "national",
        identification: "9" + Math.floor(10000000 + Math.random() * 80000000),
        password: "NotARealPassword!23",
      },
    });
    expect(r.statusCode).toBe(401);
    expect(r.json().message).toBe("Identificación o contraseña incorrecta.");
  });
});
