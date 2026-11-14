import { mkdirSync } from "node:fs";
import pg from "pg";
import { createHash } from "node:crypto";
import { loadConfig } from "../../apps/api/src/config";
export default async function setup() {
  mkdirSync(".local/preview", { recursive: true });
  const config = loadConfig();
  if (
    !["127.0.0.1", "localhost"].includes(new URL(config.DATABASE_URL).hostname)
  )
    throw new Error("Browser tests must use a local database");
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
  try {
    await pool.query("delete from private.rate_limits where key=$1", [
      createHash("sha256").update("ip:127.0.0.1").digest("hex"),
    ]);
  } finally {
    await pool.end();
  }
}
