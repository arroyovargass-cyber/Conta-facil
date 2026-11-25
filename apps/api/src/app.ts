import { emissionActionRoutes } from "./modules/emission-actions";
import { emissionNumberingRoutes } from "./modules/emission-numbering";
import { EmissionPipeline } from "./services/emission-pipeline";
import { emissionRoutes } from "./modules/emission";
import { companyRegistrationRoutes } from "./modules/company-registration";
import { fiscalLookupRoutes } from "./modules/fiscal-lookups";
import { haciendaConfigurationRoutes } from "./modules/hacienda-configuration";
import { HaciendaIdp, type IdpClient } from "./services/hacienda-idp";
import { documentWorkflowRoutes } from "./modules/document-workflow";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import pg from "pg";
import { ZodError } from "zod";
import type { AppConfig } from "./config";
import { HttpError } from "./db";
import { identity } from "./modules/identity";
import { databaseOptions } from "./database-options";
import { hosting } from "./hosting";
import { companyRoutes } from "./modules/companies";
import { customerRoutes } from "./modules/customers";
import { catalogRoutes } from "./modules/catalog";
import { invoicingRoutes } from "./modules/invoicing";
import { fiscalPreparationRoutes } from "./modules/fiscal-preparation";
export async function createApp(
  config: AppConfig,
  options: { haciendaIdp?: IdpClient } = {},
) {
  if (options.haciendaIdp && config.NODE_ENV !== "test")
    throw new Error("Las dependencias controladas solo se admiten en pruebas.");
  const app = Fastify({
    logger: false,
    bodyLimit: 32768,
    trustProxy: config.TRUST_PROXY_HOPS
      ? (_address: string, hop: number) => hop < config.TRUST_PROXY_HOPS
      : false,
  });
  const pool = new pg.Pool(databaseOptions(config));
  const emissionPipeline = new EmissionPipeline(pool, config);
  let emissionWork: Promise<void> | undefined,
    closing = false;
  const wakeEmission = () => {
    if (
      closing ||
      emissionWork ||
      config.HACIENDA_STAG_EMISSION_ENABLED !== "true"
    )
      return;
    emissionWork = (async () => {
      await pool.query("select private.recover_uncertain_emissions()");
      await emissionPipeline.runBatch(4);
    })()
      .catch(() => {
        process.stderr.write(
          JSON.stringify({ event: "emission_batch_failed" }) + "\n",
        );
      })
      .finally(() => {
        emissionWork = undefined;
      });
  };
  app.addHook("onListen", async () => {
    wakeEmission();
  });
  app.addHook("onResponse", async (request) => {
    if (
      request.principal &&
      request.url.startsWith("/api/companies/") &&
      request.url.includes("/invoices")
    )
      wakeEmission();
  });
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Vary", "Cookie, Origin");
    return payload;
  });
  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: false });
  app.decorate("configOrigin", config.APP_ORIGIN);
  app.addHook("onClose", async () => {
    closing = true;
    await emissionWork;
    await pool.end();
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        message: "Revisa los campos del formulario.",
        fields: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    if (error instanceof HttpError)
      return reply.code(error.statusCode).send({ message: error.message });
    const code = (error as { code?: string }).code;
    if (code === "FST_ERR_CTP_BODY_TOO_LARGE")
      return reply
        .code(413)
        .send({ message: "El archivo supera el tamaño permitido." });
    if (code === "23505")
      return reply
        .code(409)
        .send({ message: "Ya existe un registro con esos datos." });
    if (["23503", "23514", "22P02"].includes(code ?? ""))
      return reply.code(400).send({
        message:
          "Relación o valor inválido; comprueba el alcance y los administradores activos.",
      });
    if (code === "42501")
      return reply
        .code(403)
        .send({ message: "No tienes permiso para realizar esta operación." });
    process.stderr.write(
      JSON.stringify({
        event: "request_failed",
        requestId: req.id,
        code: code ?? "internal",
      }) + "\n",
    );
    return reply.code(500).send({
      message: "No se pudo completar la operación.",
      requestId: req.id,
    });
  });
  const auth = identity(pool, config);
  await auth.routes(app);
  companyRoutes(app, pool, auth);
  companyRegistrationRoutes(app, pool, auth);
  customerRoutes(app, pool, auth);
  catalogRoutes(app, pool, auth);
  invoicingRoutes(app, pool, auth);
  emissionRoutes(app, pool, auth, config);
  emissionNumberingRoutes(app, pool, auth);
  emissionActionRoutes(app, pool, auth);
  fiscalLookupRoutes(app, pool, auth);
  fiscalPreparationRoutes(app, pool, auth);
  documentWorkflowRoutes(app, pool, auth);
  haciendaConfigurationRoutes(
    app,
    pool,
    auth,
    config,
    options.haciendaIdp ?? new HaciendaIdp({ environment: config.NODE_ENV }),
  );
  app.get("/api/health", async () => {
    await pool.query("select 1");
    return { name: "Conta Fácil", phase: 1, status: "ok" };
  });
  if (config.STATIC_DIRECTORY) await hosting(app, config.STATIC_DIRECTORY);
  return app;
}
