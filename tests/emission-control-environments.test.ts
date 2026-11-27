import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FiscalLookups } from "../apps/api/src/services/fiscal-lookups";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import {
  emissionReadiness,
  issuePreparedInvoice,
} from "../apps/api/src/services/emission-control";
import { xmlFixture } from "./support/invoice-fixture";
import { receiverInput } from "../packages/domain/src/invoice-fiscal";

const tlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
beforeEach(() => {
  vi.spyOn(FiscalLookups.prototype, "cabys").mockImplementation(
    async (code) => ({
      available: true,
      source: "Hacienda",
      items: [{ code, description: "Catálogo sintético local" }],
    }),
  );
  vi.spyOn(FiscalLookups.prototype, "recipient").mockImplementation(
    async (identification) => ({
      available: true,
      source: "Hacienda",
      source_url: "https://api.hacienda.go.cr/fe/ae",
      recipient: { name: "Contribuyente de prueba", identification },
      activities: [
        { code: "123456", description: "Actividad de prueba", active: true },
      ],
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  if (tlsSetting === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  else process.env.NODE_TLS_REJECT_UNAUTHORIZED = tlsSetting;
});

function fixture(environment = "test", documentType: "FE" | "TE" = "FE") {
  const xml = xmlFixture();
  if (documentType === "TE") {
    xml.snapshot.document_type = "TE";
    xml.snapshot.calculation_version = "billing44-v2-line-half-up-5";
    xml.snapshot.receiver = receiverInput.parse({});
  }
  const invoice = {
    id: randomUUID(),
    tenant_id: randomUUID(),
    department_id: randomUUID(),
    environment,
    document_type: documentType,
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
  const reservationScopes: unknown[][] = [];
  const db = {
    async query(sql: string, values: any[] = []) {
      if (sql.includes("select private.has_access"))
        return { rows: [{ allowed: true, aal: "aal2" }] };
      if (sql.includes("::uuid actor"))
        return { rows: [{ actor: actorId, aal: "aal2" }] };
      if (sql.startsWith("select * from public.electronic_invoices"))
        return { rows: [stored] };
      if (sql.startsWith("select id from public.tenants"))
        return { rows: [{ id: invoice.tenant_id }] };
      if (sql.includes("private.invoice_emission_metadata"))
        return { rows: [{ metadata }] };
      if (sql.startsWith("update private.emission_sequences")) {
        if (!sql.includes("document_type=$5"))
          throw new Error("Unscoped document numbering");
        reservations++;
        reservationScopes.push(values);
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
    reservationScopes,
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
it("requires SMTP for delivery enabled in the frozen snapshot, independently of legacy metadata", async () => {
  const f = fixture();
  f.invoice.snapshot.receiver.email = "receiver@example.com";
  f.invoice.snapshot.issuer.configuration.billing = {
    email_delivery_enabled: true,
    send_email: "billing@example.com",
  };
  f.metadata.company.send_email = false;
  expect(
    (await emissionReadiness(f.db, f.invoice, f.config)).issues,
  ).toContainEqual(expect.objectContaining({ code: "SMTP_UNAVAILABLE" }));
  f.config.SMTP_HOST = "localhost";
  f.config.SMTP_PORT = 2525;
  f.config.SMTP_FROM = "issuer@example.com";
  expect((await emissionReadiness(f.db, f.invoice, f.config)).canEmit).toBe(
    true,
  );
});
it("keeps missing-SMTP legacy delivery blocked but honors a new explicit opt-out", async () => {
  const f = fixture();
  f.invoice.snapshot.receiver.email = "receiver@example.com";
  f.invoice.snapshot.issuer.configuration.billing = { send_email: true };
  expect(
    (await emissionReadiness(f.db, f.invoice, f.config)).issues,
  ).toContainEqual(expect.objectContaining({ code: "SMTP_UNAVAILABLE" }));
  f.invoice.snapshot.issuer.configuration.billing.email_delivery_enabled = false;
  f.metadata.company.send_email = true;
  expect(
    (await emissionReadiness(f.db, f.invoice, f.config)).issues,
  ).not.toContainEqual(expect.objectContaining({ code: "SMTP_UNAVAILABLE" }));
});

it("does not mark fiscal location or XML as checked when a missing provider prevents preflight", async () => {
  const f = fixture();
  f.invoice.snapshot.issuer.configuration.location = {};
  f.config.HACIENDA_SOFTWARE_PROVIDER_ID = "";
  const ready = await emissionReadiness(f.db, f.invoice, f.config);
  expect(ready.issues).toContainEqual(
    expect.objectContaining({ code: "ISSUER_LOCATION_REQUIRED" }),
  );
  expect(ready.requirements).toContainEqual(
    expect.objectContaining({ code: "location", status: "blocked" }),
  );
  expect(ready.requirements).toContainEqual(
    expect.objectContaining({ code: "xml", status: "pending" }),
  );
});
it("reports individual server requirements, including optional email, without claiming Hacienda acceptance", async () => {
  const f = fixture();
  const ready = await emissionReadiness(f.db, f.invoice, f.config);
  expect(ready.canEmit).toBe(true);
  expect(ready.requirements).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "issuer", status: "complete" }),
      expect.objectContaining({ code: "numbering", status: "complete" }),
      expect.objectContaining({ code: "mfa", status: "complete" }),
      expect.objectContaining({ code: "email", status: "not_applicable" }),
    ]),
  );
  f.metadata.numbering.confirmed_at = null;
  f.metadata.api_status = "pending";
  f.config.HACIENDA_STAG_EMISSION_ENABLED = "false";
  const blocked = await emissionReadiness(f.db, f.invoice, f.config);
  for (const code of ["numbering", "credentials", "environment"])
    expect(blocked.requirements).toContainEqual(
      expect.objectContaining({ code, status: "blocked" }),
    );
  expect(blocked.canEmit).toBe(false);
  expect(
    blocked.requirements.find((r) => r.code === "credentials")?.target,
  ).toBe("hacienda");
});
it("rejects altered frozen totals and identifies the exact totals requirement", async () => {
  const f = fixture();
  if (f.invoice.snapshot.totals.status !== "complete")
    throw new Error("Fixture requires complete totals");
  f.invoice.snapshot.totals.total = "1.00000";
  const readiness = await emissionReadiness(f.db, f.invoice, f.config);
  expect(readiness.issues).toContainEqual(
    expect.objectContaining({ code: "SNAPSHOT_TOTALS_MISMATCH" }),
  );
  expect(readiness.requirements).toContainEqual(
    expect.objectContaining({ code: "totals", status: "blocked" }),
  );
  expect(readiness.canEmit).toBe(false);
});
it("blocks unsupported receiver transport identifiers before assigning any number", async () => {
  for (const identification of ["AB123", "12345678901234567890"]) {
    const f = fixture("test", "TE");
    f.invoice.snapshot.receiver = receiverInput.parse({
      name: "Receptor extranjero",
      identification_type: "05",
      identification,
      domicile: "foreign",
    });
    const ready = await emissionReadiness(f.db, f.invoice, f.config);
    expect(ready.issues).toContainEqual(
      expect.objectContaining({ code: "RECEIVER_TRANSPORT_UNSUPPORTED" }),
    );
    expect(ready.canEmit).toBe(false);
    expect(f.reservationScopes).toEqual([]);
  }
});
it("requires official active issuer registration, independently of an editable local activity row", async () => {
  const f = fixture();
  for (const active of [false, undefined]) {
    vi.mocked(FiscalLookups.prototype.recipient).mockResolvedValue({
      available: true,
      source: "Hacienda",
      source_url: "https://api.hacienda.go.cr/fe/ae",
      activities: [
        {
          code: "123456",
          description: "Actividad",
          ...(active === undefined ? {} : { active }),
        },
      ],
    });
    expect(
      (await emissionReadiness(f.db, f.invoice, f.config)).issues,
    ).toContainEqual(
      expect.objectContaining({ code: "ISSUER_ACTIVITY_UNVERIFIED" }),
    );
  }
  vi.mocked(FiscalLookups.prototype.recipient).mockImplementation(
    async (identification) => ({
      available: true,
      source: "Hacienda",
      source_url: "https://api.hacienda.go.cr/fe/ae",
      recipient: { name: "Registro sintético", identification },
      activities: [{ code: "123456", description: "Actividad", active: true }],
    }),
  );
  f.invoice.snapshot.receiver.economic_activity = "654321";
  expect(
    (await emissionReadiness(f.db, f.invoice, f.config)).issues,
  ).toContainEqual(
    expect.objectContaining({ code: "RECEIVER_ACTIVITY_UNVERIFIED" }),
  );
});
it("blocks issuance when a CABYS is absent from the official catalog without consuming numbering", async () => {
  const f = fixture();
  vi.mocked(FiscalLookups.prototype.cabys).mockResolvedValue({
    available: true,
    source: "Hacienda",
    items: [],
  });
  const ready = await emissionReadiness(f.db, f.invoice, f.config);
  expect(ready.canEmit).toBe(false);
  expect(ready.issues).toContainEqual(
    expect.objectContaining({ code: "CABYS_NOT_FOUND" }),
  );
  await expect(
    issuePreparedInvoice(f.db, f.invoice, randomUUID(), f.actorId, f.config),
  ).rejects.toThrow("CABYS");
  expect(f.reservationScopes).toEqual([]);
});
it("keeps a draft blocked for emission when the official CABYS service is unavailable", async () => {
  const f = fixture();
  vi.mocked(FiscalLookups.prototype.cabys).mockResolvedValue({
    available: false,
    source: "Hacienda",
    items: [],
    reason: "unavailable",
  });
  const ready = await emissionReadiness(f.db, f.invoice, f.config);
  expect(ready.issues).toContainEqual(
    expect.objectContaining({ code: "CABYS_CATALOG_UNAVAILABLE" }),
  );
  expect(ready.canEmit).toBe(false);
});
it("preflights and reserves the explicitly selected TE profile without changing FE numbering", async () => {
  const ticket = fixture("test", "TE"),
    invoice = fixture();
  expect(
    (await emissionReadiness(ticket.db, ticket.invoice, ticket.config)).issues,
  ).toEqual([]);
  const issuedTicket = await issuePreparedInvoice(
    ticket.db,
    ticket.invoice,
    randomUUID(),
    ticket.actorId,
    ticket.config,
  );
  expect(issuedTicket.consecutivo).toBe("00100001040000000001");
  expect(ticket.reservationScopes).toEqual([
    [ticket.invoice.tenant_id, "test", "001", "00001", "TE"],
  ]);
  const issuedInvoice = await issuePreparedInvoice(
    invoice.db,
    invoice.invoice,
    randomUUID(),
    invoice.actorId,
    invoice.config,
  );
  expect(issuedInvoice.consecutivo).toBe("00100001010000000001");
  expect(invoice.reservationScopes[0][4]).toBe("FE");
});

it("blocks a row/snapshot document profile mismatch before reserving numbering", async () => {
  const f = fixture();
  f.invoice.snapshot.document_type = "TE";
  expect(
    (await emissionReadiness(f.db, f.invoice, f.config)).issues,
  ).toContainEqual(expect.objectContaining({ code: "DOCUMENT_TYPE_MISMATCH" }));
  expect(f.reservations()).toBe(0);
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
