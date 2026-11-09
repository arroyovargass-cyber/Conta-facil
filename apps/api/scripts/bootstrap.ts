import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { z } from "zod";
import { loadConfig } from "../src/config";
import { hash, randomToken } from "../src/security/crypto";
// Reads JSON from stdin. No password or service credential accepted as a command-line argument.
const config = loadConfig();
let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = z
  .object({
    email: z.email(),
    name: z.string().min(1),
    legal_name: z.string().min(1),
    trade_name: z.string().default(""),
    identification_type: z.string().min(1),
    identification: z.string().min(1),
    platform_operator: z.boolean().default(false),
  })
  .strict()
  .parse(JSON.parse(raw));
const pool = new pg.Pool({ connectionString: config.DATABASE_URL }),
  admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  }),
  token = randomToken();
let tenantId: string | undefined;
try {
  const db = await pool.connect();
  try {
    await db.query("begin");
    tenantId = (
      await db.query(
        "insert into public.tenants(legal_name,trade_name,identification_type,identification,contact_email) values($1,$2,$3,$4,$5) returning id",
        [
          input.legal_name,
          input.trade_name,
          input.identification_type,
          input.identification,
          input.email.toLowerCase(),
        ],
      )
    ).rows[0].id;
    const role = (
      await db.query(
        "select id from public.roles where tenant_id=$1 and code='admin'",
        [tenantId],
      )
    ).rows[0];
    await db.query(
      "insert into private.invitations(tenant_id,email,role_id,scope,token_hash,expires_at) values($1,$2,$3,'company',$4,now()+interval '48 hours')",
      [tenantId, input.email.toLowerCase(), role.id, hash(token)],
    );
    await db.query(
      "insert into public.audit_events(tenant_id,action,entity) values($1,'BOOTSTRAP','tenants')",
      [tenantId],
    );
    await db.query("commit");
  } catch (e) {
    await db.query("rollback");
    throw e;
  } finally {
    db.release();
  }
  const invited = await admin.auth.admin.inviteUserByEmail(input.email, {
    redirectTo: config.APP_ORIGIN + "/invite?invitation=" + token,
  });
  if (invited.error)
    throw new Error(
      "La empresa fue creada pero el envío falló. Revisa SMTP y las invitaciones pendientes antes de reintentar. Empresa: " +
        tenantId,
    );
  if (input.platform_operator) {
    await pool.query(
      "insert into public.profiles(id,name) values($1,$2) on conflict do nothing",
      [invited.data.user.id, input.name],
    );
    await pool.query("insert into private.platform_operators values($1)", [
      invited.data.user.id,
    ]);
  }
  console.log(
    "Empresa creada: " +
      tenantId +
      ". Invitación enviada; completa verificación del correo, identificación, contraseña y MFA.",
  );
} finally {
  await pool.end();
}
