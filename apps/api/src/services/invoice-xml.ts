import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  prepareEmission,
  type EmissionOptions,
} from "../../../../packages/domain/src/emission";
import {
  calculateInvoice,
  type ReceiverInput,
  type InvoiceLineInput,
} from "../../../../packages/domain/src/invoice-fiscal";
import type { OtherChargeInput } from "../../../../packages/domain/src/invoice-extras";
export type InvoiceXmlInput = {
  snapshot: {
    document_type?: "FE" | "TE";
    calculation_version?: string;
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
    other_charges?: OtherChargeInput[];
    totals: ReturnType<typeof calculateInvoice>;
    notes?: string;
  };
  options: EmissionOptions;
  clave: string;
  consecutivo: string;
  issued_at: string;
  software_provider_id: string;
};
const PROFILES = {
  FE: {
    root: "FacturaElectronica",
    code: "01",
    namespace:
      "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica",
  },
  TE: {
    root: "TiqueteElectronico",
    code: "04",
    namespace:
      "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/tiqueteElectronico",
  },
} as const;

/** Historical FE snapshots retain their original financial shape and bytes. */
export function frozenInvoiceCalculation(s: InvoiceXmlInput["snapshot"]) {
  if (
    s.calculation_version !== undefined &&
    !["fe-iva-v1-line-half-up-5", "billing44-v2-line-half-up-5"].includes(
      s.calculation_version,
    )
  )
    return null;
  const calculated = calculateInvoice(s.lines, s.other_charges ?? []);
  if (calculated.status !== "complete") return null;
  if (isDeepStrictEqual(calculated, s.totals)) return calculated;
  // The pre-workspace calculation had no tax arrays, charge totals or summary.
  // Only snapshots without the new document discriminator can use that shape.
  if (
    s.document_type === undefined &&
    !s.other_charges?.length &&
    s.calculation_version !== "billing44-v2-line-half-up-5"
  ) {
    const legacy = {
      status: calculated.status,
      beforeDiscount: calculated.beforeDiscount,
      discounts: calculated.discounts,
      subtotal: calculated.subtotal,
      tax: calculated.tax,
      exonerations: calculated.exonerations,
      total: calculated.total,
      groups: calculated.groups,
      lines: calculated.lines.map(
        ({ beforeDiscount, discount, base, tax, exoneration, total }) => ({
          beforeDiscount,
          discount,
          base,
          tax,
          exoneration,
          total,
        }),
      ),
    };
    if (isDeepStrictEqual(legacy, s.totals)) return calculated;
  }
  return null;
}
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
function identity(type: string, id: string, name = "Identificacion") {
  const re: Record<string, RegExp> = {
    "01": /^\d{9}$/,
    "02": /^\d{10}$/,
    "03": /^\d{11,12}$/,
    "04": /^\d{10}$/,
    "05": /^[\p{L}\p{N}]{1,20}$/u,
  };
  if (!re[type]?.test(id)) fail("Unsupported identification");
  return wrap(name, el("Tipo", type) + el("Numero", id));
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
function phone(value: string, explicitCountry?: string) {
  if (!value) return "";
  const m = /^\+(\d{1,3})[ -]([\d -]+)$/.exec(value),
    country = m?.[1] ?? explicitCountry,
    number = (m?.[2] ?? value).replace(/[ -]/g, "");
  if (
    !country ||
    !/^\d{1,3}$/.test(country) ||
    !/^\d{1,20}$/.test(number) ||
    BigInt(number) < 100n
  )
    return "";
  if (m && explicitCountry && m[1] !== explicitCountry)
    fail("Conflicting phone country code");
  return wrap(
    "Telefono",
    el("CodigoPais", country) + el("NumTelefono", number),
  );
}
export function generateInvoiceXml(input: InvoiceXmlInput): string {
  const { snapshot: s, consecutivo, clave, issued_at } = input,
    issuer = s.issuer,
    r = s.receiver,
    documentType = s.document_type ?? "FE";
  if (documentType !== "FE" && documentType !== "TE")
    fail("Unsupported document type");
  const profile = PROFILES[documentType];
  if (!["CRC", "USD"].includes(s.currency)) fail("Unsupported currency");
  const p = prepareEmission({
    document_type: documentType,
    currency: s.currency,
    receiver: r,
    lines: s.lines,
    other_charges: s.other_charges ?? [],
    options: input.options,
  });
  // Existing frozen documents remain reproducible. Issuance readiness always
  // blocks this unresolved treatment, including legacy preparations; this
  // exception only preserves bytes for snapshots predating the new profile.
  const issues = p.issues.filter(
    (issue) =>
      !(
        issue.code === "IVA_RETURN_ELIGIBILITY_UNVERIFIED" &&
        s.document_type === undefined &&
        s.calculation_version !== "billing44-v2-line-half-up-5"
      ),
  );
  if (issues.length || p.totals.status !== "complete")
    fail(issues.map((x) => x.code).join(", "));
  const t = frozenInvoiceCalculation(s),
    o = p.options;
  if (!t) fail("Frozen calculation mismatch");
  if (
    !/^\d{20}$/.test(consecutivo) ||
    consecutivo.slice(8, 10) !== profile.code ||
    !consecutivo.startsWith(o.branch_code + o.terminal_code) ||
    /^0+$/.test(consecutivo.slice(10))
  )
    fail("Invalid document consecutivo");
  // Issuer IDs remain restricted to the supported national identification types.
  if (!["01", "02", "03", "04"].includes(issuer.identification_type))
    fail("Unsupported issuer identification");
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
  const detail = s.lines
    .map((line, i) => {
      const f = line.fiscal!,
        a = t.lines[i];
      text(line.description!, 3, 200, "line description");
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
          (f.commercial_codes ?? [])
            .map((code) =>
              wrap(
                "CodigoComercial",
                el("Tipo", code.type) + el("Codigo", code.code),
              ),
            )
            .join("") +
          el(
            "Cantidad",
            line.quantity!.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""),
          ) +
          el("UnidadMedida", f.unit) +
          (documentType === "FE"
            ? optional("TipoTransaccion", f.transaction_type)
            : "") +
          optional("UnidadMedidaComercial", f.commercial_unit) +
          el("Detalle", line.description) +
          (f.vin_numbers ?? [])
            .map((vin) => el("NumeroVINoSerie", vin))
            .join("") +
          optional("RegistroMedicamento", f.medicine_registration) +
          optional("FormaFarmaceutica", f.pharmaceutical_form) +
          el("PrecioUnitario", money(scaled(line.unit_price!))) +
          el("MontoTotal", a.beforeDiscount) +
          discount +
          el("SubTotal", a.base) +
          el("BaseImponible", a.tax_base) +
          a.taxes
            .map((tax) =>
              wrap(
                "Impuesto",
                el("Codigo", tax.code) +
                  optional("CodigoTarifaIVA", tax.tariff_code) +
                  el("Tarifa", tax.rate) +
                  el("Monto", tax.amount) +
                  (tax.code === "01" ? relief : ""),
              ),
            )
            .join("") +
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
  const buckets = [t.summary.services, t.summary.goods].flatMap((group) => [
    group.taxable,
    group.exempt,
    group.exonerated,
    group.non_subject,
  ]);
  const otherCharges = t.charges
    .map((charge) =>
      wrap(
        "OtrosCargos",
        el("TipoDocumentoOC", charge.code) +
          optional("TipoDocumentoOTROS", charge.other_description) +
          (charge.third_party_type && charge.third_party_identification
            ? identity(
                charge.third_party_type,
                charge.third_party_identification,
                "IdentificacionTercero",
              )
            : "") +
          optional("NombreTercero", charge.third_party_name) +
          el("Detalle", charge.description) +
          (charge.mode === "percentage"
            ? el("PorcentajeOC", charge.percentage)
            : "") +
          el("MontoCargo", charge.calculated_amount),
      ),
    )
    .join("");
  const earliestReference = new Date(issued_at);
  earliestReference.setUTCFullYear(earliestReference.getUTCFullYear() - 10);
  const references = o.references
    .map((reference) => {
      const when = Date.parse(reference.issue_date);
      if (when < earliestReference.getTime() || when > Date.parse(issued_at))
        fail("REFERENCE_DATE_OUT_OF_RANGE");
      return wrap(
        "InformacionReferencia",
        el("TipoDocIR", reference.document_type) +
          optional("TipoDocRefOTRO", reference.document_other) +
          optional("Numero", reference.number) +
          el("FechaEmisionIR", reference.issue_date) +
          optional("Codigo", reference.code) +
          optional("CodigoReferenciaOTRO", reference.code_other) +
          optional("Razon", reference.reason),
      );
    })
    .join("");
  const summary =
    wrap(
      "CodigoTipoMoneda",
      el("CodigoMoneda", s.currency) +
        el("TipoCambio", money(scaled(o.exchange_rate))),
    ) +
    fields.map((name, i) => el(name, buckets[i])).join("") +
    ["TotalGravado", "TotalExento", "TotalExonerado", "TotalNoSujeto"]
      .map((name, i) =>
        el(name, money(scaled(buckets[i]) + scaled(buckets[i + 4]))),
      )
      .join("") +
    el("TotalVenta", t.beforeDiscount) +
    el("TotalDescuentos", t.discounts) +
    el("TotalVentaNeta", t.subtotal) +
    t.groups
      .map((g) =>
        wrap(
          "TotalDesgloseImpuesto",
          el("Codigo", g.tax_code) +
            optional("CodigoTarifaIVA", g.tariff_code) +
            el(
              "TotalMontoImpuesto",
              money(scaled(g.tax) - scaled(g.exoneration)),
            ),
        ),
      )
      .join("") +
    el("TotalImpuesto", money(scaled(t.tax) - scaled(t.exonerations))) +
    (scaled(t.ivaReturned) > 0n ? el("TotalIVADevuelto", t.ivaReturned) : "") +
    (scaled(t.otherCharges) > 0n
      ? el("TotalOtrosCargos", t.otherCharges)
      : "") +
    o.payment_methods
      .map((m) =>
        wrap(
          "MedioPago",
          el("TipoMedioPago", m.code) +
            optional("MedioPagoOtros", m.other_description) +
            el("TotalMedioPago", money(scaled(m.amount))),
        ),
      )
      .join("") +
    el("TotalComprobante", t.total);
  return (
    `<?xml version="1.0" encoding="UTF-8"?><${profile.root} xmlns="${profile.namespace}">` +
    el("Clave", clave) +
    el("ProveedorSistemas", input.software_provider_id) +
    el("CodigoActividadEmisor", o.issuer_activity) +
    (documentType === "FE"
      ? optional("CodigoActividadReceptor", r.economic_activity)
      : "") +
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
    (documentType === "FE" || r.name
      ? wrap(
          "Receptor",
          el("Nombre", r.name) +
            (r.identification_type && r.identification
              ? identity(r.identification_type, r.identification)
              : "") +
            optional(
              "NombreComercial",
              r.trade_name
                ? text(r.trade_name, 3, 80, "receiver trade name")
                : "",
            ) +
            (r.domicile === "domestic" ? location(r, r.address) : "") +
            (r.domicile === "foreign"
              ? optional("OtrasSenasExtranjero", r.foreign_address)
              : "") +
            phone(r.phone, r.phone_country_code) +
            optional("CorreoElectronico", r.email),
        )
      : "") +
    el("CondicionVenta", o.sale_condition) +
    (o.credit_days ? el("PlazoCredito", o.credit_days) : "") +
    (detail ? wrap("DetalleServicio", detail) : "") +
    otherCharges +
    wrap("ResumenFactura", summary) +
    references +
    (s.notes
      ? wrap("Otros", el("OtroTexto", text(s.notes, 1, 500, "notes")))
      : "") +
    `</${profile.root}>`
  );
}
