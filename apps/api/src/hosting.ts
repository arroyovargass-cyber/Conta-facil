import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { join } from "node:path";
import { existsSync } from "node:fs";
export async function hosting(app: FastifyInstance, directory: string) {
  if (!existsSync(join(directory, "index.html")))
    throw new Error(
      "Missing frontend build: run npm run build before starting the hosted app",
    );
  await app.register(fastifyStatic, {
    root: join(directory, "assets"),
    prefix: "/assets/",
    index: false,
    redirect: false,
    dotfiles: "deny",
  });
  for (const route of ["/", "/invite", "/reset"])
    app.get(route, async (_request, reply) => {
      reply.header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
      return reply.sendFile("index.html", directory);
    });
}
