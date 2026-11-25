import { expect, it } from "vitest";
import {
  calculateInvoice,
  lineFiscalInput,
  receiverInput,
} from "../packages/domain/src/invoice-fiscal";
import { emissionOptionsInput } from "../packages/domain/src/emission";
import {
  generateInvoiceXml,
  type InvoiceXmlInput,
} from "../apps/api/src/services/invoice-xml";
import { xmlFixture } from "./support/invoice-fixture";

it("generates unsigned FE4.4 with 2260, mandatory line fields and escaped values", () => {
  const xml = generateInvoiceXml(xmlFixture());
  expect(xml).toContain("<TotalComprobante>2260.00000</TotalComprobante>");
  expect(xml).toContain("Artículo &amp; prueba");
  expect(xml).toContain(
    "<ImpuestoAsumidoEmisorFabrica>0.00000</ImpuestoAsumidoEmisorFabrica>",
  );
  expect(xml).toContain("<TotalMercanciasGravadas>2000.00000");
  expect(xml).not.toContain("Signature");
});
it("rejects altered totals, identities, unsupported IDs and XML controls", () => {
  for (const mutate of [
    (x: InvoiceXmlInput) => {
      x.snapshot.totals = { ...x.snapshot.totals, total: "0" } as any;
    },
    (x: InvoiceXmlInput) => {
      x.clave = "0".repeat(50);
    },
    (x: InvoiceXmlInput) => {
      x.snapshot.issuer.identification_type = "05";
    },
    (x: InvoiceXmlInput) => {
      x.snapshot.lines[0].description = "bad\u0001";
    },
  ]) {
    const x = xmlFixture();
    mutate(x);
    expect(() => generateInvoiceXml(x)).toThrow();
  }
});
it("summarizes goods/services, all ordinary IVA treatments, discounts and tax relief", () => {
  const x = xmlFixture();
  x.snapshot.lines = [
    ["1234567890123", "taxable", "08"],
    ["5123456789012", "exempt", "10"],
    ["5123456789012", "non_subject", "11"],
    ["1234567890123", "exonerated", "08"],
    ["5123456789012", "taxable", "01"],
    ["1234567890123", "taxable", "02"],
  ].map(([cabys, treatment, tariff_code], i) => ({
    quantity: "1",
    unit_price: "100",
    description: "Artículo prueba",
    fiscal: lineFiscalInput.parse({
      cabys,
      unit: "Unid",
      treatment,
      tariff_code,
      ...(i === 0
        ? {
            discount_amount: "10",
            discount_code: "07",
            discount_reason: "Descuento comercial",
          }
        : {}),
      ...(i === 3
        ? {
            exoneration: {
              document_type: "01",
              document_number: "ABC123",
              institution: "01",
              issue_date: "2026-01-01T00:00:00-06:00",
              rate: "13",
            },
          }
        : {}),
    }),
  }));
  x.snapshot.totals = calculateInvoice(x.snapshot.lines);
  if (x.snapshot.totals.status !== "complete") throw Error("fixture");
  x.options.payment_methods = [{ code: "01", amount: x.snapshot.totals.total }];
  const xml = generateInvoiceXml(x);
  for (const expected of [
    "<TotalServExentos>100.00000",
    "<TotalServNoSujeto>200.00000",
    "<TotalMercExonerada>100.00000",
    "<TotalMercanciasGravadas>200.00000",
    "<TotalDescuentos>10.00000",
    "<MontoExoneracion>13.00000",
    "<TotalComprobante>602.70000",
  ])
    expect(xml).toContain(expected);
});
it("fails closed for unverified precision in partial relief summaries", () => {
  const x = xmlFixture();
  x.snapshot.lines[0].unit_price = "1.23456";
  x.snapshot.lines[0].fiscal!.treatment = "exonerated";
  x.snapshot.lines[0].fiscal!.exoneration = {
    document_type: "01",
    document_other: "",
    document_number: "ABC123",
    institution: "01",
    institution_other: "",
    issue_date: "2026-01-01T00:00:00-06:00",
    article: "",
    inciso: "",
    rate: "5",
  };
  x.snapshot.totals = calculateInvoice(x.snapshot.lines);
  if (x.snapshot.totals.status !== "complete") throw Error("fixture");
  x.options.payment_methods = [{ code: "01", amount: x.snapshot.totals.total }];
  expect(() => generateInvoiceXml(x)).toThrow(
    "EXONERATION_SUMMARY_PRECISION_UNVERIFIED",
  );
});
