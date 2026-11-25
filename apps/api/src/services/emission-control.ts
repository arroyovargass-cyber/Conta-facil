import { generateInvoiceXml } from "./invoice-xml";
import type pg from "pg";
import { createHash, randomInt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppConfig } from "../config";
import { HttpError, requirePermission } from "../db";
import { prepareEmission } from "../../../../packages/domain/src/emission";
import type { InvoiceFiscalIssue } from "../../../../packages/domain/src/invoice-fiscal";
import {
  buildInvoiceClave,
  formatInvoiceNumber,
} from "../../../../packages/domain/src/invoice-numbering";
import { parseKeyring } from "../security/credential-vault";
import { haciendaEnvironmentInput } from "../../../../packages/domain/src/hacienda-environment";
import { enabledEmissionEnvironments } from "./emission-settings";

function validatorAvailable(): boolean {
  try {
    if (
      ![
        ".local/xmlschema-env/bin/python",
        "infra/invoice-validator-worker.py",
      ].every((p) => existsSync(resolve(p)))
    )
      return false;
    const raw = readFileSync(
      resolve("docs/reference/hacienda/v4.4/manifest.json"),
    );
    const manifest = JSON.parse(raw.toString("utf8"));
    // Same fixed package commitment as the isolated full signed XML worker.
    return (
      createHash("sha256").update(raw).digest("hex") ===
        "d4f65a9887c63fdaa10461ed106c3a16ba0172d36be03620d8e6aac3cca94474" &&
      manifest.runtime_use_allowed === true &&
      manifest.status === "official-package-revision-confirmed"
    );
  } catch {
    return false;
  }
}

