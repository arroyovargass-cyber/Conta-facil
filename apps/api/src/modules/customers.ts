import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { customerInput } from "../../../../packages/domain/src/billing";
import { scoped, HttpError } from "../db";
import type { identity } from "./identity";
import {
  insertCustomer,
  CUSTOMER_COLUMNS,
  customerValues,
  ensureCustomerNotDuplicate,
} from "./customer-persistence";
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
      return { item: await insertCustomer(db, tenantId, v) };
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
      await ensureCustomerNotDuplicate(db, tenantId, v, id!);
      const values = customerValues(v);
      const item = (
        await db.query(
          `update public.customers set ${CUSTOMER_COLUMNS.map((k, i) => k + "=$" + (i + 3)).join(",")},version=version+1,updated_at=now() where tenant_id=$1 and id=$2 and version=$${values.length + 3} returning *`,
          [tenantId, id, ...values, input.version],
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
