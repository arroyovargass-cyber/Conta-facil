import { z } from "zod";
import {
  calculateInvoice,
  validateInvoiceForIssuance,
  type ReceiverInput,
  type InvoiceLineInput,
  type InvoiceFiscalIssue,
} from "./invoice-fiscal";
const text = (max: number) => z.string().trim().max(max).default("");
const preparatoryDecimal = z
  .union([z.literal(""), z.string().regex(/^\d{1,13}(?:\.\d{1,5})?$/)])
  .default("");
export const emissionOptionsInput = z
  .object({
    sale_condition: z.enum(["01", "02"]).default("01"),
    credit_days: z.int().min(0).max(99999).nullable().default(null),
    exchange_rate: preparatoryDecimal,
    payment_methods: z
      .array(z.object({ code: text(2), amount: preparatoryDecimal }).strict())
      .max(4)
      .default([]),
    branch_code: text(3),
    terminal_code: text(5),
    issuer_activity: text(6),
  })
  .strict();
export type EmissionOptions = z.infer<typeof emissionOptionsInput>;
function scaled(value: string): bigint {
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer) * 100000n + BigInt(fraction.padEnd(5, "0"));
}
export function prepareEmission(input: {
  document_type: string;
  currency: "CRC" | "USD";
  receiver: ReceiverInput;
  lines: InvoiceLineInput[];
  options: EmissionOptions;
}): {
  options: EmissionOptions;
  totals: ReturnType<typeof calculateInvoice>;
  issues: InvoiceFiscalIssue[];
} {
  const options = emissionOptionsInput.parse(input.options);
  const totals = calculateInvoice(input.lines);
  const issues = validateInvoiceForIssuance({
    document_type: "FE",
    receiver: input.receiver,
    lines: input.lines,
  });
  const add = (code: string, message: string, path: string) =>
    issues.push({ code, message, path });
  if (input.document_type !== "FE")
    add(
      "DOCUMENT_TYPE_UNSUPPORTED",
      "La preparación admite únicamente factura electrónica nacional.",
      "document_type",
    );
  if (input.receiver.domicile !== "domestic")
    add(
      "NATIONAL_RECEIVER_REQUIRED",
      "Confirme un receptor con domicilio nacional.",
      "receiver.domicile",
    );
  if (input.currency === "CRC") options.exchange_rate = "1";
  else if (!options.exchange_rate || scaled(options.exchange_rate) === 0n)
    add(
      "EXCHANGE_RATE_REQUIRED",
      "Ingrese un tipo de cambio USD positivo con hasta cinco decimales.",
      "options.exchange_rate",
    );
  if (!/^\d{3}$/.test(options.branch_code) || options.branch_code === "000")
    add(
      "BRANCH_CODE_REQUIRED",
      "Ingrese una sucursal de tres dígitos distinta de cero.",
      "options.branch_code",
    );
  if (
    !/^\d{5}$/.test(options.terminal_code) ||
    options.terminal_code === "00000"
  )
    add(
      "TERMINAL_CODE_REQUIRED",
      "Ingrese una terminal de cinco dígitos distinta de cero.",
      "options.terminal_code",
    );
  if (!/^\d{6}$/.test(options.issuer_activity))
    add(
      "ISSUER_ACTIVITY_REQUIRED",
      "Ingrese la actividad económica del emisor de seis dígitos.",
      "options.issuer_activity",
    );
  // Annex v4.4 p24: ordinary credit02 requires a positive term in days.
  if (options.sale_condition === "02") {
    if (!options.credit_days)
      add(
        "CREDIT_DAYS_REQUIRED",
        "Ingrese el plazo de crédito en días, entre 1 y 99999.",
        "options.credit_days",
      );
  } else if (options.credit_days !== null)
    add(
      "CREDIT_DAYS_NOT_ALLOWED",
      "El plazo de crédito solo corresponde a ventas a crédito.",
      "options.credit_days",
    );
  // Annex p55 exempts credit02 from mandatory payment; note6 and CR FE XSD verify01–07,99.
  if (options.sale_condition === "01" && !options.payment_methods.length)
    add(
      "PAYMENT_METHOD_REQUIRED",
      "Complete al menos un medio de pago para la venta de contado.",
      "options.payment_methods",
    );
  let sum = 0n,
    validAmounts = true;
  for (const [index, payment] of options.payment_methods.entries()) {
    const path = `options.payment_methods.${index}`;
    if (!/^(0[1-7]|99)$/.test(payment.code))
      add(
        "PAYMENT_CODE_INVALID",
        "Seleccione un código oficial de medio de pago.",
        path + ".code",
      );
    if (payment.code === "99")
      add(
        "PAYMENT_OTHER_DETAILS_UNSUPPORTED",
        "El medio Otros requiere una descripción que esta preparación aún no admite.",
        path + ".code",
      );
    if (!payment.amount || scaled(payment.amount) === 0n) {
      validAmounts = false;
      add(
        "PAYMENT_AMOUNT_REQUIRED",
        "Ingrese un monto de pago positivo.",
        path + ".amount",
      );
    } else sum += scaled(payment.amount);
  }
  // Annex p56 requires reconciliation when two or more methods are supplied.
  // For cash preparation, reconcile even a single explicit payment to the full total.
  if (
    validAmounts &&
    options.payment_methods.length &&
    (options.sale_condition === "01" || options.payment_methods.length > 1) &&
    totals.status === "complete" &&
    sum !== scaled(totals.total)
  )
    add(
      "PAYMENT_TOTAL_MISMATCH",
      "La suma de los medios de pago debe coincidir exactamente con el total del comprobante.",
      "options.payment_methods",
    );
  return { options, totals, issues };
}
