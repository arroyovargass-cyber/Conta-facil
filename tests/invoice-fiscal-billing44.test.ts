import { expect, it } from "vitest";
import {
  calculateInvoice,
  lineFiscalInput,
  receiverInput,
  validateInvoiceForIssuance,
} from "../packages/domain/src/invoice-fiscal";
import { otherChargeInput } from "../packages/domain/src/invoice-extras";

const fiscal = (extra = {}) =>
  lineFiscalInput.parse({
    cabys: "1234567890123",
    unit: "Unid",
    treatment: "taxable",
    tariff_code: "08",
    ...extra,
  });
const line = (extra = {}) => ({
  quantity: "2",
  unit_price: "1000",
  description: "Producto",
  fiscal: fiscal(),
  ...extra,
});
const charge = (extra = {}) => ({
  code: "08",
  other_description: "",
  description: "Depósito de garantía",
  third_party_type: "",
  third_party_identification: "",
  third_party_name: "",
  mode: "amount" as const,
  amount: "10",
  percentage: "",
  percentage_base: "",
  ...extra,
});
const readiness = (lines = [line()], other_charges = [charge()]) =>
  validateInvoiceForIssuance({
    document_type: "TE",
    receiver: receiverInput.parse({}),
    lines,
    other_charges,
  });

it("calculates a percentage discount independently of the retained amount field", () => {
  expect(
    calculateInvoice([
      line({
        fiscal: fiscal({
          discount_mode: "percentage",
          discount_percentage: "10",
          discount_amount: "999",
          discount_code: "07",
          discount_reason: "Promoción",
        }),
      }),
    ]),
  ).toMatchObject({
    status: "complete",
    discounts: "200.00000",
    subtotal: "1800.00000",
    tax: "234.00000",
    total: "2034.00000",
  });
  for (const discount_percentage of ["", "100.00001"])
    expect(
      calculateInvoice([
        line({
          fiscal: fiscal({ discount_mode: "percentage", discount_percentage }),
        }),
      ]).status,
    ).toBe("blocked");
});

it("rounds percentage discounts within each line and sums rounded results", () => {
  const tiny = line({
    quantity: "1",
    unit_price: "0.00005",
    fiscal: fiscal({
      tariff_code: "01",
      discount_mode: "percentage",
      discount_percentage: "10",
      discount_code: "07",
      discount_reason: "Promoción",
    }),
  });
  expect(calculateInvoice([tiny, tiny])).toMatchObject({
    status: "complete",
    discounts: "0.00002",
    subtotal: "0.00008",
    total: "0.00008",
  });
});

it("calculates cement separately and includes it in the IVA base", () => {
  expect(
    calculateInvoice([
      line({ fiscal: fiscal({ other_taxes: [{ code: "12", rate: "5" }] }) }),
    ]),
  ).toMatchObject({
    status: "complete",
    subtotal: "2000.00000",
    tax: "373.00000",
    total: "2373.00000",
    lines: [
      {
        base: "2000.00000",
        tax_base: "2100.00000",
        taxes: [
          { code: "01", base: "2100.00000", amount: "273.00000" },
          { code: "12", rate: "5", base: "2000.00000", amount: "100.00000" },
        ],
      },
    ],
    groups: [
      { tax_code: "01", tax: "273.00000" },
      { tax_code: "12", tariff_code: "", tax: "100.00000" },
    ],
  });
});

it("blocks unsupported tax bases and any cement rate other than the verified five percent", () => {
  for (const tax of [
    { code: "02", rate: "5" },
    { code: "03", rate: "5" },
    { code: "04", rate: "5" },
    { code: "05", rate: "5" },
    { code: "06", rate: "5" },
    { code: "07", rate: "5" },
    { code: "08", rate: "5" },
    { code: "99", rate: "5", other_description: "Otro impuesto" },
    { code: "12", rate: "4" },
  ])
    expect(
      calculateInvoice([line({ fiscal: fiscal({ other_taxes: [tax] }) })]),
    ).toMatchObject({ status: "blocked" });
});

