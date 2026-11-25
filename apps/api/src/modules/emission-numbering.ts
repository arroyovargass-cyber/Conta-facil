import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import type { identity } from "./identity";
import { HttpError, requirePermission } from "../db";
import { haciendaEnvironmentInput } from "../../../../packages/domain/src/hacienda-environment";
const params = z.object({ tenantId: z.uuid() });
export function emissionNumberingRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  auth: ReturnType<typeof identity>,
) {
  const base = "/api/companies/:tenantId/invoices";
  async function transaction<T>(
    claims: unknown,
    run: (db: pg.PoolClient) => Promise<T>,
  ) {
    const db = await pool.connect();
    try {
      await db.query("begin");
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify(claims),
      ]);
      const value = await run(db);
      await db.query("commit");
      return value;
    } catch (e) {
      await db.query("rollback");
      throw e;
    } finally {
      db.release();
    }
  }
  const allowed = async (db: pg.PoolClient, tenant: string) =>
    (
      await db.query(
        "select private.is_system_administrator() and private.has_access($1,'tax.manage',null) allowed",
        [tenant],
      )
    ).rows[0].allowed;
  app.get(base + "/numbering-options", async (req) => {
    const p = await auth.authenticate(req),
      { tenantId } = params.parse(req.params),
      { environment } = z
        .object({ environment: haciendaEnvironmentInput })
        .strict()
        .parse(req.query ?? {});
    return transaction(p.claims, async (db) => {
      if (!(await allowed(db, tenantId)))
        return { canConfirm: false, environment, items: [] };
      const items = (
        await db.query(
          `select b.code branch_code,t.code terminal_code,coalesce(s.last_value,0)::text last_value,
    coalesce((select max(d.last_value) from public.document_sequences d where d.tenant_id=b.tenant_id and d.branch_id=b.id and d.terminal_id=t.id and d.document_type='FE'),0)::text legacy_floor,s.confirmed_at
    from public.branches b join public.terminals t on t.tenant_id=b.tenant_id and t.branch_id=b.id
    left join private.emission_sequences s on s.tenant_id=b.tenant_id and s.environment=$2 and s.branch_code=b.code and s.terminal_code=t.code
    where b.tenant_id=$1 and b.active and t.active order by b.code,t.code limit 101`,
          [tenantId, environment],
        )
      ).rows;
      return { canConfirm: true, environment, items: items.slice(0, 100) };
    });
  });
  app.post(base + "/numbering", async (req) => {
    const { tenantId } = params.parse(req.params),
      input = z
        .object({
          branch_code: z
            .string()
            .regex(/^[0-9]{3}$/)
            .refine((s) => s !== "000"),
          terminal_code: z
            .string()
            .regex(/^[0-9]{5}$/)
            .refine((s) => s !== "00000"),
          starting_value: z.string().regex(/^(0|[1-9][0-9]{0,9})$/),
          environment: haciendaEnvironmentInput,
        })
        .strict()
        .parse(req.body);
    return transaction(req.principal!.claims, async (db) => {
      if (!(await allowed(db, tenantId)))
        throw new HttpError(
          403,
          "Solo el superadministrador con MFA puede confirmar la numeración.",
        );
      await requirePermission(db, tenantId, "tax.manage");
      try {
        await db.query(
          "select private.confirm_emission_numbering($1,$2,$3,$4::numeric,$5::text)",
          [
            tenantId,
            input.branch_code,
            input.terminal_code,
            input.starting_value,
            input.environment,
          ],
        );
      } catch (e) {
        if (
          [
            "LEGACY_SEQUENCE_FLOOR",
            "SEQUENCE_CANNOT_DECREASE",
            "INVALID_SEQUENCE",
            "INVALID_BRANCH_TERMINAL",
          ].includes((e as Error).message)
        )
          throw new HttpError(
            409,
            "Revisa la sucursal y terminal: el consecutivo no puede ser menor que la numeración conservada.",
          );
        throw e;
      }
      await requirePermission(db, tenantId, "tax.manage");
      return { confirmed: true, environment: input.environment };
    });
  });
}
