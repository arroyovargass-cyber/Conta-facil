import type { PoolConfig } from "pg";
import type { AppConfig } from "./config";
export function databaseOptions(config: AppConfig): PoolConfig {
  const url = new URL(config.DATABASE_URL);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  // pg connection-string SSL parameters can overwrite an explicit ssl object.
  for (const key of ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert"])
    url.searchParams.delete(key);
  return {
    connectionString: url.toString(),
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    ssl:
      local && config.NODE_ENV !== "production"
        ? false
        : {
            rejectUnauthorized: true,
            ...(config.DATABASE_CA_CERT
              ? { ca: config.DATABASE_CA_CERT.replaceAll("\\n", "\n") }
              : {}),
          },
  };
}
