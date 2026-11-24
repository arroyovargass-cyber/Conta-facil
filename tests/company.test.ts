import { it, expect } from "vitest";
import {
  companyInput,
  companyPreparation,
} from "../packages/domain/src/company";
const basic = {
  legal_name: "Empresa Legal",
  identification_type: "02",
  identification: "3-101-123456",
  person_type: "legal",
};
it("normalizes identification and saves basic configuration without fiscal prerequisites", () => {
  const value = companyInput.parse(basic);
  expect(value.identification).toBe("3101123456");
  expect(value.configuration.billing.environment).toBe("test");
  expect(companyPreparation(value).status).toBe("pending");
});
it("rejects invented IDs, mismatched person type and secret fields", () => {
  expect(
    companyInput.safeParse({ ...basic, identification: "123" }).success,
  ).toBe(false);
  expect(
    companyInput.safeParse({ ...basic, person_type: "physical" }).success,
  ).toBe(false);
  expect(
    companyInput.safeParse({ ...basic, configuration: { password: "secret" } })
      .success,
  ).toBe(false);
});
it("validates dates, primary activities and fiscal hierarchy syntax", () => {
  expect(
    companyInput.safeParse({
      ...basic,
      configuration: {
        accounting: { fiscal_start: "2026-12-01", fiscal_end: "2026-01-01" },
      },
    }).success,
  ).toBe(false);
  expect(
    companyInput.safeParse({
      ...basic,
      activities: [
        { code: "123456", name: "Manual", primary: true },
        { code: "123457", name: "Manual 2", primary: true },
      ],
    }).success,
  ).toBe(false);
});
it("keeps monetary presentation parameters separate from fiscal rounding", () => {
  const v = companyInput.parse({
    ...basic,
    configuration: {
      accounting: { money_decimals: 2, inventory_method: "fifo" },
    },
  });
  expect(v.configuration.accounting.money_decimals).toBe(2);
  expect(v.configuration.accounting.inventory_method).toBe("fifo");
  expect(companyPreparation(v).canEmit).toBe(false);
});
it('can parse saved optional empty URLs again and rejects impossible dates without throwing',()=>{
 const v=companyInput.parse(basic);
 expect(()=>companyInput.parse(v)).not.toThrow();
 expect(()=>companyInput.safeParse({...basic,configuration:{tax:{registration_date:'2026-99-99'}}})).not.toThrow();
 expect(companyInput.safeParse({...basic,configuration:{tax:{registration_date:'2026-99-99'}}}).success).toBe(false);
});
