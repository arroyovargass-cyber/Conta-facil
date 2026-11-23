import { beforeAll, afterAll, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../apps/api/src/app";
import { loadConfig } from "../apps/api/src/config";
let app: Awaited<ReturnType<typeof createApp>>;
const root = mkdtempSync(join(tmpdir(), "conta-hosting-"));
beforeAll(async () => {
  mkdirSync(join(root, "assets"));
  writeFileSync(
    join(root, "index.html"),
    '<!doctype html><html lang="es"><body>Conta Fácil</body></html>',
  );
  writeFileSync(join(root, "assets", "app.js"), 'console.log("Conta Fácil")');
  writeFileSync(join(root, "secret.env"), "PRIVATE_TEST_SECRET");
  app = await createApp({ ...loadConfig(), STATIC_DIRECTORY: root });
});
afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});
it("serves the app and callback routes without requiring login", async () => {
  for (const route of ["/", "/invite?invitation=test", "/reset"]) {
    const r = await app.inject(route);
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/html");
    expect(r.body).toContain("Conta Fácil");
  }
});
it("serves built assets", async () => {
  const r = await app.inject("/assets/app.js");
  expect(r.statusCode).toBe(200);
  expect(r.headers["content-type"]).toContain("javascript");
});
it("does not turn missing API routes into the app", async () => {
  const r = await app.inject("/api/not-found");
  expect(r.statusCode).toBe(404);
  expect(r.headers["content-type"]).toContain("application/json");
});
it("never exposes private files or arbitrary paths", async () => {
  for (const route of [
    "/.env",
    "/package.json",
    "/secret.env",
    "/assets/../../.env",
    "/unknown",
    "/assets/missing.js",
  ]) {
    const r = await app.inject(route);
    expect(r.statusCode, route).toBe(404);
    expect(r.body).not.toContain("PRIVATE_TEST_SECRET");
  }
});
it("sets a CSP for hosted HTML", async () => {
  expect((await app.inject("/")).headers["content-security-policy"]).toContain(
    "default-src 'self'",
  );
});
