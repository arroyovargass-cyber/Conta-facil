import { HACIENDA_UNITS } from "./hacienda-units";
import { isEconomicActivityCode } from "./economic-activity";
import { isPharmaceuticalFormCode } from "./pharmaceutical-forms";
import {
  CHARGE_ONLY_CODES,
  OTHER_CHARGE_CODES,
  otherChargeInput,
  type OtherChargeInput,
} from "./invoice-extras";
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
    phone_country_code: text(3),
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
    internal_code: text(20),
    commercial_codes: z
      .array(z.object({ type: text(2), code: text(20) }).strict())
      .max(5)
      .default([]),
    transaction_type: text(2),
    vin_numbers: z.array(z.string().trim().max(17)).max(1000).default([]),
    medicine_registration: text(100),
    pharmaceutical_form: text(3),
    treatment: z
      .enum(["pending", "taxable", "exempt", "exonerated", "non_subject"])
      .default("pending"),
    tax_code: z.literal("01").default("01"),
    tariff_code: text(2),
    discount_amount: decimal.default("0"),
    discount_mode: z.enum(["amount", "percentage"]).default("amount"),
    discount_percentage: z.union([z.literal(""), decimal]).default("0"),
    discount_code: text(2),
    discount_reason: text(80),
    discount_other: text(100),
    exoneration: exonerationInput.nullable().default(null),
    other_taxes: z
      .array(
        z
          .object({
            code: text(2),
            rate: z.union([z.literal(""), decimal]).default(""),
            other_description: text(100),
          })
          .strict(),
      )
      .max(999)
      .default([]),
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
export type CalculatedTax = {
  code: string;
  tariff_code: string;
  rate: string;
  base: string;
  amount: string;
  exoneration: string;
};
export type CalculatedOtherCharge = OtherChargeInput & {
  calculated_amount: string;
};
export type TreatmentSummary = {
  taxable: string;
  exempt: string;
  exonerated: string;
  non_subject: string;
};
export type InvoiceSummary = {
  services: TreatmentSummary;
  goods: TreatmentSummary;
  totals: TreatmentSummary;
};
export type Amounts = {
  beforeDiscount: string;
  discount: string;
  base: string;
  tax_base: string;
  tax: string;
  taxes: CalculatedTax[];
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
      otherCharges: string;
      ivaReturned: string;
      total: string;
      charges: CalculatedOtherCharge[];
      summary: InvoiceSummary;
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
  otherCharges: OtherChargeInput[] = [],
): InvoiceCalculation {
  const issues: InvoiceFiscalIssue[] = [];
  const add = (code: string, message: string, path?: string) =>
    issues.push({ code, message, ...(path ? { path } : {}) });
  // User-confirmed accounting policy: half up at each line; document totals sum rounded lines.
  const round = (n: bigint, d: bigint, _path: string): bigint =>
    n / d + ((n % d) * 2n >= d ? 1n : 0n);
  const charges: CalculatedOtherCharge[] = [];
  let chargeTotal = 0n;
  if (otherCharges.length > 15)
    add(
      "OTHER_CHARGE_COUNT",
      "Se permiten hasta quince cargos.",
      "other_charges",
    );
  for (const [index, input] of otherCharges.slice(0, 15).entries()) {
    const path = `other_charges.${index}`,
      parsed = otherChargeInput.safeParse(input);
    if (!parsed.success) {
      add("OTHER_CHARGE_INVALID", "Revise los campos del cargo.", path);
      continue;
    }
    const charge = parsed.data;
    if (!OTHER_CHARGE_CODES.some((c) => c.code === charge.code))
      add(
        "OTHER_CHARGE_CODE_INVALID",
        "Seleccione el código oficial del cargo.",
        path + ".code",
      );
    let amount = 0n;
    if (charge.mode === "percentage") {
      // Annex p49 defines percentage points, but no universal calculation base.
      if (!charge.percentage || !charge.percentage_base) {
        add(
          "OTHER_CHARGE_PERCENTAGE_BASE_REQUIRED",
          "Indique el porcentaje y su base comercial explícita.",
          path,
        );
        continue;
      }
      if (scaled(charge.percentage) > 999999999n) {
        add(
          "OTHER_CHARGE_PERCENTAGE_LIMIT",
          "El porcentaje admite hasta cuatro enteros y cinco decimales.",
          path + ".percentage",
        );
        continue;
      }
      amount = round(
        scaled(charge.percentage_base) * scaled(charge.percentage),
        100n * S,
        path,
      );
    } else if (charge.amount) amount = scaled(charge.amount);
    if (amount <= 0n) {
      add(
        "OTHER_CHARGE_AMOUNT_REQUIRED",
        "El monto del cargo debe ser mayor que cero.",
        path + ".amount",
      );
      continue;
    }
    if (amount > MAX) {
      add("AMOUNT_LIMIT", "El cargo supera el límite monetario.", path);
      continue;
    }
    chargeTotal += amount;
    charges.push({ ...charge, calculated_amount: formatted(amount) });
  }
  if (
    lines.length > 100 ||
    (lines.length === 0 &&
      (!charges.length ||
        charges.some(
          (c) => !(CHARGE_ONLY_CODES as readonly string[]).includes(c.code),
        )))
  )
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
  const summary = {
    services: { taxable: 0n, exempt: 0n, exonerated: 0n, non_subject: 0n },
    goods: { taxable: 0n, exempt: 0n, exonerated: 0n, non_subject: 0n },
  };
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
    );
    if (
      f.discount_mode === "percentage" &&
      (!f.discount_percentage || scaled(f.discount_percentage) > 100n * S)
    ) {
      add(
        "DISCOUNT_PERCENTAGE_INVALID",
        "Ingrese un porcentaje de descuento entre cero y cien.",
        path + ".fiscal.discount_percentage",
      );
      continue;
    }
    const discount =
        f.discount_mode === "percentage"
          ? round(
              gross * scaled(f.discount_percentage),
              100n * S,
              path + ".discount",
            )
          : scaled(f.discount_amount),
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
    let cement = 0n;
    const extraTaxes: CalculatedTax[] = [];
    const seenTaxes = new Set<string>();
    for (const [taxIndex, otherTax] of f.other_taxes.entries()) {
      const taxPath = path + `.fiscal.other_taxes.${taxIndex}`;
      if (seenTaxes.has(otherTax.code)) {
        add(
          "OTHER_TAX_DUPLICATE",
          "No duplique el impuesto de la línea.",
          taxPath,
        );
        continue;
      }
      seenTaxes.add(otherTax.code);
      if (otherTax.code !== "12") {
        add(
          "OTHER_TAX_REGIME_UNSUPPORTED",
          "La base legal y los datos específicos de este impuesto deben verificarse antes de calcularlo.",
          taxPath,
        );
        continue;
      }
      if (!otherTax.rate || scaled(otherTax.rate) !== 5n * S) {
        add(
          "CEMENT_TAX_RATE_INVALID",
          "El impuesto al cemento utiliza la tarifa oficial del cinco por ciento.",
          taxPath + ".rate",
        );
        continue;
      }
      // Annex pp38,44: cement12 = net subtotal × 5%; it increases the IVA base.
      cement = round(base * 5n, 100n, taxPath);
      extraTaxes.push({
        code: "12",
        tariff_code: "",
        rate: "5",
        base: formatted(base),
        amount: formatted(cement),
        exoneration: formatted(0n),
      });
    }
    if (f.treatment === "exonerated" && f.other_taxes.length) {
      add(
        "EXONERATION_OTHER_TAX_SUMMARY_UNVERIFIED",
        "La proporción exonerada con otros impuestos requiere verificación normativa.",
        path + ".fiscal",
      );
      continue;
    }
    const taxBase = base + cement,
      rate = scaled(t.rate),
      vat = round(taxBase * rate, 100n * S, path + ".tax"),
      tax = vat + cement;
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
      relief = round(taxBase * exemptRate, 100n * S, path + ".exoneration");
    } else if (f.exoneration) {
      add(
        "EXONERATION_TREATMENT_MISMATCH",
        "Seleccione tratamiento exonerado para aplicar exoneración.",
        path,
      );
      continue;
    }
    if (f.treatment === "exonerated" && vat === 0n) {
      add(
        "EXONERATION_SUMMARY_ZERO_TAX",
        "La proporción exonerada no puede determinarse cuando el IVA de la línea redondea a cero.",
        path + ".fiscal.exoneration",
      );
      continue;
    }
    const total = base + tax - relief,
      values = [gross, discount, base, tax, relief, total];
    if ([...values, taxBase, cement].some((v) => v > MAX || v < 0n)) {
      add("AMOUNT_LIMIT", "El importe supera el límite monetario.", path);
      continue;
    }
    values.forEach((v, i) => (sums[i] += v));
    output.push({
      beforeDiscount: formatted(gross),
      discount: formatted(discount),
      base: formatted(base),
      tax_base: formatted(taxBase),
      tax: formatted(tax),
      taxes: [
        {
          code: f.tax_code,
          tariff_code: f.tariff_code,
          rate: t.rate,
          base: formatted(taxBase),
          amount: formatted(vat),
          exoneration: formatted(relief),
        },
        ...extraTaxes,
      ],
      exoneration: formatted(relief),
      total: formatted(total),
    });
    for (const calculatedTax of output[output.length - 1].taxes) {
      const key = calculatedTax.code + ":" + calculatedTax.tariff_code,
        g = groups.get(key) ?? {
          tax_code: calculatedTax.code,
          tariff_code: calculatedTax.tariff_code,
          rate: calculatedTax.rate,
          base: 0n,
          tax: 0n,
          exoneration: 0n,
        };
      g.base += scaled(calculatedTax.base);
      g.tax += scaled(calculatedTax.amount);
      g.exoneration += scaled(calculatedTax.exoneration);
      groups.set(key, g);
    }
    const bucket = Number(f.cabys[0]) >= 5 ? summary.services : summary.goods;
    if (f.treatment === "exonerated") {
      // Annex pp50–52: gross sale × (exoneration amount / gross IVA).
      // Apply the confirmed five-decimal half-up policy to this line partition only.
      const exonerated = round(gross * relief, vat, path + ".summary");
      bucket.exonerated += exonerated;
      bucket.taxable += gross - exonerated;
    } else if (["01", "11"].includes(f.tariff_code))
      bucket.non_subject += gross;
    else if (f.treatment === "exempt") bucket.exempt += gross;
    else bucket.taxable += gross;
  }
  if ([...sums, chargeTotal, sums[5] + chargeTotal].some((v) => v > MAX))
    add("AMOUNT_LIMIT", "La suma del documento supera el límite monetario.");
  if (issues.length) return { status: "blocked", issues };
  return {
    status: "complete",
    beforeDiscount: formatted(sums[0]),
    discounts: formatted(sums[1]),
    subtotal: formatted(sums[2]),
    tax: formatted(sums[3]),
    exonerations: formatted(sums[4]),
    otherCharges: formatted(chargeTotal),
    ivaReturned: formatted(0n),
    total: formatted(sums[5] + chargeTotal),
    charges,
    summary: {
      services: Object.fromEntries(
        Object.entries(summary.services).map(([k, v]) => [k, formatted(v)]),
      ) as TreatmentSummary,
      goods: Object.fromEntries(
        Object.entries(summary.goods).map(([k, v]) => [k, formatted(v)]),
      ) as TreatmentSummary,
      totals: Object.fromEntries(
        Object.entries(summary.services).map(([k, v]) => [
          k,
          formatted(v + summary.goods[k as keyof typeof summary.goods]),
        ]),
      ) as TreatmentSummary,
    },
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
  other_charges?: OtherChargeInput[];
}): InvoiceFiscalIssue[] {
  const result = calculateInvoice(input.lines, input.other_charges),
    issues: InvoiceFiscalIssue[] =
      result.status === "blocked" ? [...result.issues] : [];
  const add = (code: string, message: string, path: string) =>
    issues.push({ code, message, path });
  const r = input.receiver;
  const hasReceiver = [
    r.name,
    r.identification_type,
    r.identification,
    r.email,
    r.phone,
    r.address,
    r.trade_name,
    r.foreign_address,
    r.province,
    r.canton,
    r.district,
    r.neighborhood,
    r.phone_country_code,
  ].some(Boolean);
  if (input.document_type === "TE" && hasReceiver && !r.name)
    add(
      "RECEIVER_NAME_MISSING",
      "Complete el nombre del receptor incluido en el tiquete.",
      "receiver.name",
    );
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
  if (
    input.document_type === "TE" &&
    Boolean(r.identification_type) !== Boolean(r.identification)
  )
    add(
      "RECEIVER_IDENTIFICATION_INCOMPLETE",
      "Complete ambos campos de identificación u omítalos del tiquete.",
      "receiver.identification",
    );
  // Annex receiver identification rules and note4 (pp22–23,69).
  const receiverIdentificationPatterns: Record<string, RegExp> = {
    "01": /^[1-9]\d{8}$/,
    "02": /^\d{10}$/,
    "03": /^[1-9]\d{10,11}$/,
    "04": /^\d{10}$/,
    "05": /^[\p{L}\p{N}]{1,20}$/u,
  };
  if (
    r.identification &&
    receiverIdentificationPatterns[r.identification_type] &&
    !receiverIdentificationPatterns[r.identification_type].test(
      r.identification,
    )
  )
    add(
      "RECEIVER_IDENTIFICATION_INVALID",
      "El número debe respetar el formato del tipo de identificación seleccionado, sin guiones ni ceros iniciales para cédula física o DIMEX.",
      "receiver.identification",
    );
  // Foreign05 is allowed in TE. FE05 requires sale12, outside the supported01/02 profile.
  // Non-contributor06 is restricted to the issuer of a purchase invoice (note4).
  if (
    r.identification_type === "06" ||
    (input.document_type === "FE" && r.identification_type === "05")
  )
    add(
      "RECEIVER_IDENTIFICATION_CONTEXT_UNSUPPORTED",
      "El tipo de identificación requiere un contexto de comprobante o condición de venta que esta preparación no admite.",
      "receiver.identification_type",
    );
  if (r.phone_country_code && !/^\d{1,3}$/.test(r.phone_country_code))
    add(
      "RECEIVER_PHONE_COUNTRY_INVALID",
      "El código de país debe tener entre uno y tres dígitos.",
      "receiver.phone_country_code",
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
    input.document_type === "FE" &&
    (r.requires_activity || r.economic_activity) &&
    !isEconomicActivityCode(r.economic_activity)
  )
    add(
      "RECEIVER_ACTIVITY_MISSING",
      "Confirme la actividad económica de seis caracteres requerida para este receptor.",
      "receiver.economic_activity",
    );
  if (r.requires_email && !r.email)
    add(
      "RECEIVER_EMAIL_MISSING",
      "Complete el correo requerido para este receptor.",
      "receiver.email",
    );
  for (const [i, line] of input.lines.entries()) {
    const parsedFiscal = lineFiscalInput.safeParse(line.fiscal),
      f = parsedFiscal.success ? parsedFiscal.data : null,
      path = `lines.${i}`;
    if (!line.description?.trim())
      add(
        "DESCRIPTION_MISSING",
        "Complete el detalle de la línea.",
        path + ".description",
      );
    else if (
      line.description.trim().length < 3 ||
      line.description.trim().length > 200
    )
      add(
        "DESCRIPTION_FISCAL_LIMIT",
        "El detalle fiscal debe tener entre tres y doscientos caracteres.",
        path + ".description",
      );
    if (!f) continue;
    for (const [codeIndex, commercial] of f.commercial_codes.entries())
      if (!/^(0[1-4]|99)$/.test(commercial.type) || !commercial.code)
        add(
          "COMMERCIAL_CODE_INVALID",
          "Complete el código comercial y su tipo oficial.",
          path + `.fiscal.commercial_codes.${codeIndex}`,
        );
    if (input.document_type === "FE" && f.transaction_type) {
      if (!/^(0[1-9]|1[0-3])$/.test(f.transaction_type))
        add(
          "TRANSACTION_TYPE_INVALID",
          "Seleccione un tipo de transacción oficial.",
          path + ".fiscal.transaction_type",
        );
      else if (f.transaction_type !== "01")
        add(
          "TRANSACTION_TREATMENT_UNSUPPORTED",
          "El tratamiento especial de esta transacción requiere verificación antes de emitir.",
          path + ".fiscal.transaction_type",
        );
    }
    if (f.vin_numbers.some((vin) => !vin))
      add(
        "VIN_INCOMPLETE",
        "Complete cada número VIN o serie incluido en la línea.",
        path + ".fiscal.vin_numbers",
      );
    // Annex pp28–29: a registered medicine requires a pharmaceutical form.
    // The catalog verifies the supplied form, without inferring CABYS applicability.
    if (
      (f.medicine_registration || f.pharmaceutical_form) &&
      !isPharmaceuticalFormCode(f.pharmaceutical_form)
    )
      add(
        "PHARMACEUTICAL_FORM_INVALID",
        "Seleccione la forma farmacéutica del catálogo oficial, conservando su código exacto.",
        path + ".fiscal.pharmaceutical_form",
      );
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
      ((f.discount_mode === "percentage" &&
        f.discount_percentage &&
        scaled(f.discount_percentage) > 0n) ||
        (f.discount_mode === "amount" && scaled(f.discount_amount) > 0n)) && // Annex v4.4 note 20 supplies codes 01–09 and 99.
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
  for (const [i, value] of (input.other_charges ?? []).entries()) {
    const parsed = otherChargeInput.safeParse(value),
      path = `other_charges.${i}`;
    if (!parsed.success) continue;
    const c = parsed.data;
    if (!c.description)
      add(
        "OTHER_CHARGE_DESCRIPTION_MISSING",
        "Describa el cargo.",
        path + ".description",
      );
    if (c.code === "99" && c.other_description.length < 5)
      add(
        "OTHER_CHARGE_OTHER_DESCRIPTION_MISSING",
        "Describa el tipo de otros cargos con al menos cinco caracteres.",
        path + ".other_description",
      );
    if (
      c.code === "04" ||
      c.third_party_type ||
      c.third_party_identification ||
      c.third_party_name
    ) {
      const identificationPatterns: Record<string, RegExp> = {
        "01": /^[1-9]\d{8}$/,
        "02": /^\d{10}$/,
        "03": /^[1-9]\d{10,11}$/,
        "04": /^\d{10}$/,
        "05": /^[\p{L}\p{N}]{1,20}$/u,
        "06": /^.{1,20}$/,
      };
      if (
        ((c.code === "04" ||
          c.third_party_type ||
          c.third_party_identification) &&
          !identificationPatterns[c.third_party_type]?.test(
            c.third_party_identification,
          )) ||
        ((c.code === "04" || c.third_party_name) &&
          c.third_party_name.length < 5)
      )
        add(
          "OTHER_CHARGE_THIRD_PARTY_MISSING",
          "Complete identificación oficial y nombre del tercero que vende o presta lo cobrado.",
          path,
        );
      // Annex pp48–49 explicitly exempts foreign nonresidents05 from registration.
      // Non-contributor06 has a separately restricted FEC context (note4), not FE/TE.
      if (c.third_party_type === "06")
        add(
          "OTHER_CHARGE_THIRD_PARTY_CONTEXT_UNSUPPORTED",
          "El tipo No Contribuyente corresponde a un contexto de factura de compra distinto de FE o TE.",
          path + ".third_party_identification",
        );
    }
  }
  return issues;
}
