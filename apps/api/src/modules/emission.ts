import {
  emissionReadiness,
  issuePreparedInvoice,
} from "../services/emission-control";
import type { AppConfig } from "../config";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { createHash } from "node:crypto";
import {
  emissionOptionsInput,
  prepareEmission,
} from "../../../../packages/domain/src/emission";
import { receiverInput } from "../../../../packages/domain/src/invoice-fiscal";
import { scoped, requirePermission, HttpError } from "../db";
import { found, ids } from "./billing-common";
import { invoiceHistoryQuery, listInvoiceHistory } from "./invoice-history";
import type { identity } from "./identity";
import { receiverLocationIssues } from "../services/receiver-location";
import { haciendaEnvironmentInput } from "../../../../packages/domain/src/hacienda-environment";
const prepareInput = z
  .object({
    operation_id: z.uuid(),
    draft_id: z.uuid(),
    expected_version: z.int().positive(),
    options: emissionOptionsInput.optional(),
    environment: haciendaEnvironmentInput,
  })
  .strict();
const issueInput = z
  .object({
    operation_id: z.uuid(),
    version: z.int().positive(),
    production_confirmation: z.boolean().default(false),
  })
  .strict();
const issue = (code: string, message: string) => ({ code, message });
const requestHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function historicalPrepareHashes(input: z.infer<typeof prepareInput>) {
  if (
    !input.options ||
    input.options.references.length ||
    input.options.payment_methods.some((m) => m.other_description)
  )
    return [];
  const { references: _references, ...options } = input.options;
  const legacy = {
    ...input,
    options: {
      ...options,
      payment_methods: options.payment_methods.map(
        ({ other_description: _description, ...method }) => method,
      ),
    },
  };
  const { environment: _environment, ...withoutEnvironment } = legacy;
  return [
    requestHash(legacy),
    ...(input.environment === "test" ? [requestHash(withoutEnvironment)] : []),
  ];
}
async function decorate(db: pg.PoolClient, row: any, config: AppConfig) {
  return { ...row, readiness: await emissionReadiness(db, row, config) };
}
async function snapshotFromDraft(
  db: pg.PoolClient,
  tenantId: string,
  draft: any,
  options: z.infer<typeof emissionOptionsInput>,
) {
  const issuer = found(
    (
      await db.query(
        "select legal_name,trade_name,identification_type,identification,contact_email,phone,address,configuration,configuration_version from public.tenants where id=$1 and active",
        [tenantId],
      )
    ).rows[0],
  );
  const receiver = receiverInput.parse(draft.customer_snapshot),
    result = prepareEmission({
      document_type: draft.document_type,
      currency: draft.currency,
      receiver,
      lines: draft.lines,
      other_charges: draft.other_charges ?? [],
      options: options,
    });
  const preparation_issues = await receiverLocationIssues(receiver);
  // Missing issuer configuration remains explicit; preparing is not authorization to send.
  if (
    !issuer.identification ||
    !["01", "02", "03", "04", "national", "legal", "dimex", "nite"].includes(
      issuer.identification_type,
    )
  )
    preparation_issues.push(
      issue(
        "ISSUER_ID_REQUIRED",
        "Completa y verifica la identificación tributaria de la empresa emisora.",
      ),
    );
  if (!issuer.contact_email || !issuer.address)
    preparation_issues.push(
      issue(
        "ISSUER_CONTACT_REQUIRED",
        "Completa el correo y la dirección fiscal del emisor.",
      ),
    );
  const snapshot = {
    issuer,
    document_type: draft.document_type,
    receiver,
    currency: draft.currency,
    lines: draft.lines,
    other_charges: draft.other_charges ?? [],
    totals: result.totals,
    notes: draft.notes,
    prices_include_tax: false,
    calculation_version: "billing44-v2-line-half-up-5",
    preparation_issues,
  };

  return { snapshot, result };
}
export function emissionRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  auth: ReturnType<typeof identity>,
  config: AppConfig,
) {
  const base = "/api/companies/:tenantId/invoices";
  app.get(base, async (req) => {
    const p = await auth.authenticate(req);
    const { tenantId } = ids.parse(req.params),
      q = invoiceHistoryQuery.parse(req.query ?? {});
    return scoped(pool, p.claims, (db) => listInvoiceHistory(db, tenantId, q));
  });
  app.get(base + "/:id", async (req) => {
    const p = await auth.authenticate(req);
    const { tenantId, id } = ids.parse(req.params);
    return scoped(pool, p.claims, async (db) => {
      const row = found(
        (
          await db.query(
            "select * from public.electronic_invoices where tenant_id=$1 and id=$2",
            [tenantId, id],
          )
        ).rows[0],
      );
      const artifacts = (
        await db.query("select private.invoice_artifact_kinds($1,$2) kinds", [
          tenantId,
          id,
        ])
      ).rows[0].kinds;
      const collections_review =
        (
          await db.query(
            "select id,state,target_department_id from public.document_work_items where tenant_id=$1 and source_id=$2 and flow='collections' order by created_at desc limit 1",
            [tenantId, row.draft_id],
          )
        ).rows[0] ?? null;
      return {
        item: {
          ...(await decorate(db, row, config)),
          artifacts,
          collections_review,
        },
      };
    });
  });
  app.get(base + "/:id/artifacts/:kind", async (req, reply) => {
    const p = await auth.authenticate(req),
      { tenantId, id, kind } = z
        .object({
          tenantId: z.uuid(),
          id: z.uuid(),
          kind: z.enum(["signed_xml", "hacienda_response", "pdf"]),
        })
        .parse(req.params);
    const db = await pool.connect();
    try {
      await db.query("begin");
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify(p.claims),
      ]);
      const row = found(
        (
          await db.query(
            "select id,department_id,consecutivo from public.electronic_invoices where tenant_id=$1 and id=$2",
            [tenantId, id],
          )
        ).rows[0],
      );
      await requirePermission(
        db,
        tenantId,
        "invoices.download",
        row.department_id,
      );
      await db.query("reset role");
      const artifacts = (
        await db.query(
          "select content,sha256 from private.invoice_artifacts where tenant_id=$1 and invoice_id=$2 and kind=$3 order by created_at desc limit 2",
          [tenantId, id, kind],
        )
      ).rows;
      const artifact = found(artifacts[0]);
      if (
        artifacts.length > 1 ||
        createHash("sha256").update(artifact.content).digest("hex") !==
          artifact.sha256
      )
        throw new HttpError(
          409,
          "El documento requiere revisión de integridad antes de descargarlo.",
        );
      await requirePermission(
        db,
        tenantId,
        "invoices.download",
        row.department_id,
      );
      await db.query("commit");
      return reply
        .type(
          kind === "pdf" ? "application/pdf" : "application/xml; charset=utf-8",
        )
        .header(
          "Content-Disposition",
          `attachment; filename="${row.consecutivo ?? id}-${kind}.${kind === "pdf" ? "pdf" : "xml"}"`,
        )
        .send(artifact.content);
    } catch (e) {
      await db.query("rollback");
      throw e;
    } finally {
      db.release();
    }
  });
  app.post(base, { bodyLimit: 65536 }, async (req) => {
    const { tenantId } = ids.parse(req.params),
      input = prepareInput.parse(req.body),
      p = req.principal!;
    const db = await pool.connect();
    try {
      await db.query("begin");
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify(p.claims),
      ]);
      // Serialize a source conversion without requiring draft-edit authority.
      // The single SELECT below reads a coherent draft + lines snapshot; the
      // expected version pins the copy the caller requested to prepare.
      await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
        `${tenantId.toLowerCase()}:prepare:${input.draft_id.toLowerCase()}`,
      ]);
      const draft = found(
        (
          await db.query(
            "select d.*,coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('quantity',l.quantity::text,'unit_price',l.unit_price::text) order by l.position) from public.invoice_draft_lines l where l.tenant_id=d.tenant_id and l.draft_id=d.id),'[]'::jsonb) lines from public.invoice_drafts d where d.tenant_id=$1 and d.id=$2",
            [tenantId, input.draft_id],
          )
        ).rows[0],
      );
      await requirePermission(
        db,
        tenantId,
        "invoices.prepare",
        draft.department_id,
      );
      const hash = requestHash(input);
      // Previous test requests were hashed before environment was part of the contract.
      const { environment: _environment, ...legacyInput } = input;
      const legacyHash = requestHash(legacyInput);
      const replay = (
        await db.query(
          "select * from public.electronic_invoices where tenant_id=$1 and created_by=$2 and operation_id=$3",
          [tenantId, p.userId, input.operation_id],
        )
      ).rows[0];
      if (replay) {
        if (
          replay.environment !== input.environment ||
          (replay.request_hash !== hash &&
            !historicalPrepareHashes(input).includes(replay.request_hash) &&
            !(
              input.environment === "test" && replay.request_hash === legacyHash
            ))
        )
          throw new HttpError(
            409,
            "Esta operación ya se utilizó con otros datos.",
          );
        const item = await decorate(db, replay, config);
        await db.query("commit");
        return { item };
      }
      if (draft.version !== input.expected_version)
        throw new HttpError(
          409,
          "El borrador cambió. Recarga antes de preparar la factura.",
        );
      if (draft.archived_at)
        throw new HttpError(
          409,
          "Restaura el borrador antes de preparar la factura.",
        );
      if (!["FE", "TE"].includes(draft.document_type))
        throw new HttpError(
          400,
          "Este módulo admite factura y tiquete electrónico nacional.",
        );
      const old = (
        await db.query(
          "select * from public.electronic_invoices where tenant_id=$1 and draft_id=$2 and environment=$3",
          [tenantId, draft.id, input.environment],
        )
      ).rows[0];
      if (old) {
        if (old.draft_version !== draft.version)
          throw new HttpError(
            409,
            "Ya existe una preparación de una versión anterior. Ábrela y usa Editar preparación para actualizar su copia.",
          );
        if (
          JSON.stringify(emissionOptionsInput.parse(old.options)) !==
          JSON.stringify(
            emissionOptionsInput.parse({
              ...(input.options ?? draft.commercial ?? {}),
              exchange_rate:
                draft.currency === "CRC"
                  ? "1"
                  : (input.options ?? draft.commercial ?? {}).exchange_rate,
            }),
          )
        )
          throw new HttpError(
            409,
            "Ya existe una factura preparada desde este borrador con otras opciones.",
          );
        const item = await decorate(db, old, config);
        await db.query("commit");
        return { item };
      }
      const { snapshot, result } = await snapshotFromDraft(
        db,
        tenantId,
        draft,
        emissionOptionsInput.parse(input.options ?? draft.commercial ?? {}),
      );
      await db.query("reset role");
      const row = (
        await db.query(
          "insert into public.electronic_invoices(tenant_id,draft_id,draft_version,department_id,snapshot,options,created_by,operation_id,request_hash,environment,document_type) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *",
          [
            tenantId,
            draft.id,
            draft.version,
            draft.department_id,
            snapshot,
            result.options,
            p.userId,
            input.operation_id,
            hash,
            input.environment,
            draft.document_type,
          ],
        )
      ).rows[0];
      await requirePermission(
        db,
        tenantId,
        "invoices.prepare",
        draft.department_id,
      );
      const item = await decorate(db, row, config);
      await db.query("commit");
      return { item };
    } catch (e) {
      await db.query("rollback");
      throw e;
    } finally {
      db.release();
    }
  });
  app.patch(base + "/:id", async (req) => {
    const { tenantId, id } = ids.parse(req.params),
      input = z
        .object({
          version: z.int().positive(),
          expected_version: z.int().positive(),
          options: emissionOptionsInput.optional(),
        })
        .strict()
        .parse(req.body),
      p = req.principal!;
    const db = await pool.connect();
    try {
      await db.query("begin");
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify(p.claims),
      ]);
      const old = found(
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
        "invoices.prepare",
        old.department_id,
      );
      if (old.version !== input.version)
        throw new HttpError(
          409,
          "La preparación cambió. Recarga antes de guardar.",
        );
      if (
        old.document_status !== "prepared" ||
        old.transmission_status !== "not_sent"
      )
        throw new HttpError(
          409,
          "Un comprobante emitido o enviado no puede editarse.",
        );
      const draft = found(
        (
          await db.query(
            "select d.*,coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('quantity',l.quantity::text,'unit_price',l.unit_price::text) order by l.position) from public.invoice_draft_lines l where l.tenant_id=d.tenant_id and l.draft_id=d.id),'[]'::jsonb) lines from public.invoice_drafts d where d.tenant_id=$1 and d.id=$2 for update of d",
            [tenantId, old.draft_id],
          )
        ).rows[0],
      );
      if (draft.version !== input.expected_version)
        throw new HttpError(
          409,
          "El borrador cambió. Recarga antes de actualizar la copia.",
        );
      if (
        draft.archived_at ||
        draft.document_type !== old.document_type ||
        draft.department_id !== old.department_id
      )
        throw new HttpError(
          409,
          "El origen debe ser un borrador activo del mismo tipo y departamento.",
        );
      const { snapshot, result } = await snapshotFromDraft(
        db,
        tenantId,
        draft,
        emissionOptionsInput.parse(input.options ?? draft.commercial ?? {}),
      );
      await db.query("reset role");
      const row = (
        await db.query(
          "update public.electronic_invoices set snapshot=$3,options=$4,draft_version=$5,version=version+1 where tenant_id=$1 and id=$2 and version=$6 returning *",
          [
            tenantId,
            id,
            snapshot,
            result.options,
            draft.version,
            input.version,
          ],
        )
      ).rows[0];
      if (!row)
        throw new HttpError(
          409,
          "La preparación cambió. Recarga antes de guardar.",
        );
      const item = await decorate(db, row, config);
      await db.query("commit");
      return { item };
    } catch (e) {
      await db.query("rollback");
      throw e;
    } finally {
      db.release();
    }
  });
  app.post(base + "/:id/issue", async (req) => {
    const { tenantId, id } = ids.parse(req.params),
      input = issueInput.parse(req.body),
      p = req.principal!;
    const db = await pool.connect();
    try {
      await db.query("begin");
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify(p.claims),
      ]);
      const old = found(
        (
          await db.query(
            "select * from public.electronic_invoices where tenant_id=$1 and id=$2",
            [tenantId, id],
          )
        ).rows[0],
      );
      await requirePermission(db, tenantId, "invoices.emit", old.department_id);
      if (old.document_status !== "issued" && old.version !== input.version)
        throw new HttpError(
          409,
          "La factura cambió. Recarga antes de confirmar.",
        );
      await db.query("reset role");
      const row = await issuePreparedInvoice(
        db,
        old,
        input.operation_id,
        p.userId,
        config,
        input.production_confirmation,
      );
      const item = await decorate(db, row, config);
      await db.query("commit");
      return { item };
    } catch (e) {
      await db.query("rollback");
      throw e;
    } finally {
      db.release();
    }
  });
}
