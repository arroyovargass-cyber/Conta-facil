import { it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { createApp } from "../../apps/api/src/app";
import { loadConfig } from "../../apps/api/src/config";
it("completes recovery with provider-issued recovery session and revokes it", async () => {
  const config = loadConfig(),
    app = await createApp(config);
  try {
    const admin = createClient(
        config.SUPABASE_URL,
        config.SUPABASE_SERVICE_KEY,
        { auth: { persistSession: false } },
      ),
      email = "recovery-" + randomBytes(6).toString("hex") + "@example.test";
    const user = await admin.auth.admin.createUser({
      email,
      password: randomBytes(16).toString("hex"),
      email_confirm: true,
    });
    expect(user.error).toBeNull();
    const link = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
    });
    expect(link.error).toBeNull();
    const client = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    const verified = await client.auth.verifyOtp({
      token_hash: link.data.properties!.hashed_token,
      type: "recovery",
    });
    expect(verified.error).toBeNull();
    const password = randomBytes(20).toString("hex") + "aA!";
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/reset",
      headers: { origin: config.APP_ORIGIN },
      payload: {
        access_token: verified.data.session!.access_token,
        refresh_token: verified.data.session!.refresh_token,
        password,
      },
    });
    expect(r.statusCode, r.body).toBe(200);
    const login = await client.auth.signInWithPassword({ email, password });
    expect(login.error).toBeNull();
  } finally {
    await app.close();
  }
});
