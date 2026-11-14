import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { customerInput } from "../../../../packages/domain/src/billing";
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
export function customerRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  auth: ReturnType<typeof identity>,
) {
  const base = "/api/companies/:tenantId/customers";
  const patch = z
    .object(customerInput.shape)
    .partial()
    .extend({ version: z.int().positive() })
    .strict();
  app.get(base, async (req) => {
    const p = await auth.authenticate(req),
      { tenantId } = ids.parse(req.params),
      q = listQuery.parse(req.query);
    return scoped(pool, p.claims, async (db) => {
      await catalogPermission(db, tenantId, "customers.read");
      return page(
        (
          await db.query(
            "select * from public.customers where tenant_id=$1 and (name ilike $2 or identification ilike $2) and ($3::boolean is null or active=$3) order by name,id limit 51 offset $4",
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
            "select * from public.customers where tenant_id=$1 and id=$2",
            [tenantId, id],
          )
        ).rows[0],
      ),
    }));
  });
  app.post(base, async (req) => {
    const { tenantId } = ids.parse(req.params),
      v = customerInput.parse(req.body),
      p = req.principal!;
    return scoped(pool, p.claims, async (db) => {
      await catalogPermission(db, tenantId, "customers.manage");
      return {
        item: (
          await db.query(
            "insert into public.customers(tenant_id,name,identification_type,identification,email,phone,address,active) values($1,$2,$3,$4,$5,$6,$7,$8) returning *",
            [
              tenantId,
              v.name,
              v.identification_type,
              v.identification,
              v.email,
              v.phone,
              v.address,
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
            "select * from public.customers where tenant_id=$1 and id=$2",
            [tenantId, id],
          )
        ).rows[0],
      );
      await catalogPermission(db, tenantId, "customers.manage");
      const v = customerInput.parse(
        Object.fromEntries(
          Object.keys(customerInput.shape).map((k) => [
            k,
            Object.hasOwn(req.body as object, k) ? (input as any)[k] : old[k],
          ]),
        ),
      );
      const item = (
        await db.query(
          "update public.customers set name=$3,identification_type=$4,identification=$5,email=$6,phone=$7,address=$8,active=$9,version=version+1,updated_at=now() where tenant_id=$1 and id=$2 and version=$10 returning *",
          [
            tenantId,
            id,
            v.name,
            v.identification_type,
            v.identification,
            v.email,
            v.phone,
            v.address,
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
