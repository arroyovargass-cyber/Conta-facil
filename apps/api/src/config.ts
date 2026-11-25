import { parseKeyring } from "./security/credential-vault";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
export function parseConfig(environment: NodeJS.ProcessEnv) {
  if (environment.NODE_ENV === "production") {
    const required = [
      "DATABASE_URL",
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_KEY",
      "SESSION_KEY",
    ];
    const missing = required.filter((key) => !environment[key]?.trim());
    if (!(environment.APP_ORIGIN ?? environment.RENDER_EXTERNAL_URL)?.trim())
      missing.push("APP_ORIGIN (o RENDER_EXTERNAL_URL)");
    if (missing.length)
      throw new Error(
        "Faltan variables de configuración: " +
          missing.join(", ") +
          ". Configúralas en Environment Variables y guarda el despliegue.",
      );
  }
  const config = z
    .object({
      DATABASE_URL: z
        .string()
        .url()
        .default("postgresql://postgres:postgres@127.0.0.1:54322/postgres"),
      HACIENDA_KEYRING: z.string().optional(),
      HACIENDA_ACTIVE_KEY_ID: z.string().optional(),
      HACIENDA_STAG_PROBE_ENABLED: z.enum(["true", "false"]).default("false"),
      HACIENDA_PRODUCTION_PROBE_ENABLED: z
        .enum(["true", "false"])
        .default("false"),
      HACIENDA_STAG_EMISSION_ENABLED: z
        .enum(["true", "false"])
        .default("false"),
      HACIENDA_PRODUCTION_EMISSION_ENABLED: z
        .enum(["true", "false"])
        .default("false"),
      HACIENDA_RESPONSE_TRUST_POLICY: z
        .enum(["pinned_certificate", "official_api"])
        .default("pinned_certificate"),
      HACIENDA_SOFTWARE_PROVIDER_ID: z
        .string()
        .regex(/^[1-9][0-9]{8,11}$/)
        .optional(),
      HACIENDA_RESPONSE_CERTIFICATE_PINS: z.string().optional(),
      HACIENDA_PRODUCTION_RESPONSE_CERTIFICATE_PINS: z.string().optional(),
      SMTP_HOST: z.string().max(253).optional(),
      SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
      SMTP_SECURE: z.enum(["true", "false"]).default("true"),
      SMTP_USER: z.string().max(254).optional(),
      SMTP_PASSWORD: z.string().max(4096).optional(),
      SMTP_FROM: z.email().max(254).optional(),
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
  parseKeyring(
    config.HACIENDA_KEYRING,
    config.HACIENDA_ACTIVE_KEY_ID,
    config.SESSION_KEY,
  );
  return config;
}
export function loadConfig() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  return parseConfig(process.env);
}
export type AppConfig = ReturnType<typeof parseConfig>;
