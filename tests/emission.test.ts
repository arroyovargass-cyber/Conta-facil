import { expect, it } from "vitest";
import {
  emissionOptionsInput,
  prepareEmission,
} from "../packages/domain/src/emission";
import {
  lineFiscalInput,
  receiverInput,
} from "../packages/domain/src/invoice-fiscal";
const options = (extra = {}) =>
  emissionOptionsInput.parse({
    branch_code: "001",
    terminal_code: "00001",
    issuer_activity: "123456",
    payment_methods: [{ code: "01", amount: "2260" }],
    ...extra,
  });
const input = (extra = {}) => ({
  document_type: "FE",
  currency: "CRC" as const,
  receiver: receiverInput.parse({
    name: "Cliente",
    identification_type: "01",
    identification: "123456789",
    domicile: "domestic",
    province: "1",
    canton: "01",
    district: "01",
    address: "San José",
  }),
  lines: [
    {
      quantity: "2",
      unit_price: "1000",
      description: "Servicio",
      fiscal: lineFiscalInput.parse({
        cabys: "1234567890123",
        unit: "Unid",
        treatment: "taxable",
        tariff_code: "08",
      }),
    },
  ],
  options: options(),
  ...extra,
});
const codes = (extra = {}) =>
  prepareEmission(input(extra)).issues.map((i) => i.code);
it("preserves incomplete preparation with bounded strict fields", () => {
  expect(emissionOptionsInput.parse({})).toEqual({
    sale_condition: "01",
    credit_days: null,
    exchange_rate: "",
    payment_methods: [],
    branch_code: "",
    terminal_code: "",
    issuer_activity: "",
  });
  expect(
    emissionOptionsInput.parse({ payment_methods: [{ code: "", amount: "" }] })
      .payment_methods,
  ).toEqual([{ code: "", amount: "" }]);
  for (const malformed of [
    { unknown: 1 },
    { sale_condition: "99" },
    { credit_days: 1.5 },
    { credit_days: 100000 },
    { exchange_rate: "NaN" },
    { exchange_rate: "1.123456" },
    { branch_code: "1234" },
    { payment_methods: Array(5).fill({ code: "01", amount: "1" }) },
    { payment_methods: [{ code: "01", amount: "-1" }] },
    { payment_methods: [{ code: "01", amount: "1", unknown: 1 }] },
  ])
    expect(emissionOptionsInput.safeParse(malformed).success).toBe(false);
});
it("prepares CRC2260 exactly and normalizes only CRC exchange rate", () => {
  const result = prepareEmission(
    input({ options: options({ exchange_rate: "500" }) }),
  );
  expect(result.totals).toMatchObject({
    status: "complete",
    tax: "260.00000",
    total: "2260.00000",
  });
  expect(result.options.exchange_rate).toBe("1");
  expect(result.issues).toEqual([]);
});
it("requires an explicit positive USD exchange rate without inventing it", () => {
  for (const exchange_rate of ["", "0", "0.00000"]) {
    const result = prepareEmission(
      input({ currency: "USD", options: options({ exchange_rate }) }),
    );
    expect(result.options.exchange_rate).toBe(exchange_rate);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "EXCHANGE_RATE_REQUIRED" }),
    );
  }
  expect(
    codes({
      currency: "USD",
      options: options({ exchange_rate: "512.12345" }),
    }),
  ).toEqual([]);
});
it("reconciles payments exactly at five decimal places", () => {
  expect(
    codes({
      options: options({
        payment_methods: [{ code: "01", amount: "2259.99999" }],
      }),
    }),
  ).toContain("PAYMENT_TOTAL_MISMATCH");
  expect(
    codes({
      options: options({
        payment_methods: [
          { code: "02", amount: "1000.00001" },
          { code: "06", amount: "1259.99999" },
        ],
      }),
    }),
  ).toEqual([]);
  expect(codes({ options: options({ payment_methods: [] }) })).toContain(
    "PAYMENT_METHOD_REQUIRED",
  );
  for (const code of ["08", "99", ""])
    expect(
      codes({
        options: options({ payment_methods: [{ code, amount: "2260" }] }),
      }).length,
    ).toBeGreaterThan(0);
  expect(
    codes({
      options: options({ payment_methods: [{ code: "01", amount: "0" }] }),
    }),
  ).toContain("PAYMENT_AMOUNT_REQUIRED");
});
it("allows ordinary credit without payments but requires a positive bounded term", () => {
  expect(
    codes({
      options: options({
        sale_condition: "02",
        credit_days: 30,
        payment_methods: [],
      }),
    }),
  ).toEqual([]);
  expect(
    codes({
      options: options({
        sale_condition: "02",
        credit_days: null,
        payment_methods: [],
      }),
    }),
  ).toContain("CREDIT_DAYS_REQUIRED");
  expect(
    codes({
      options: options({
        sale_condition: "02",
        credit_days: 0,
        payment_methods: [],
      }),
    }),
  ).toContain("CREDIT_DAYS_REQUIRED");
  expect(codes({ options: options({ credit_days: 30 }) })).toContain(
    "CREDIT_DAYS_NOT_ALLOWED",
  );
  expect(
    codes({
      options: options({
        sale_condition: "02",
        credit_days: 30,
        payment_methods: [
          { code: "01", amount: "1" },
          { code: "02", amount: "1" },
        ],
      }),
    }),
  ).toContain("PAYMENT_TOTAL_MISMATCH");
});
it("blocks TE, non-national receivers and incomplete fiscal preparation", () => {
  expect(codes({ document_type: "TE" })).toContain("DOCUMENT_TYPE_UNSUPPORTED");
  expect(
    codes({ receiver: receiverInput.parse({ domicile: "foreign" }) }),
  ).toContain("NATIONAL_RECEIVER_REQUIRED");
  expect(
    codes({
      options: emissionOptionsInput.parse({}),
      receiver: receiverInput.parse({}),
    }),
  ).toEqual(
    expect.arrayContaining([
      "BRANCH_CODE_REQUIRED",
      "TERMINAL_CODE_REQUIRED",
      "ISSUER_ACTIVITY_REQUIRED",
      "RECEIVER_IDENTIFICATION_MISSING",
    ]),
  );
  for (const change of [
    { branch_code: "000" },
    { terminal_code: "00000" },
    { issuer_activity: "abc123" },
  ])
    expect(codes({ options: options(change) }).length).toBeGreaterThan(0);
  expect(codes({ lines: [] })).toContain("INVALID_LINE_COUNT");
});
