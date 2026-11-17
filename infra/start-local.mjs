import { spawn } from "node:child_process";
import { openSync, writeFileSync } from "node:fs";
process.loadEnvFile(".env");
const services = [
  [
    "mailpit",
    { MP_SMTP_BIND_ADDR: "127.0.0.1:1025", MP_UI_BIND_ADDR: "127.0.0.1:54324" },
  ],
  [
    "auth",
    {
      GOTRUE_API_HOST: "127.0.0.1",
      GOTRUE_API_PORT: "9999",
      API_EXTERNAL_URL: "http://localhost:54321/auth/v1",
      GOTRUE_DB_DRIVER: "postgres",
      GOTRUE_DB_NAMESPACE: "auth",
      GOTRUE_DB_DATABASE_URL:
        "postgres://supabase_auth_admin:local-only-auth@127.0.0.1:54322/postgres",
      GOTRUE_SITE_URL: "http://localhost:5173",
      GOTRUE_URI_ALLOW_LIST: "http://localhost:5173/**",
      GOTRUE_JWT_SECRET: process.env.LOCAL_JWT_SECRET,
      GOTRUE_JWT_EXP: "3600",
      GOTRUE_JWT_AUD: "authenticated",
      GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated",
      GOTRUE_JWT_ADMIN_ROLES: "service_role",
      GOTRUE_DISABLE_SIGNUP: "true",
      GOTRUE_EXTERNAL_EMAIL_ENABLED: "true",
      GOTRUE_MAILER_AUTOCONFIRM: "false",
      GOTRUE_SMTP_HOST: "127.0.0.1",
      GOTRUE_SMTP_PORT: "1025",
      GOTRUE_SMTP_ADMIN_EMAIL: "acceso@contafacil.test",
      GOTRUE_SMTP_SENDER_NAME: "Conta Fácil",
      GOTRUE_MFA_ENABLED: "true",
      GOTRUE_MFA_TOTP_ENROLL_ENABLED: "true",
      GOTRUE_MFA_TOTP_VERIFY_ENABLED: "true",
      GOTRUE_MAILER_URLPATHS_RECOVERY: "/auth/v1/verify",
      GOTRUE_MAILER_URLPATHS_INVITE: "/auth/v1/verify",
      GOTRUE_MAILER_URLPATHS_CONFIRMATION: "/auth/v1/verify",
    },
  ],
  [
    "postgrest",
    {
      PGRST_DB_URI:
        "postgres://authenticator:local-only-authenticator@127.0.0.1:54322/postgres",
      PGRST_DB_SCHEMAS: "public",
      PGRST_DB_ANON_ROLE: "anon",
      PGRST_JWT_SECRET: process.env.LOCAL_JWT_SECRET,
      PGRST_SERVER_HOST: "127.0.0.1",
      PGRST_SERVER_PORT: "54323",
    },
  ],
];
const ids = {};
for (const [name, env] of services) {
  if (process.argv[2] && process.argv[2] !== name) continue;
  const log = openSync(".local/" + name + ".log", "a");
  const p = spawn(".local/" + name, [], {
    env: { ...process.env, ...env },
    stdio: ["ignore", log, log],
    detached: true,
  });
  p.unref();
  ids[name] = p.pid;
}
if (!process.argv[2]) {
  const log = openSync(".local/gateway.log", "a");
  const p = spawn(process.execPath, ["infra/local-gateway.mjs"], {
    stdio: ["ignore", log, log],
    detached: true,
  });
  p.unref();
  ids.gateway = p.pid;
}
writeFileSync(".local/pids.json", JSON.stringify(ids));
console.log(
  "Local Auth, REST, Mail and gateway launched; PID file in .local/pids.json",
);
