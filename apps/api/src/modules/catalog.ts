import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import {
  catalogInput,
  type DraftInput,
} from "../../../../packages/domain/src/billing";
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
function normalizedCatalog(v: z.infer<typeof catalogInput>) {
  if (!v.tax_defaults) return v;
  const f = v.tax_defaults;
  if (
    (v.cabys && f.cabys && v.cabys !== f.cabys) ||
    (v.unit && f.unit && v.unit !== f.unit)
  )
    throw new HttpError(
      400,
      "El CABYS y la unidad del producto deben coincidir con sus valores fiscales predeterminados.",
    );
  const cabys = v.cabys || f.cabys,
    unit = v.unit || f.unit;
  return { ...v, cabys, unit, tax_defaults: { ...f, cabys, unit } };
}
// Saving a draft line is an explicit catalog operation, scoped and deduplicated
// in the same transaction as the draft. Existing catalog data is never changed.
export async function saveDraftCatalogItem(
  db: pg.PoolClient,
  tenant: string,
  currency: "CRC" | "USD",
  line: DraftInput["lines"][number],
) {
  await catalogPermission(db, tenant, "catalog.manage");
  await catalogPermission(db, tenant, "catalog.read");
  const code = line.fiscal?.internal_code?.trim();
  if (!code || !line.description || line.unit_price === null || !line.fiscal)
    throw new HttpError(
      400,
      "Para guardar el producto completa el código interno, la descripción, el precio y sus datos fiscales.",
    );
  await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
    tenant + ":catalog:" + code,
  ]);
  const existing = (
    await db.query(
      "select id,active,currency from public.catalog_items where tenant_id=$1 and code=$2",
      [tenant, code],
    )
  ).rows[0];
  if (existing) {
    if (!existing.active || existing.currency !== currency)
      throw new HttpError(
        409,
        "El código interno ya existe en esta empresa con otra moneda o está inactivo. Selecciona el producto o usa otro código.",
      );
    return existing.id as string;
  }
  const v = normalizedCatalog(
    catalogInput.parse({
      code,
      description: line.description,
      currency,
      unit_price: line.unit_price,
      kind: /^[0-4]/.test(line.fiscal.cabys) ? "product" : "service",
      cabys: line.fiscal.cabys,
      unit: line.fiscal.unit,
      tax_defaults: line.fiscal,
    }),
  );
  return (
    await db.query(
      "insert into public.catalog_items(tenant_id,code,description,kind,currency,unit_price,cabys,unit,active,tax_defaults) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id",
      [
        tenant,
        v.code,
        v.description,
        v.kind,
        v.currency,
        v.unit_price,
        v.cabys,
        v.unit,
        v.active,
        v.tax_defaults,
      ],
    )
  ).rows[0].id as string;
}
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
      v = normalizedCatalog(catalogInput.parse(req.body)),
      p = req.principal!;
    return scoped(pool, p.claims, async (db) => {
      await catalogPermission(db, tenantId, "catalog.manage");
      return {
        item: (
          await db.query(
            "insert into public.catalog_items(tenant_id,code,description,kind,currency,unit_price,cabys,unit,active,tax_defaults) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *",
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
              v.tax_defaults,
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
      let v = catalogInput.parse(
        Object.fromEntries(
          Object.keys(catalogInput.shape).map((k) => [
            k,
            Object.hasOwn(req.body as object, k) ? (input as any)[k] : old[k],
          ]),
        ),
      );
      if (
        v.tax_defaults &&
        !Object.hasOwn(req.body as object, "tax_defaults")
      ) {
        v = {
          ...v,
          tax_defaults: {
            ...v.tax_defaults,
            ...(Object.hasOwn(req.body as object, "cabys")
              ? { cabys: v.cabys }
              : {}),
            ...(Object.hasOwn(req.body as object, "unit")
              ? { unit: v.unit }
              : {}),
          },
        };
      }
      v = normalizedCatalog(v);
      const item = (
        await db.query(
          "update public.catalog_items set code=$3,description=$4,kind=$5,currency=$6,unit_price=$7,cabys=$8,unit=$9,active=$10,tax_defaults=$12,version=version+1,updated_at=now() where tenant_id=$1 and id=$2 and version=$11 returning *",
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
            v.tax_defaults,
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
