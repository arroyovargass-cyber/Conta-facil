import { isDeepStrictEqual } from "node:util";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";
import {
  calculateInvoice,
  IVA_TARIFFS,
} from "../../../../packages/domain/src/invoice-fiscal";
import type { InvoiceXmlInput } from "./invoice-xml";
export async function renderInvoicePdf(input: {
  snapshot: InvoiceXmlInput["snapshot"];
  clave: string;
  consecutivo: string;
  issued_at: string;
  hacienda_status: "pending" | "accepted" | "rejected";
}): Promise<Buffer> {
  const { snapshot: s } = input;
  const t = calculateInvoice(s.lines);
  if (t.status !== "complete" || !isDeepStrictEqual(t, s.totals))
    throw Error("INVOICE_PDF_TOTALS_MISMATCH");
  if (
    !/^\d{50}$/.test(input.clave) ||
    !/^\d{20}$/.test(input.consecutivo) ||
    !Number.isFinite(Date.parse(input.issued_at)) ||
    !["pending", "accepted", "rejected"].includes(input.hacienda_status)
  )
    throw Error("INVOICE_PDF_INVALID_METADATA");
  // Fixed repository asset, also available when the server is bundled at the repository root.
  const fontBytes = await readFile(
    resolve("apps/api/assets/fonts/DejaVuSans.ttf"),
  );
  if (
    createHash("sha256").update(fontBytes).digest("hex") !==
    "57f73e11f51999432bf7ab22ce55b6f945d5eca1bf824404cfa9ec2e3718c84e"
  )
    throw Error("INVOICE_PDF_FONT_INTEGRITY");
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: true });
  const characters = new Set(font.getCharacterSet());
  let page = doc.addPage([595, 842]),
    y = 800;
  function line(text: string, size = 10) {
    text = text.replace(/[\r\n\t]/g, " ");
    // Fontkit can silently emit a missing-glyph box; reject before any encoding or measuring.
    if ([...text].some((c) => !characters.has(c.codePointAt(0)!)))
      throw Error(
        "INVOICE_PDF_UNSUPPORTED_CHARACTER: la fuente no admite este texto",
      );
    font.encodeText(text);
    const chunks: string[] = [];
    let current = "";
    for (const c of text.replace(/[\r\n\t]/g, " ")) {
      if (font.widthOfTextAtSize(current + c, size) > 505) {
        chunks.push(current);
        current = "";
      }
      current += c;
    }
    chunks.push(current);
    for (const chunk of chunks) {
      if (y < 48) {
        page = doc.addPage([595, 842]);
        y = 800;
      }
      page.drawText(chunk, { x: 45, y, size, font, color: rgb(0, 0, 0) });
      y -= size + 5;
    }
  }
  line("Factura electrónica nacional", 16);
  line("Ambiente de pruebas", 12);
  line("Representación gráfica del comprobante electrónico");
  line(
    `Estado de Hacienda: ${{ pending: "Pendiente", accepted: "Aceptado", rejected: "Rechazado" }[input.hacienda_status]}`,
  );
  line(`Emisor: ${s.issuer.legal_name}`);
  line(
    `Identificación: ${s.issuer.identification_type} / ${s.issuer.identification}`,
  );
  if (s.issuer.trade_name) line(`Nombre comercial: ${s.issuer.trade_name}`);
  line(`Dirección: ${s.issuer.address}`);
  line(`Correo: ${s.issuer.contact_email}`);
  line(`Receptor: ${s.receiver.name}`);
  line(
    `Identificación: ${s.receiver.identification_type} / ${s.receiver.identification}`,
  );
  line(`Clave / referencia de consulta: ${input.clave}`);
  line(`Consecutivo: ${input.consecutivo}`);
  line(`Fecha de emisión: ${input.issued_at}`);
  line(`Moneda: ${s.currency}`);
  s.lines.forEach((l, i) => {
    const a = t.lines[i],
      f = l.fiscal!;
    line(`${i + 1}. ${l.description ?? ""}`, 11);
    line(
      `CABYS: ${f.cabys} | Cantidad: ${l.quantity} ${f.unit} | Precio: ${l.unit_price}`,
    );
    line(
      `Importe: ${a.beforeDiscount} | Descuento: ${a.discount} | Base: ${a.base}`,
    );
    line(
      `IVA ${IVA_TARIFFS[f.tariff_code].rate}%: ${a.tax} | Exoneración: ${a.exoneration} | Total: ${a.total}`,
    );
  });
  line("Desglose de impuestos", 12);
  for (const g of t.groups)
    line(
      `IVA código ${g.tax_code}, tarifa ${g.tariff_code} (${g.rate}%): base ${g.base}; impuesto ${g.tax}; exoneración ${g.exoneration}`,
    );
  line(
    `Venta: ${t.beforeDiscount} | Descuentos: ${t.discounts} | Subtotal: ${t.subtotal}`,
  );
  line(`IVA: ${t.tax} | Exoneraciones: ${t.exonerations}`);
  line(`Total ${s.currency}: ${t.total}`, 14);
  if (s.notes) line(`Notas: ${s.notes}`);
  for (const [i, p] of doc.getPages().entries())
    p.drawText(`Página ${i + 1} de ${doc.getPageCount()}`, {
      x: 45,
      y: 25,
      size: 9,
      font,
    });
  return Buffer.from(await doc.save());
}
