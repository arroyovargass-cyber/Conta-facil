import pg from "pg";
import { readFileSync } from "node:fs";
process.loadEnvFile(".env");
const u = new URL(process.env.DATABASE_URL);
if (!["127.0.0.1", "localhost"].includes(u.hostname))
  throw new Error("Database tests are local-only.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query("create schema if not exists extensions");
  const results = await pool.query(
    readFileSync("supabase/tests/tenant_isolation.sql", "utf8"),
  );
  let failed = false;
  for (const r of results)
    for (const row of r.rows) {
      const value = Object.values(row)[0];
      if (typeof value === "string" && /^(ok|not ok|1\.\.|#)/.test(value)) {
        console.log(value);
        if (value.startsWith("not ok") || value.startsWith("# Looks like"))
          failed = true;
      }
    }
  if (failed) process.exitCode = 1;
} finally {
  await pool.end();
}
