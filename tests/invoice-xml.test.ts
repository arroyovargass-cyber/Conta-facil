import { expect, it } from "vitest";
import { createHash } from "node:crypto";
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

function ticketFixture() {
  const x = xmlFixture();
  (x.snapshot as any).document_type = "TE";
  x.snapshot.receiver = receiverInput.parse({});
  x.consecutivo = "00100001040000000001";
  x.clave = "506241126003101234567" + x.consecutivo + "112345678";
  return x;
}

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
it("can reproduce legacy frozen XML without enabling new invoices with unresolved IVA refunds", () => {
  const x = xmlFixture();
  x.snapshot.lines[0].fiscal!.cabys = "8399000000000";
  x.snapshot.lines[0].fiscal!.tariff_code = "04";
  x.snapshot.totals = calculateInvoice(x.snapshot.lines);
  x.options = emissionOptionsInput.parse({
    ...x.options,
    payment_methods: [{ code: "02", amount: "2080" }],
  });
  x.snapshot.calculation_version = "fe-iva-v1-line-half-up-5";
  expect(generateInvoiceXml(x)).toContain(
    "<TotalComprobante>2080.00000</TotalComprobante>",
  );
  x.snapshot.document_type = "FE";
  x.snapshot.calculation_version = "billing44-v2-line-half-up-5";
  expect(() => generateInvoiceXml(x)).toThrow(
    "IVA_RETURN_ELIGIBILITY_UNVERIFIED",
  );
});
it("preserves the original FE XML bytes for a frozen calculation from before the workspace update", () => {
  const x = xmlFixture();
  if (x.snapshot.totals.status !== "complete") throw Error("fixture");
  const { charges, otherCharges, ivaReturned, summary, ...original } =
    x.snapshot.totals;
  x.snapshot.totals = {
    ...original,
    lines: original.lines.map(({ tax_base, taxes, ...line }) => line),
  } as any;
  x.snapshot.calculation_version = "fe-iva-v1-line-half-up-5";
  // Captured from the baseline generator and calculation at HEAD before this change.
  expect(createHash("sha256").update(generateInvoiceXml(x)).digest("hex")).toBe(
    "5fc9956a33e4b59d1424cba76749a45a00634113582ecdb5ee946bc019ff3dc4",
  );
  (x.snapshot.totals as any).lines[0].tax = "259.00000";
  expect(() => generateInvoiceXml(x)).toThrow("Frozen calculation mismatch");
});
it("generates an explicitly selected consumer-final TE without inventing a receiver", () => {
  const x = ticketFixture();
  const xml = generateInvoiceXml(x);
  expect(xml).toContain(
    '<TiqueteElectronico xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/tiqueteElectronico">',
  );
  expect(xml).toContain("<TotalComprobante>2260.00000</TotalComprobante>");
  expect(xml).not.toContain("<Receptor>");
  expect(xml).not.toContain("CodigoActividadReceptor");
  expect(xml).not.toContain("TipoTransaccion");
  expect(() =>
    generateInvoiceXml({ ...x, consecutivo: "00100001010000000001" }),
  ).toThrow();
  delete (x.snapshot as any).document_type;
  expect(() => generateInvoiceXml(x)).toThrow();
});
it("includes a name-only TE receiver and omits FE-only activity and transaction fields", () => {
  const x = ticketFixture();
  x.snapshot.receiver = receiverInput.parse({
    name: "Cliente ocasional",
    economic_activity: "4520.0",
  });
  (x.snapshot.lines[0].fiscal as any).transaction_type = "01";
  x.snapshot.totals = calculateInvoice(x.snapshot.lines);
  const xml = generateInvoiceXml(x);
  expect(xml).toContain(
    "<Receptor><Nombre>Cliente ocasional</Nombre></Receptor>",
  );
  expect(xml).not.toContain("CodigoActividadReceptor");
  expect(xml).not.toContain("TipoTransaccion");
});
it("preserves an explicitly supplied phone country code without inventing one", () => {
  const x = xmlFixture();
  x.snapshot.receiver.phone = "2222-3333";
  x.snapshot.receiver.phone_country_code = "506";
  expect(generateInvoiceXml(x)).toContain(
    "<Telefono><CodigoPais>506</CodigoPais><NumTelefono>22223333</NumTelefono></Telefono>",
  );
  x.snapshot.receiver.phone_country_code = "";
  expect(generateInvoiceXml(x)).not.toContain("<Telefono>");
});
it("preserves an optional foreign TE receiver identity and supplied foreign address", () => {
  const x = ticketFixture();
  x.snapshot.receiver = receiverInput.parse({
    name: "Turista prueba",
    identification_type: "05",
    identification: "AB123",
    domicile: "foreign",
    foreign_address: "Dirección del extranjero",
  });
  const xml = generateInvoiceXml(x);
  expect(xml).toContain(
    "<Identificacion><Tipo>05</Tipo><Numero>AB123</Numero></Identificacion>",
  );
  expect(xml).toContain(
    "<OtrasSenasExtranjero>Dirección del extranjero</OtrasSenasExtranjero>",
  );
});
it("serializes frozen explicit-base charges and code99 payment details in official sequence", () => {
  const x = xmlFixture();
  (x.snapshot as any).other_charges = [
    {
      code: "99",
      other_description: "Cargo administrativo",
      description: "Gestión comercial",
      third_party_type: "",
      third_party_identification: "",
      third_party_name: "",
      mode: "percentage",
      amount: "",
      percentage: "0.5",
      percentage_base: "2000",
    },
  ];
  x.snapshot.totals = (calculateInvoice as any)(
    x.snapshot.lines,
    (x.snapshot as any).other_charges,
  );
  x.options.payment_methods = [
    { code: "99", amount: "2270", other_description: "Pago acordado" } as any,
  ];
  const xml = generateInvoiceXml(x);
  expect(xml).toContain(
    "</DetalleServicio><OtrosCargos><TipoDocumentoOC>99</TipoDocumentoOC><TipoDocumentoOTROS>Cargo administrativo</TipoDocumentoOTROS><Detalle>Gestión comercial</Detalle><PorcentajeOC>0.5</PorcentajeOC><MontoCargo>10.00000</MontoCargo></OtrosCargos><ResumenFactura>",
  );
  expect(xml).toContain(
    "<TotalOtrosCargos>10.00000</TotalOtrosCargos><MedioPago><TipoMedioPago>99</TipoMedioPago><MedioPagoOtros>Pago acordado</MedioPagoOtros><TotalMedioPago>2270.00000</TotalMedioPago>",
  );
  expect(xml).toContain("<TotalComprobante>2270.00000");
  (x.snapshot.totals as any).charges[0].calculated_amount = "1.00000";
  expect(() => generateInvoiceXml(x)).toThrow("Frozen calculation mismatch");
});
it("omits DetalleServicio for an allowed charge-only document", () => {
  const x = xmlFixture();
  x.snapshot.lines = [];
  x.snapshot.other_charges = [
    {
      code: "08",
      other_description: "",
      description: "Depósito de garantía",
      third_party_type: "",
      third_party_identification: "",
      third_party_name: "",
      mode: "amount",
      amount: "100",
      percentage: "",
      percentage_base: "",
    },
  ];
  x.snapshot.totals = calculateInvoice([], x.snapshot.other_charges);
  x.options.payment_methods = [{ code: "01", amount: "100" }];
  const xml = generateInvoiceXml(x);
  expect(xml).not.toContain("DetalleServicio");
  expect(xml).toContain("<MontoCargo>100.00000</MontoCargo>");
  expect(xml).toContain("<TotalComprobante>100.00000</TotalComprobante>");
});
it("serializes commercial codes, VINs and separate commercial/IVA bases with verified cement tax", () => {
  const x = xmlFixture();
  x.snapshot.lines = [
    {
      ...x.snapshot.lines[0],
      quantity: "1",
      unit_price: "100",
      fiscal: {
        ...x.snapshot.lines[0].fiscal!,
        transaction_type: "01",
        commercial_codes: [{ type: "04", code: "SKU<&" }],
        vin_numbers: ["ABC12345678901234"],
        other_taxes: [{ code: "12", rate: "5", other_description: "" }],
      } as any,
    },
  ];
  x.snapshot.totals = calculateInvoice(x.snapshot.lines);
  x.options.payment_methods = [{ code: "01", amount: "118.65" }];
  const xml = generateInvoiceXml(x);
  expect(xml).toContain(
    "<CodigoComercial><Tipo>04</Tipo><Codigo>SKU&lt;&amp;</Codigo></CodigoComercial><Cantidad>1</Cantidad><UnidadMedida>Unid</UnidadMedida><TipoTransaccion>01</TipoTransaccion>",
  );
  expect(xml).toContain(
    "<NumeroVINoSerie>ABC12345678901234</NumeroVINoSerie><PrecioUnitario>100.00000",
  );
  expect(xml).toContain(
    "<SubTotal>100.00000</SubTotal><BaseImponible>105.00000</BaseImponible>",
  );
  expect(xml).toContain(
    "<Impuesto><Codigo>12</Codigo><Tarifa>5</Tarifa><Monto>5.00000</Monto></Impuesto>",
  );
  expect(xml).toContain("<TotalComprobante>118.65000");
});
it("emits validated references after the summary and enforces the ten-year issue-date window", () => {
  const x = xmlFixture();
  x.options.references = [
    {
      document_type: "01",
      document_other: "",
      number: "5".repeat(50),
      issue_date: "2026-01-01T00:00:00-06:00",
      code: "04",
      code_other: "",
      reason: "Factura relacionada",
    },
  ];
  const xml = generateInvoiceXml(x);
  expect(xml).toContain(
    "</ResumenFactura><InformacionReferencia><TipoDocIR>01</TipoDocIR><Numero>" +
      "5".repeat(50) +
      "</Numero><FechaEmisionIR>2026-01-01T00:00:00-06:00</FechaEmisionIR><Codigo>04</Codigo><Razon>Factura relacionada</Razon></InformacionReferencia>",
  );
  x.options.references[0].issue_date = "2016-11-24T12:00:00-06:00";
  expect(() => generateInvoiceXml(x)).not.toThrow();
  x.options.references[0].issue_date = "2016-11-24T11:59:59-06:00";
  expect(() => generateInvoiceXml(x)).toThrow("REFERENCE_DATE_OUT_OF_RANGE");
  x.options.references[0].issue_date = "2026-11-25T12:00:00-06:00";
  expect(() => generateInvoiceXml(x)).toThrow("REFERENCE_DATE_OUT_OF_RANGE");
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
it("uses the shared per-line half-up allocation for partial relief summaries", () => {
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
  const xml = generateInvoiceXml(x);
  // 2.46912 × 0.12346 / 0.32099 = 0.94968017… → 0.94968, remainder 1.51944.
  expect(xml).toContain(
    "<TotalMercanciasGravadas>1.51944</TotalMercanciasGravadas>",
  );
  expect(xml).toContain("<TotalMercExonerada>0.94968</TotalMercExonerada>");
});
