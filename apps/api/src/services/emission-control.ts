import { frozenInvoiceCalculation, generateInvoiceXml } from "./invoice-xml";
import type pg from "pg";
import { z } from "zod";
import { createHash, randomInt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppConfig } from "../config";
import { HttpError, requirePermission } from "../db";
import { prepareEmission } from "../../../../packages/domain/src/emission";
import {
  receiverInput,
  type InvoiceFiscalIssue,
} from "../../../../packages/domain/src/invoice-fiscal";
import { receiverLocationIssues } from "./receiver-location";
import {
  buildInvoiceClave,
  formatInvoiceNumber,
} from "../../../../packages/domain/src/invoice-numbering";
import { parseKeyring } from "../security/credential-vault";
import { haciendaEnvironmentInput } from "../../../../packages/domain/src/hacienda-environment";
import { enabledEmissionEnvironments } from "./emission-settings";
import { invoiceEmailDeliveryEnabled } from "../../../../packages/domain/src/company";
import { fiscalLookups } from "./fiscal-lookups";

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
        "f2a60d6fdd046a3fd34aa98784e2eb04018d5d6ac7bc9067228f259e69d09490" &&
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
type Requirement = {
  code: string;
  label: string;
  status: "complete" | "pending" | "blocked" | "not_applicable";
  message: string;
  target?: "company" | "hacienda" | "invoice" | "numbering";
};
function requirements(
  issues: InvoiceFiscalIssue[],
  emailApplicable: boolean,
  cabysVerified: boolean,
  activitiesVerified: boolean,
  xmlVerified: boolean,
): Requirement[] {
  const definitions: [string, string, Requirement["target"], RegExp][] = [
    [
      "issuer",
      "Datos del emisor",
      "company",
      /ISSUER_ID|ISSUER_DETAILS|ISSUER_SNAPSHOT|COMPANY_|ISSUER_CONTACT/,
    ],
    ["location", "Domicilio fiscal", "company", /ISSUER_LOCATION/],
    ["activity", "Actividad económica activa", "company", /ISSUER_ACTIVITY/],
    ["branch", "Sucursal activa", "company", /BRANCH|TERMINAL_INACTIVE/],
    ["terminal", "Terminal activa", "company", /TERMINAL/],
    ["numbering", "Numeración confirmada", "numbering", /NUMBERING/],
    ["receiver", "Datos del receptor", "invoice", /RECEIVER|NATIONAL_RECEIVER/],
    ["cabys", "Códigos CABYS", "invoice", /CABYS/],
    [
      "tax",
      "Clasificación tributaria de las líneas",
      "invoice",
      /FISCAL_|TARIFF|TAX|IVA_|EXONER|TREATMENT|MEDIC|PHARMA|TRANSACTION|DISCOUNT/,
    ],
    [
      "totals",
      "Totales consistentes",
      "invoice",
      /TOTAL|CALCULATION|AMOUNT|ROUND|COMMERCIAL|QUANTITY|OTHER_CHARGE/,
    ],
    [
      "options",
      "Condición, moneda, pagos y referencias",
      "invoice",
      /CREDIT|PAYMENT|EXCHANGE|REFERENCE|DOCUMENT_TYPE/,
    ],
    ["permission", "Permiso de emisión", undefined, /EMISSION_PERMISSION/],
    ["mfa", "Autenticación multifactor", undefined, /MFA_REQUIRED/],
    [
      "credentials",
      "Credenciales API comprobadas",
      "hacienda",
      /CREDENTIALS|VAULT/,
    ],
    [
      "certificate",
      "Certificado vigente y válido localmente",
      "hacienda",
      /^CERTIFICATE_INVALID$/,
    ],
    [
      "enrollment",
      "Revisión administrativa de la llave",
      "hacienda",
      /CERTIFICATE_ENROLLMENT/,
    ],
    [
      "environment",
      "Ambiente y confianza de respuesta",
      "hacienda",
      /EMISSION_DISABLED|RESPONSE_/,
    ],
    [
      "provider",
      "Identificación del proveedor del sistema",
      undefined,
      /SOFTWARE_PROVIDER/,
    ],
    ["validator", "Validador XML disponible", undefined, /XML_VALIDATOR/],
    [
      "xml",
      "Preparación estructural del XML",
      "invoice",
      /XML_PREFLIGHT|PREPARATION_INVALID/,
    ],
    ["email", "Configuración de entrega por correo", "company", /SMTP_/],
  ];
  return definitions.map(([code, label, target, pattern]) => {
    const matching = issues.filter(
      (issue) =>
        pattern.test(issue.code) ||
        (code === "receiver" && issue.path?.startsWith("receiver")),
    );
    const notApplicable = code === "email" && !emailApplicable;
    const needsXmlReview =
      (code === "cabys" && !cabysVerified) ||
      (code === "xml" && !xmlVerified) ||
      (code === "activity" && !activitiesVerified) ||
      (["issuer", "location", "receiver", "cabys", "tax"].includes(code) &&
        issues.some((issue) => issue.code === "XML_PREFLIGHT_FAILED"));
    return {
      code,
      label,
      target,
      status: notApplicable
        ? "not_applicable"
        : matching.length
          ? "blocked"
          : needsXmlReview
            ? "pending"
            : "complete",
      message: notApplicable
        ? "Entrega automática no solicitada o receptor sin correo."
        : matching.length
          ? [...new Set(matching.map((issue) => issue.message))].join(" ")
          : needsXmlReview
            ? code === "activity"
              ? "La inscripción activa en Hacienda se verifica al completar los demás requisitos."
              : code === "cabys"
                ? "La existencia en el catálogo oficial se comprueba al completar los demás requisitos."
                : "Pendiente de resolver la preparación estructural del XML."
            : "Comprobado en la preparación actual; no demuestra aceptación de Hacienda.",
    };
  });
}
export async function emissionReadiness(
  db: pg.PoolClient,
  invoice: any,
  config: AppConfig,
): Promise<{
  canEmit: boolean;
  issues: InvoiceFiscalIssue[];
  requirements: Requirement[];
}> {
  const issues: InvoiceFiscalIssue[] = [];
  let cabysVerified = false;
  let activitiesVerified = false;
  let xmlVerified = false;
  const add = (code: string, message: string) => issues.push({ code, message });
  const actor = (
    await db.query(
      "select private.has_access($1,'invoices.emit',$2) allowed, nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal' aal",
      [invoice.tenant_id, invoice.department_id],
    )
  ).rows[0];
  if (!actor.allowed)
    add(
      "EMISSION_PERMISSION_REQUIRED",
      "No tienes permiso efectivo de emisión en este departamento. Revisa también la autenticación multifactor.",
    );
  if (actor.aal !== "aal2")
    add("MFA_REQUIRED", "Confirma tu identidad con autenticación multifactor.");
  if (invoice.document_status !== "prepared") {
    add(
      "ALREADY_ISSUED",
      "La factura ya fue emitida. Consulta sus estados y documentos conservados.",
    );
    return { canEmit: false, issues, requirements: [] };
  }
  const issuer = invoice.snapshot?.issuer ?? {},
    location = issuer.configuration?.location ?? {};
  const ids: Record<string, RegExp> = {
    "01": /^\d{9}$/,
    "02": /^\d{10}$/,
    "03": /^\d{11,12}$/,
    "04": /^\d{10}$/,
  };
  if (!ids[issuer.identification_type]?.test(issuer.identification ?? ""))
    add(
      "ISSUER_ID_REQUIRED",
      "Verifica el tipo oficial y el formato de la identificación tributaria del emisor.",
    );
  if (
    typeof issuer.legal_name !== "string" ||
    issuer.legal_name.length < 3 ||
    issuer.legal_name.length > 100 ||
    (issuer.trade_name &&
      (issuer.trade_name.length < 3 || issuer.trade_name.length > 80))
  )
    add(
      "ISSUER_DETAILS_INVALID",
      "Revisa los límites del nombre del emisor (3 a 100 caracteres) y del nombre comercial opcional (3 a 80).",
    );
  if (
    !z.email().safeParse(issuer.contact_email).success ||
    issuer.contact_email.length > 160
  )
    add(
      "ISSUER_CONTACT_REQUIRED",
      "Completa un correo válido del emisor de hasta 160 caracteres.",
    );
  if (
    !/^[1-7]$/.test(location.province ?? "") ||
    !/^\d{2}$/.test(location.canton ?? "") ||
    !/^\d{2}$/.test(location.district ?? "") ||
    typeof issuer.address !== "string" ||
    issuer.address.length < 5 ||
    issuer.address.length > 250 ||
    (location.neighborhood &&
      (location.neighborhood.length < 5 || location.neighborhood.length > 50))
  )
    add(
      "ISSUER_LOCATION_REQUIRED",
      "Completa provincia, cantón, distrito y otras señas del emisor (5 a 250 caracteres); el barrio opcional admite de 5 a 50.",
    );
  else {
    const locationIssues = await receiverLocationIssues(
      receiverInput.parse({
        domicile: "domestic",
        province: location.province,
        canton: location.canton,
        district: location.district,
        neighborhood: location.neighborhood ?? "",
        address: issuer.address,
      }),
    );
    if (locationIssues.length)
      add(
        "ISSUER_LOCATION_INVALID",
        "Domicilio fiscal del emisor: " + locationIssues[0].message,
      );
  }
  try {
    const documentType = invoice.snapshot.document_type ?? "FE";
    if (documentType !== invoice.document_type)
      add(
        "DOCUMENT_TYPE_MISMATCH",
        "Actualiza la preparación del tipo de comprobante seleccionado.",
      );
    const enabledDocuments =
      invoice.snapshot.issuer?.configuration?.billing?.documents;
    if (
      Array.isArray(enabledDocuments) &&
      !enabledDocuments.includes(documentType)
    )
      add(
        "DOCUMENT_TYPE_DISABLED",
        "El tipo de comprobante no está habilitado en Mi empresa. Revisa la configuración y actualiza la preparación.",
      );
    const p = prepareEmission({
      document_type: documentType,
      currency: invoice.snapshot.currency,
      receiver: invoice.snapshot.receiver,
      lines: invoice.snapshot.lines,
      other_charges: invoice.snapshot.other_charges ?? [],
      options: invoice.options,
    });
    issues.push(...p.issues, ...(invoice.snapshot.preparation_issues ?? []));
    if (
      invoice.snapshot.receiver?.identification &&
      !/^\d{1,12}$/.test(invoice.snapshot.receiver.identification)
    )
      add(
        "RECEIVER_TRANSPORT_UNSUPPORTED",
        "El identificador del receptor es válido en ciertos XML, pero no está soportado por el circuito de transmisión y respuesta actual. Conserva el borrador hasta completar ese perfil; no se asignará numeración.",
      );
    if (
      p.totals.status === "complete" &&
      !frozenInvoiceCalculation(invoice.snapshot)
    )
      add(
        "SNAPSHOT_TOTALS_MISMATCH",
        "Los totales guardados no coinciden con las líneas. Actualiza la preparación.",
      );
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
    invoiceEmailDeliveryEnabled(invoice.snapshot?.issuer?.configuration) &&
    invoice.snapshot?.receiver?.email &&
    (!config.SMTP_HOST || !config.SMTP_PORT || !config.SMTP_FROM)
  )
    add("SMTP_UNAVAILABLE", "Configura el correo de entrega antes de emitir.");
  if (/^[0-9]{9,12}$/.test(config.HACIENDA_SOFTWARE_PROVIDER_ID ?? "")) {
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
          documentType: invoice.document_type,
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
        xmlVerified = true;
      }
    } catch {
      add(
        "XML_PREFLIGHT_FAILED",
        "Corrige los datos del emisor, receptor o detalle antes de generar el XML.",
      );
    }
  }
  // Consult the official public catalog only after local/configuration checks
  // pass. Reuse its five-minute public cache; failure never consumes numbering.
  if (issues.length === 0) {
    activitiesVerified = true;
    const checks = [
      {
        role: "ISSUER",
        identification: invoice.snapshot.issuer.identification,
        code: invoice.options.issuer_activity,
      },
    ];
    if (
      invoice.document_type === "FE" &&
      invoice.snapshot.receiver.economic_activity
    )
      checks.push({
        role: "RECEIVER",
        identification: invoice.snapshot.receiver.identification,
        code: invoice.snapshot.receiver.economic_activity,
      });
    const registrations = new Map<
      string,
      Awaited<ReturnType<typeof fiscalLookups.recipient>>
    >();
    for (const check of checks) {
      let registration = registrations.get(check.identification);
      if (!registration) {
        registration = await fiscalLookups.recipient(check.identification);
        registrations.set(check.identification, registration);
      }
      if (
        !registration.available ||
        registration.recipient?.identification !== check.identification ||
        !registration.activities?.some(
          (activity) =>
            activity.code === check.code && activity.active === true,
        )
      ) {
        activitiesVerified = false;
        add(
          `${check.role}_ACTIVITY_UNVERIFIED`,
          `${check.role === "ISSUER" ? "Emisor" : "Receptor"}: no se pudo confirmar la actividad ${check.code} como inscrita y activa en la consulta oficial de Hacienda. Revisa la inscripción o vuelve a consultar; no se modifica el código automáticamente.`,
        );
      }
    }
  }
  if (issues.length === 0) {
    cabysVerified = true;
    const codes = new Set<string>(
      invoice.snapshot.lines
        .map((line: any) => line.fiscal?.cabys)
        .filter(Boolean),
    );
    for (const code of codes) {
      const result = await fiscalLookups.cabys(code);
      if (!result.available) {
        cabysVerified = false;
        add(
          "CABYS_CATALOG_UNAVAILABLE",
          "No se pudo verificar el catálogo oficial CABYS. Conserva la preparación y vuelve a comprobar antes de emitir.",
        );
        break;
      }
      if (!result.items.some((entry) => entry.code === code)) {
        cabysVerified = false;
        add(
          "CABYS_NOT_FOUND",
          `El código CABYS ${code} no aparece en la respuesta del catálogo oficial. Corrige la línea antes de emitir.`,
        );
      }
    }
  }
  return {
    canEmit: issues.length === 0,
    issues,
    requirements: requirements(
      issues,
      invoiceEmailDeliveryEnabled(invoice.snapshot?.issuer?.configuration) &&
        Boolean(invoice.snapshot?.receiver?.email),
      cabysVerified,
      activitiesVerified,
      xmlVerified,
    ),
  };
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
    await db.query(
      "select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid actor, nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal' aal",
    )
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
      `update private.emission_sequences set last_value=last_value+1 where tenant_id=$1 and environment=$2 and branch_code=$3 and terminal_code=$4 and document_type=$5 and confirmed_at is not null and last_value<9999999999 returning last_value`,
      [
        fresh.tenant_id,
        fresh.environment,
        fresh.options.branch_code,
        fresh.options.terminal_code,
        fresh.document_type,
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
      documentType: fresh.document_type,
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
