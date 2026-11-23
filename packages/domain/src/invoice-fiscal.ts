import { HACIENDA_UNITS } from "./hacienda-units";
import { z } from "zod";
const text = (max: number) => z.string().trim().max(max).default("");
const decimal = z.string().regex(/^\d{1,13}(?:\.\d{1,5})?$/);
export const exonerationInput = z
  .object({
    document_type: text(2),
    document_other: text(100),
    document_number: text(40),
    institution: text(160),
    institution_other: text(160),
    issue_date: text(35),
    article: text(10),
    inciso: text(10),
    rate: decimal.default("0"),
  })
  .strict();
export const receiverFiscalInput = z
  .object({
    trade_name: text(80),
    domicile: z
      .enum(["domestic", "foreign", "unspecified"])
      .default("unspecified"),
    requires_activity: z.boolean().default(false),
    requires_email: z.boolean().default(false),
    foreign_address: text(300),
    economic_activity: text(6),
    province: text(1),
    canton: text(2),
    district: text(2),
    neighborhood: text(50),
    exoneration: exonerationInput.nullable().default(null),
  })
  .strict();
export const receiverInput = z
  .object({
    name: text(160),
    identification_type: text(40),
    identification: text(40),
    email: z
      .string()
      .trim()
      .max(254)
      .refine(
        (v) => v === "" || z.email().safeParse(v).success,
        "Correo inválido",
      )
      .default(""),
    phone: text(40),
    address: text(1000),
    ...receiverFiscalInput.shape,
  })
  .strict();
export const lineFiscalInput = z
  .object({
    cabys: text(13),
    unit: text(15),
    commercial_unit: text(20),
    treatment: z
      .enum(["pending", "taxable", "exempt", "exonerated", "non_subject"])
      .default("pending"),
    tax_code: z.literal("01").default("01"),
    tariff_code: text(2),
    discount_amount: decimal.default("0"),
    discount_code: text(2),
    discount_reason: text(80),
    discount_other: text(100),
    exoneration: exonerationInput.nullable().default(null),
  })
  .strict();
export type FiscalLineInput = z.infer<typeof lineFiscalInput>;
export type ReceiverInput = z.infer<typeof receiverInput>;
// Annex v4.4 note 8.1: codes 05–07 are transitory notes, not FE tariffs.
export const IVA_TARIFFS: Record<
  string,
  { rate: string; treatment: "taxable" | "exempt" | "non_subject" }
> = {
  "01": { rate: "0", treatment: "taxable" },
  "02": { rate: "1", treatment: "taxable" },
  "03": { rate: "2", treatment: "taxable" },
  "04": { rate: "4", treatment: "taxable" },
  "08": { rate: "13", treatment: "taxable" },
  "09": { rate: "0.5", treatment: "taxable" },
  "10": { rate: "0", treatment: "exempt" },
  "11": { rate: "0", treatment: "non_subject" },
};
export type InvoiceLineInput = {
  quantity: string | null;
  unit_price: string | null;
  description?: string;
  fiscal: FiscalLineInput | null;
};
export type InvoiceFiscalIssue = {
  code: string;
  path?: string;
  message: string;
};
type Amounts = {
  beforeDiscount: string;
  discount: string;
  base: string;
  tax: string;
  exoneration: string;
  total: string;
};
type Group = {
  tax_code: string;
  tariff_code: string;
  rate: string;
  base: string;
  tax: string;
  exoneration: string;
};
export type InvoiceCalculation =
  | { status: "blocked"; issues: InvoiceFiscalIssue[] }
  | {
      status: "complete";
      beforeDiscount: string;
      discounts: string;
      subtotal: string;
      tax: string;
      exonerations: string;
      total: string;
      groups: Group[];
      lines: Amounts[];
    };
const S = 100000n,
  MAX = 999999999999999999n;
