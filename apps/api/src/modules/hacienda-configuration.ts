import type { IdpClient } from "../services/hacienda-idp";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import type { AppConfig } from "../config";
import type { identity } from "./identity";
import { HttpError } from "../db";
import { CredentialStore } from "../services/credential-store";
const params = z.object({ tenantId: z.uuid() }).strict();
const revision = z
  .object({
    environment: z.literal("test"),
    expected_revision: z.number().int().min(0).max(2147483646),
  })
  .strict();
const secret = z.string().min(1).max(1024);
const credentials = revision
  .extend({
    username: secret,
    password: secret,
    pin: secret.refine(
      (p) => Buffer.byteLength(p, "utf8") <= 1023 && !/[\0\r\n]/.test(p),
      "El PIN supera la capacidad de lectura o contiene separadores no admitidos.",
    ),
    pkcs12_base64: z.string().min(4).max(2796204),
  })
  .strict();
export function haciendaConfigurationRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  auth: ReturnType<typeof identity>,
  config: AppConfig,
  idp: IdpClient,
) {
  const store = new CredentialStore(pool, config),
    base = "/api/companies/:tenantId/hacienda";
  app.get(base, async (req) => {
    const p = await auth.authenticate(req),
      { tenantId } = params.parse(req.params);
    return store.metadata(p.claims, tenantId);
  });
  app.post(
    base + "/credentials",
    { bodyLimit: 3 * 1024 * 1024 },
    async (req) => {
      const p = req.principal!,
        { tenantId } = params.parse(req.params);
      await store.authorize(p.claims, tenantId, "hacienda.credentials.manage");
      const input = credentials.parse(req.body);
      await auth.limit("hacienda:credentials:tenant:" + tenantId, 5);
      await auth.limit("hacienda:credentials:user:" + p.claims.sub, 10);
      const file = Buffer.from(input.pkcs12_base64, "base64");
      try {
        if (
          file.length > 2097152 ||
          file.toString("base64") !== input.pkcs12_base64
        )
          throw new HttpError(400, "Archivo Base64 no válido.");
        return await store.replace(p.claims, tenantId, input, file);
      } finally {
        file.fill(0);
      }
    },
  );
  app.post(base + "/credentials/deactivate", async (req) => {
    const p = req.principal!,
      { tenantId } = params.parse(req.params);
    await store.authorize(p.claims, tenantId, "hacienda.credentials.manage");
    const input = revision.parse(req.body);
    await auth.limit("hacienda:credentials:tenant:" + tenantId, 5);
    await auth.limit("hacienda:credentials:user:" + p.claims.sub, 10);
    return store.deactivate(p.claims, tenantId, input.expected_revision);
  });
  app.post(base + "/connection-test", async (req) => {
    const p = req.principal!,
      { tenantId } = params.parse(req.params);
    await store.authorize(p.claims, tenantId, "hacienda.connection.test");
    const input = revision.parse(req.body);
    if (config.HACIENDA_STAG_PROBE_ENABLED !== "true")
      throw new HttpError(
        503,
        "La prueba externa de Hacienda está pendiente de habilitación.",
      );
    await auth.limit("hacienda:probe:tenant:" + tenantId, 5);
    await auth.limit("hacienda:probe:user:" + p.claims.sub, 5);
    return store.testConnection(
      p.claims,
      tenantId,
      input.expected_revision,
      idp,
    );
  });
}
