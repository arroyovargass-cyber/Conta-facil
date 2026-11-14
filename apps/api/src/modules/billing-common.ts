import { z } from "zod";
import type pg from "pg";
import { HttpError } from "../db";
export const ids = z.object({ tenantId: z.uuid(), id: z.uuid().optional() });
export const listQuery = z
  .object({
    search: z.string().max(100).default(""),
    cursor: z.coerce.number().int().min(0).max(1000000).default(0),
    active: z.enum(["true", "false"]).optional(),
    archived: z.enum(["true", "false"]).optional(),
  })
  .strict();
export const pattern = (s: string) => "%" + s.replace(/[\\%_]/g, "\\$&") + "%";
export async function catalogPermission(
  db: pg.PoolClient,
  t: string,
  p: string,
) {
  if (
    !(
      await db.query("select private.has_catalog_access($1,$2) allowed", [t, p])
    ).rows[0]?.allowed
  )
    throw new HttpError(403, "No tienes permiso para realizar esta operación.");
}
export function page(rows: any[], cursor: number) {
  return {
    items: rows.slice(0, 50),
    nextCursor: rows.length > 50 ? cursor + 50 : null,
  };
}
export function found<T>(item: T | undefined): T {
  if (!item) throw new HttpError(404, "Registro no disponible.");
  return item;
}
