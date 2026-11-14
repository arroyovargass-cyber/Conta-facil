import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { createHash } from "node:crypto";
import {
  draftInput,
  draftUpdateInput,
  subtotal,
  type DraftInput,
} from "../../../../packages/domain/src/billing";
import { scoped, requirePermission, HttpError } from "../db";
import type { identity } from "./identity";
import { ids, listQuery, pattern, page, found } from "./billing-common";
const archiveInput = z
  .object({ version: z.int().positive(), archived: z.boolean() })
  .strict();
async function detail(db: pg.PoolClient, tenant: string, id: string) {
  const item = found(
    (
      await db.query(
        "select * from public.invoice_drafts where tenant_id=$1 and id=$2",
        [tenant, id],
      )
    ).rows[0],
  );
  item.lines = (
    await db.query(
      "select * from public.invoice_draft_lines where tenant_id=$1 and draft_id=$2 order by position",
      [tenant, id],
    )
  ).rows;
  item.subtotal = subtotal(item.lines);
  return item;
}
async function validateReferences(
  db: pg.PoolClient,
  tenant: string,
  v: Omit<DraftInput, "operation_id">,
  old?: any,
) {
  const dep = (
    await db.query(
      "select id from public.departments where tenant_id=$1 and id=$2 and active",
      [tenant, v.department_id],
    )
  ).rows[0];
  if (!dep)
    throw new HttpError(400, "Selecciona un departamento activo y autorizado.");
  const c = (
    await db.query(
      "select * from public.customers where tenant_id=$1 and id=$2",
      [tenant, v.customer_id],
    )
  ).rows[0];
  if (!c || (!c.active && old?.customer_id !== c.id))
    throw new HttpError(400, "Selecciona un cliente activo de esta empresa.");
  for (const line of v.lines)
    if (line.catalog_item_id) {
      const p = (
        await db.query(
          "select * from public.catalog_items where tenant_id=$1 and id=$2",
          [tenant, line.catalog_item_id],
        )
      ).rows[0];
      if (
        !p ||
        (!p.active &&
          !old?.lines.some((l: any) => l.catalog_item_id === p.id)) ||
        p.currency !== v.currency
      )
        throw new HttpError(
          400,
          "El producto debe pertenecer a esta empresa y coincidir con la moneda. Nuevas referencias deben estar activas.",
        );
    }
  return old?.customer_id === c.id
    ? old.customer_snapshot
    : {
        name: c.name,
        identification_type: c.identification_type,
        identification: c.identification,
      };
}
async function insertLines(
  db: pg.PoolClient,
  tenant: string,
  id: string,
  lines: DraftInput["lines"],
) {
  for (const [index, l] of lines.entries())
    await db.query(
      "insert into public.invoice_draft_lines(tenant_id,draft_id,position,catalog_item_id,description,quantity,unit_price) values($1,$2,$3,$4,$5,$6,$7)",
      [
        tenant,
        id,
        index + 1,
        l.catalog_item_id,
        l.description,
        l.quantity,
        l.unit_price,
      ],
    );
}
export function invoicingRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  auth: ReturnType<typeof identity>,
) {
  const company = "/api/companies/:tenantId",
    base = company + "/invoice-drafts";
  app.get(company + "/invoice-options", async (req) => {
    const p = await auth.authenticate(req),
      { tenantId } = ids.parse(req.params);
    return scoped(pool, p.claims, async (db) => {
      const departments = (
        await db.query(
          "select id,name,active,private.has_access(tenant_id,'invoices.manage',id) can_manage from public.departments where tenant_id=$1 and private.has_access(tenant_id,'invoices.read',id) order by name,id",
          [tenantId],
        )
      ).rows;
      const permissions = (
        await db.query(
          "select code from public.permission_catalog where module in ('customers','catalog') and private.has_catalog_access($1,code)",
          [tenantId],
        )
      ).rows.map((r) => r.code);
      return {
        departments,
        permissions,
        canManage: departments.some((d) => d.active && d.can_manage),
      };
    });
  });
  app.get(base, async (req) => {
    const p = await auth.authenticate(req),
      { tenantId } = ids.parse(req.params),
      q = listQuery.parse(req.query);
    return scoped(pool, p.claims, async (db) =>
      page(
        (
          await db.query(
            "select id,customer_snapshot,department_id,currency,status,archived_at,version,created_at from public.invoice_drafts where tenant_id=$1 and (customer_snapshot->>'name' ilike $2 or id::text ilike $2) and ($3::boolean is null or (archived_at is not null)=$3) order by created_at desc,id limit 51 offset $4",
            [tenantId, pattern(q.search), q.archived ?? null, q.cursor],
          )
        ).rows,
        q.cursor,
      ),
    );
  });
  app.get(base + "/:id", async (req) => {
    const p = await auth.authenticate(req),
      { tenantId, id } = ids.parse(req.params);
    return scoped(pool, p.claims, async (db) => ({
      item: await detail(db, tenantId, id!),
    }));
  });
  app.post(base, { bodyLimit: 262144 }, async (req) => {
    const p = req.principal!,
      { tenantId } = ids.parse(req.params),
      v = draftInput.parse(req.body),
      hash = createHash("sha256").update(JSON.stringify(v)).digest("hex");
    return scoped(pool, p.claims, async (db) => {
      await requirePermission(db, tenantId, "invoices.manage", v.department_id);
      await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
        tenantId + ":" + p.userId + ":" + v.operation_id,
      ]);
      const existing = (
        await db.query(
          "select id,request_hash from public.invoice_drafts where tenant_id=$1 and created_by=$2 and operation_id=$3",
          [tenantId, p.userId, v.operation_id],
        )
      ).rows[0];
      if (existing) {
        if (existing.request_hash !== hash)
          throw new HttpError(
            409,
            "La operación ya se usó con datos diferentes.",
          );
        return { item: await detail(db, tenantId, existing.id) };
      }
      const snapshot = await validateReferences(db, tenantId, v);
      const row = (
        await db.query(
          "insert into public.invoice_drafts(tenant_id,customer_id,department_id,currency,customer_snapshot,notes,created_by,updated_by,operation_id,request_hash) values($1,$2,$3,$4,$5,$6,$7,$7,$8,$9) returning id",
          [
            tenantId,
            v.customer_id,
            v.department_id,
            v.currency,
            snapshot,
            v.notes,
            p.userId,
            v.operation_id,
            hash,
          ],
        )
      ).rows[0];
      await insertLines(db, tenantId, row.id, v.lines);
      return { item: await detail(db, tenantId, row.id) };
    });
  });
  app.patch(base + "/:id", { bodyLimit: 262144 }, async (req) => {
    const p = req.principal!,
      { tenantId, id } = ids.parse(req.params),
      v = z.union([archiveInput, draftUpdateInput]).parse(req.body);
    return scoped(pool, p.claims, async (db) => {
      found(
        (
          await db.query(
            "select id from public.invoice_drafts where tenant_id=$1 and id=$2 for update",
            [tenantId, id],
          )
        ).rows[0],
      );
      const old = await detail(db, tenantId, id!);
      await requirePermission(
        db,
        tenantId,
        "invoices.manage",
        old.department_id,
      );
      if (old.version !== v.version)
        throw new HttpError(
          409,
          "El borrador cambió. Recarga antes de guardar.",
        );
      if ("archived" in v) {
        await db.query(
          "update public.invoice_drafts set archived_at=case when $3 then now() else null end,version=version+1,updated_by=$4,updated_at=now() where tenant_id=$1 and id=$2",
          [tenantId, id, v.archived, p.userId],
        );
      } else {
        if (old.archived_at)
          throw new HttpError(409, "Restaura el borrador antes de editarlo.");
        await requirePermission(
          db,
          tenantId,
          "invoices.manage",
          v.department_id,
        );
        const snapshot = await validateReferences(db, tenantId, v, old);
        await db.query(
          "update public.invoice_drafts set customer_id=$3,department_id=$4,currency=$5,customer_snapshot=$6,notes=$7,version=version+1,updated_by=$8,updated_at=now() where tenant_id=$1 and id=$2",
          [
            tenantId,
            id,
            v.customer_id,
            v.department_id,
            v.currency,
            snapshot,
            v.notes,
            p.userId,
          ],
        );
        await db.query(
          "delete from public.invoice_draft_lines where tenant_id=$1 and draft_id=$2",
          [tenantId, id],
        );
        await insertLines(db, tenantId, id!, v.lines);
      }
      return { item: await detail(db, tenantId, id!) };
    });
  });
}
