import { validateHaciendaResponseSchema } from "./hacienda-response-schema";
import { verifyInvoiceSignature } from "../security/invoice-signature";
import type pg from "pg";
import { createHash, X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AppConfig } from "../config";
import {
  EmissionJobs,
  type Job,
  type JobKind,
  type JobTrustEligibility,
} from "./emission-jobs";
import { EmissionWorkerStore } from "./emission-worker-store";
import { parseKeyring, decryptCredential } from "../security/credential-vault";
import { generateInvoiceXml } from "./invoice-xml";
import { signInvoicePkcs12 } from "../security/invoice-pkcs12-signing";
import { validateSignedInvoiceXml } from "./invoice-schema-validation";
import { HaciendaTokenSession } from "./hacienda-token-session";
import { HaciendaReception } from "./hacienda-reception";
import {
  verifyHaciendaResponse,
  verifyOfficialApiHaciendaResponse,
  readHaciendaResponseEvidence,
} from "./hacienda-response";
import { enabledEmissionEnvironments } from "./emission-settings";
import type { HaciendaEnvironment } from "../../../../packages/domain/src/hacienda-environment";
import { renderInvoicePdf } from "./invoice-pdf";
import { InvoiceMail } from "./invoice-mail";
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const fail = () => {
  throw Error("EMISSION_BLOCKED");
};
const POLICY_URL =
  "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/Resoluci%C3%B3n_General_sobre_disposiciones_t%C3%A9cnicas_comprobantes_electr%C3%B3nicos_para_efectos_tributarios.pdf";
const POLICY_HASH =
  "0d6c629f5c5639e23c3ae5905dace1e158cb5806822c003de787a6ec3321d21f";
