import { spawn } from "node:child_process";
import pg from "pg";
import { loadConfig } from "../apps/api/src/config";
import { runtimeConfig } from "../tests/support/runtime-config";

// Fixtures keep their local administrative connection; only the web API uses
// the restricted login role. Neither URL nor credentials are written to logs.
const config = loadConfig();
if (
  ![config.DATABASE_URL, config.SUPABASE_URL].every((value) =>
    ["localhost", "127.0.0.1"].includes(new URL(value).hostname),
  )
)
  throw new Error(
    "Estas pruebas solo admiten base de datos y autenticación locales.",
  );
const admin = new pg.Pool({ connectionString: config.DATABASE_URL });
let code = 1,
  restoreUsage = false;
try {
  restoreUsage = (
    await admin.query(
      "select has_schema_privilege('conta_facil_api','auth','USAGE') allowed",
    )
  ).rows[0].allowed;
  const runtime = await runtimeConfig(config);
  await admin.query("revoke usage on schema auth from conta_facil_api");
  const proof = new pg.Client({ connectionString: runtime.DATABASE_URL });
  try {
    await proof.connect();
    const role = (
      await proof.query(`select current_user as name,rolsuper,rolinherit,rolbypassrls,
      has_schema_privilege(current_user,'auth','USAGE') auth_usage from pg_roles where rolname=current_user`)
    ).rows[0];
    if (
      !role ||
      role.name !== "conta_facil_api" ||
      role.rolsuper ||
      role.rolinherit ||
      role.rolbypassrls ||
      role.auth_usage
    )
      throw new Error(
        "El rol local no reproduce las restricciones de Supabase alojado.",
      );
  } finally {
    await proof.end();
  }
  console.log(
    "API de navegador: conta_facil_api, sin USAGE en auth, sin omitir RLS.",
  );
  const child = spawn(
    process.execPath,
    [
      "node_modules/@playwright/test/cli.js",
      "test",
      "--config=playwright.company.config.ts",
      ...process.argv.slice(2),
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        COMPANY_BROWSER_DATABASE_URL: runtime.DATABASE_URL,
      },
    },
  );
  code = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (value) => resolve(value ?? 1));
  });
} finally {
  if (restoreUsage)
    await admin.query("grant usage on schema auth to conta_facil_api");
  await admin.end();
}
process.exitCode = code;
