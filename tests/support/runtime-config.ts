import pg from "pg";
import { randomBytes } from "node:crypto";
import type { AppConfig } from "../../apps/api/src/config";
export async function runtimeConfig(config: AppConfig): Promise<AppConfig> {
  const url = new URL(config.DATABASE_URL);
  if (!["localhost", "127.0.0.1"].includes(url.hostname))
    throw new Error("Runtime-role tests are local-only");
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL }),
    password = randomBytes(32).toString("hex");
  try {
    await pool.query(`alter role conta_facil_api login password '${password}'`);
  } finally {
    await pool.end();
  }
  url.username = "conta_facil_api";
  url.password = password;
  return { ...config, DATABASE_URL: url.toString() };
}
