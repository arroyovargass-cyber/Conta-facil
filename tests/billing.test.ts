import { it, expect } from "vitest";
import {
  decimalInput,
  customerInput,
  catalogInput,
  draftInput,
  lineAmount,
  subtotal,
} from "../packages/domain/src/billing";
import { randomUUID } from "node:crypto";
const draft = () => ({
  operation_id: randomUUID(),
  customer_id: randomUUID(),
  department_id: randomUUID(),
  currency: "CRC",
  notes: "",
  lines: [{ description: "Servicio", quantity: "1", unit_price: "0" }],
});
it("multiplies and sums decimal values without binary rounding", () => {
  expect(lineAmount("0.1", "0.2")).toBe("0.02");
  expect(
    subtotal([
      { quantity: "0.1", unit_price: "0.2" },
      { quantity: "1", unit_price: "0.03" },
    ]),
  ).toBe("0.05");
  expect(lineAmount("0.00001", "0.00001")).toBe("0.0000000001");
  expect(lineAmount("999999999.99999", "999999999.99999")).toBe(
    "999999999999980000.0000000001",
  );
});
it("bounds commercial decimals and rejects ambiguous representations", () => {
  for (const value of [
    "NaN",
    "1e2",
    "-1",
    "1.000001",
    "1000000000",
    " 1",
    "1,2",
    "",
  ])
    expect(decimalInput.safeParse(value).success, value).toBe(false);
  expect(decimalInput.parse("0")).toBe("0");
  expect(decimalInput.parse("999999999.99999")).toBe("999999999.99999");
});
it("accepts drafts only with positive quantities and 1 through 100 lines", () => {
  expect(draftInput.safeParse(draft()).success).toBe(true);
  for (const quantity of ["0", "0.00000"]) {
    const d = draft();
    d.lines[0].quantity = quantity;
    expect(draftInput.safeParse(d).success).toBe(false);
  }
  for (const count of [0, 101]) {
    const d = draft();
    d.lines = Array.from({ length: count }, () => d.lines[0]);
    expect(draftInput.safeParse(d).success).toBe(false);
  }
  expect(draftInput.safeParse({ ...draft(), tax: "13" }).success).toBe(false);
});
it("keeps identifiers alphanumeric and requires both identification fields", () => {
  expect(
    customerInput.safeParse({
      name: "Cliente",
      identification_type: "juridica",
      identification: "3-ABC-123",
    }).success,
  ).toBe(true);
  expect(
    customerInput.safeParse({ name: "Cliente", identification: "123" }).success,
  ).toBe(false);
  expect(
    catalogInput.safeParse({
      code: "S1",
      description: "Servicio",
      kind: "service",
      currency: "USD",
      unit_price: "0",
    }).success,
  ).toBe(true);
});
