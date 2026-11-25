import { expect, it } from "vitest";
import type pg from "pg";
import { randomBytes } from "node:crypto";
import { parseConfig } from "../apps/api/src/config";
import { CredentialStore } from "../apps/api/src/services/credential-store";

function store(flags: Record<string, string>) {
  return new CredentialStore(
    {} as pg.Pool,
    parseConfig({
      NODE_ENV: "test",
      SUPABASE_ANON_KEY: "synthetic-anon-key",
      SUPABASE_SERVICE_KEY: "synthetic-service-key",
      SESSION_KEY: randomBytes(32).toString("hex"),
      HACIENDA_KEYRING: JSON.stringify({ v1: randomBytes(32).toString("hex") }),
      HACIENDA_ACTIVE_KEY_ID: "v1",
      ...flags,
    }),
  );
}

it("does not enable a production connection probe through the test flag", async () => {
  const credentials = store({ HACIENDA_STAG_PROBE_ENABLED: "true" });
  expect((await credentials.capability()).can_test_connection).toBe(true);
  expect((await credentials.capability("production")).can_test_connection).toBe(
    false,
  );
});

it("enables only the production probe through its separate flag", async () => {
  const credentials = store({ HACIENDA_PRODUCTION_PROBE_ENABLED: "true" });
  expect((await credentials.capability("production")).can_test_connection).toBe(
    true,
  );
  expect((await credentials.capability("test")).can_test_connection).toBe(
    false,
  );
});

it("blocks a disabled production probe before releasing credentials to a provider", async () => {
  const credentials = store({ HACIENDA_STAG_PROBE_ENABLED: "true" });
  await expect(
    credentials.testConnection(
      { sub: "synthetic-user", aal: "aal2", session_id: "synthetic-session" },
      "synthetic-tenant",
      1,
      {
        async probe() {
          throw new Error("Provider must never receive credentials");
        },
      },
      "production",
    ),
  ).rejects.toMatchObject({ statusCode: 503 });
});
