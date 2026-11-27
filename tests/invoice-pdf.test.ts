import { expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  calculateInvoice,
  lineFiscalInput,
  receiverInput,
} from "../packages/domain/src/invoice-fiscal";
import { renderInvoicePdf } from "../apps/api/src/services/invoice-pdf";
import { renderDraftPrint } from "../apps/api/src/services/draft-print";
import { xmlFixture } from "./support/invoice-fixture";
function fixture() {
  const lines = [
    {
      quantity: "2",
      unit_price: "1000",
      description: "Artículo prueba",
      fiscal: lineFiscalInput.parse({
        cabys: "1234567890123",
        unit: "Unid",
        treatment: "taxable",
        tariff_code: "08",
      }),
    },
  ];
  return {
    snapshot: {
      issuer: {
        legal_name: "Empresa José",
        trade_name: "",
        identification_type: "02",
        identification: "3101234567",
        contact_email: "a@example.com",
        phone: "",
        address: "San José",
        configuration: {},
      },
      receiver: receiverInput.parse({
        name: "Cliente prueba",
        identification: "123456789",
      }),
      currency: "CRC" as const,
      lines,
      totals: calculateInvoice(lines),
    },
    clave: "50624112600310123456700100001010000000001112345678",
    consecutivo: "00100001010000000001",
    issued_at: "2026-11-24T12:00:00-06:00",
    hacienda_status: "pending" as const,
  };
}
it("renders a real PDF and paginates long names and 100 lines", async () => {
  const x = fixture();
  const bytes = await renderInvoicePdf(x);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
  x.snapshot.lines = Array.from({ length: 100 }, () => ({
    ...x.snapshot.lines[0],
    description: "Descripción ".repeat(50),
  }));
  x.snapshot.totals = calculateInvoice(x.snapshot.lines);
  expect(
    (await PDFDocument.load(await renderInvoicePdf(x))).getPageCount(),
  ).toBeGreaterThan(4);
});
it("rejects altered fiscal totals and unsupported identity glyphs clearly", async () => {
  const x = fixture();
  x.snapshot.totals = { ...x.snapshot.totals, total: "0" } as any;
  await expect(renderInvoicePdf(x)).rejects.toThrow("TOTALS_MISMATCH");
  const y = fixture();
  y.snapshot.issuer.legal_name = "公司";
  await expect(renderInvoicePdf(y)).rejects.toThrow("UNSUPPORTED_CHARACTER");
});
it("rejects a PDF whose number disagrees with the explicitly selected document profile", async () => {
  const x = fixture();
  await expect(
    renderInvoicePdf({
      ...x,
      snapshot: { ...x.snapshot, document_type: "TE" },
    }),
  ).rejects.toThrow("INVALID_METADATA");
  await expect(
    renderInvoicePdf({
      ...x,
      clave: x.clave.slice(0, 21) + "00100001010000000002" + x.clave.slice(41),
    }),
  ).rejects.toThrow("INVALID_METADATA");
});
it("preserves colones and Spanish identities in extracted PDF text and paginated totals", async () => {
  const x = fixture();
  x.snapshot.issuer.legal_name = "Compañía José ₡";
  x.snapshot.lines = [
    {
      ...x.snapshot.lines[0],
      quantity: "1",
      unit_price: "100",
      description: "Artículo caña ₡100",
    },
  ];
  x.snapshot.totals = calculateInvoice(x.snapshot.lines);
  const dir = mkdtempSync(join(tmpdir(), "invoice-pdf-"));
  try {
    const file = join(dir, "invoice.pdf"),
      output = join(dir, "invoice.txt");
    const extract = () => {
      execFileSync("pdftotext", ["-layout", file, output], { stdio: "ignore" });
      return readFileSync(output, "utf8");
    };
    writeFileSync(file, await renderInvoicePdf(x));
    const text = extract();
    expect(text).toContain("Compañía José ₡");
    expect(text).toContain("Artículo caña ₡100");
    expect(text).toContain("Total CRC: 113.00000");
    x.snapshot.lines = Array.from({ length: 100 }, () => ({
      ...x.snapshot.lines[0],
    }));
    x.snapshot.totals = calculateInvoice(x.snapshot.lines);
    const bytes = await renderInvoicePdf(x);
    writeFileSync(file, bytes);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(4);
    const longText = extract();
    expect(longText).toContain("100. Artículo caña ₡100");
    expect(longText).toContain("Total CRC: 11300.00000");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("identifies the document environment in both the printed text and PDF metadata", async () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-pdf-environment-"));
  try {
    for (const [environment, label] of [
      ["test", "Ambiente de pruebas"],
      ["production", "Ambiente de producción"],
    ] as const) {
      const bytes = await renderInvoicePdf({ ...fixture(), environment });
      const path = join(dir, "invoice.pdf"),
        output = join(dir, "invoice.txt");
      writeFileSync(path, bytes);
      execFileSync("pdftotext", ["-layout", path, output], { stdio: "ignore" });
      expect(readFileSync(output, "utf8")).toContain(label);
      expect((await PDFDocument.load(bytes)).getSubject()).toBe(label);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("prints TE, frozen charges and the credit due date derived from issuance in Costa Rica", async () => {
  const x = xmlFixture();
  x.snapshot.document_type = "TE";
  x.consecutivo = "00100001040000000001";
  x.clave = "506241126003101234567" + x.consecutivo + "112345678";
  x.snapshot.receiver = receiverInput.parse({});
  x.snapshot.other_charges = [
    {
      code: "99",
      other_description: "Gestión adicional",
      description: "Entrega pactada",
      third_party_type: "",
      third_party_identification: "",
      third_party_name: "",
      mode: "amount",
      amount: "10",
      percentage: "",
      percentage_base: "",
    },
  ];
  x.snapshot.totals = calculateInvoice(
    x.snapshot.lines,
    x.snapshot.other_charges,
  );
  x.options.sale_condition = "02";
  x.options.credit_days = 2;
  x.options.payment_methods = [];
  const dir = mkdtempSync(join(tmpdir(), "invoice-ticket-pdf-"));
  try {
    const path = join(dir, "ticket.pdf"),
      output = join(dir, "ticket.txt");
    writeFileSync(
      path,
      await renderInvoicePdf({
        ...x,
        issued_at: "2026-11-30T05:59:00Z",
        hacienda_status: "pending",
      }),
    );
    execFileSync("pdftotext", ["-layout", path, output], { stdio: "ignore" });
    const text = readFileSync(output, "utf8");
    for (const expected of [
      "Tiquete electrónico",
      "Consumidor final",
      "Otros cargos: 10.00000",
      "Entrega pactada",
      "Total CRC: 2270.00000",
      "Vencimiento comercial: 2026-12-01",
      "Costa Rica",
      "Plazo de crédito: 2 días",
    ])
      expect(text).toContain(expected);
    expect(text).not.toContain("Aceptado");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("prints draft issuer, charges, tax bases and credit terms without inventing an issue date", () => {
  const x = xmlFixture();
  x.snapshot.other_charges = [
    {
      code: "99",
      other_description: "Gestión adicional",
      description: "Entrega pactada <urgente>",
      third_party_type: "",
      third_party_identification: "",
      third_party_name: "",
      mode: "amount",
      amount: "10",
      percentage: "",
      percentage_base: "",
    },
  ];
  const html = renderDraftPrint(
    {
      ...x.snapshot,
      customer_snapshot: x.snapshot.receiver,
      document_type: "FE",
      version: 2,
      fiscal_totals: calculateInvoice(
        x.snapshot.lines,
        x.snapshot.other_charges,
      ),
      commercial: { ...x.options, sale_condition: "02", credit_days: 30 },
    },
    x.snapshot.issuer,
  );
  for (const expected of [
    "3101234567",
    "emisor@example.com",
    "Entrega pactada &lt;urgente&gt;",
    "Otros cargos",
    "10.00000",
    "2270.00000",
    "30 días",
    "sin validez tributaria",
  ])
    expect(html.toLowerCase()).toContain(expected.toLowerCase());
  expect(html).not.toContain("Otros cargos no habilitados");
  expect(html).not.toContain("[object Object]");
});
