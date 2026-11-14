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
export async function createApp(config: AppConfig) {
  const app = Fastify({
    logger: false,
    bodyLimit: 32768,
    trustProxy: config.TRUST_PROXY_HOPS
      ? (_address: string, hop: number) => hop < config.TRUST_PROXY_HOPS
      : false,
  });
  const pool = new pg.Pool(databaseOptions(config));
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Vary", "Cookie, Origin");
    return payload;
  });
  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: false });
  app.decorate("configOrigin", config.APP_ORIGIN);
  app.addHook("onClose", async () => {
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
  customerRoutes(app, pool, auth);
  catalogRoutes(app, pool, auth);
  invoicingRoutes(app, pool, auth);
  app.get("/api/health", async () => {
    await pool.query("select 1");
    return { name: "Conta Fácil", phase: 1, status: "ok" };
  });
  if (config.STATIC_DIRECTORY) await hosting(app, config.STATIC_DIRECTORY);
  return app;
}
