import { expect, it } from "vitest";
import { companyInput } from "../packages/domain/src/company";
import {
  companyFormSubmission,
  companyValidationMessage,
  companyValidationTab,
  companyApiErrorTab,
} from "../apps/web/src/features/companies/company-form";

const empty = () => ({
  code: "",
  name: "",
  primary: false,
  active: true,
  source_url: "",
});
const value = () =>
  companyInput.parse({
    legal_name: "Empresa de prueba",
    identification_type: "01",
    identification: "123456789",
  });

it("discards only new empty activities without mutating the editor", () => {
  const form = value();
  form.activities = [
    { ...empty(), code: "123456", name: "Actividad existente" },
    { ...empty(), code: "  ", name: "\t" },
    empty(),
  ];
  const submitted = companyFormSubmission(form, 1);
  expect(submitted.activities).toHaveLength(1);
  expect(submitted.activities[0].code).toBe("123456");
  expect(form.activities).toHaveLength(3);
});
it("never drops a persisted activity whose fields were cleared", () => {
  const form = value();
  form.activities = [empty()];
  expect(companyFormSubmission(form, 1).activities).toHaveLength(1);
  expect(companyInput.safeParse(companyFormSubmission(form, 1)).success).toBe(
    false,
  );
});
it.each([
  { code: "123456", name: "", source_url: "" },
  { code: "", name: "Actividad parcial", source_url: "" },
  { code: "", name: "", source_url: "https://example.test" },
])("keeps partially completed new activities for validation: %j", (row) => {
  const form = value();
  form.activities = [{ ...empty(), ...row }];
  const submitted = companyFormSubmission(form, 0);
  expect(submitted.activities).toHaveLength(1);
  const result = companyInput.safeParse(submitted);
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(companyValidationTab(result.error.issues[0].path)).toBe(2);
    expect(companyValidationMessage(result.error.issues[0])).not.toMatch(
      /Too small|Invalid input|expected string/,
    );
  }
});
it.each([
  [["legal_name"], 0],
  [["address"], 1],
  [["configuration", "location", "district"], 1],
  [["activities", 0, "name"], 2],
  [["configuration", "tax", "regime"], 2],
  [["configuration", "billing", "terminal_code"], 3],
  [["configuration", "accounting", "fiscal_end"], 4],
])("opens the tab for %j", (path, expected) =>
  expect(companyValidationTab(path as PropertyKey[])).toBe(expected),
);
it("routes server-side address errors without hiding permission errors", () => {
  expect(
    companyApiErrorTab("Domicilio fiscal: provincia y cantón inválidos."),
  ).toBe(1);
  expect(
    companyApiErrorTab(
      "Los códigos nuevos de actividad deben tener seis dígitos.",
    ),
  ).toBe(2);
  expect(
    companyApiErrorTab("No tienes permiso para realizar esta operación."),
  ).toBeNull();
});