export class EmissionPipeline {
  private readonly deps: any;
  private readonly settings: any;
  constructor(
    private readonly pool: pg.Pool,
    private readonly config: AppConfig,
    overrides?: object,
  ) {
    if (overrides && config.NODE_ENV !== "test")
      throw Error("TEST_OVERRIDES_ONLY");
    this.settings = config;
    this.deps = {
      jobs: new EmissionJobs(pool),
      store: new EmissionWorkerStore(pool),
      generate: generateInvoiceXml,
      sign: signInvoicePkcs12,
      validate: validateSignedInvoiceXml,
      verify: verifyHaciendaResponse,
      verifyOfficial: verifyOfficialApiHaciendaResponse,
      readEvidence: readHaciendaResponseEvidence,
      validateResponse: validateHaciendaResponseSchema,
      verifyInvoice: verifyInvoiceSignature,
      pdf: renderInvoicePdf,
      tokens: new HaciendaTokenSession({ environment: config.NODE_ENV }),
      reception: new HaciendaReception(),
      ...overrides,
    };
  }
  private enabled(
    environment: HaciendaEnvironment,
    policy = this.settings.HACIENDA_RESPONSE_TRUST_POLICY ??
      "pinned_certificate",
  ) {
    const c = this.settings;
    let pins: unknown;
    if (policy === "pinned_certificate") {
      try {
        pins = JSON.parse(
          (environment === "production"
            ? c.HACIENDA_PRODUCTION_RESPONSE_CERTIFICATE_PINS
            : c.HACIENDA_RESPONSE_CERTIFICATE_PINS) ?? "[]",
        );
      } catch {
        fail();
      }
    }
    if (
      !enabledEmissionEnvironments(c).includes(environment) ||
      !/^\d{9,12}$/.test(c.HACIENDA_SOFTWARE_PROVIDER_ID ?? "") ||
      !["official_api", "pinned_certificate"].includes(policy) ||
      (policy === "pinned_certificate" &&
        (!Array.isArray(pins) ||
          !pins.length ||
          !pins.every(
            (p) => typeof p === "string" && /^[a-f0-9]{64}$/i.test(p),
          ))) ||
      (policy === "official_api" &&
        process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") ||
      !parseKeyring(c.HACIENDA_KEYRING, c.HACIENDA_ACTIVE_KEY_ID, c.SESSION_KEY)
    )
      fail();
    return policy === "pinned_certificate" ? (pins as string[]) : [];
  }
  private async document(j: Job) {
    const d = await this.deps.store.document(j);
    if (
      !d ||
      d.id !== j.invoice_id ||
      d.tenant_id !== j.tenant_id ||
      !["test", "production"].includes(d.environment) ||
      d.environment !== j.environment ||
      d.document_status !== "issued"
    )
      fail();
    return d;
  }
  private async update(j: Job, p: object) {
    if (!(await this.deps.store.update(j, p))) fail();
  }
  private async observeResponse(
    j: Job,
    responseHash: string,
    evidence: any,
  ): Promise<void> {
    if (!evidence || evidence.synthetic !== false) fail();
    if (this.deps.observeResponse) {
      if (!(await this.deps.observeResponse(j, responseHash, evidence))) fail();
      return;
    }
    const r = await this.pool.query(
      "select private.emission_job_observe_response($1,$2,$3,$4::jsonb) id",
      [j.id, j.lease_token, responseHash, JSON.stringify(evidence)],
    );
    if (!r.rows[0]?.id) fail();
  }
  private async artifact(
    j: Job,
    kind: string,
    content?: Buffer,
  ): Promise<Buffer | undefined> {
    if (this.deps.artifact) return this.deps.artifact(j, kind, content);
    const db = await this.pool.connect();
    try {
      await db.query("begin");
      // Lock the lease and document together; lease expiry and content changes cannot race insertion.
      const lease = await db.query(
        "select id from private.emission_jobs where id=$1 and lease_token=$2 and status='leased' and lease_until>now() for update",
        [j.id, j.lease_token],
      );
      if (!lease.rowCount) fail();
      const allowed = await db.query(
        "select id from private.emission_job_document($1,$2)",
        [j.id, j.lease_token],
      );
      if (!allowed.rowCount) fail();
      const old = await db.query(
        "select content,sha256 from private.invoice_artifacts where tenant_id=$1 and invoice_id=$2 and kind=$3",
        [j.tenant_id, j.invoice_id, kind],
      );
      const hashes = new Set(old.rows.map((r) => r.sha256));
      if (hashes.size > 1) fail();
      if (old.rows.length) {
        const value = old.rows[0].content as Buffer;
        if (
          hash(value) !== old.rows[0].sha256 ||
          (content && hash(content) !== hash(value))
        )
          fail();
        await db.query("commit");
        return value;
      }
      if (content) {
        const result = await db.query(
          `insert into private.invoice_artifacts(tenant_id,invoice_id,kind,content,sha256)
    select $3,$4,$5,$6,$7 from private.emission_job_document($1,$2) d where d.id=$4 and d.tenant_id=$3
    and exists(select 1 from private.emission_jobs j where j.id=$1 and j.lease_token=$2 and j.status='leased' and j.lease_until>now()) returning id`,
          [
            j.id,
            j.lease_token,
            j.tenant_id,
            j.invoice_id,
            kind,
            content,
            hash(content),
          ],
        );
        if (!result.rowCount) fail();
      }
      await db.query("commit");
      return content;
    } catch (e) {
      await db.query("rollback");
      throw e;
    } finally {
      db.release();
    }
  }
  private async next(j: Job, kind: JobKind) {
    if (this.deps.enqueue) return this.deps.enqueue(j, kind);
    const db = await this.pool.connect();
    try {
      await db.query("begin");
      const r = await db.query(
        "select id from private.emission_jobs where id=$1 and lease_token=$2 and status='leased' and lease_until>now() for update",
        [j.id, j.lease_token],
      );
      if (!r.rowCount) fail();
      if (
        !(
          await db.query(
            "select id from private.emission_job_document($1,$2)",
            [j.id, j.lease_token],
          )
        ).rowCount
      )
        fail();
      await this.deps.jobs.enqueue(db, {
        tenantId: j.tenant_id,
        invoiceId: j.invoice_id,
        kind,
      });
      await db.query("commit");
    } catch (e) {
      await db.query("rollback");
      throw e;
    } finally {
      db.release();
    }
  }
  private async credential<T>(
    j: Job,
    kind: "pkcs12" | "api_access",
    use: (value: any) => Promise<T>,
  ) {
    const row = await this.deps.store.credentials(j);
    if (
      !row ||
      row.tenant_id !== j.tenant_id ||
      row.environment !== j.environment
    )
      fail();
    const d = await this.document(j);
    if (
      row.version !== d.credential_version ||
      row.environment !== d.environment
    )
      fail();
    const keyring = parseKeyring(
      this.settings.HACIENDA_KEYRING,
      this.settings.HACIENDA_ACTIVE_KEY_ID,
      this.settings.SESSION_KEY,
    );
    if (!keyring) fail();
    const prefix = kind === "pkcs12" ? "pkcs12" : "api";
    let plain: Buffer | undefined;
    let value: any;
    try {
      plain = decryptCredential(
        { keyId: row[prefix + "_key_id"], blob: row[prefix + "_ciphertext"] },
        {
          tenantId: j.tenant_id,
          environment: d.environment,
          version: row.version,
          kind,
        },
        keyring!,
      );
      value = JSON.parse(plain.toString());
      return await use(value);
    } finally {
      plain?.fill(0);
      if (value) for (const k of Object.keys(value)) value[k] = "";
    }
  }
  private input(d: any) {
    return {
      environment: d.environment,
      snapshot: d.snapshot,
      options: d.options,
      clave: d.clave,
      consecutivo: d.consecutivo,
      issued_at: new Date(d.issued_at).toISOString(),
      software_provider_id: this.settings.HACIENDA_SOFTWARE_PROVIDER_ID,
    };
  }
  private async execute(j: Job) {
    const d = await this.document(j);
    const policy = d.response_trust_policy ?? "pinned_certificate";
    const pins = this.enabled(d.environment, policy);
    if (j.kind === "sign") {
      let signed = await this.artifact(j, "signed_xml");
      let certificate = d.public_certificate_pem;
      if (!signed) {
        const provenance = JSON.parse(
          await readFile(
            resolve(
              "docs/reference/hacienda/v4.4/signature-policy.provenance.json",
            ),
            "utf8",
          ),
        );
        const policy = await readFile(
          resolve("docs/reference/hacienda/v4.4/signature-policy.pdf"),
        );
        if (
          provenance.source_url !== POLICY_URL ||
          hash(policy) !== POLICY_HASH ||
          provenance.sha256 !== POLICY_HASH ||
          Buffer.from(POLICY_HASH, "hex").toString("base64") !==
            provenance.sha256_base64
        )
          fail();
        const result = await this.credential(j, "pkcs12", async (v) => {
          if (typeof v.pkcs12_base64 !== "string" || typeof v.pin !== "string")
            fail();
          const bytes = Buffer.from(v.pkcs12_base64, "base64");
          try {
            return await this.deps.sign({
              xml: this.deps.generate(this.input(d)),
              pkcs12: bytes,
              pin: v.pin,
              signedAt: this.input(d).issued_at,
              policy: {
                url: POLICY_URL,
                sha256Base64: provenance.sha256_base64,
              },
            });
          } finally {
            bytes.fill(0);
          }
        });
        certificate = result.certificatePem;
        if (
          new X509Certificate(certificate).fingerprint256
            .replaceAll(":", "")
            .toLowerCase() !==
          d.certificate_fingerprint?.replaceAll(":", "").toLowerCase()
        )
          fail();
        if (!(await this.deps.validate(result.signedXml)).valid) fail();
        signed = Buffer.from(result.signedXml);
        await this.artifact(j, "signed_xml", signed);
      }
      // A crash after artifact insertion may leave no public certificate: recover it from
      // the already signed XML rather than signing the document a second time.
      if (!certificate) {
        const match = signed
          .toString()
          .match(
            /<(?:\w+:)?X509Certificate\b[^>]*>([A-Za-z0-9+/=\s]+)<\/(?:\w+:)?X509Certificate>/,
          );
        if (!match) fail();
        certificate =
          "-----BEGIN CERTIFICATE-----\n" +
          match![1].replace(/\s/g, "") +
          "\n-----END CERTIFICATE-----";
      }
      if (
        new X509Certificate(certificate).fingerprint256
          .replaceAll(":", "")
          .toLowerCase() !==
          d.certificate_fingerprint?.replaceAll(":", "").toLowerCase() ||
        !this.deps.verifyInvoice(signed.toString(), certificate) ||
        !(await this.deps.validate(signed.toString())).valid
      )
        fail();
      await this.update(j, {
        signature_status: "signed",
        public_certificate_pem: certificate,
        transmission_status: "queued",
      });
      await this.next(j, "transmit");
    } else if (j.kind === "transmit" || j.kind === "query") {
      if (d.signature_status !== "signed") fail();
      if (
        j.kind === "transmit" &&
        ["uncertain", "sent", "processing"].includes(d.transmission_status)
      ) {
        await this.next(j, "query");
        return;
      }
      const xml = await this.artifact(j, "signed_xml");
      if (!xml) fail();
      await this.credential(j, "api_access", async (access) => {
        if (
          typeof access.username !== "string" ||
          typeof access.password !== "string"
        )
          fail();
        await this.deps.tokens.withAccess(
          access,
          async (token: string) => {
            await this.document(j);
            if (j.kind === "transmit") {
              if (d.transmission_status !== "queued") fail();
              await this.update(j, { transmission_status: "uncertain" });
              const s = d.snapshot;
              const identity = (x: any) => ({
                tipoIdentificacion: x.identification_type,
                numeroIdentificacion: x.identification,
              });
              const result = await this.deps.reception.submit(
                token,
                {
                  clave: d.clave,
                  fecha: this.input(d).issued_at,
                  emisor: identity(s.issuer),
                  ...(s.receiver.identification
                    ? { receptor: identity(s.receiver) }
                    : {}),
                  comprobanteXml: xml!.toString(),
                },
                d.environment,
              );
              if (
                result.status === "rejected_request" ||
                result.status === "authentication_failed"
              ) {
                await this.update(j, {
                  transmission_status: "technical_error",
                });
                throw Error("SUBMISSION_REJECTED");
              }
              await this.update(j, {
                transmission_status:
                  result.status === "received" ? "sent" : "uncertain",
              });
              await this.next(j, "query");
            } else {
              const context = {
                tenantId: j.tenant_id,
                environment: d.environment,
                credentialVersion: d.credential_version,
              };
              const result = await this.deps.reception.query(
                token,
                d.clave,
                d.environment,
                {
                  tenantId: j.tenant_id,
                  credentialVersion: d.credential_version,
                },
              );
              if (
                ["reported_accepted", "reported_rejected"].includes(
                  result.status,
                )
              ) {
                if (!result.responseXml) fail();
                // The official-API verifier performs this same full pinned XSD check.
                if (
                  policy === "pinned_certificate" &&
                  !(await this.deps.validateResponse(result.responseXml)).valid
                )
                  fail();
                const totals = d.snapshot.totals;
                const units = (s: string) => {
                  const [a, b = ""] = s.split(".");
                  return BigInt(a) * 100000n + BigInt(b.padEnd(5, "0"));
                };
                const tax = units(totals.tax) - units(totals.exonerations);
                const taxText = `${tax / 100000n}.${(tax % 100000n).toString().padStart(5, "0")}`;
                const expected = {
                  clave: d.clave,
                  issuerIdentification: d.snapshot.issuer.identification,
                  issuerIdentificationType:
                    d.snapshot.issuer.identification_type,
                  receiverIdentification: d.snapshot.receiver.identification,
                  receiverIdentificationType:
                    d.snapshot.receiver.identification_type,
                  total: totals.total,
                  tax: taxText,
                };
                const verified =
                  policy === "official_api"
                    ? await this.deps.verifyOfficial(result, expected, context)
                    : this.deps.verify(result.responseXml, expected, pins);
                const status =
                  result.status === "reported_accepted"
                    ? "accepted"
                    : "rejected";
                if (verified.status !== status) fail();
                await this.artifact(
                  j,
                  "hacienda_response",
                  Buffer.from(result.responseXml),
                );
                if (policy === "official_api")
                  await this.observeResponse(
                    j,
                    hash(Buffer.from(result.responseXml)),
                    this.deps.readEvidence(result, context),
                  );
                await this.update(j, {
                  hacienda_status: status,
                  transmission_status: "sent",
                });
                if (status === "accepted") await this.next(j, "pdf");
              } else if (result.status === "not_found") {
                throw Error("MANUAL_RECONCILIATION_REQUIRED");
              } else {
                if (result.status === "pending")
                  await this.update(j, { transmission_status: "processing" });
                throw Error("QUERY_RETRY");
              }
            }
          },
          d.environment,
        );
      });
    } else if (j.kind === "pdf") {
      if (d.hacienda_status !== "accepted") fail();
      if (!(await this.artifact(j, "pdf")))
        await this.artifact(
          j,
          "pdf",
          await this.deps.pdf({
            ...this.input(d),
            hacienda_status: "accepted",
          }),
        );
      if (
        d.snapshot.issuer.configuration?.billing?.send_email === true &&
        d.snapshot.receiver.email &&
        this.smtp()
      )
        await this.next(j, "email");
    } else if (j.kind === "email") {
      if (
        d.hacienda_status !== "accepted" ||
        d.snapshot.issuer.configuration?.billing?.send_email !== true ||
        !this.smtp()
      )
        fail();
      if (
        ["processing", "uncertain", "provider_accepted"].includes(
          d.email_status,
        )
      )
        throw Error("EMAIL_UNCERTAIN");
      const xml = await this.artifact(j, "signed_xml"),
        pdf = await this.artifact(j, "pdf"),
        response = await this.artifact(j, "hacienda_response");
      if (!xml || !pdf || !response) fail();
      await this.document(j);
      await this.update(j, { email_status: "processing" });
      const c = this.settings;
      const mail =
        this.deps.mail ??
        new InvoiceMail({
          host: c.SMTP_HOST,
          port: Number(c.SMTP_PORT),
          secure: c.SMTP_SECURE === "true",
          user: c.SMTP_USER,
          password: c.SMTP_PASSWORD,
          from: c.SMTP_FROM,
          environment: c.NODE_ENV === "test" ? "test" : "production",
        });
      const result = await mail.send({
        fiscalEnvironment: d.environment,
        invoiceId: d.email_dispatch_id
          ? `${d.id}:${d.email_dispatch_id}`
          : d.id,
        recipient: d.snapshot.receiver.email,
        companyName: d.snapshot.issuer.legal_name,
        xml,
        pdf,
        haciendaResponse: response,
      });
      await this.update(j, {
        email_status:
          result.status === "provider_accepted"
            ? "provider_accepted"
            : result.status === "rejected"
              ? "error"
              : "uncertain",
      });
      if (result.status !== "provider_accepted") throw Error("EMAIL_UNCERTAIN");
    }
  }
  private smtp() {
    const c = this.settings;
    return !!(c.SMTP_HOST && c.SMTP_PORT && c.SMTP_FROM);
  }
  async runBatch(limit = 1): Promise<{ processed: number }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 4)
      throw Error("INVALID_CLAIM_LIMIT");
    const eligible: JobTrustEligibility = {};
    const environments = enabledEmissionEnvironments(this.config).filter(
      (environment) => {
        eligible[environment] = (
          ["official_api", "pinned_certificate"] as const
        ).filter((policy) => {
          try {
            this.enabled(environment, policy);
            return true;
          } catch {
            return false;
          }
        });
        return eligible[environment]!.length > 0;
      },
    );
    if (!environments.length) return { processed: 0 };
    const jobs: Job[] = await this.deps.jobs.claim(
      limit,
      environments,
      eligible,
    );
    for (const j of jobs) {
      try {
        await this.execute(j);
        await this.deps.jobs.finish(j, { status: "completed" });
      } catch (e) {
        if (j.kind === "transmit") {
          try {
            const d = await this.document(j);
            if (d.transmission_status === "uncertain")
              await this.next(j, "query");
          } catch {
            /* Preserve the durable write-ahead marker when capability was revoked. */
          }
        }
        if (j.kind === "email") {
          try {
            const d = await this.document(j);
            if (d.email_status === "processing")
              await this.update(j, { email_status: "uncertain" });
          } catch {
            /* Reconciliation must retain the original effect marker. */
          }
        }
        const code =
          e instanceof Error &&
          [
            "QUERY_RETRY",
            "MANUAL_RECONCILIATION_REQUIRED",
            "EMAIL_UNCERTAIN",
            "SUBMISSION_REJECTED",
          ].includes(e.message)
            ? e.message
            : "EMISSION_STEP_FAILED";
        await this.deps.jobs.finish(j, {
          status:
            code === "QUERY_RETRY" && j.attempts < 8
              ? "pending"
              : code === "EMAIL_UNCERTAIN" || j.kind === "email"
                ? "uncertain"
                : "failed",
          errorCode: code,
          ...(code === "QUERY_RETRY" ? { retryInSeconds: 30 } : {}),
        });
      }
    }
    return { processed: jobs.length };
  }
}
