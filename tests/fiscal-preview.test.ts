import { it, expect } from "vitest";
import {
  prepareFiscalPreview,
  fiscalPreviewRequest,
  type FiscalPreviewSource,
} from "../packages/domain/src/fiscal-preview";
const source = (quantity = "1", price = "1000"): FiscalPreviewSource => ({
  currency: "CRC",
  customerSnapshot: {},
  lines: [{ position: 1, quantity, unit_price: price }],
});
it("calculates exact general VAT without binary rounding", () => {
  const a = prepareFiscalPreview(source()).calculation;
  expect(a).toMatchObject({
    status: "complete",
    base: "1000",
    vat: "130",
    total: "1130",
  });
  const s = source("0.1", "0.2");
  s.lines.push({ ...s.lines[0], position: 2 });
  expect(prepareFiscalPreview(s).calculation).toMatchObject({
    base: "0.04",
    vat: "0.0052",
    total: "0.0452",
  });
  expect(
    prepareFiscalPreview(source("0.10000", "0.20000")).calculation,
  ).toMatchObject({ base: "0.02", vat: "0.0026", total: "0.0226" });
  expect(prepareFiscalPreview(source("1", "0")).calculation).toMatchObject({
    base: "0",
    vat: "0",
    total: "0",
  });
});
it("blocks extra quantity precision and unrepresentable products or VAT without partial totals", () => {
  for (const [q, p, code] of [
    ["0.00001", "1", "QUANTITY_PRECISION"],
    ["0.001", "0.00001", "ROUNDING_POLICY_PENDING"],
    ["1", "0.00001", "ROUNDING_POLICY_PENDING"],
  ]) {
    const s = source(q, p);
    s.lines.push({ position: 2, quantity: "1", unit_price: "1000" });
    const r = prepareFiscalPreview(s);
    expect(r.calculation).toEqual({ status: "blocked", currency: "CRC" });
    expect(r.readiness.issues).toContainEqual(
      expect.objectContaining({ code, position: 1 }),
    );
  }
});
it("bounds individual amounts and aggregate totals", () => {
  expect(
    prepareFiscalPreview(source("999999999", "999999999")).calculation.status,
  ).toBe("blocked");
  const s = source("1000", "100000000");
  s.lines = Array.from({ length: 100 }, (_, i) => ({
    ...s.lines[0],
    position: i + 1,
  }));
  const r = prepareFiscalPreview(s);
  expect(r.calculation.status).toBe("blocked");
  expect(r.readiness.issues.some((i) => i.code === "AMOUNT_LIMIT")).toBe(true);
  // Base fits, but IVA/total can overflow their own bounds.
  expect(
    prepareFiscalPreview(source("99999", "99999999")).calculation.status,
  ).toBe("blocked");
});
it("blocks malformed commercial inputs and unsupported currency", () => {
  for (const v of ["NaN", "1e2", "-1", "0", "1.000001"])
    expect(prepareFiscalPreview(source(v)).calculation.status, v).toBe(
      "blocked",
    );
  for (const v of ["NaN", "-1", "1e2"])
    expect(prepareFiscalPreview(source("1", v)).calculation.status).toBe(
      "blocked",
    );
  const s = source();
  s.currency = "USD";
  expect(prepareFiscalPreview(s).calculation).toEqual({
    status: "blocked",
    currency: "CRC",
  });
  for (const count of [0, 101]) {
    const s = source();
    s.lines = Array.from({ length: count }, (_, i) => ({
      ...source().lines[0],
      position: i + 1,
    }));
    expect(prepareFiscalPreview(s).calculation.status).toBe("blocked");
  }
});
it("keeps arithmetic separate from explicit unresolved fiscal readiness", () => {
  const r = prepareFiscalPreview(source());
  expect(r.calculation.status).toBe("complete");
  expect(r.readiness).toMatchObject({
    canGenerateXml: false,
    xsdValidation: "not_run",
    signature: "missing",
    haciendaStatus: "not_sent",
  });
  const codes = r.readiness.issues.map((i) => i.code);
  expect(codes).toEqual(
    expect.arrayContaining([
      "SCHEMA_REVISION_UNCONFIRMED",
      "SIGNATURE_MISSING",
      "XML_GENERATION_DISABLED",
      "ISSUER_PROFILE_PENDING",
      "ISSUER_ACTIVITY_UNCONFIRMED",
      "RECEIVER_IDENTIFICATION_MISSING",
      "FISCAL_CLASSIFICATION_PENDING",
    ]),
  );
  for (const i of r.readiness.issues) {
    expect(i.severity).toBe("blocker");
    expect(i.message.length).toBeGreaterThan(10);
    expect(i.nextAction.length).toBeGreaterThan(10);
  }
  const s = source();
  s.customerSnapshot = { identification_type: "other", identification: "TEST" };
  expect(
    prepareFiscalPreview(s).readiness.issues.some(
      (i) => i.code === "RECEIVER_IDENTIFICATION_UNCONFIRMED",
    ),
  ).toBe(true);
});
it("requires explicit confirmation and a strict versioned preview contract", () => {
  const valid = {
    profile: "FE_CRC_CASH_IVA13",
    expected_version: 1,
    confirmed_general_vat: true,
  };
  expect(fiscalPreviewRequest.safeParse(valid).success).toBe(true);
  for (const extra of [
    { confirmed_general_vat: false },
    { confirmed_general_vat: undefined },
    { expected_version: 0 },
    { profile: "ANY" },
    { vat: 13 },
    { xml: "<x/>" },
    { total: "1" },
  ])
    expect(fiscalPreviewRequest.safeParse({ ...valid, ...extra }).success).toBe(
      false,
    );
});
