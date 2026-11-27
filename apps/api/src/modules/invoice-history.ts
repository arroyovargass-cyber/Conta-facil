import { z } from "zod";
import type pg from "pg";
import { haciendaEnvironmentInput } from "../../../../packages/domain/src/hacienda-environment";
import { page, pattern } from "./billing-common";

const date = z
  .string()
  .default("")
  .refine(
    (v) =>
      !v ||
      (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
        Number.isFinite(Date.parse(v + "T00:00:00Z")) &&
        new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v),
    "Indica una fecha válida.",
  );
export const invoiceHistoryQuery = z
  .object({
    search: z.string().max(100).default(""),
    cursor: z.coerce.number().int().min(0).max(1000000).default(0),
    environment: haciendaEnvironmentInput,
    from: date,
    to: date,
    identification: z.string().max(20).default(""),
    consecutivo: z.string().max(20).default(""),
    clave: z.string().max(50).default(""),
    document_type: z.enum(["", "FE", "TE"]).default(""),
    currency: z.enum(["", "CRC", "USD"]).default(""),
    document_status: z.enum(["", "prepared", "issued"]).default(""),
    hacienda_status: z
      .enum(["", "pending", "accepted", "rejected"])
      .default(""),
    issued_by: z.union([z.uuid(), z.literal("")]).default(""),
    sale_condition: z.enum(["", "01", "02"]).default(""),
    include_summary: z.enum(["true", "false"]).default("false"),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    path: ["to"],
    message: "La fecha final debe ser igual o posterior a la inicial.",
  });

/** Caller supplies an authenticated, tenant-scoped transaction; RLS remains active. */
export async function listInvoiceHistory(
  db: pg.PoolClient,
  tenantId: string,
  q: z.infer<typeof invoiceHistoryQuery>,
) {
  const values: unknown[] = [tenantId, pattern(q.search), q.environment];
  const clauses = [
    "tenant_id=$1",
    "environment=$3",
    `(snapshot->'receiver'->>'name' ilike $2 or snapshot->'receiver'->>'identification' ilike $2 or consecutivo ilike $2 or clave ilike $2 or id::text ilike $2)`,
  ];
  const add = (value: string, expression: string, like = false) => {
    if (!value) return;
    values.push(like ? pattern(value) : value);
    clauses.push(expression.replace("?", "$" + values.length));
  };
  const dateExpression =
    "(coalesce(issued_at,created_at) at time zone 'America/Costa_Rica')::date";
  add(q.from, dateExpression + ">=?::date");
  add(q.to, dateExpression + "<=?::date");
  add(
    q.identification,
    "snapshot->'receiver'->>'identification' ilike ?",
    true,
  );
  add(q.consecutivo, "consecutivo ilike ?", true);
  add(q.clave, "clave ilike ?", true);
  add(q.document_type, "document_type=?");
  add(q.currency, "snapshot->>'currency'=?");
  add(q.document_status, "document_status=?");
  add(q.hacienda_status, "hacienda_status=?");
  add(q.issued_by, "issued_by=?::uuid");
  add(q.sale_condition, "options->>'sale_condition'=?");
  const where = clauses.join(" and ");
  const result = page(
    (
      await db.query(
        `select id,version,draft_id,draft_version,department_id,environment,
    document_type,document_status,signature_status,transmission_status,hacienda_status,email_status,
    created_at,issued_at,issued_by,consecutivo,clave,options->>'sale_condition' sale_condition,
    jsonb_build_object('receiver',jsonb_build_object('name',snapshot->'receiver'->>'name',
      'identification',snapshot->'receiver'->>'identification'),'currency',snapshot->>'currency',
      'totals',jsonb_build_object('total',snapshot->'totals'->>'total','status',snapshot->'totals'->>'status')) snapshot
    from public.electronic_invoices where ${where} order by created_at desc,id limit 51 offset $${values.length + 1}`,
        [...values, q.cursor],
      )
    ).rows,
    q.cursor,
  );
  if (q.include_summary !== "true") return result;
  const canReport = (
    await db.query(
      "select exists(select 1 from public.departments d where d.tenant_id=$1 and d.active and private.has_access($1,'reports.read',d.id)) allowed",
      [tenantId],
    )
  ).rows[0]?.allowed;
  if (!canReport) return { ...result, summary: null };
  const summary = (
    await db.query(
      `with matched as (
    select document_status,hacienda_status,options,snapshot from public.electronic_invoices where ${where}
      and private.has_access(tenant_id,'reports.read',department_id)
  ), accepted as (
    select snapshot->>'currency' currency,options->>'sale_condition' sale_condition,
      (snapshot->'totals'->>'total')::numeric total,
      (snapshot->'totals'->>'tax')::numeric - coalesce(snapshot->'totals'->>'exonerations','0')::numeric tax
    from matched where document_status='issued' and hacienda_status='accepted'
      and snapshot->'totals'->>'status'='complete'
      and snapshot->'totals'->>'total' ~ '^[0-9]+([.][0-9]{1,5})?$'
      and snapshot->'totals'->>'tax' ~ '^[0-9]+([.][0-9]{1,5})?$'
      and coalesce(snapshot->'totals'->>'exonerations','0') ~ '^[0-9]+([.][0-9]{1,5})?$'
  ) select jsonb_build_object('counts',(
    select jsonb_build_object(
      'prepared',count(*) filter(where document_status='prepared'),
      'accepted',count(*) filter(where document_status='issued' and hacienda_status='accepted'),
      'rejected',count(*) filter(where document_status='issued' and hacienda_status='rejected'),
      'pending',count(*) filter(where document_status='issued' and hacienda_status='pending'),
      'cash',count(*) filter(where document_status='issued' and hacienda_status='accepted' and options->>'sale_condition'='01'),
      'credit',count(*) filter(where document_status='issued' and hacienda_status='accepted' and options->>'sale_condition'='02')
    ) from matched), 'amounts',coalesce((
      select jsonb_agg(a order by a.currency) from (
        select currency,sum(total)::text total,sum(tax)::text tax,
          coalesce(sum(total) filter(where sale_condition='01'),0)::text cash,
          coalesce(sum(total) filter(where sale_condition='02'),0)::text credit
        from accepted group by currency
      ) a
    ),'[]'::jsonb)) summary`,
      values,
    )
  ).rows[0].summary;
  return { ...result, summary };
}
