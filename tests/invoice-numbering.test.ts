import { expect, it } from "vitest";
import {
  buildInvoiceClave,
  formatInvoiceNumber,
} from "../packages/domain/src/invoice-numbering";
const consecutivo = "00100001010000000001";
const claveInput = (extra = {}) => ({
  consecutivo,
  issuerIdentification: "123456789",
  issuedAt: new Date("2026-11-24T06:00:00Z"),
  securityCode: "00000000",
  ...extra,
});
it("formats FE branch, terminal and sequence as exactly twenty digits", () => {
  expect(
    formatInvoiceNumber({ branch: "001", terminal: "00001", sequence: 1n }),
  ).toBe(consecutivo);
  expect(
    formatInvoiceNumber({
      branch: "999",
      terminal: "99999",
      sequence: 9999999999n,
    }),
  ).toBe("99999999019999999999");
});
it("keeps explicitly selected TE numbering separate with official document code 04", () => {
  expect(
    formatInvoiceNumber({
      branch: "001",
      terminal: "00001",
      sequence: 1n,
      documentType: "TE",
    }),
  ).toBe("00100001040000000001");
  expect(
    buildInvoiceClave(claveInput({ consecutivo: "00100001040000000001" })),
  ).toBe("50624112600012345678900100001040000000001100000000");
  expect(() =>
    formatInvoiceNumber({
      branch: "001",
      terminal: "00001",
      sequence: 1n,
      documentType: "NC" as any,
    }),
  ).toThrow();
});
it("rejects invalid branch, terminal, exhausted or non-bigint sequence", () => {
  for (const change of [
    { branch: "000" },
    { branch: "01" },
    { branch: "1 1" },
    { terminal: "00000" },
    { terminal: "0001" },
    { sequence: 0n },
    { sequence: -1n },
    { sequence: 10000000000n },
    { sequence: 1 as unknown as bigint },
  ])
    expect(() =>
      formatInvoiceNumber({
        branch: "001",
        terminal: "00001",
        sequence: 1n,
        ...change,
      }),
    ).toThrow();
});
it("builds the verified fifty-digit normal-situation clave without inventing security", () => {
  const result = buildInvoiceClave(claveInput());
  expect(result).toBe(
    "506" + "241126" + "000123456789" + consecutivo + "1" + "00000000",
  );
  expect(result).toHaveLength(50);
  expect(
    buildInvoiceClave(claveInput({ securityCode: "12345678" })).slice(-8),
  ).toBe("12345678");
});
it("uses the Costa Rican civil date across UTC day and year boundaries", () => {
  expect(
    buildInvoiceClave(
      claveInput({ issuedAt: new Date("2026-11-24T05:59:59.999Z") }),
    ).slice(3, 9),
  ).toBe("231126");
  expect(
    buildInvoiceClave(
      claveInput({ issuedAt: new Date("2027-01-01T05:59:59Z") }),
    ).slice(3, 9),
  ).toBe("311226");
  expect(
    buildInvoiceClave(
      claveInput({ issuedAt: new Date("2000-01-01T06:00:00Z") }),
    ).slice(3, 9),
  ).toBe("010100");
  expect(
    buildInvoiceClave(
      claveInput({ issuedAt: new Date("2100-01-01T05:59:59Z") }),
    ).slice(3, 9),
  ).toBe("311299");
});
it("pads only valid raw national, legal, NITE and DIMEX identifications", () => {
  for (const id of ["123456789", "3101234567", "12345678901", "123456789012"])
    expect(
      buildInvoiceClave(claveInput({ issuerIdentification: id })).slice(9, 21),
    ).toBe(id.padStart(12, "0"));
  for (const id of [
    "012345678",
    "0000000000",
    "01234567890",
    "1-1234-5678",
    "12345678",
    "1234567890123",
    " 123456789",
  ])
    expect(() =>
      buildInvoiceClave(claveInput({ issuerIdentification: id })),
    ).toThrow();
});
it("rejects malformed and unsupported consecutives, invalid dates and security codes", () => {
  for (const extra of [
    { consecutivo: "00100001030000000001" },
    { consecutivo: "00000001010000000001" },
    { consecutivo: "00100000010000000001" },
    { consecutivo: "00100001010000000000" },
    { consecutivo: consecutivo + "1" },
    { issuedAt: new Date("invalid") },
    { issuedAt: new Date("2000-01-01T05:59:59Z") },
    { issuedAt: new Date("2100-01-01T06:00:00Z") },
    { securityCode: "1234567" },
    { securityCode: "123456789" },
    { securityCode: "12a45678" },
    { securityCode: " 1234567" },
  ])
    expect(() => buildInvoiceClave(claveInput(extra))).toThrow();
});