function scaled(v: string) {
  const [i, f = ""] = v.split(".");
  return BigInt(i) * S + BigInt(f.padEnd(5, "0"));
}
function formatted(v: bigint) {
  const s = v.toString().padStart(6, "0");
  return s.slice(0, -5) + "." + s.slice(-5);
}
export function calculateInvoice(
  lines: InvoiceLineInput[],
): InvoiceCalculation {
  const issues: InvoiceFiscalIssue[] = [];
  const add = (code: string, message: string, path?: string) =>
    issues.push({ code, message, ...(path ? { path } : {}) });
  // User-confirmed accounting policy: half up at each line; document totals sum rounded lines.
  const round = (n: bigint, d: bigint, _path: string): bigint =>
    n / d + ((n % d) * 2n >= d ? 1n : 0n);
  if (lines.length < 1 || lines.length > 100)
    add("INVALID_LINE_COUNT", "Se requieren entre una y cien líneas.", "lines");
  const output: Amounts[] = [],
    groups = new Map<
      string,
      {
        tax_code: string;
        tariff_code: string;
        rate: string;
        base: bigint;
        tax: bigint;
        exoneration: bigint;
      }
    >();
  const sums = [0n, 0n, 0n, 0n, 0n, 0n];
  for (const [index, line] of lines.slice(0, 100).entries()) {
    const path = `lines.${index}`;
    const parsed = lineFiscalInput.safeParse(line.fiscal);
    if (!parsed.success) {
      add(
        "FISCAL_CLASSIFICATION_PENDING",
        "Confirme la clasificación fiscal de la línea.",
        path + ".fiscal",
      );
      continue;
    }
    const f = parsed.data,
      t = IVA_TARIFFS[f.tariff_code];
    if (!t || f.treatment === "pending") {
      add(
        "FISCAL_CLASSIFICATION_PENDING",
        "Seleccione un tratamiento y una tarifa IVA vigentes para FE.",
        path + ".fiscal",
      );
      continue;
    }
    if (
      f.treatment !== t.treatment &&
      !(f.treatment === "exonerated" && t.treatment === "taxable")
    ) {
      add(
        "TARIFF_TREATMENT_MISMATCH",
        "El tratamiento no corresponde a la tarifa seleccionada.",
        path + ".fiscal",
      );
      continue;
    }
    if (
      !line.quantity ||
      !decimal.safeParse(line.quantity).success ||
      !line.unit_price ||
      !decimal.safeParse(line.unit_price).success ||
      scaled(line.quantity) === 0n
    ) {
      add(
        "INVALID_COMMERCIAL_VALUES",
        "Ingrese cantidad positiva y precio válido.",
        path,
      );
      continue;
    }
    if ((line.quantity.split(".")[1] ?? "").replace(/0+$/, "").length > 3) {
      add(
        "QUANTITY_PRECISION",
        "La cantidad admite hasta tres decimales significativos.",
        path + ".quantity",
      );
      continue;
    }
    const gross = round(
        scaled(line.quantity) * scaled(line.unit_price),
        S,
        path,
      ),
      discount = scaled(f.discount_amount),
      base = gross - discount;
    if (discount > 0n && ["01", "02", "03"].includes(f.discount_code)) {
      add(
        "DISCOUNT_SPECIAL_TREATMENT_UNSUPPORTED",
        "La regalía o bonificación requiere un tratamiento tributario aún no implementado.",
        path + ".fiscal.discount_code",
      );
      continue;
    }
    if (base < 0n) {
      add(
        "DISCOUNT_EXCEEDS_BASE",
        "El descuento supera el importe de la línea.",
        path,
      );
      continue;
    }
    const rate = scaled(t.rate),
      tax = round(base * rate, 100n * S, path + ".tax");
    let relief = 0n;
    if (f.treatment === "exonerated") {
      if (!f.exoneration) {
        add(
          "EXONERATION_MISSING",
          "Complete la exoneración de la línea.",
          path + ".fiscal.exoneration",
        );
        continue;
      }
      const exemptRate = scaled(f.exoneration.rate);
      if (
        exemptRate <= 0n ||
        exemptRate > rate ||
        (f.exoneration.rate.split(".")[1] ?? "").replace(/0+$/, "").length > 2
      ) {
        add(
          "INVALID_EXONERATION_RATE",
          "La tarifa exonerada debe ser positiva, no superar IVA y admitir hasta dos decimales.",
          path + ".fiscal.exoneration.rate",
        );
        continue;
      }
      relief = round(base * exemptRate, 100n * S, path + ".exoneration");
    } else if (f.exoneration) {
      add(
        "EXONERATION_TREATMENT_MISMATCH",
        "Seleccione tratamiento exonerado para aplicar exoneración.",
        path,
      );
      continue;
    }
    const total = base + tax - relief,
      values = [gross, discount, base, tax, relief, total];
    if (values.some((v) => v > MAX || v < 0n)) {
      add("AMOUNT_LIMIT", "El importe supera el límite monetario.", path);
      continue;
    }
    values.forEach((v, i) => (sums[i] += v));
    output.push({
      beforeDiscount: formatted(gross),
      discount: formatted(discount),
      base: formatted(base),
      tax: formatted(tax),
      exoneration: formatted(relief),
      total: formatted(total),
    });
    const key = f.tax_code + ":" + f.tariff_code,
      g = groups.get(key) ?? {
        tax_code: f.tax_code,
        tariff_code: f.tariff_code,
        rate: t.rate,
        base: 0n,
        tax: 0n,
        exoneration: 0n,
      };
    g.base += base;
    g.tax += tax;
    g.exoneration += relief;
    groups.set(key, g);
  }
  if (sums.some((v) => v > MAX))
    add("AMOUNT_LIMIT", "La suma del documento supera el límite monetario.");
  if (issues.length) return { status: "blocked", issues };
  return {
    status: "complete",
    beforeDiscount: formatted(sums[0]),
    discounts: formatted(sums[1]),
    subtotal: formatted(sums[2]),
    tax: formatted(sums[3]),
    exonerations: formatted(sums[4]),
    total: formatted(sums[5]),
    groups: [...groups.values()].map((g) => ({
      ...g,
      base: formatted(g.base),
      tax: formatted(g.tax),
      exoneration: formatted(g.exoneration),
    })),
    lines: output,
  };
}
export function validateInvoiceForIssuance(input: {
  document_type: "FE" | "TE";
  receiver: ReceiverInput;
  lines: InvoiceLineInput[];
}): InvoiceFiscalIssue[] {
  const result = calculateInvoice(input.lines),
    issues: InvoiceFiscalIssue[] =
      result.status === "blocked" ? [...result.issues] : [];
  const add = (code: string, message: string, path: string) =>
    issues.push({ code, message, path });
  const r = input.receiver;
  if (
    (r.name.length > 0 && r.name.length < 3) ||
    r.name.length > 100 ||
    r.identification.length > 20 ||
    r.email.length > 160 ||
    r.address.length > 250
  )
    add(
      "RECEIVER_FISCAL_LIMIT",
      "Revise los límites fiscales de los datos del receptor.",
      "receiver",
    );
  if (
    input.document_type === "FE" &&
    (!r.name || !r.identification_type || !r.identification)
  )
    add(
      "RECEIVER_IDENTIFICATION_MISSING",
      "La factura electrónica requiere nombre e identificación del receptor.",
      "receiver",
    );
  if (
    r.identification_type &&
    !["01", "02", "03", "04", "05", "06"].includes(r.identification_type)
  )
    add(
      "INVALID_RECEIVER_IDENTIFICATION_TYPE",
      "Seleccione un tipo de identificación oficial.",
      "receiver.identification_type",
    );
  if (input.document_type === "FE" && r.domicile === "unspecified")
    add(
      "RECEIVER_DOMICILE_UNCONFIRMED",
      "Confirme si el domicilio del receptor es nacional o extranjero.",
      "receiver.domicile",
    );
  if (
    r.domicile === "domestic" &&
    (!/^[1-7]$/.test(r.province) ||
      !/^\d{2}$/.test(r.canton) ||
      !/^\d{2}$/.test(r.district) ||
      r.address.length < 5 ||
      r.address.length > 250)
  )
    add(
      "RECEIVER_DOMICILE_INCOMPLETE",
      "Complete provincia, cantón, distrito y dirección nacional.",
      "receiver",
    );
  if (
    r.domicile === "foreign" &&
    r.foreign_address &&
    r.foreign_address.length < 5
  )
    add(
      "RECEIVER_FOREIGN_ADDRESS_INVALID",
      "La dirección extranjera debe tener al menos cinco caracteres.",
      "receiver.foreign_address",
    );
  if (
    (r.requires_activity || r.economic_activity) &&
    !/^\d{6}$/.test(r.economic_activity)
  )
    add(
      "RECEIVER_ACTIVITY_MISSING",
      "Confirme la actividad económica de seis dígitos requerida para este receptor.",
      "receiver.economic_activity",
    );
  if (r.requires_email && !r.email)
    add(
      "RECEIVER_EMAIL_MISSING",
      "Complete el correo requerido para este receptor.",
      "receiver.email",
    );
  for (const [i, line] of input.lines.entries()) {
    const f = line.fiscal,
      path = `lines.${i}`;
    if (!line.description?.trim())
      add(
        "DESCRIPTION_MISSING",
        "Complete el detalle de la línea.",
        path + ".description",
      );
    if (!f) continue;
    if (!/^\d{13}$/.test(f.cabys))
      add(
        "CABYS_MISSING",
        "Seleccione un código CABYS de trece dígitos.",
        path + ".fiscal.cabys",
      );
    if (!HACIENDA_UNITS.some((u) => u.code === f.unit))
      add(
        "UNIT_MISSING",
        "Seleccione la unidad de medida.",
        path + ".fiscal.unit",
      );
    if (f.unit === "Otros" && !f.commercial_unit.trim())
      add(
        "COMMERCIAL_UNIT_MISSING",
        "Describa la unidad comercial cuando utilice Otros.",
        path + ".fiscal.commercial_unit",
      );
    if (
      decimal.safeParse(f.discount_amount).success &&
      scaled(f.discount_amount) > 0n && // Annex v4.4 note 20 supplies codes 01–09 and 99.
      (!/^(0[1-9]|99)$/.test(f.discount_code) ||
        f.discount_reason.length < 3 ||
        (f.discount_code === "99" && f.discount_other.length < 5))
    )
      add(
        "DISCOUNT_DETAILS_MISSING",
        "Complete código oficial y motivo del descuento.",
        path + ".fiscal",
      );
    if (f.treatment === "exonerated" && f.exoneration) {
      const e = f.exoneration;
      if (
        !/^(0[1-9]|1[01]|99)$/.test(e.document_type) ||
        !/^(0[1-9]|1[0-2]|99)$/.test(e.institution) ||
        e.document_number.length < 3 ||
        !z.iso.datetime({ offset: true }).safeParse(e.issue_date).success ||
        (e.document_type === "99" && e.document_other.length < 5) ||
        (e.institution === "99" && e.institution_other.length < 5) ||
        (["02", "03", "06", "07", "08"].includes(e.document_type) &&
          !/^\d{1,6}$/.test(e.article)) ||
        (e.article !== "" && !/^\d{1,6}$/.test(e.article)) ||
        (e.inciso !== "" && !/^\d{1,6}$/.test(e.inciso))
      )
        add(
          "EXONERATION_DETAILS_MISSING",
          "Complete códigos oficiales, fecha con zona horaria y evidencia de exoneración aplicable.",
          path + ".fiscal.exoneration",
        );
      if (["04", "11"].includes(e.document_type))
        add(
          "EXONERATION_AUTHORIZATION_UNVERIFIED",
          "La autorización de esta compra requiere verificación antes de emitir.",
          path + ".fiscal.exoneration.document_type",
        );
    }
  }
  return issues;
}
