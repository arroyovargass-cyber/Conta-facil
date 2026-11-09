import pg from "pg";
import { readdirSync, readFileSync } from "node:fs";
process.loadEnvFile(".env");
const url = new URL(process.env.DATABASE_URL);
if (!["127.0.0.1", "localhost"].includes(url.hostname))
  throw new Error(
    "This script is local-only. Use the reviewed Supabase migration workflow for hosted projects.",
  );
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await pool.query("select to_regclass('auth.users') name");
      if (r.rows[0].name) break;
    } catch {}
    if (i === 59) throw new Error("Local Auth schema not ready");
    await new Promise((r) => setTimeout(r, 1000));
  }
  await pool.query(
    "create schema if not exists private; create table if not exists private.schema_migrations(name text primary key, applied_at timestamptz default now())",
  );
  for (const name of readdirSync("supabase/migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (
      (
        await pool.query(
          "select 1 from private.schema_migrations where name=$1",
          [name],
        )
      ).rowCount
    )
      continue;
    const db = await pool.connect();
    try {
      await db.query("begin");
      await db.query(readFileSync("supabase/migrations/" + name, "utf8"));
      await db.query("insert into private.schema_migrations(name) values($1)", [
        name,
      ]);
      await db.query("commit");
      console.log("Applied " + name);
    } catch (e) {
      await db.query("rollback");
      throw e;
    } finally {
      db.release();
    }
  }
  await pool.query("NOTIFY pgrst,'reload schema'");
} finally {
  await pool.end();
}