async function metadata(db: pg.PoolClient, invoice: any) {
  return (
    await db.query("select private.invoice_emission_metadata($1,$2) metadata", [
      invoice.tenant_id,
      invoice.id,
    ])
  ).rows[0]?.metadata;
}
export async function emissionReadiness(
  db: pg.PoolClient,
  invoice: any,
  config: AppConfig,
): Promise<{ canEmit: boolean; issues: InvoiceFiscalIssue[] }> {
  const issues: InvoiceFiscalIssue[] = [];
  const add = (code: string, message: string) => issues.push({ code, message });
  const actor = (
    await db.query(
      "select private.has_access($1,'invoices.emit',$2) allowed, auth.jwt()->>'aal' aal",
      [invoice.tenant_id, invoice.department_id],
    )
  ).rows[0];
  if (!actor.allowed || actor.aal !== "aal2")
    add(
      "EMISSION_PERMISSION_REQUIRED",
      "La emisión requiere permiso y autenticación multifactor.",
    );
  if (invoice.document_status !== "prepared") {
    add(
      "ALREADY_ISSUED",
      "La factura ya fue emitida. Consulta sus estados y documentos conservados.",
    );
    return { canEmit: false, issues };
  }
  try {
    const p = prepareEmission({
      document_type: invoice.document_type,
      currency: invoice.snapshot.currency,
      receiver: invoice.snapshot.receiver,
      lines: invoice.snapshot.lines,
      options: invoice.options,
    });
    issues.push(...p.issues, ...(invoice.snapshot.preparation_issues ?? []));
  } catch {
    add(
      "PREPARATION_INVALID",
      "Actualiza la preparación fiscal de la factura.",
    );
  }
  const environment = haciendaEnvironmentInput.parse(invoice.environment),
    environmentLabel = environment === "production" ? "Producción" : "Pruebas";
  if (!enabledEmissionEnvironments(config).includes(environment))
    add(
      "EMISSION_DISABLED",
      `La emisión en ${environmentLabel} no está habilitada.`,
    );
  let keyring;
  try {
    keyring = parseKeyring(
      config.HACIENDA_KEYRING,
      config.HACIENDA_ACTIVE_KEY_ID,
      config.SESSION_KEY,
    );
  } catch {}
  if (!keyring)
    add("VAULT_UNAVAILABLE", "Configura la bóveda de credenciales.");
  if (!/^[0-9]{9,12}$/.test(config.HACIENDA_SOFTWARE_PROVIDER_ID ?? ""))
    add(
      "SOFTWARE_PROVIDER_REQUIRED",
      "Configura la identificación del proveedor del sistema.",
    );
  const trustPolicy =
    config.HACIENDA_RESPONSE_TRUST_POLICY ?? "pinned_certificate";
  if (trustPolicy === "pinned_certificate") {
    let pins: unknown;
    try {
      pins = JSON.parse(
        (environment === "production"
          ? config.HACIENDA_PRODUCTION_RESPONSE_CERTIFICATE_PINS
          : config.HACIENDA_RESPONSE_CERTIFICATE_PINS) ?? "",
      );
    } catch {}
    if (
      !Array.isArray(pins) ||
      !pins.length ||
      !pins.every((p) => typeof p === "string" && /^[a-f0-9]{64}$/i.test(p))
    )
      add(
        "RESPONSE_TRUST_REQUIRED",
        "Configura la confianza del certificado de respuesta.",
      );
  } else if (trustPolicy !== "official_api")
    add(
      "RESPONSE_TRUST_REQUIRED",
      "Configura una política válida de confianza de respuesta.",
    );
  if (
    trustPolicy === "official_api" &&
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
  )
    add(
      "RESPONSE_TLS_REQUIRED",
      "Activa la verificación TLS para consultar la API oficial de Hacienda.",
    );
  const m = await metadata(db, invoice),
    cert = m?.certificate_metadata,
    company = m?.company;
  if (!m?.credential_version || m.api_status !== "success")
    add(
      "CREDENTIALS_UNVERIFIED",
      `Verifica las credenciales y la conexión en ${environmentLabel}.`,
    );
  const now = Date.now();
  if (
    cert?.technical_status !== "valid_local" ||
    !(
      Date.parse(cert?.valid_from) <= now && Date.parse(cert?.valid_until) > now
    ) ||
    !/^[a-f0-9]{64}$/i.test(String(cert?.fingerprint ?? "").replace(/:/g, ""))
  )
    add(
      "CERTIFICATE_INVALID",
      "Verifica la vigencia y validez técnica del certificado.",
    );
  // This is an administrative review, never a claim of identity attestation by Hacienda.
  const enrollment = m?.enrollment;
  if (
    enrollment?.status !== "operator_verified" ||
    enrollment.environment !== environment ||
    !Number.isInteger(enrollment?.version) ||
    enrollment.version !== m?.credential_version ||
    !Number.isFinite(Date.parse(enrollment?.confirmed_at)) ||
    !company?.identification ||
    !company?.identification_type ||
    enrollment.issuer_identification !== company.identification ||
    enrollment.issuer_identification_type !== company.identification_type ||
    enrollment.certificate_fingerprint !==
      String(cert?.fingerprint ?? "")
        .replace(/:/g, "")
        .toLowerCase()
  )
    add(
      "CERTIFICATE_ENROLLMENT_REQUIRED",
      "El superadministrador debe registrar la revisión administrativa de la llave vigente para esta empresa y ambiente. Esta revisión no verifica la identidad ante Hacienda.",
    );
  if (!m?.numbering?.confirmed_at)
    add(
      "NUMBERING_UNCONFIRMED",
      `El propietario debe confirmar explícitamente la numeración en ${environmentLabel}.`,
    );
  if (
    !company ||
    company.configuration_version !==
      invoice.snapshot?.issuer?.configuration_version ||
    company.identification !== invoice.snapshot?.issuer?.identification ||
    company.identification_type !==
      invoice.snapshot?.issuer?.identification_type
  )
    add(
      "ISSUER_SNAPSHOT_STALE",
      "La empresa cambió: actualiza la preparación antes de emitir.",
    );
  const catalog = { activity: m?.activity, terminal: m?.terminal };
  if (!catalog.activity)
    add(
      "ISSUER_ACTIVITY_INACTIVE",
      "Confirma una actividad económica activa del emisor.",
    );
  if (!catalog.terminal)
    add(
      "TERMINAL_INACTIVE",
      "Confirma una sucursal y terminal activas de la empresa.",
    );
  if (!validatorAvailable())
    add(
      "XML_VALIDATOR_UNAVAILABLE",
      "Instala y verifica el validador completo de XML firmado.",
    );
  if (
    company?.send_email === true &&
    invoice.snapshot?.receiver?.email &&
    (!config.SMTP_HOST || !config.SMTP_PORT || !config.SMTP_FROM)
  )
    add("SMTP_UNAVAILABLE", "Configura el correo de entrega antes de emitir.");
  if (/^[1-9][0-9]{8,11}$/.test(config.HACIENDA_SOFTWARE_PROVIDER_ID ?? "")) {
    try {
      const next = BigInt(String(m?.numbering?.last_value ?? "0")) + 1n;
      if (next > 9999999999n)
        add("NUMBERING_EXHAUSTED", "La numeración está agotada.");
      else {
        // Preflight is discarded: it reserves nothing and is never signed or transmitted.
        const issuedAt = new Date();
        const consecutivo = formatInvoiceNumber({
          branch: invoice.options.branch_code,
          terminal: invoice.options.terminal_code,
          sequence: next,
        });
        const clave = buildInvoiceClave({
          consecutivo,
          issuerIdentification: invoice.snapshot.issuer.identification,
          issuedAt,
          securityCode: "00000000",
        });
        generateInvoiceXml({
          snapshot: invoice.snapshot,
          options: invoice.options,
          clave,
          consecutivo,
          issued_at: issuedAt.toISOString(),
          software_provider_id: config.HACIENDA_SOFTWARE_PROVIDER_ID!,
        });
      }
    } catch {
      add(
        "XML_PREFLIGHT_FAILED",
        "Corrige los datos del emisor, receptor o detalle antes de generar el XML.",
      );
    }
  }
  return { canEmit: issues.length === 0, issues };
}

