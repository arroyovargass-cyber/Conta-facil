import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";
import { frozenInvoiceCalculation, type InvoiceXmlInput } from "./invoice-xml";
import type { EmissionOptions } from "../../../../packages/domain/src/emission";
import { haciendaEnvironmentInput } from "../../../../packages/domain/src/hacienda-environment";
const netTax = (tax: string, exoneration: string) => {
  const units = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * 100000n + BigInt(fraction.padEnd(5, "0"));
  };
  const value = units(tax) - units(exoneration);
  return `${value / 100000n}.${(value % 100000n).toString().padStart(5, "0")}`;
};
export async function renderInvoicePdf(input: {
  snapshot: InvoiceXmlInput["snapshot"];
  clave: string;
  consecutivo: string;
  issued_at: string;
  hacienda_status: "pending" | "accepted" | "rejected";
  environment?: "test" | "production";
  options?: EmissionOptions;
}): Promise<Buffer> {
  const environment = haciendaEnvironmentInput.parse(input.environment);
  const environmentLabel =
    environment === "production"
      ? "Ambiente de producción"
      : "Ambiente de pruebas";
  const { snapshot: s } = input;
  const t = frozenInvoiceCalculation(s);
  if (!t) throw Error("INVOICE_PDF_TOTALS_MISMATCH");
  if (
    !/^\d{50}$/.test(input.clave) ||
    !/^\d{20}$/.test(input.consecutivo) ||
    input.clave.slice(21, 41) !== input.consecutivo ||
    input.consecutivo.slice(8, 10) !==
      (s.document_type === "TE" ? "04" : "01") ||
    (s.document_type !== undefined &&
      !["FE", "TE"].includes(s.document_type)) ||
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
  doc.setSubject(environmentLabel);
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
  line(
    s.document_type === "TE"
      ? "Tiquete electrónico"
      : "Factura electrónica nacional",
    16,
  );
  line(environmentLabel, 12);
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
  if (s.issuer.phone) line(`Teléfono: ${s.issuer.phone}`);
  line(
    `Receptor: ${s.receiver.name || (s.document_type === "TE" ? "Consumidor final" : "")}`,
  );
  if (s.receiver.identification)
    line(
      `Identificación: ${s.receiver.identification_type} / ${s.receiver.identification}`,
    );
  if (s.receiver.trade_name) line(`Nombre comercial: ${s.receiver.trade_name}`);
  if (s.receiver.foreign_address || s.receiver.address)
    line(`Dirección: ${s.receiver.foreign_address || s.receiver.address}`);
  if (s.receiver.email) line(`Correo: ${s.receiver.email}`);
  if (s.receiver.phone) line(`Teléfono: ${s.receiver.phone}`);
  if (s.receiver.economic_activity && s.document_type !== "TE")
    line(`Actividad del receptor: ${s.receiver.economic_activity}`);
  line(`Clave / referencia de consulta: ${input.clave}`);
  line(`Consecutivo: ${input.consecutivo}`);
  line(`Fecha de emisión: ${input.issued_at}`);
  if (input.options) {
    line(
      `Condición de venta: ${input.options.sale_condition === "02" ? "Crédito" : "Contado"}`,
    );
    if (input.options.issuer_activity)
      line(`Actividad del emisor: ${input.options.issuer_activity}`);
    if (input.options.sale_condition === "02") {
      const days = input.options.credit_days;
      if (!Number.isInteger(days) || days! < 1 || days! > 99999)
        throw Error("INVOICE_PDF_INVALID_METADATA");
      // Immutable issuance instant, then calendar days in Costa Rica (UTC−06:00, no DST).
      const due = new Date(
        Date.parse(input.issued_at) - 6 * 3600000 + days! * 86400000,
      )
        .toISOString()
        .slice(0, 10);
      line(`Plazo de crédito: ${days} días`);
      line(`Vencimiento comercial: ${due} (Costa Rica)`);
    }
  }
  line(`Moneda: ${s.currency}`);
  s.lines.forEach((l, i) => {
    const a = t.lines[i],
      f = l.fiscal!;
    line(`${i + 1}. ${l.description ?? ""}`, 11);
    line(
      `CABYS: ${f.cabys} | Cantidad: ${l.quantity} ${f.unit} | Precio: ${l.unit_price}`,
    );
    line(
      `Importe: ${a.beforeDiscount} | Descuento: ${a.discount} | Base comercial: ${a.base} | Base IVA: ${a.tax_base}`,
    );
    for (const tax of a.taxes)
      line(
        `${tax.code === "01" ? "IVA" : "Impuesto " + tax.code} ${tax.rate}%: ${tax.amount} | Exoneración: ${tax.exoneration}`,
      );
    line(`Total de línea: ${a.total}`);
    if (f.internal_code) line(`Código interno: ${f.internal_code}`);
    for (const code of f.commercial_codes ?? [])
      line(`Código comercial ${code.type}: ${code.code}`);
    if (f.transaction_type && s.document_type !== "TE")
      line(`Tipo de transacción: ${f.transaction_type}`);
    if (f.vin_numbers?.length) line(`VIN / serie: ${f.vin_numbers.join(", ")}`);
    if (f.medicine_registration)
      line(`Registro sanitario: ${f.medicine_registration}`);
    if (f.pharmaceutical_form)
      line(`Forma farmacéutica: ${f.pharmaceutical_form}`);
  });
  line("Desglose de impuestos", 12);
  for (const g of t.groups)
    line(
      `${g.tax_code === "01" ? "IVA" : "Impuesto"} código ${g.tax_code}${g.tariff_code ? ", tarifa " + g.tariff_code : ""} (${g.rate}%): base ${g.base}; impuesto ${g.tax}; exoneración ${g.exoneration}`,
    );
  line(
    `Venta: ${t.beforeDiscount} | Descuentos: ${t.discounts} | Subtotal: ${t.subtotal}`,
  );
  line(
    `Impuestos antes de exoneraciones: ${t.tax} | Exoneraciones: ${t.exonerations}`,
  );
  line(`Total de impuestos: ${netTax(t.tax, t.exonerations)}`);
  if (t.charges.length) {
    line("Otros cargos", 12);
    for (const charge of t.charges) {
      line(
        `${charge.code}: ${charge.description} | Monto: ${charge.calculated_amount}`,
      );
      if (charge.other_description)
        line(`Tipo de cargo: ${charge.other_description}`);
      if (charge.mode === "percentage")
        line(
          `Porcentaje: ${charge.percentage}% sobre base comercial explícita: ${charge.percentage_base}`,
        );
      if (charge.third_party_name)
        line(
          `Tercero: ${charge.third_party_name} | ${charge.third_party_type} / ${charge.third_party_identification}`,
        );
    }
    line(`Otros cargos: ${t.otherCharges}`);
  }
  if (t.ivaReturned !== "0.00000") line(`IVA devuelto: ${t.ivaReturned}`);
  if (input.options)
    for (const payment of input.options.payment_methods)
      line(
        `Medio de pago ${payment.code}${payment.other_description ? " / " + payment.other_description : ""}: ${payment.amount}`,
      );
  for (const ref of input.options?.references ?? []) {
    line(
      `Referencia ${ref.document_type}${ref.document_other ? " / " + ref.document_other : ""}: ${ref.number} | Fecha: ${ref.issue_date}`,
    );
    if (ref.code || ref.reason)
      line(
        `Código ${ref.code}${ref.code_other ? " / " + ref.code_other : ""}: ${ref.reason}`,
      );
  }
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
