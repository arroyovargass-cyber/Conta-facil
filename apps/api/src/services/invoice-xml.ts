import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  prepareEmission,
  type EmissionOptions,
} from "../../../../packages/domain/src/emission";
import {
  calculateInvoice,
  IVA_TARIFFS,
  type ReceiverInput,
  type InvoiceLineInput,
} from "../../../../packages/domain/src/invoice-fiscal";
export type InvoiceXmlInput = {
  snapshot: {
    issuer: {
      legal_name: string;
      trade_name: string;
      identification_type: string;
      identification: string;
      contact_email: string;
      phone: string;
      address: string;
      configuration: any;
    };
    receiver: ReceiverInput;
    currency: "CRC" | "USD";
    lines: InvoiceLineInput[];
    totals: ReturnType<typeof calculateInvoice>;
    notes?: string;
  };
  options: EmissionOptions;
  clave: string;
  consecutivo: string;
  issued_at: string;
  software_provider_id: string;
};
const NS =
  "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica";
function fail(message: string): never {
  throw new Error(`INVOICE_XML_INVALID: ${message}`);
}
function escape(value: unknown): string {
  const s = String(value);
  for (const c of s) {
    const n = c.codePointAt(0)!;
    if (!(
      n === 9 ||
      n === 10 ||
      n === 13 ||
      (n >= 32 && n <= 0xd7ff) ||
      (n >= 0xe000 && n <= 0xfffd) ||
      (n >= 0x10000 && n <= 0x10ffff)
    ))
      fail("Invalid XML character");
  }
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
const el = (name: string, value: unknown) =>
  `<${name}>${escape(value)}</${name}>`;
const wrap = (name: string, xml: string) => `<${name}>${xml}</${name}>`;
const optional = (name: string, value: string | undefined) =>
  value ? el(name, value) : "";
function text(value: string, min: number, max: number, name: string) {
  if (typeof value !== "string" || value.length < min || value.length > max)
    fail(name);
  return value;
}
function scaled(s: string) {
  const [i, f = ""] = s.split(".");
  return BigInt(i) * 100000n + BigInt(f.padEnd(5, "0"));
}
function money(n: bigint) {
  return (
    (n / 100000n).toString() + "." + (n % 100000n).toString().padStart(5, "0")
  );
}
function identity(type: string, id: string) {
  const re: Record<string, RegExp> = {
    "01": /^\d{9}$/,
    "02": /^\d{10}$/,
    "03": /^\d{11,12}$/,
    "04": /^\d{10}$/,
  };
  if (!re[type]?.test(id)) fail("Unsupported identification");
  return wrap("Identificacion", el("Tipo", type) + el("Numero", id));
}
function location(l: any, address: string) {
  if (
    !l ||
    !/^[1-7]$/.test(l.province) ||
    !/^\d{2}$/.test(l.canton) ||
    !/^\d{2}$/.test(l.district)
  )
    fail("Incomplete location");
  return wrap(
    "Ubicacion",
    el("Provincia", l.province) +
      el("Canton", l.canton) +
      el("Distrito", l.district) +
      optional(
        "Barrio",
        l.neighborhood ? text(l.neighborhood, 5, 50, "neighborhood") : "",
      ) +
      el("OtrasSenas", text(address, 5, 250, "address")),
  );
}
// Phone is optional: only preserve an explicit international country code, never invent one.
function phone(value: string) {
  if (!value) return "";
  const m = /^\+(\d{1,3})[ -](\d{1,20})$/.exec(value);
  return m
    ? wrap("Telefono", el("CodigoPais", m[1]) + el("NumTelefono", m[2]))
    : "";
}
export function generateInvoiceXml(input: InvoiceXmlInput): string {
  const { snapshot: s, consecutivo, clave, issued_at } = input,
    issuer = s.issuer,
    r = s.receiver;
  if (!["CRC", "USD"].includes(s.currency)) fail("Unsupported currency");
  const p = prepareEmission({
    document_type: "FE",
    currency: s.currency,
    receiver: r,
    lines: s.lines,
    options: input.options,
  });
  if (p.issues.length || p.totals.status !== "complete")
    fail(p.issues.map((x) => x.code).join(", "));
  const t = p.totals,
    o = p.options;
  if (!isDeepStrictEqual(t, s.totals)) fail("Frozen calculation mismatch");
  if (
    !/^\d{20}$/.test(consecutivo) ||
    consecutivo.slice(8, 10) !== "01" ||
    !consecutivo.startsWith(o.branch_code + o.terminal_code) ||
    /^0+$/.test(consecutivo.slice(10))
  )
    fail("Invalid FE consecutivo");
  identity(issuer.identification_type, issuer.identification);
  if (
    !/^\d{50}$/.test(clave) ||
    clave.slice(0, 3) !== "506" ||
    clave.slice(9, 21) !== issuer.identification.padStart(12, "0") ||
    clave.slice(21, 41) !== consecutivo ||
    !/[123]/.test(clave[41])
  )
    fail("Invalid clave");
  if (!z.iso.datetime({ offset: true }).safeParse(issued_at).success)
    fail("Invalid issue date");
  const d = new Date(new Date(issued_at).getTime() - 6 * 3600000),
    date =
      String(d.getUTCDate()).padStart(2, "0") +
      String(d.getUTCMonth() + 1).padStart(2, "0") +
      String(d.getUTCFullYear()).slice(-2);
  if (clave.slice(3, 9) !== date) fail("Clave date mismatch");
  if (!/^\d{9,12}$/.test(input.software_provider_id))
    fail("Software provider required");
  if (!z.email().safeParse(issuer.contact_email).success) fail("Issuer email");
  const buckets = Array<bigint>(8).fill(0n);
  const detail = s.lines
    .map((line, i) => {
      const f = line.fiscal!,
        a = t.lines[i],
        rate = IVA_TARIFFS[f.tariff_code].rate;
      text(line.description!, 3, 200, "line description");
      const base = Number(f.cabys[0]) >= 5 ? 0 : 4,
        gross = scaled(a.beforeDiscount);
      // Annex pp50–52: CABYS0–4 goods,5–9 services; tariff01/11 NoSujeto.
      if (f.treatment === "exonerated") {
        const tax = scaled(a.tax),
          relief = scaled(a.exoneration);
        if (tax === 0n) fail("Exoneration has no tax");
        // Exact five-decimal allocation only: rounding of summary proportions is not a verified policy.
        if ((gross * relief) % tax !== 0n)
          fail("EXONERATION_SUMMARY_PRECISION_UNVERIFIED");
        const exempt = (gross * relief) / tax;
        buckets[base] += gross - exempt;
        buckets[base + 2] += exempt;
      } else
        buckets[
          base +
            (f.tariff_code === "01" || f.tariff_code === "11"
              ? 3
              : f.treatment === "exempt"
                ? 1
                : 0)
        ] += gross;
      const e = f.exoneration;
      const relief = e
        ? wrap(
            "Exoneracion",
            el("TipoDocumentoEX1", e.document_type) +
              optional("TipoDocumentoOTRO", e.document_other) +
              el("NumeroDocumento", e.document_number) +
              optional("Articulo", e.article) +
              optional("Inciso", e.inciso) +
              el("NombreInstitucion", e.institution) +
              optional("NombreInstitucionOtros", e.institution_other) +
              el("FechaEmisionEX", e.issue_date) +
              el("TarifaExonerada", e.rate) +
              el("MontoExoneracion", a.exoneration),
          )
        : "";
      const discount =
        scaled(a.discount) > 0n
          ? wrap(
              "Descuento",
              el("MontoDescuento", a.discount) +
                el("CodigoDescuento", f.discount_code) +
                optional("CodigoDescuentoOTRO", f.discount_other) +
                optional("NaturalezaDescuento", f.discount_reason),
            )
          : "";
      return wrap(
        "LineaDetalle",
        el("NumeroLinea", i + 1) +
          el("CodigoCABYS", f.cabys) +
          el(
            "Cantidad",
            line.quantity!.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""),
          ) +
          el("UnidadMedida", f.unit) +
          optional("UnidadMedidaComercial", f.commercial_unit) +
          el("Detalle", line.description) +
          el("PrecioUnitario", money(scaled(line.unit_price!))) +
          el("MontoTotal", a.beforeDiscount) +
          discount +
          el("SubTotal", a.base) +
          el("BaseImponible", a.base) +
          wrap(
            "Impuesto",
            el("Codigo", "01") +
              el("CodigoTarifaIVA", f.tariff_code) +
              el("Tarifa", rate) +
              el("Monto", a.tax) +
              relief,
          ) +
          el("ImpuestoAsumidoEmisorFabrica", "0.00000") +
          el("ImpuestoNeto", money(scaled(a.tax) - scaled(a.exoneration))) +
          el("MontoTotalLinea", a.total),
      );
    })
    .join("");
  const fields = [
    "TotalServGravados",
    "TotalServExentos",
    "TotalServExonerado",
    "TotalServNoSujeto",
    "TotalMercanciasGravadas",
    "TotalMercanciasExentas",
    "TotalMercExonerada",
    "TotalMercNoSujeta",
  ];
  const summary =
    wrap(
      "CodigoTipoMoneda",
      el("CodigoMoneda", s.currency) +
        el("TipoCambio", money(scaled(o.exchange_rate))),
    ) +
    fields.map((name, i) => el(name, money(buckets[i]))).join("") +
    ["TotalGravado", "TotalExento", "TotalExonerado", "TotalNoSujeto"]
      .map((name, i) => el(name, money(buckets[i] + buckets[i + 4])))
      .join("") +
    el("TotalVenta", t.beforeDiscount) +
    el("TotalDescuentos", t.discounts) +
    el("TotalVentaNeta", t.subtotal) +
    t.groups
      .map((g) =>
        wrap(
          "TotalDesgloseImpuesto",
          el("Codigo", g.tax_code) +
            el("CodigoTarifaIVA", g.tariff_code) +
            el(
              "TotalMontoImpuesto",
              money(scaled(g.tax) - scaled(g.exoneration)),
            ),
        ),
      )
      .join("") +
    el("TotalImpuesto", money(scaled(t.tax) - scaled(t.exonerations))) +
    o.payment_methods
      .map((m) =>
        wrap(
          "MedioPago",
          el("TipoMedioPago", m.code) +
            el("TotalMedioPago", money(scaled(m.amount))),
        ),
      )
      .join("") +
    el("TotalComprobante", t.total);
  return (
    `<?xml version="1.0" encoding="UTF-8"?><FacturaElectronica xmlns="${NS}">` +
    el("Clave", clave) +
    el("ProveedorSistemas", input.software_provider_id) +
    el("CodigoActividadEmisor", o.issuer_activity) +
    optional("CodigoActividadReceptor", r.economic_activity) +
    el("NumeroConsecutivo", consecutivo) +
    el("FechaEmision", issued_at) +
    wrap(
      "Emisor",
      el("Nombre", text(issuer.legal_name, 3, 100, "issuer name")) +
        identity(issuer.identification_type, issuer.identification) +
        optional(
          "NombreComercial",
          issuer.trade_name ? text(issuer.trade_name, 3, 80, "trade name") : "",
        ) +
        location(issuer.configuration?.location, issuer.address) +
        phone(issuer.phone) +
        el(
          "CorreoElectronico",
          text(issuer.contact_email, 3, 160, "issuer email"),
        ),
    ) +
    wrap(
      "Receptor",
      el("Nombre", r.name) +
        identity(r.identification_type, r.identification) +
        optional(
          "NombreComercial",
          r.trade_name ? text(r.trade_name, 3, 80, "receiver trade name") : "",
        ) +
        location(r, r.address) +
        phone(r.phone) +
        optional("CorreoElectronico", r.email),
    ) +
    el("CondicionVenta", o.sale_condition) +
    (o.credit_days ? el("PlazoCredito", o.credit_days) : "") +
    wrap("DetalleServicio", detail) +
    wrap("ResumenFactura", summary) +
    (s.notes
      ? wrap("Otros", el("OtroTexto", text(s.notes, 1, 500, "notes")))
      : "") +
    "</FacturaElectronica>"
  );
}
