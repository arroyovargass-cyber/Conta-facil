import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { scoped, HttpError } from "../db";
import type { identity } from "./identity";
import {
  FiscalLookups,
  cabysSearchInput,
  recipientIdentificationInput,
} from "../services/fiscal-lookups";

export function fiscalLookupRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  auth: ReturnType<typeof identity>,
) {
  const service = new FiscalLookups();
  const params = z.object({ tenantId: z.uuid() });
  const base = "/api/companies/:tenantId";
  async function authorize(req: Parameters<typeof auth.authenticate>[0]) {
    const principal = await auth.authenticate(req);
    const { tenantId } = params.parse(req.params);
    await scoped(pool, principal.claims, async (db) => {
      const result = await db.query(
        "select private.member_access($1) and (private.has_catalog_access($1,'customers.read') or private.has_catalog_access($1,'catalog.read') or exists(select 1 from public.departments d where d.tenant_id=$1 and d.active and private.has_access($1,'invoices.read',d.id))) allowed",
        [tenantId],
      );
      if (!result.rows[0]?.allowed)
        throw new HttpError(
          403,
          "No tienes permiso para realizar esta operación.",
        );
    });
    await auth.limit("fiscal-lookup:" + principal.userId, 30);
  }
  app.get(base + "/cabys", async (req) => {
    await authorize(req);
    const { search } = z
      .object({ search: cabysSearchInput })
      .strict()
      .parse(req.query);
    return service.cabys(search);
  });
  app.get(base + "/recipient-lookup", async (req, reply) => {
    await authorize(req);
    reply.header("Cache-Control", "no-store");
    const { identification } = z
      .object({ identification: recipientIdentificationInput })
      .strict()
      .parse(req.query);
    return service.recipient(identification);
  });
  app.get(base + "/locations", async (req) => {
    await authorize(req);
    return JSON.parse(
      await readFile("docs/reference/hacienda/v4.4/locations.json", "utf8"),
    );
  });
}
