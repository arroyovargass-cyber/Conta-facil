import { afterEach, it, expect, vi } from "vitest";
import { Readable } from "node:stream";
const state = vi.hoisted(() => ({ options: undefined as any }));
vi.mock("pg", () => ({
  default: {
    Pool: class {
      constructor(options: any) {
        state.options = options;
        throw Error("STOP_BEFORE_NETWORK");
      }
    },
  },
}));
vi.mock("../apps/api/src/config", () => ({
  loadConfig: () => ({
    NODE_ENV: "production",
    DATABASE_URL:
      "postgresql://conta_facil_api:synthetic-password@db.example.test:5432/postgres?sslmode=require",
    DATABASE_CA_CERT: "SYNTHETIC-CA",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_KEY: "synthetic-service-key",
    APP_ORIGIN: "https://example.onrender.com",
  }),
}));
afterEach(() => {
  vi.restoreAllMocks();
});
it("verifies database TLS during hosted administrator bootstrap before any network or invitation", async () => {
  vi.spyOn(process, "stdin", "get").mockReturnValue(
    Readable.from([
      JSON.stringify({
        email: "admin@example.test",
        name: "Admin",
        legal_name: "Empresa sintética",
        identification_type: "other",
        identification: "TEST-001",
      }),
    ]) as typeof process.stdin,
  );
  await expect(import("../apps/api/scripts/bootstrap")).rejects.toThrow(
    "STOP_BEFORE_NETWORK",
  );
  expect(state.options.ssl).toEqual({
    rejectUnauthorized: true,
    ca: "SYNTHETIC-CA",
  });
  expect(
    new URL(state.options.connectionString).searchParams.has("sslmode"),
  ).toBe(false);
});
