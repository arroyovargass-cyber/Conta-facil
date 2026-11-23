import { expect, it } from "vitest";
import {
  calculateInvoice,
  lineFiscalInput,
  receiverInput,
  validateInvoiceForIssuance,
} from "../packages/domain/src/invoice-fiscal";
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
  description: "Servicio",
  fiscal: fiscal(),
  ...extra,
});
it("preserves incomplete strict drafts without assuming a tariff", () => {
  expect(lineFiscalInput.parse({}).treatment).toBe("pending");
  expect(lineFiscalInput.parse({}).tariff_code).toBe("");
  expect(receiverInput.parse({}).name).toBe("");
  expect(receiverInput.safeParse({ email: "bad" }).success).toBe(false);
  expect(lineFiscalInput.safeParse({ total: "10" }).success).toBe(false);
});
it("calculates exact IVA and discounts before taxation", () => {
  expect(calculateInvoice([line()])).toMatchObject({
    status: "complete",
    beforeDiscount: "2000.00000",
    subtotal: "2000.00000",
    tax: "260.00000",
    total: "2260.00000",
  });
  expect(
    calculateInvoice([
      line({
        fiscal: fiscal({
          discount_amount: "100",
          discount_code: "07",
          discount_reason: "Promoción",
        }),
      }),
    ]),
  ).toMatchObject({
    status: "complete",
    discounts: "100.00000",
    subtotal: "1900.00000",
    tax: "247.00000",
    total: "2147.00000",
  });
});
it("calculates relief in percentage points separately from gross VAT", () => {
  const exoneration = {
    document_type: "01",
    document_number: "ABC",
    institution: "Institución",
    issue_date: "2026-01-01",
    rate: "8",
  };
  expect(
    calculateInvoice([
      line({ fiscal: fiscal({ treatment: "exonerated", exoneration }) }),
    ]),
  ).toMatchObject({
    status: "complete",
    tax: "260.00000",
    exonerations: "160.00000",
    total: "2100.00000",
  });
});
it("distinguishes exempt, non subject and taxable zero and groups tariffs", () => {
  const result = calculateInvoice([
    line({ fiscal: fiscal({ tariff_code: "01" }) }),
    line({ fiscal: fiscal({ treatment: "exempt", tariff_code: "10" }) }),
    line({ fiscal: fiscal({ treatment: "non_subject", tariff_code: "11" }) }),
  ]);
  expect(result).toMatchObject({
    status: "complete",
    tax: "0.00000",
    total: "6000.00000",
  });
  if (result.status === "complete")
    expect(result.groups.map((g) => g.tariff_code)).toEqual(["01", "10", "11"]);
});
it("blocks incomplete classification, mismatches and transitory FE tariffs", () => {
  for (const f of [
    null,
    lineFiscalInput.parse({}),
    fiscal({ tariff_code: "05" }),
    fiscal({ treatment: "exempt" }),
    fiscal({ discount_amount: "2001" }),
    fiscal({ exoneration: { rate: "14" }, treatment: "exonerated" }),
  ])
    expect(calculateInvoice([line({ fiscal: f })]).status).toBe("blocked");
});
it("applies user-confirmed half-up rounding at line level", () => {
  expect(
    calculateInvoice([
      line({
        quantity: "0.001",
        unit_price: "0.006",
        fiscal: fiscal({ tariff_code: "01" }),
      }),
    ]),
  ).toMatchObject({ status: "complete", subtotal: "0.00001" });
  const result = calculateInvoice([
    line({ quantity: "0.001", unit_price: "0.005" }),
  ]);
  expect(result).toMatchObject({ status: "complete", subtotal: "0.00001" });
});
it("bounds quantity precision, individual and aggregate money", () => {
  for (const values of [
    { quantity: "0.0001" },
    { quantity: "NaN" },
    { unit_price: "99999999999999" },
    { quantity: "9999999999999", unit_price: "9999999999999" },
  ])
    expect(calculateInvoice([line(values)]).status).toBe("blocked");
  expect(
    calculateInvoice([
      line({ quantity: "1", unit_price: "6000000000000" }),
      line({ quantity: "1", unit_price: "6000000000000" }),
    ]).status,
  ).toBe("blocked");
});
it("requires FE receiver identity and permits an explicitly selected TE consumer", () => {
  expect(
    validateInvoiceForIssuance({
      document_type: "FE",
      receiver: receiverInput.parse({}),
      lines: [line()],
    }),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "RECEIVER_IDENTIFICATION_MISSING" }),
    ]),
  );
  expect(
    validateInvoiceForIssuance({
      document_type: "TE",
      receiver: receiverInput.parse({}),
      lines: [line()],
    }),
  ).toEqual([]);
});

it("sums rounded lines without rerounding the document", () => {
  const tiny = line({
    quantity: "0.001",
    unit_price: "0.005",
    fiscal: fiscal({ tariff_code: "01" }),
  });
  expect(calculateInvoice([tiny, tiny])).toMatchObject({
    status: "complete",
    subtotal: "0.00002",
    total: "0.00002",
  });
});
it("blocks issuance for incomplete discount and exoneration evidence", () => {
  for (const f of [
    fiscal({ discount_amount: "1" }),
    fiscal({
      discount_amount: "1",
      discount_code: "42",
      discount_reason: "Otro",
    }),
    fiscal({ treatment: "exonerated", exoneration: { rate: "8" } }),
  ]) {
    expect(
      validateInvoiceForIssuance({
        document_type: "TE",
        receiver: receiverInput.parse({}),
        lines: [line({ fiscal: f })],
      }).length,
    ).toBeGreaterThan(0);
  }
});

