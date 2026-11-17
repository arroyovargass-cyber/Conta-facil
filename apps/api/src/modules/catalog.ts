import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { catalogInput } from "../../../../packages/domain/src/billing";
import { scoped, HttpError } from "../db";
import type { identity } from "./identity";
import {
  ids,
  listQuery,
  pattern,
  page,
  catalogPermission,
  found,
} from "./billing-common";
export function catalogRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  auth: ReturnType<typeof identity>,
) {
  const base = "/api/companies/:tenantId/catalog-items",
    patch = catalogInput
      .partial()
      .extend({ version: z.int().positive() })
      .strict();
  app.get(base, async (req) => {
    const p = await auth.authenticate(req),
      { tenantId } = ids.parse(req.params),
      q = listQuery.parse(req.query);
    return scoped(pool, p.claims, async (db) => {
      await catalogPermission(db, tenantId, "catalog.read");
      return page(
        (
          await db.query(
            "select * from public.catalog_items where tenant_id=$1 and (description ilike $2 or code ilike $2) and ($3::boolean is null or active=$3) order by description,id limit 51 offset $4",
            [tenantId, pattern(q.search), q.active ?? null, q.cursor],
          )
        ).rows,
        q.cursor,
      );
    });
  });
  app.get(base + "/:id", async (req) => {
    const p = await auth.authenticate(req),
      { tenantId, id } = ids.parse(req.params);
    return scoped(pool, p.claims, async (db) => ({
      item: found(
        (
          await db.query(
            "select * from public.catalog_items where tenant_id=$1 and id=$2",
            [tenantId, id],
          )
        ).rows[0],
      ),
    }));
  });
  app.post(base, async (req) => {
    const { tenantId } = ids.parse(req.params),
      v = catalogInput.parse(req.body),
      p = req.principal!;
    return scoped(pool, p.claims, async (db) => {
      await catalogPermission(db, tenantId, "catalog.manage");
      return {
        item: (
          await db.query(
            "insert into public.catalog_items(tenant_id,code,description,kind,currency,unit_price,cabys,unit,active) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *",
            [
              tenantId,
              v.code,
              v.description,
              v.kind,
              v.currency,
              v.unit_price,
              v.cabys,
              v.unit,
              v.active,
            ],
          )
        ).rows[0],
      };
    });
  });
  app.patch(base + "/:id", async (req) => {
    const { tenantId, id } = ids.parse(req.params),
      input = patch.parse(req.body),
      p = req.principal!;
    return scoped(pool, p.claims, async (db) => {
      const old = found(
        (
          await db.query(
            "select * from public.catalog_items where tenant_id=$1 and id=$2",
            [tenantId, id],
          )
        ).rows[0],
      );
      await catalogPermission(db, tenantId, "catalog.manage");
      const v = catalogInput.parse(
        Object.fromEntries(
          Object.keys(catalogInput.shape).map((k) => [
            k,
            Object.hasOwn(req.body as object, k) ? (input as any)[k] : old[k],
          ]),
        ),
      );
      const item = (
        await db.query(
          "update public.catalog_items set code=$3,description=$4,kind=$5,currency=$6,unit_price=$7,cabys=$8,unit=$9,active=$10,version=version+1,updated_at=now() where tenant_id=$1 and id=$2 and version=$11 returning *",
          [
            tenantId,
            id,
            v.code,
            v.description,
            v.kind,
            v.currency,
            v.unit_price,
            v.cabys,
            v.unit,
            v.active,
            input.version,
          ],
        )
      ).rows[0];
      if (!item)
        throw new HttpError(
          409,
          "El registro cambió. Recarga antes de guardar.",
        );
      return { item };
    });
  });
}
