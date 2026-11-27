import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { xmlFixture } from "./support/invoice-fixture";
import {
  calculateInvoice,
  lineFiscalInput,
  receiverInput,
} from "../packages/domain/src/invoice-fiscal";
import { generateInvoiceXml } from "../apps/api/src/services/invoice-xml";
import {
  signInvoiceXml,
  verifyInvoiceSignature,
} from "../apps/api/src/security/invoice-signature";
import { validateSignedInvoiceXml } from "../apps/api/src/services/invoice-schema-validation";
it("validates complete official FE plus real synthetic RSA XAdES and rejects malformed structure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "schema-signature-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(dir, "key"),
        "-out",
        join(dir, "cert"),
        "-days",
        "2",
        "-subj",
        "/CN=Synthetic",
      ],
      { stdio: "ignore" },
    );
    const certificatePem = readFileSync(join(dir, "cert"), "utf8");
    const unsigned = generateInvoiceXml(xmlFixture());
    const signed = signInvoiceXml(unsigned, {
      privateKeyPem: readFileSync(join(dir, "key"), "utf8"),
      certificatePem,
      signedAt: new Date().toISOString(),
      policy: {
        url: "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/Resoluci%C3%B3n_General_sobre_disposiciones_t%C3%A9cnicas_comprobantes_electr%C3%B3nicos_para_efectos_tributarios.pdf",
        sha256Base64: "DWxin1xWOeI8OuWQXazh4VjLWAaCLAA954em7DMh0h8=",
      },
    });
    expect(verifyInvoiceSignature(signed, certificatePem)).toBe(true);
    expect(await validateSignedInvoiceXml(signed)).toEqual({
      valid: true,
      issues: [],
    });
    const material = {
      privateKeyPem: readFileSync(join(dir, "key"), "utf8"),
      certificatePem,
      signedAt: new Date().toISOString(),
      policy: {
        url: "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/Resoluci%C3%B3n_General_sobre_disposiciones_t%C3%A9cnicas_comprobantes_electr%C3%B3nicos_para_efectos_tributarios.pdf",
        sha256Base64: "DWxin1xWOeI8OuWQXazh4VjLWAaCLAA954em7DMh0h8=",
      },
    };
    const specialized = xmlFixture();
    specialized.snapshot.document_type = "FE";
    specialized.snapshot.lines = [
      {
        quantity: "1",
        unit_price: "100",
        description: "Detalle sintético de campos",
        fiscal: lineFiscalInput.parse({
          cabys: "1234567890123",
          unit: "Unid",
          treatment: "taxable",
          tariff_code: "08",
          commercial_codes: [{ type: "04", code: "SKU-01" }],
          transaction_type: "01",
          vin_numbers: ["ABC12345678901234"],
          medicine_registration: "REGISTRO-SINTETICO",
          pharmaceutical_form: "01",
          other_taxes: [{ code: "12", rate: "5" }],
        }),
      },
    ];
    specialized.snapshot.other_charges = [
      {
        code: "04",
        other_description: "",
        description: "Cobro por cuenta de tercero",
        third_party_type: "05",
        third_party_identification: "AB123",
        third_party_name: "Tercero extranjero",
        mode: "amount",
        amount: "10",
        percentage: "",
        percentage_base: "",
      },
    ];
    specialized.snapshot.totals = calculateInvoice(
      specialized.snapshot.lines,
      specialized.snapshot.other_charges,
    );
    specialized.options.issuer_activity = "4520.0";
    specialized.options.payment_methods = [
      { code: "99", amount: "128.65", other_description: "Pago acordado" },
    ];
    specialized.options.references = [
      {
        document_type: "01",
        document_other: "",
        number: "5".repeat(50),
        issue_date: "2026-01-01T00:00:00-06:00",
        code: "04",
        code_other: "",
        reason: "Documento relacionado",
      },
    ];
    expect(
      await validateSignedInvoiceXml(
        signInvoiceXml(generateInvoiceXml(specialized), material),
      ),
    ).toEqual({ valid: true, issues: [] });
    const ticket = xmlFixture();
    ticket.snapshot.document_type = "TE";
    ticket.snapshot.receiver = receiverInput.parse({});
    ticket.consecutivo = "00100001040000000001";
    ticket.clave = "506241126003101234567" + ticket.consecutivo + "112345678";
    ticket.snapshot.other_charges = [
      {
        code: "99",
        other_description: "Cargo administrativo",
        description: "Gestión adicional",
        third_party_type: "",
        third_party_identification: "",
        third_party_name: "",
        mode: "amount",
        amount: "10",
        percentage: "",
        percentage_base: "",
      },
    ];
    ticket.snapshot.lines.push({
      quantity: "1",
      unit_price: "100",
      description: "Servicio exento",
      fiscal: lineFiscalInput.parse({
        cabys: "5123456789012",
        unit: "Sp",
        treatment: "exempt",
        tariff_code: "10",
      }),
    });
    ticket.snapshot.totals = calculateInvoice(
      ticket.snapshot.lines,
      ticket.snapshot.other_charges,
    );
    ticket.options.payment_methods = [{ code: "01", amount: "2370" }];
    const ticketUnsigned = generateInvoiceXml(ticket);
    const ticketSigned = signInvoiceXml(ticketUnsigned, {
      privateKeyPem: readFileSync(join(dir, "key"), "utf8"),
      certificatePem,
      signedAt: new Date().toISOString(),
      policy: {
        url: "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/Resoluci%C3%B3n_General_sobre_disposiciones_t%C3%A9cnicas_comprobantes_electr%C3%B3nicos_para_efectos_tributarios.pdf",
        sha256Base64: "DWxin1xWOeI8OuWQXazh4VjLWAaCLAA954em7DMh0h8=",
      },
    });
    expect(verifyInvoiceSignature(ticketSigned, certificatePem)).toBe(true);
    expect(await validateSignedInvoiceXml(ticketSigned)).toEqual({
      valid: true,
      issues: [],
    });
    ticket.snapshot.receiver = receiverInput.parse({
      name: "Cliente ocasional",
    });
    ticket.options.sale_condition = "02";
    ticket.options.credit_days = 30;
    ticket.options.payment_methods = [];
    const namedTicket = generateInvoiceXml(ticket);
    expect(namedTicket).toContain(
      "<Receptor><Nombre>Cliente ocasional</Nombre></Receptor>",
    );
    expect(namedTicket).toContain("<PlazoCredito>30</PlazoCredito>");
    expect(namedTicket).not.toContain("FechaVencimiento");
    expect(
      await validateSignedInvoiceXml(signInvoiceXml(namedTicket, material)),
    ).toEqual({ valid: true, issues: [] });
    ticket.snapshot.lines = [];
    ticket.snapshot.other_charges[0].code = "08";
    ticket.snapshot.other_charges[0].other_description = "";
    ticket.snapshot.totals = calculateInvoice(
      [],
      ticket.snapshot.other_charges,
    );
    expect(
      await validateSignedInvoiceXml(
        signInvoiceXml(generateInvoiceXml(ticket), material),
      ),
    ).toEqual({ valid: true, issues: [] });
    for (const malformed of [
      ticketUnsigned,
      ticketSigned.replace(
        "</CodigoActividadEmisor>",
        "</CodigoActividadEmisor><CodigoActividadReceptor>4520.0</CodigoActividadReceptor>",
      ),
      ticketSigned.replace(
        "</UnidadMedida>",
        "</UnidadMedida><TipoTransaccion>01</TipoTransaccion>",
      ),
      ticketSigned.replace("</Nombre>", "</Nombre><Invalid>1</Invalid>"),
      ticketSigned.replace(
        "<MontoCargo>10.00000</MontoCargo>",
        "<MontoCargo>10.000001</MontoCargo>",
      ),
      ticketSigned.replace("/tiqueteElectronico", "/facturaElectronica"),
    ])
      expect((await validateSignedInvoiceXml(malformed)).valid).toBe(false);
    for (const xml of [
      unsigned,
      signed.replaceAll("TotalComprobante", "BadTotal"),
      signed.replaceAll("FacturaElectronica", "WrongRoot"),
      '<!DOCTYPE x [<!ENTITY ext SYSTEM "https://evil.invalid/x">]>' + signed,
      signed
        .replace(
          "xmlns=",
          'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="https://evil.invalid/a https://evil.invalid/a.xsd" xmlns=',
        )
        .replaceAll("TotalComprobante", "BadTotal"),
    ])
      expect((await validateSignedInvoiceXml(xml)).valid).toBe(false);
    expect(
      (await validateSignedInvoiceXml(" ".repeat(1048577))).issues,
    ).toContain("XML_SIZE_EXCEEDED");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20000);