it("uses only the explicit percentage base for other charges", () => {
  expect(
    calculateInvoice(
      [line()],
      [
        charge({
          mode: "percentage",
          amount: "999",
          percentage: "10",
          percentage_base: "100",
        }),
      ],
    ),
  ).toMatchObject({
    status: "complete",
    subtotal: "2000.00000",
    tax: "260.00000",
    otherCharges: "10.00000",
    ivaReturned: "0.00000",
    total: "2270.00000",
    charges: [{ calculated_amount: "10.00000" }],
  });
  expect(
    calculateInvoice(
      [line()],
      [charge({ mode: "percentage", percentage: "10", percentage_base: "" })],
    ),
  ).toMatchObject({ status: "blocked" });
});

it("requires charge conditions at issuance while allowing incomplete descriptive drafts", () => {
  expect(
    calculateInvoice([line()], [charge({ code: "99", description: "" })])
      .status,
  ).toBe("complete");
  expect(
    readiness([line()], [charge({ code: "99", description: "" })]),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "OTHER_CHARGE_DESCRIPTION_MISSING" }),
      expect.objectContaining({
        code: "OTHER_CHARGE_OTHER_DESCRIPTION_MISSING",
      }),
    ]),
  );
  expect(readiness([line()], [charge({ code: "04" })])).toContainEqual(
    expect.objectContaining({ code: "OTHER_CHARGE_THIRD_PARTY_MISSING" }),
  );
  expect(
    readiness(
      [line()],
      [
        charge({
          code: "04",
          third_party_type: "01",
          third_party_identification: "123456789",
          third_party_name: "Comercio tercero",
        }),
      ],
    ),
  ).toEqual([]);
  expect(calculateInvoice([line()], [charge({ amount: "0" })]).status).toBe(
    "blocked",
  );
  expect(calculateInvoice([line()], Array(16).fill(charge())).status).toBe(
    "blocked",
  );
});

it("allows charge-only documents exclusively for the verified charge codes", () => {
  for (const code of ["04", "08", "09", "10"])
    expect(calculateInvoice([], [charge({ code })])).toMatchObject({
      status: "complete",
      total: "10.00000",
    });
  expect(calculateInvoice([], [charge({ code: "99" })]).status).toBe("blocked");
  expect(calculateInvoice([]).status).toBe("blocked");
});

it("centralizes goods and services totals without confusing zero, exempt, and exonerated", () => {
  expect(
    calculateInvoice([
      line(),
      line({
        fiscal: fiscal({
          cabys: "5123456789012",
          treatment: "exempt",
          tariff_code: "10",
        }),
      }),
      line({ fiscal: fiscal({ cabys: "6123456789012", tariff_code: "01" }) }),
      line({
        fiscal: fiscal({ treatment: "exonerated", exoneration: { rate: "8" } }),
      }),
    ]),
  ).toMatchObject({
    status: "complete",
    summary: {
      services: {
        taxable: "0.00000",
        exempt: "2000.00000",
        exonerated: "0.00000",
        non_subject: "2000.00000",
      },
      goods: {
        taxable: "2769.23077",
        exempt: "0.00000",
        exonerated: "1230.76923",
        non_subject: "0.00000",
      },
      totals: {
        taxable: "2769.23077",
        exempt: "2000.00000",
        exonerated: "1230.76923",
        non_subject: "2000.00000",
      },
    },
  });
});

it("allocates exonerated summary shares at each line and keeps the rounded partition exact", () => {
  expect(
    calculateInvoice([
      line({
        fiscal: fiscal({ treatment: "exonerated", exoneration: { rate: "8" } }),
      }),
    ]),
  ).toMatchObject({
    status: "complete",
    tax: "260.00000",
    exonerations: "160.00000",
    total: "2100.00000",
    summary: { goods: { taxable: "769.23077", exonerated: "1230.76923" } },
  });
});

it("preserves specialized fields but rejects unknown medicine forms and special FE regimes", () => {
  const f = fiscal({
    internal_code: "SKU-123",
    commercial_codes: [{ type: "04", code: "INTERNO-123" }],
    transaction_type: "01",
    vin_numbers: ["1HGBH41JXMN109186"],
    medicine_registration: "MS-123",
    pharmaceutical_form: "001",
  });
  expect(f.internal_code).toBe("SKU-123");
  expect(readiness([line({ fiscal: f })], [])).toContainEqual(
    expect.objectContaining({ code: "PHARMACEUTICAL_FORM_INVALID" }),
  );
  expect(
    validateInvoiceForIssuance({
      document_type: "FE",
      receiver: receiverInput.parse({
        name: "Cliente",
        identification_type: "01",
        identification: "123456789",
        domicile: "foreign",
      }),
      lines: [line({ fiscal: fiscal({ transaction_type: "02" }) })],
    }),
  ).toContainEqual(
    expect.objectContaining({ code: "TRANSACTION_TREATMENT_UNSUPPORTED" }),
  );
});

