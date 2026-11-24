import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "../../apps/api/src/config";
export async function workspace(
  options: { role?: string; companies?: number; systemAdmin?: boolean } = {},
) {
  const config = loadConfig();
  if (
    !["127.0.0.1", "localhost"].includes(new URL(config.DATABASE_URL).hostname)
  )
    throw new Error("Synthetic fixtures are local-only");
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL }),
    tag = randomBytes(8).toString("hex"),
    identification = "test-" + tag,
    email = identification + "@example.test",
    password = randomBytes(24).toString("hex") + "aA!";
  const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const u = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (u.error) {
    await pool.end();
    throw u.error;
  }
  const userId = u.data.user.id;
  await pool.query("insert into public.profiles(id,name) values($1,$2)", [
    userId,
    "Usuario de prueba",
  ]);
  await pool.query(
    "insert into private.login_directory values($1,'CR','other',$2,$3)",
    [userId, identification, email],
  );
  if (options.systemAdmin)
    await pool.query("insert into private.platform_operators values($1)", [
      userId,
    ]);
  const tenants: string[] = [];
  for (let i = 0; i < (options.companies ?? 1); i++) {
    const id = (
      await pool.query(
        "insert into public.tenants(legal_name,trade_name,identification_type,identification) values($1,$2,'other',$3) returning id",
        [
          "Empresa de prueba " + (i === 0 ? "Norte" : "Sur") + " " + tag,
          "Empresa " + (i === 0 ? "Norte" : "Sur"),
          tag + "-" + i,
        ],
      )
    ).rows[0].id;
    tenants.push(id);
    await pool.query(
      "insert into public.memberships(tenant_id,user_id,scope) values($1,$2,'company')",
      [id, userId],
    );
    await pool.query(
      "insert into public.membership_roles select tenant_id,$2,id from public.roles where tenant_id=$1 and code=$3",
      [id, userId, options.role ?? "operative"],
    );
  }
  async function login(app: FastifyInstance) {
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      remoteAddress: "127.31.1." + ((parseInt(tag.slice(0, 2), 16) % 250) + 1),
      headers: { origin: config.APP_ORIGIN },
      payload: { country: "CR", type: "other", identification, password },
    });
    if (r.statusCode !== 200) throw new Error(r.body);
    return { cookie: "cf_session=" + r.cookies[0].value, csrf: r.json().csrf };
  }
  return {
    config,
    pool,
    admin,
    userId,
    email,
    password,
    identification,
    tenants,
    tag,
    login,
  };
}
