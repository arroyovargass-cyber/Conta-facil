import { afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import {
  emissionReadiness,
  issuePreparedInvoice,
} from "../apps/api/src/services/emission-control";
import { xmlFixture } from "./support/invoice-fixture";

const tlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
afterEach(() => {
  if (tlsSetting === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  else process.env.NODE_TLS_REJECT_UNAUTHORIZED = tlsSetting;
});

function fixture(environment = "test") {
  const xml = xmlFixture();
  const invoice = {
    id: randomUUID(),
    tenant_id: randomUUID(),
    department_id: randomUUID(),
    environment,
    document_type: "FE",
    document_status: "prepared",
    version: 1,
    snapshot: {
      ...xml.snapshot,
      issuer: { ...xml.snapshot.issuer, configuration_version: 1 },
      preparation_issues: [],
    },
    options: xml.options,
  };
  const actorId = randomUUID();
  const metadata: any = {
    credential_version: 1,
    api_status: "success",
    certificate_metadata: {
      technical_status: "valid_local",
      identity_status: "pending",
      fingerprint: "a".repeat(64),
      valid_from: "2020-01-01",
      valid_until: "2099-01-01",
    },
    enrollment: {
      status: "operator_verified",
      environment,
      version: 1,
      issuer_identification: invoice.snapshot.issuer.identification,
      issuer_identification_type: invoice.snapshot.issuer.identification_type,
      certificate_fingerprint: "a".repeat(64),
      confirmed_at: "2026-11-25T00:00:00Z",
    },
    company: {
      configuration_version: 1,
      identification: invoice.snapshot.issuer.identification,
      identification_type: invoice.snapshot.issuer.identification_type,
      send_email: false,
    },
    activity: true,
    terminal: true,
    numbering: { confirmed_at: "2026-11-25T00:00:00Z", last_value: "0" },
  };
  const config: any = {
    SESSION_KEY: "b".repeat(64),
    HACIENDA_KEYRING: JSON.stringify({ TEST: "c".repeat(64) }),
    HACIENDA_ACTIVE_KEY_ID: "TEST",
    HACIENDA_STAG_EMISSION_ENABLED: "true",
    HACIENDA_PRODUCTION_EMISSION_ENABLED: "true",
    HACIENDA_SOFTWARE_PROVIDER_ID: "3101234567",
    HACIENDA_RESPONSE_TRUST_POLICY: "official_api",
  };
  let stored: any = structuredClone(invoice);
  let reservations = 0;
  const db = {
    async query(sql: string, values: any[] = []) {
      if (sql.includes("select private.has_access"))
        return { rows: [{ allowed: true, aal: "aal2" }] };
      if (sql.startsWith("select auth.uid()"))
        return { rows: [{ actor: actorId, aal: "aal2" }] };
      if (sql.startsWith("select * from public.electronic_invoices"))
        return { rows: [stored] };
      if (sql.startsWith("select id from public.tenants"))
        return { rows: [{ id: invoice.tenant_id }] };
      if (sql.includes("private.invoice_emission_metadata"))
        return { rows: [{ metadata }] };
      if (sql.startsWith("update private.emission_sequences")) {
        reservations++;
        return { rows: [{ last_value: String(reservations) }] };
      }
      if (sql.startsWith("update public.electronic_invoices")) {
        stored = {
          ...stored,
          document_status: "issued",
          consecutivo: values[2],
          clave: values[3],
          credential_version: values[5],
          certificate_fingerprint: values[6],
          response_trust_policy: values[9],
          version: stored.version + 1,
        };
        return { rows: [stored] };
      }
      if (
        sql.startsWith("insert into private.emission_jobs") ||
        sql.startsWith("insert into public.audit_events")
      )
        return { rows: [] };
      throw new Error("Unexpected fixture query: " + sql);
    },
  } as unknown as pg.PoolClient;
  return {
    invoice,
    actorId,
    metadata,
    config,
    db,
    reservations: () => reservations,
  };
}

it("uses each environment's own emission switch", async () => {
  const f = fixture("production");
  f.config.HACIENDA_STAG_EMISSION_ENABLED = "false";
  expect((await emissionReadiness(f.db, f.invoice, f.config)).issues).toEqual(
    [],
  );
  f.config.HACIENDA_STAG_EMISSION_ENABLED = "true";
  f.config.HACIENDA_PRODUCTION_EMISSION_ENABLED = "false";
  expect((await emissionReadiness(f.db, f.invoice, f.config)).issues).toEqual([
    expect.objectContaining({ code: "EMISSION_DISABLED" }),
  ]);
  f.invoice.environment = "test";
  f.metadata.enrollment.environment = "test";
  expect((await emissionReadiness(f.db, f.invoice, f.config)).issues).toEqual(
    [],
  );
});

it("uses a current administrative enrollment without claiming certificate identity verification", async () => {
  const f = fixture();
  expect((await emissionReadiness(f.db, f.invoice, f.config)).canEmit).toBe(
    true,
  );
  f.metadata.certificate_metadata.identity_status = "verified";
  f.metadata.enrollment = null;
  const readiness = await emissionReadiness(f.db, f.invoice, f.config);
  expect(readiness.canEmit).toBe(false);
  expect(readiness.issues).toContainEqual(
    expect.objectContaining({ code: "CERTIFICATE_ENROLLMENT_REQUIRED" }),
  );
});

it.each([
  ["environment", "production"],
  ["version", 2],
  ["certificate_fingerprint", "d".repeat(64)],
  ["issuer_identification", "3100000000"],
  ["issuer_identification_type", "01"],
  ["status", "pending"],
  ["confirmed_at", null],
])("blocks stale administrative enrollment %s", async (field, value) => {
  const f = fixture();
  f.metadata.enrollment[field] = value;
  expect(
    (await emissionReadiness(f.db, f.invoice, f.config)).issues,
  ).toContainEqual(
    expect.objectContaining({ code: "CERTIFICATE_ENROLLMENT_REQUIRED" }),
  );
});

it("blocks identity type changes in the current company and prepared snapshot", async () => {
  const f = fixture();
  f.metadata.company.identification_type = "01";
  const codes = (await emissionReadiness(f.db, f.invoice, f.config)).issues.map(
    (i) => i.code,
  );
  expect(codes).toContain("CERTIFICATE_ENROLLMENT_REQUIRED");
  expect(codes).toContain("ISSUER_SNAPSHOT_STALE");
});

it("requires pins only for pinned_certificate and rejects disabled TLS for official_api", async () => {
  const f = fixture();
  expect((await emissionReadiness(f.db, f.invoice, f.config)).canEmit).toBe(
    true,
  );
  f.config.HACIENDA_RESPONSE_TRUST_POLICY = "pinned_certificate";
  expect(
    (await emissionReadiness(f.db, f.invoice, f.config)).issues,
  ).toContainEqual(
    expect.objectContaining({ code: "RESPONSE_TRUST_REQUIRED" }),
  );
  f.config.HACIENDA_RESPONSE_TRUST_POLICY = "official_api";
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  expect(
    (await emissionReadiness(f.db, f.invoice, f.config)).issues,
  ).toContainEqual(expect.objectContaining({ code: "RESPONSE_TLS_REQUIRED" }));
});

it("requires production response pins separately from the test pins", async () => {
  const f = fixture("production");
  f.config.HACIENDA_RESPONSE_TRUST_POLICY = "pinned_certificate";
  f.config.HACIENDA_RESPONSE_CERTIFICATE_PINS = JSON.stringify([
    "d".repeat(64),
  ]);
  expect(
    (await emissionReadiness(f.db, f.invoice, f.config)).issues,
  ).toContainEqual(
    expect.objectContaining({ code: "RESPONSE_TRUST_REQUIRED" }),
  );
  f.config.HACIENDA_PRODUCTION_RESPONSE_CERTIFICATE_PINS = JSON.stringify([
    "e".repeat(64),
  ]);
  expect((await emissionReadiness(f.db, f.invoice, f.config)).canEmit).toBe(
    true,
  );
  f.invoice.environment = "test";
  f.metadata.enrollment.environment = "test";
  delete f.config.HACIENDA_RESPONSE_TRUST_POLICY;
  expect((await emissionReadiness(f.db, f.invoice, f.config)).canEmit).toBe(
    true,
  );
});

it("requires explicit production confirmation before consuming a number", async () => {
  const f = fixture("production");
  await expect(
    issuePreparedInvoice(f.db, f.invoice, randomUUID(), f.actorId, f.config),
  ).rejects.toThrow("Confirma expresamente");
  expect(f.reservations()).toBe(0);
});

it("fixes the server trust policy at issue and replays an issued production invoice without another confirmation", async () => {
  const f = fixture("production"),
    operation = randomUUID();
  const issued = await issuePreparedInvoice(
    f.db,
    f.invoice,
    operation,
    f.actorId,
    f.config,
    true,
  );
  expect(issued.document_status).toBe("issued");
  expect(issued.response_trust_policy).toBe("official_api");
  f.config.HACIENDA_PRODUCTION_EMISSION_ENABLED = "false";
  f.config.HACIENDA_RESPONSE_TRUST_POLICY = "pinned_certificate";
  expect(
    await issuePreparedInvoice(f.db, f.invoice, operation, f.actorId, f.config),
  ).toEqual(issued);
  expect(f.reservations()).toBe(1);
});

it("rejects an issued replay when the caller carries a different environment", async () => {
  const f = fixture();
  await issuePreparedInvoice(
    f.db,
    f.invoice,
    randomUUID(),
    f.actorId,
    f.config,
  );
  await expect(
    issuePreparedInvoice(
      f.db,
      { ...f.invoice, environment: "production" },
      randomUUID(),
      f.actorId,
      f.config,
      true,
    ),
  ).rejects.toThrow("ambiente");
});

it("checks the prepared version again after obtaining the issuance row lock", async () => {
  const f = fixture();
  await expect(
    issuePreparedInvoice(
      f.db,
      { ...f.invoice, version: 2 },
      randomUUID(),
      f.actorId,
      f.config,
    ),
  ).rejects.toThrow("La factura cambió");
  expect(f.reservations()).toBe(0);
});