it("validates medicine form codes against the verified official text catalog without padding", () => {
  for (const pharmaceutical_form of ["01", "199", "229"])
    expect(
      readiness(
        [
          line({
            fiscal: fiscal({
              medicine_registration: "MS-123",
              pharmaceutical_form,
            }),
          }),
        ],
        [],
      ),
    ).toEqual([]);
  for (const pharmaceutical_form of ["001", "230", ""])
    expect(
      readiness(
        [
          line({
            fiscal: fiscal({
              medicine_registration: "MS-123",
              pharmaceutical_form,
            }),
          }),
        ],
        [],
      ),
    ).toContainEqual(
      expect.objectContaining({ code: "PHARMACEUTICAL_FORM_INVALID" }),
    );
  expect(
    readiness([line({ fiscal: fiscal({ pharmaceutical_form: "199" }) })], []),
  ).toEqual([]);
});

it("validates commercial types and receiver names independently for the TE profile", () => {
  expect(
    readiness(
      [
        line({
          fiscal: fiscal({ commercial_codes: [{ type: "88", code: "SKU" }] }),
        }),
      ],
      [],
    ),
  ).toContainEqual(
    expect.objectContaining({ code: "COMMERCIAL_CODE_INVALID" }),
  );
  expect(
    validateInvoiceForIssuance({
      document_type: "TE",
      receiver: receiverInput.parse({
        name: "Cliente",
        requires_activity: true,
        economic_activity: "",
      }),
      lines: [line()],
    }),
  ).toEqual([]);
  expect(
    validateInvoiceForIssuance({
      document_type: "TE",
      receiver: receiverInput.parse({ email: "cliente@example.com" }),
      lines: [line()],
    }),
  ).toContainEqual(expect.objectContaining({ code: "RECEIVER_NAME_MISSING" }));
  expect(
    receiverInput.parse({ phone: "+506 12345678" }).phone_country_code,
  ).toBe("");
});

it("bounds specialized official fields while preserving incomplete drafts", () => {
  expect(
    lineFiscalInput.safeParse({
      commercial_codes: [{}],
      vin_numbers: [""],
      medicine_registration: "",
      pharmaceutical_form: "",
    }).success,
  ).toBe(true);
  for (const extra of [
    { commercial_codes: Array(6).fill({ type: "04", code: "SKU" }) },
    { commercial_codes: [{ type: "04", code: "X".repeat(21) }] },
    { vin_numbers: ["X".repeat(18)] },
    { vin_numbers: Array(1001).fill("VIN") },
    { medicine_registration: "X".repeat(101) },
    { pharmaceutical_form: "1234" },
  ])
    expect(lineFiscalInput.safeParse(extra).success).toBe(false);
  expect(otherChargeInput.safeParse({}).success).toBe(true);
  expect(
    otherChargeInput.safeParse({ description: "X".repeat(161) }).success,
  ).toBe(false);
  expect(otherChargeInput.safeParse({ percentage_base: "NaN" }).success).toBe(
    false,
  );
});

it("blocks duplicate taxes, excessive charges, and incomplete percentage discount evidence", () => {
  expect(
    calculateInvoice([
      line({
        fiscal: fiscal({
          other_taxes: [
            { code: "12", rate: "5" },
            { code: "12", rate: "5" },
          ],
        }),
      }),
    ]),
  ).toMatchObject({
    status: "blocked",
    issues: expect.arrayContaining([
      expect.objectContaining({ code: "OTHER_TAX_DUPLICATE" }),
    ]),
  });
  expect(
    calculateInvoice(
      [line()],
      [
        charge({
          mode: "percentage",
          percentage: "10000",
          percentage_base: "1",
        }),
      ],
    ),
  ).toMatchObject({ status: "blocked" });
  expect(
    calculateInvoice([line()], [charge({ amount: "9999999999999.99999" })]),
  ).toMatchObject({ status: "blocked" });
  expect(
    readiness(
      [
        line({
          fiscal: fiscal({
            discount_mode: "percentage",
            discount_percentage: "10",
            discount_amount: "0",
          }),
        }),
      ],
      [],
    ),
  ).toContainEqual(
    expect.objectContaining({ code: "DISCOUNT_DETAILS_MISSING" }),
  );
});

