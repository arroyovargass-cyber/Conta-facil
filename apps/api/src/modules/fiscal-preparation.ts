import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import {
  fiscalPreviewRequest,
  prepareFiscalPreview,
} from "../../../../packages/domain/src/fiscal-preview";
import { scoped, HttpError } from "../db";
import type { identity } from "./identity";
import { found } from "./billing-common";
const params = z.object({ tenantId: z.uuid(), id: z.uuid() }).strict();
export function fiscalPreparationRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  _auth: ReturnType<typeof identity>,
) {
  app.post(
    "/api/companies/:tenantId/invoice-drafts/:id/fiscal-preview",
    async (req) => {
      const p = req.principal!,
        { tenantId, id } = params.parse(req.params),
        input = fiscalPreviewRequest.parse(req.body);
      return scoped(pool, p.claims, async (db) => {
        // One statement snapshot: never pair an old version with a new set of lines.
        // Numeric values stay strings through PostgreSQL JSON and the JS parser.
        const draft = found(
          (
            await db.query(
              `select d.id,d.version,d.currency,d.customer_snapshot,
 coalesce((select jsonb_agg(jsonb_build_object('position',l.position,'quantity',l.quantity::text,'unit_price',l.unit_price::text) order by l.position)
 from public.invoice_draft_lines l where l.tenant_id=d.tenant_id and l.draft_id=d.id),'[]'::jsonb) lines
 from public.invoice_drafts d where d.tenant_id=$1 and d.id=$2 and private.has_access(d.tenant_id,'invoices.read',d.department_id)`,
              [tenantId, id],
            )
          ).rows[0],
        );
        if (draft.version !== input.expected_version)
          throw new HttpError(
            409,
            "El borrador cambió. Recarga antes de calcular la vista previa.",
          );
        return {
          draft_id: draft.id,
          draft_version: draft.version,
          ...prepareFiscalPreview({
            currency: draft.currency,
            customerSnapshot: draft.customer_snapshot ?? {},
            lines: draft.lines,
          }),
        };
      });
    },
  );
}
