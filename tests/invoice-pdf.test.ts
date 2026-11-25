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
    clave: "1".repeat(50),
    consecutivo: "1".repeat(20),
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
