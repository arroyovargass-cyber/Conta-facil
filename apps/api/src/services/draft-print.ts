import { IVA_TARIFFS } from "../../../../packages/domain/src/invoice-fiscal";
const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function renderDraftPrint(draft: any, company: string) {
  const receiver = draft.customer_snapshot ?? {},
    totals = draft.fiscal_totals;
  const rows = draft.lines
    .map((l: any, i: number) => {
      const t = totals?.status === "complete" ? totals.lines[i] : null;
      return `<tr><td>${escape(l.description)}</td><td>${escape(l.fiscal?.cabys)}</td><td>${escape(l.quantity ?? "Pendiente")} ${escape(l.fiscal?.unit)} ${escape(l.fiscal?.commercial_unit ?? "")}</td><td>${escape(l.unit_price ?? "Pendiente")}</td><td>${escape(t?.discount ?? "Pendiente")}</td><td>${escape(t?.base ?? "Pendiente")}</td><td>${escape(t?.tax ?? "Pendiente")}<br><small>${escape(l.fiscal?.tax_code ?? "")} / ${escape(l.fiscal?.tariff_code ?? "")} ${escape(IVA_TARIFFS[l.fiscal?.tariff_code]?.rate ?? "")} %</small></td><td>${escape(t?.exoneration ?? "Pendiente")}</td><td>${escape(t?.total ?? "Pendiente")}</td></tr>`;
    })
    .join("");
  const amount = (label: string, v: unknown) =>
    `<tr><th>${escape(label)}</th><td>${escape(draft.currency)} ${escape(v)}</td></tr>`;
  const summary =
    totals?.status === "complete"
      ? `<table class="totals">${amount("Importe antes de descuentos", totals.beforeDiscount)}${amount("Descuentos", totals.discounts)}${amount("Subtotal después de descuentos", totals.subtotal)}${totals.groups.map((g: any) => amount("IVA código " + g.tariff_code + " / " + g.rate + " %", g.tax)).join("")}${amount("Exoneraciones", totals.exonerations)}${amount("Impuestos antes de exoneración", totals.tax)}${amount("TOTAL", totals.total)}</table>`
      : "<p>Totales tributarios pendientes: complete el tratamiento de todas las líneas.</p>";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Borrador de factura</title><style>body{font:14px sans-serif;margin:28px;color:#172338}h1{font-size:23px}.notice{padding:12px;border:2px solid #b65f00}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{text-align:left;padding:8px;border-bottom:1px solid #ccc}.totals{margin-left:auto;width:60%}.muted{color:#555}@media print{body{margin:0}.help{display:none}}</style></head><body><h1>${escape(company)}</h1><p class="notice">BORRADOR SIN VALIDEZ TRIBUTARIA — no firmado ni enviado a Hacienda.</p><h2>${draft.document_type === "TE" ? "Preparación de tiquete electrónico" : "Preparación de factura electrónica"}</h2><p>Versión ${escape(draft.version)} · ${escape(draft.receiver_mode === "occasional" ? "Venta rápida / cliente ocasional" : "Cliente registrado")}</p><h3>Receptor: ${escape(receiver.name || "Pendiente")}</h3><p>${escape(receiver.identification_type)} ${escape(receiver.identification)} · ${escape(receiver.email)}</p><p>${escape(receiver.trade_name)} · Actividad ${escape(receiver.economic_activity)} · ${escape(receiver.phone)}</p><p>${escape(receiver.foreign_address || receiver.address)} · ${escape(receiver.province)} / ${escape(receiver.canton)} / ${escape(receiver.district)} / ${escape(receiver.neighborhood)}</p><p class="muted">Precios antes de impuestos. Moneda ${escape(draft.currency)}. Otros cargos no habilitados.</p><table><thead><tr><th>Detalle</th><th>CABYS</th><th>Cantidad / unidad</th><th>Precio</th><th>Descuento</th><th>Base</th><th>IVA</th><th>Exoneración</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>${summary}<p>${escape(draft.notes)}</p><p class="help">Para guardar este borrador en PDF utiliza Imprimir del navegador.</p></body></html>`;
}
