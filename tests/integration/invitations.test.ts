import { runtimeConfig } from "../support/runtime-config";
import { it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { createApp } from "../../apps/api/src/app";
import { loadConfig } from "../../apps/api/src/config";
import { hash } from "../../apps/api/src/security/crypto";
it("accepts only matching verified email and prevents replay or expired invitations", async () => {
  const c = loadConfig(),
    pool = new pg.Pool({ connectionString: c.DATABASE_URL }),
    app = await createApp(await runtimeConfig(c)),
    admin = createClient(c.SUPABASE_URL, c.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    }),
    password = randomBytes(20).toString("hex") + "aA!";
  let userId = "";
  try {
    const email = "invite-" + randomUUID() + "@example.test",
      u = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
    expect(u.error).toBeNull();
    userId = u.data.user!.id;
    const client = createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY, {
        auth: { persistSession: false },
      }),
      session = await client.auth.signInWithPassword({ email, password });
    const tenant = (
        await pool.query(
          "insert into public.tenants(legal_name,identification_type,identification) values('Invitation test','other',$1) returning id",
          [randomUUID()],
        )
      ).rows[0].id,
      role = (
        await pool.query(
          "select id from public.roles where tenant_id=$1 and code='operative'",
          [tenant],
        )
      ).rows[0].id,
      token = randomBytes(32).toString("hex");
    await pool.query(
      "insert into private.invitations(tenant_id,email,role_id,scope,token_hash,expires_at) values($1,$2,$3,'company',$4,now()+interval '1 hour')",
      [tenant, "other-" + email, role, hash(token)],
    );
    const payload = {
      token,
      access_token: session.data.session!.access_token,
      country: "CR",
      type: "other",
      identification: "ID-" + randomUUID(),
      name: "Invitado",
      password,
    };
    const call = () =>
      app.inject({
        method: "POST",
        url: "/api/auth/invitations/accept",
        remoteAddress:
          "127.23.1." + ((parseInt(email.slice(7, 9), 16) % 250) + 1),
        headers: { origin: c.APP_ORIGIN },
        payload,
      });
    expect((await call()).statusCode).toBe(400);
    expect(
      (
        await pool.query("select * from public.memberships where user_id=$1", [
          userId,
        ])
      ).rowCount,
    ).toBe(0);
    await pool.query(
      "update private.invitations set email=$2 where token_hash=$1",
      [hash(token), email],
    );
    expect((await call()).statusCode).toBe(200);
    payload.access_token = (
      await client.auth.signInWithPassword({ email, password })
    ).data.session!.access_token;
    expect((await call()).statusCode).toBe(400);
    await pool.query(
      "update private.invitations set accepted_at=null,expires_at=now()+interval '1 hour' where token_hash=$1",
      [hash(token)],
    );
    const conflict = await call();
    expect(conflict.statusCode, conflict.body).toBe(409);
    expect(
      (
        await pool.query(
          "select scope from public.memberships where user_id=$1 and tenant_id=$2",
          [userId, tenant],
        )
      ).rows[0].scope,
    ).toBe("company");
    await pool.query(
      "update private.invitations set accepted_at=null,expires_at=now()-interval '1 minute' where token_hash=$1",
      [hash(token)],
    );
    expect((await call()).statusCode).toBe(400);
  } finally {
    await app.close();
    await pool.end();
  }
});
