import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { HttpError, requirePermission } from "../db";
import { found } from "./billing-common";
import type { identity } from "./identity";
import { invoiceEmailDeliveryEnabled } from "../../../../packages/domain/src/company";
const actions = [
  "retry_signature",
  "retry_transmission",
  "query",
  "resend_email",
] as const;
type Action = (typeof actions)[number];
const params = z.object({ tenantId: z.uuid(), id: z.uuid() });
const inputSchema = z
  .object({ operation_id: z.uuid(), action: z.enum(actions) })
  .strict();
const kind = {
  retry_signature: "sign",
  retry_transmission: "transmit",
  query: "query",
  resend_email: "email",
};
const actionPermission = (action: Action) =>
  action === "query"
    ? "invoices.query"
    : action === "resend_email"
      ? "invoices.email"
      : "invoices.emit";
const active = (job: any) => job && ["pending", "leased"].includes(job.status);
function permitted(row: any, action: Action, job: any, actor: string) {
  if (row.document_status !== "issued") return false;
  if (!["query", "resend_email"].includes(action) && row.issued_by !== actor)
    return false;
  if (action === "retry_signature")
    return (
      row.signature_status === "pending" &&
      row.transmission_status === "queued" &&
      job?.status === "failed"
    );
  if (action === "retry_transmission")
    return (
      row.signature_status === "signed" &&
      row.transmission_status === "queued" &&
      ["failed", "uncertain"].includes(job?.status)
    );
  if (action === "query")
    return (
      row.hacienda_status === "pending" &&
      ["sent", "uncertain", "processing"].includes(row.transmission_status)
    );
  return (
    row.hacienda_status === "accepted" &&
    Boolean(row.snapshot?.receiver?.email) &&
    invoiceEmailDeliveryEnabled(row.snapshot?.issuer?.configuration) &&
    ["queued", "provider_accepted", "error", "not_queued"].includes(
      row.email_status,
    ) &&
    job?.status !== "leased" &&
    (row.email_status !== "queued" || !job || job.status === "pending")
  );
}
async function artifactsValid(db: pg.PoolClient, tenant: string, id: string) {
  const rows = (
    await db.query(
      "select kind,content,sha256 from private.invoice_artifacts where tenant_id=$1 and invoice_id=$2",
      [tenant, id],
    )
  ).rows;
  return ["signed_xml", "hacienda_response", "pdf"].every((k) => {
    const matches = rows.filter((r) => r.kind === k);
    return (
      matches.length === 1 &&
      createHash("sha256").update(matches[0].content).digest("hex") ===
        matches[0].sha256
    );
  });
}
export function emissionActionRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  auth: ReturnType<typeof identity>,
) {
  const base = "/api/companies/:tenantId/invoices/:id/actions";
  app.get(base, async (req) => {
    const p = await auth.authenticate(req),
      { tenantId, id } = params.parse(req.params);
    const db = await pool.connect();
    try {
      await db.query("begin");
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify(p.claims),
      ]);
      let row = found(
        (
          await db.query(
            "select * from public.electronic_invoices where tenant_id=$1 and id=$2",
            [tenantId, id],
          )
        ).rows[0],
      );
      await requirePermission(db, tenantId, "invoices.read", row.department_id);
      const capabilities = (
        await db.query(
          "select private.has_access($1,'invoices.emit',$2) can_emit,private.has_access($1,'invoices.query',$2) can_query,private.has_access($1,'invoices.email',$2) can_email",
          [tenantId, row.department_id],
        )
      ).rows[0];
      await db.query("reset role");
      const jobs = (
        await db.query(
          "select * from private.emission_jobs where tenant_id=$1 and invoice_id=$2",
          [tenantId, id],
        )
      ).rows;
      const visible: Action[] = [];
      if (p.claims.aal === "aal2")
        for (const action of actions)
          if (
            (action === "query"
              ? capabilities.can_query
              : action === "resend_email"
                ? capabilities.can_email
                : capabilities.can_emit) &&
            permitted(
              row,
              action,
              jobs.find((j) => j.kind === kind[action]),
              p.userId,
            ) &&
            (action !== "resend_email" ||
              (await artifactsValid(db, tenantId, id)))
          )
            visible.push(action);
      await db.query("commit");
      return { actions: visible };
    } catch (e) {
      await db.query("rollback");
      throw e;
    } finally {
      db.release();
    }
  });
  app.post(base, async (req) => {
    const p = req.principal!,
      { tenantId, id } = params.parse(req.params),
      input = inputSchema.parse(req.body);
    const db = await pool.connect();
    try {
      await db.query("begin");
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify(p.claims),
      ]);
      // Authorize the live interactive session before any private operation lookup.
      let row = found(
        (
          await db.query(
            "select * from public.electronic_invoices where tenant_id=$1 and id=$2",
            [tenantId, id],
          )
        ).rows[0],
      );
      await requirePermission(
        db,
        tenantId,
        actionPermission(input.action),
        row.department_id,
      );
      if (p.claims.aal !== "aal2")
        throw new HttpError(
          403,
          "Confirma tu identidad con MFA antes de continuar.",
        );
      if (
        !["query", "resend_email"].includes(input.action) &&
        row.issued_by !== p.userId
      )
        throw new HttpError(
          403,
          "Solo la persona que emitió la factura puede solicitar esta acción.",
        );
      await db.query("reset role");
      // Operation IDs are shared across documents for this actor, including concurrent requests.
      await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
        `${tenantId.toLowerCase()}:${p.userId}:${input.operation_id.toLowerCase()}`,
      ]);
      const hash = createHash("sha256")
        .update(
          JSON.stringify({
            invoice_id: id.toLowerCase(),
            action: input.action,
          }),
        )
        .digest("hex");
      const replay = (
        await db.query(
          "select * from private.emission_actions where tenant_id=$1 and actor_id=$2 and operation_id=$3",
          [tenantId, p.userId, input.operation_id],
        )
      ).rows[0];
      if (replay) {
        if (replay.request_hash !== hash)
          throw new HttpError(
            409,
            "Esta operación ya se utilizó con otros datos.",
          );
        await db.query("commit");
        return { queued: true, action: input.action };
      }
      // Serialize the absent-job case with enqueue and recovery before locking a document.
      await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
        `${tenantId.toLowerCase()}:${id.toLowerCase()}:${kind[input.action]}`,
      ]);
      const job = (
        await db.query(
          "select * from private.emission_jobs where tenant_id=$1 and invoice_id=$2 and kind=$3 for update",
          [tenantId, id, kind[input.action]],
        )
      ).rows[0];
      row = found(
        (
          await db.query(
            "select * from public.electronic_invoices where tenant_id=$1 and id=$2" +
              (input.action === "query" ? "" : " for update"),
            [tenantId, id],
          )
        ).rows[0],
      );
      await requirePermission(
        db,
        tenantId,
        actionPermission(input.action),
        row.department_id,
      );
      await requirePermission(db, tenantId, "invoices.read", row.department_id);
      if (
        !permitted(row, input.action, job, p.userId) ||
        (input.action === "resend_email" &&
          !(await artifactsValid(db, tenantId, id)))
      )
        throw new HttpError(
          409,
          "La factura no permite esta acción en su estado actual.",
        );
      const limits = (
        await db.query(
          "select count(*)::int total,count(*) filter(where created_at>now()-interval '1 hour')::int hourly from private.emission_actions where tenant_id=$1 and invoice_id=$2 and actor_id=$3",
          [tenantId, id, p.userId],
        )
      ).rows[0];
      if (limits.total >= 10 || limits.hourly >= 3)
        throw new HttpError(
          429,
          "Límite de acciones manuales: máximo 3 por hora y 10 en total por factura y usuario.",
        );
      if (!active(job)) {
        const scheduled = await db.query(
          "insert into private.emission_jobs(tenant_id,invoice_id,kind,request_origin,requested_by) values($1,$2,$3,$4,$5) on conflict(tenant_id,invoice_id,kind) do update set status='pending',attempts=0,available_at=now(),lease_token=null,lease_until=null,last_error_code=null,completed_at=null,request_origin=excluded.request_origin,requested_by=excluded.requested_by where private.emission_jobs.status not in ('pending','leased') returning id",
          [
            tenantId,
            id,
            kind[input.action],
            ["query", "resend_email"].includes(input.action)
              ? "manual"
              : "automatic",
            ["query", "resend_email"].includes(input.action) ? p.userId : null,
          ],
        );
        if (input.action === "resend_email" && scheduled.rowCount)
          await db.query(
            "update public.electronic_invoices set email_status='queued',email_dispatch_id=$3 where tenant_id=$1 and id=$2",
            [tenantId, id, input.operation_id],
          );
      }
      await db.query(
        "insert into private.emission_actions(tenant_id,invoice_id,actor_id,operation_id,action,request_hash) values($1,$2,$3,$4,$5,$6)",
        [tenantId, id, p.userId, input.operation_id, input.action, hash],
      );
      await requirePermission(
        db,
        tenantId,
        actionPermission(input.action),
        row.department_id,
      );
      await requirePermission(db, tenantId, "invoices.read", row.department_id);
      await db.query("commit");
      return { queued: true, action: input.action };
    } catch (e) {
      await db.query("rollback");
      throw e;
    } finally {
      db.release();
    }
  });
}