it("requires special verification for an exoneration combined with other taxes", () => {
  expect(
    calculateInvoice([
      line({
        fiscal: fiscal({
          treatment: "exonerated",
          exoneration: { rate: "8" },
          other_taxes: [{ code: "12", rate: "5" }],
        }),
      }),
    ]),
  ).toMatchObject({
    status: "blocked",
    issues: expect.arrayContaining([
      expect.objectContaining({
        code: "EXONERATION_OTHER_TAX_SUMMARY_UNVERIFIED",
      }),
    ]),
  });
});

it("applies the documented third-party identity formats and foreign-registration exception", () => {
  expect(
    readiness(
      [line()],
      [
        charge({
          code: "04",
          third_party_type: "05",
          third_party_identification: "AbC123",
          third_party_name: "Proveedor extranjero",
        }),
      ],
    ),
  ).toEqual([]);
  expect(
    readiness(
      [line()],
      [
        charge({
          code: "04",
          third_party_type: "01",
          third_party_identification: "012345678",
          third_party_name: "Proveedor tercero",
        }),
      ],
    ),
  ).toContainEqual(
    expect.objectContaining({ code: "OTHER_CHARGE_THIRD_PARTY_MISSING" }),
  );
  expect(
    readiness([line()], [charge({ code: "08", third_party_name: "Abc" })]),
  ).toContainEqual(
    expect.objectContaining({ code: "OTHER_CHARGE_THIRD_PARTY_MISSING" }),
  );
});

it("validates the fiscal detail length at issuance without rejecting saved draft text", () => {
  for (const description of ["ab", "X".repeat(201)])
    expect(readiness([line({ description })], [])).toContainEqual(
      expect.objectContaining({ code: "DESCRIPTION_FISCAL_LIMIT" }),
    );
});

it("blocks undefined exonerated summary proportions when the rounded IVA is zero", () => {
  for (const values of [
    { quantity: "1", unit_price: "0.00001" },
    {
      fiscal: fiscal({
        treatment: "exonerated",
        exoneration: { rate: "13" },
        discount_amount: "2000",
        discount_code: "07",
        discount_reason: "Promoción",
      }),
    },
  ])
    expect(
      calculateInvoice([
        line({
          fiscal: fiscal({
            treatment: "exonerated",
            exoneration: { rate: "13" },
          }),
          ...values,
        }),
      ]),
    ).toMatchObject({
      status: "blocked",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "EXONERATION_SUMMARY_ZERO_TAX" }),
      ]),
    });
});

it("checks supplied TE receiver identification formats before XML preparation", () => {
  const check = (
    identification_type: string,
    identification: string,
    document_type: "FE" | "TE" = "TE",
  ) =>
    validateInvoiceForIssuance({
      document_type,
      receiver: receiverInput.parse({
        name: "Cliente",
        identification_type,
        identification,
        domicile: document_type === "FE" ? "foreign" : "unspecified",
      }),
      lines: [line()],
    });
  for (const [identification_type, identification] of [
    ["01", "123456789"],
    ["02", "1234567890"],
    ["03", "12345678901"],
    ["03", "123456789012"],
    ["04", "1234567890"],
    ["05", "AbC123"],
  ])
    expect(check(identification_type, identification)).toEqual([]);
  for (const [identification_type, identification] of [
    ["01", "123"],
    ["01", "012345678"],
    ["02", "123456789"],
    ["03", "01234567890"],
    ["04", "12345678901"],
    ["05", "invalid-number"],
  ])
    expect(check(identification_type, identification)).toContainEqual(
      expect.objectContaining({ code: "RECEIVER_IDENTIFICATION_INVALID" }),
    );
  expect(check("05", "AbC123", "FE")).toContainEqual(
    expect.objectContaining({
      code: "RECEIVER_IDENTIFICATION_CONTEXT_UNSUPPORTED",
    }),
  );
  for (const document_type of ["FE", "TE"] as const)
    expect(check("06", "AbC123", document_type)).toContainEqual(
      expect.objectContaining({
        code: "RECEIVER_IDENTIFICATION_CONTEXT_UNSUPPORTED",
      }),
    );
});