it("retains legacy commercial receiver snapshots and flags issuance limits", () => {
  const receiver = receiverInput.parse({
    name: "A".repeat(160),
    identification_type: "national",
    identification: "1",
    address: "A".repeat(1000),
  });
  expect(receiver.name.length).toBe(160);
  expect(
    validateInvoiceForIssuance({
      document_type: "FE",
      receiver,
      lines: [line()],
    }).map((i) => i.code),
  ).toEqual(
    expect.arrayContaining([
      "RECEIVER_FISCAL_LIMIT",
      "INVALID_RECEIVER_IDENTIFICATION_TYPE",
    ]),
  );
});

it("blocks regalia and bonus discounts until their special tax treatment is implemented", () => {
  for (const discount_code of ["01", "02", "03"])
    expect(
      calculateInvoice([
        line({
          fiscal: fiscal({
            discount_amount: "10",
            discount_code,
            discount_reason: "Regalía",
          }),
        }),
      ]),
    ).toMatchObject({
      status: "blocked",
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "DISCOUNT_SPECIAL_TREATMENT_UNSUPPORTED",
        }),
      ]),
    });
});
const validExoneration = {
  document_type: "01",
  document_number: "ABC",
  institution: "01",
  issue_date: "2026-01-01T00:00:00-06:00",
  rate: "8",
};
const readiness = (f = fiscal(), receiver = receiverInput.parse({})) =>
  validateInvoiceForIssuance({
    document_type: "TE",
    receiver,
    lines: [line({ fiscal: f })],
  });
it("validates exoneration catalog codes, timezone, articles and other descriptions", () => {
  expect(
    readiness(
      fiscal({ treatment: "exonerated", exoneration: validExoneration }),
    ),
  ).toEqual([]);
  for (const change of [
    { document_type: "42" },
    { institution: "42" },
    { issue_date: "2026-01-01" },
    { document_number: "AB" },
    { document_type: "02" },
    { document_type: "99", document_other: "abc" },
    { institution: "99", institution_other: "abc" },
    { inciso: "1.2" },
    { article: "1234567" },
  ])
    expect(
      readiness(
        fiscal({
          treatment: "exonerated",
          exoneration: { ...validExoneration, ...change },
        }),
      ).length,
    ).toBeGreaterThan(0);
  for (const document_type of ["04", "11"])
    expect(
      readiness(
        fiscal({
          treatment: "exonerated",
          exoneration: { ...validExoneration, document_type },
        }),
      ),
    ).toContainEqual(
      expect.objectContaining({ code: "EXONERATION_AUTHORIZATION_UNVERIFIED" }),
    );
  for (const rate of ["0", "8.001", "14"])
    expect(
      calculateInvoice([
        line({
          fiscal: fiscal({
            treatment: "exonerated",
            exoneration: { ...validExoneration, rate },
          }),
        }),
      ]).status,
    ).toBe("blocked");
});
it("requires details for discount other and accepts ordinary discount codes", () => {
  expect(
    readiness(
      fiscal({
        discount_amount: "1",
        discount_code: "99",
        discount_reason: "Otro",
      }),
    ),
  ).toContainEqual(
    expect.objectContaining({ code: "DISCOUNT_DETAILS_MISSING" }),
  );
  expect(
    readiness(
      fiscal({
        discount_amount: "1",
        discount_code: "99",
        discount_reason: "Otro",
        discount_other: "Acuerdo comercial",
      }),
    ),
  ).toEqual([]);
});
it("captures conditional receiver evidence and requires explicit FE domicile", () => {
  const base = {
    name: "Cliente",
    identification_type: "06",
    identification: "123",
  };
  const check = (extra = {}) =>
    validateInvoiceForIssuance({
      document_type: "FE",
      receiver: receiverInput.parse({ ...base, ...extra }),
      lines: [line()],
    });
  expect(check()).toContainEqual(
    expect.objectContaining({ code: "RECEIVER_DOMICILE_UNCONFIRMED" }),
  );
  expect(check({ domicile: "domestic" })).toContainEqual(
    expect.objectContaining({ code: "RECEIVER_DOMICILE_INCOMPLETE" }),
  );
  expect(
    check({
      domicile: "domestic",
      province: "1",
      canton: "01",
      district: "01",
      address: "San José",
    }),
  ).toEqual([]);
  expect(
    check({
      domicile: "foreign",
      foreign_address: "Road abroad",
      requires_activity: true,
      requires_email: true,
    }),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "RECEIVER_ACTIVITY_MISSING" }),
      expect.objectContaining({ code: "RECEIVER_EMAIL_MISSING" }),
    ]),
  );
  expect(
    check({
      domicile: "foreign",
      foreign_address: "Road abroad",
      economic_activity: "123456",
    }),
  ).toEqual([]);
});
it("uses official unit codes and requires a commercial description for Otros", () => {
  const input = {
    document_type: "FE" as const,
    receiver: receiverInput.parse({
      name: "Cliente",
      identification_type: "01",
      identification: "123456789",
      domicile: "foreign",
    }),
    lines: [line({ fiscal: fiscal({ unit: "fake-unit" }) })],
  };
  expect(
    validateInvoiceForIssuance(input).some((i) => i.code === "UNIT_MISSING"),
  ).toBe(true);
  input.lines = [line({ fiscal: fiscal({ unit: "Otros" }) })];
  expect(
    validateInvoiceForIssuance(input).some(
      (i) => i.code === "COMMERCIAL_UNIT_MISSING",
    ),
  ).toBe(true);
  input.lines = [
    line({
      fiscal: fiscal({ unit: "Otros", commercial_unit: "Unidad comercial" }),
    }),
  ];
  expect(
    validateInvoiceForIssuance(input).some(
      (i) => i.code === "COMMERCIAL_UNIT_MISSING" || i.code === "UNIT_MISSING",
    ),
  ).toBe(false);
});
