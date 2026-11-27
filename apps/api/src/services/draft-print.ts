import { calculateInvoice } from "../../../../packages/domain/src/invoice-fiscal";
import type { InvoiceXmlInput } from "./invoice-xml";
const netTax = (tax: string, exoneration: string) => {
  const units = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * 100000n + BigInt(fraction.padEnd(5, "0"));
  };
  const value = units(tax) - units(exoneration);
  return `${value / 100000n}.${(value % 100000n).toString().padStart(5, "0")}`;
};
const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function renderDraftPrint(
  draft: any,
  company: string | Partial<InvoiceXmlInput["snapshot"]["issuer"]>,
) {
  const issuer =
      typeof company === "string" ? { legal_name: company } : company,
    receiver = draft.customer_snapshot ?? {},
    totals = calculateInvoice(draft.lines, draft.other_charges ?? []),
    commercial = draft.commercial ?? draft.options ?? {};
  const rows = draft.lines
    .map((l: any, i: number) => {
      const t = totals.status === "complete" ? totals.lines[i] : null;
      const taxes =
        t?.taxes
          .map(
            (tax) =>
              `${escape(tax.code === "01" ? "IVA" : "Impuesto " + tax.code)} ${escape(tax.rate)} %: ${escape(tax.amount)}`,
          )
          .join("<br>") ?? "Pendiente";
      const codes = (l.fiscal?.commercial_codes ?? [])
        .map((c: any) => `${escape(c.type)}: ${escape(c.code)}`)
        .join(" · ");
      return `<tr><td>${escape(l.description)}${l.fiscal?.internal_code ? `<br><small>Código interno: ${escape(l.fiscal.internal_code)}</small>` : ""}${codes ? `<br><small>${codes}</small>` : ""}${l.fiscal?.vin_numbers?.length ? `<br><small>VIN / serie: ${escape(l.fiscal.vin_numbers.join(", "))}</small>` : ""}${l.fiscal?.medicine_registration ? `<br><small>Registro sanitario: ${escape(l.fiscal.medicine_registration)}</small>` : ""}${l.fiscal?.pharmaceutical_form ? `<br><small>Forma farmacéutica: ${escape(l.fiscal.pharmaceutical_form)}</small>` : ""}</td><td>${escape(l.fiscal?.cabys)}</td><td>${escape(l.quantity ?? "Pendiente")} ${escape(l.fiscal?.unit)} ${escape(l.fiscal?.commercial_unit)}</td><td>${escape(l.unit_price ?? "Pendiente")}</td><td>${escape(t?.discount ?? "Pendiente")}</td><td>${escape(t?.base ?? "Pendiente")}<br><small>IVA: ${escape(t?.tax_base ?? "Pendiente")}</small></td><td>${taxes}</td><td>${escape(t?.exoneration ?? "Pendiente")}</td><td>${escape(t?.total ?? "Pendiente")}</td></tr>`;
    })
    .join("");
  const amount = (label: string, value: unknown) =>
    `<tr><th>${escape(label)}</th><td>${escape(draft.currency)} ${escape(value)}</td></tr>`;
  const summary =
    totals.status === "complete"
      ? `<table class="totals">${amount("Importe antes de descuentos", totals.beforeDiscount)}${amount("Descuentos", totals.discounts)}${amount("Subtotal después de descuentos", totals.subtotal)}${totals.groups.map((g) => amount(`${g.tax_code === "01" ? "IVA" : "Impuesto " + g.tax_code}${g.tariff_code ? " código " + g.tariff_code : ""} / ${g.rate} % antes de exoneraciones`, g.tax)).join("")}${amount("Impuestos antes de exoneraciones", totals.tax)}${amount("Exoneraciones", totals.exonerations)}${amount("Total de impuestos", netTax(totals.tax, totals.exonerations))}${amount("Otros cargos", totals.otherCharges)}${totals.ivaReturned !== "0.00000" ? amount("IVA devuelto", totals.ivaReturned) : ""}${amount("TOTAL", totals.total)}</table>`
      : "<p>Totales tributarios pendientes: complete los datos de líneas y cargos.</p>";
  const charges = (
    totals.status === "complete" ? totals.charges : (draft.other_charges ?? [])
  )
    .map(
      (charge: any) =>
        `<tr><td>${escape(charge.code)} ${escape(charge.other_description)}</td><td>${escape(charge.description)}</td><td>${escape(charge.third_party_name)} ${escape(charge.third_party_type)} ${escape(charge.third_party_identification)}</td><td>${charge.mode === "percentage" ? `${escape(charge.percentage)} % sobre base comercial explícita ${escape(charge.percentage_base)}` : "Importe fijo"}</td><td>${escape(charge.calculated_amount ?? "Pendiente")}</td></tr>`,
    )
    .join("");
  const references = (commercial.references ?? [])
    .map(
      (ref: any) =>
        `<li>Documento ${escape(ref.document_type)} ${escape(ref.document_other)} · ${escape(ref.number)} · ${escape(ref.issue_date)} · Código ${escape(ref.code)} ${escape(ref.code_other)}: ${escape(ref.reason)}</li>`,
    )
    .join("");
  const receiverLabel =
    draft.receiver_mode === "consumer_final"
      ? "Consumidor final"
      : draft.receiver_mode === "occasional"
        ? "Venta rápida / cliente ocasional"
        : "Cliente registrado";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Borrador de comprobante</title><style>body{font:14px sans-serif;margin:28px;color:#172338}h1{font-size:23px}.notice{padding:12px;border:2px solid #b65f00}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{text-align:left;padding:8px;border-bottom:1px solid #ccc}.totals{margin-left:auto;width:60%}.muted{color:#555}@media print{body{margin:0}.help{display:none}}</style></head><body><h1>${escape(issuer.legal_name ?? "Empresa")}</h1><p>${escape(issuer.identification_type)} ${escape(issuer.identification)} · ${escape(issuer.contact_email)} · ${escape(issuer.phone)}</p><p>${escape(issuer.address)}</p><p class="notice">BORRADOR SIN VALIDEZ TRIBUTARIA — no firmado ni enviado a Hacienda.</p><h2>${draft.document_type === "TE" ? "Preparación de tiquete electrónico" : "Preparación de factura electrónica"}</h2><p>Versión ${escape(draft.version)} · ${escape(receiverLabel)}</p><h3>Receptor: ${escape(receiver.name || (draft.document_type === "TE" ? "Consumidor final" : "Pendiente"))}</h3><p>${escape(receiver.identification_type)} ${escape(receiver.identification)} · ${escape(receiver.email)}</p><p>${escape(receiver.trade_name)} · Actividad ${escape(receiver.economic_activity)} · ${escape(receiver.phone)}</p><p>${escape(receiver.foreign_address || receiver.address)} · ${escape(receiver.province)} / ${escape(receiver.canton)} / ${escape(receiver.district)} / ${escape(receiver.neighborhood)}</p><p>Condición de venta: ${commercial.sale_condition === "02" ? "Crédito" : "Contado"}${commercial.credit_days ? ` · Plazo de crédito: ${escape(commercial.credit_days)} días. Vencimiento comercial pendiente de emisión.` : ""}</p><p class="muted">Precios antes de impuestos. Moneda ${escape(draft.currency)}.</p><table><thead><tr><th>Detalle</th><th>CABYS</th><th>Cantidad / unidad</th><th>Precio</th><th>Descuento</th><th>Base comercial / IVA</th><th>Impuestos</th><th>Exoneración</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>${charges ? `<h3>Otros cargos</h3><table><thead><tr><th>Tipo</th><th>Detalle</th><th>Tercero</th><th>Cálculo</th><th>Monto</th></tr></thead><tbody>${charges}</tbody></table>` : ""}${summary}${references ? `<h3>Referencias</h3><ul>${references}</ul>` : ""}<p>${escape(draft.notes)}</p><p class="help">Para guardar este borrador en PDF utiliza Imprimir del navegador.</p></body></html>`;
}