/** Caller owns the transaction. Row lock also protects callers that did not pre-lock. */
export async function issuePreparedInvoice(
  db: pg.PoolClient,
  invoice: any,
  operationId: string,
  actorId: string,
  config: AppConfig,
  productionConfirmation = false,
): Promise<any> {
  const fresh = (
    await db.query(
      "select * from public.electronic_invoices where tenant_id=$1 and id=$2 for update",
      [invoice.tenant_id, invoice.id],
    )
  ).rows[0];
  if (!fresh) throw new HttpError(404, "Factura no encontrada.");
  await requirePermission(
    db,
    fresh.tenant_id,
    "invoices.emit",
    fresh.department_id,
  );
  const auth = (
    await db.query("select auth.uid() actor, auth.jwt()->>'aal' aal")
  ).rows[0];
  if (auth.aal !== "aal2" || auth.actor !== actorId)
    throw new HttpError(
      403,
      "Confirma tu identidad con autenticación multifactor.",
    );
  if (
    haciendaEnvironmentInput.parse(fresh.environment) !==
    haciendaEnvironmentInput.parse(invoice.environment)
  )
    throw new HttpError(
      409,
      "El ambiente de la factura cambió. Recarga antes de confirmar.",
    );
  if (fresh.document_status === "issued") return fresh;
  if (fresh.version !== invoice.version)
    throw new HttpError(409, "La factura cambió. Recarga antes de confirmar.");
  if (fresh.environment === "production" && productionConfirmation !== true)
    throw new HttpError(
      409,
      "Confirma expresamente que esta factura corresponde a una operación real de Producción.",
    );
  // Custody replacement and issuer edits take a tenant write lock. Keep the
  // reviewed key and company identity stable through readiness and issuance.
  await db.query("select id from public.tenants where id=$1 for share", [
    fresh.tenant_id,
  ]);
  const readiness = await emissionReadiness(db, fresh, config);
  if (!readiness.canEmit)
    throw new HttpError(
      409,
      readiness.issues[0]?.message ?? "La factura requiere revisión.",
    );
  const m = await metadata(db, fresh);
  const seq = (
    await db.query(
      `update private.emission_sequences set last_value=last_value+1 where tenant_id=$1 and environment=$2 and branch_code=$3 and terminal_code=$4 and confirmed_at is not null and last_value<9999999999 returning last_value`,
      [
        fresh.tenant_id,
        fresh.environment,
        fresh.options.branch_code,
        fresh.options.terminal_code,
      ],
    )
  ).rows[0];
  if (!seq)
    throw new HttpError(
      409,
      "La numeración no está confirmada o está agotada.",
    );
  const consecutivo = formatInvoiceNumber({
      branch: fresh.options.branch_code,
      terminal: fresh.options.terminal_code,
      sequence: BigInt(seq.last_value),
    }),
    issuedAt = new Date();
  const clave = buildInvoiceClave({
    consecutivo,
    issuerIdentification: fresh.snapshot.issuer.identification,
    issuedAt,
    securityCode: randomInt(0, 100000000).toString().padStart(8, "0"),
  });
  const row = (
    await db.query(
      `update public.electronic_invoices set document_status='issued',signature_status='pending',transmission_status='queued',consecutivo=$3,clave=$4,issued_at=$5,credential_version=$6,certificate_fingerprint=$7,issue_operation_id=$8,issued_by=$9,response_trust_policy=$10,version=version+1 where tenant_id=$1 and id=$2 returning *`,
      [
        fresh.tenant_id,
        fresh.id,
        consecutivo,
        clave,
        issuedAt,
        m.credential_version,
        m.certificate_metadata.fingerprint.replace(/:/g, "").toLowerCase(),
        operationId,
        actorId,
        config.HACIENDA_RESPONSE_TRUST_POLICY ?? "pinned_certificate",
      ],
    )
  ).rows[0];
  if (!row)
    throw new HttpError(403, "No tienes permiso para emitir esta factura.");
  await db.query(
    "insert into private.emission_jobs(tenant_id,invoice_id,kind) values($1,$2,'sign') on conflict(tenant_id,invoice_id,kind) do nothing",
    [row.tenant_id, row.id],
  );
  await db.query(
    "insert into public.audit_events(tenant_id,actor_id,action,entity,entity_id,details) values($1,$2,'ISSUE_INVOICE','electronic_invoices',$3,jsonb_build_object('environment',$4::text,'consecutivo',$5::text,'credential_version',$6::int))",
    [
      row.tenant_id,
      actorId,
      row.id,
      row.environment,
      row.consecutivo,
      row.credential_version,
    ],
  );
  return row;
}
