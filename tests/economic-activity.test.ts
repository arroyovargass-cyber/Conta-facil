import { expect, it } from "vitest";
import {
  economicActivityCode,
  isEconomicActivityCode,
} from "../packages/domain/src/economic-activity";
import { createCompanyInput } from "../packages/domain/src/company";

it.each(["4520.0", "4100.0", "123456", "000001"])(
  "preserves the six-character activity code %s exactly",
  (code) => {
    expect(isEconomicActivityCode(code)).toBe(true);
    expect(economicActivityCode.parse(code)).toBe(code);
  },
);

it.each(["", "4520", "4520.", "45200.0", " 4520.0", "4520.0 "])(
  "rejects an activity code with invalid XSD length: %j",
  (code) => {
    expect(isEconomicActivityCode(code)).toBe(false);
    expect(economicActivityCode.safeParse(code).success).toBe(false);
  },
);

it("checks only XSD length and does not assert that a code is registered", () => {
  expect(economicActivityCode.parse("4523.0")).toBe("4523.0");
});

it.each(["4520.0", "4100.0", "123456"])(
  "allows an exact activity code when creating company configuration: %s",
  (code) => {
    const company = createCompanyInput.parse({
      operation_id: "a0000000-0000-4000-8000-000000000001",
      legal_name: "Empresa de prueba",
      person_type: "legal",
      identification_type: "02",
      identification: "3000000000",
      activities: [{ code, name: "Actividad declarada", primary: true }],
    });
    expect(company.activities[0].code).toBe(code);
  },
);
it.each(["4520", "45200.0", " 4520.0", "4520.0 "])(
  "rejects new company activity codes without changing their text: %j",
  (code) => {
    expect(
      createCompanyInput.safeParse({
        operation_id: "a0000000-0000-4000-8000-000000000001",
        legal_name: "Empresa de prueba",
        person_type: "legal",
        identification_type: "02",
        identification: "3000000000",
        activities: [{ code, name: "Actividad declarada", primary: true }],
      }).success,
    ).toBe(false);
  },
);
