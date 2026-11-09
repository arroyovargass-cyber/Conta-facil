import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
export function parseConfig(environment: NodeJS.ProcessEnv) {
  const config = z
    .object({
      DATABASE_URL: z
        .string()
        .url()
        .default("postgresql://postgres:postgres@127.0.0.1:54322/postgres"),
      DATABASE_CA_CERT: z.string().optional(),
      SUPABASE_URL: z.url().default("http://127.0.0.1:54321"),
      SUPABASE_ANON_KEY: z.string().min(10),
      SUPABASE_SERVICE_KEY: z.string().min(10),
      SESSION_KEY: z.string().transform((value, ctx) => {
        if (/^[a-f0-9]{64}$/i.test(value)) return value.toLowerCase();
        const bytes = Buffer.from(value, "base64");
        if (bytes.length === 32 && bytes.toString("base64") === value)
          return bytes.toString("hex");
        ctx.addIssue({
          code: "custom",
          message: "SESSION_KEY must contain 32 random bytes as hex or base64",
        });
        return z.NEVER;
      }),
      APP_ORIGIN: z.url().default("http://localhost:5173"),
      STATIC_DIRECTORY: z.string().optional(),
      TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
      PORT: z.coerce.number().int().min(0).max(65535).default(3001),
      NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
    })
    .parse({
      ...environment,
      APP_ORIGIN: environment.APP_ORIGIN ?? environment.RENDER_EXTERNAL_URL,
      STATIC_DIRECTORY:
        environment.STATIC_DIRECTORY ??
        (environment.NODE_ENV === "production" ? resolve("dist") : undefined),
    });
  if (config.NODE_ENV === "production") {
    if (!environment.DATABASE_URL)
      throw new Error("DATABASE_URL is required for deployment");
    const database = new URL(config.DATABASE_URL);
    if (
      !["postgres:", "postgresql:"].includes(database.protocol) ||
      ["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)
    )
      throw new Error("Use a remote PostgreSQL database for deployment");
    for (const key of ["APP_ORIGIN", "SUPABASE_URL"] as const) {
      const url = new URL(config[key]);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.hash ||
        url.search ||
        url.pathname !== "/"
      )
        throw new Error(key + " must be an HTTPS origin");
    }
  }
  if (config.STATIC_DIRECTORY)
    config.STATIC_DIRECTORY = resolve(config.STATIC_DIRECTORY);
  return config;
}
export function loadConfig() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  return parseConfig(process.env);
}
export type AppConfig = ReturnType<typeof parseConfig>;
