import { z } from "zod";
import { economicActivityCode } from "./economic-activity";
const text = (max = 160) => z.string().trim().max(max);
const optionalEmail = z.union([z.email(), z.literal("")]).default("");
const date = z
  .string()
  .refine(
    (v) =>
      !v ||
      (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
        Number.isFinite(Date.parse(v + "T00:00:00Z")) &&
        new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v),
    "Fecha inválida.",
  )
  .default("");
const currency = z.enum(["CRC", "USD"]);
export const documentTypes = [
  "FE",
  "TE",
  "NC",
  "ND",
  "FEC",
  "FEE",
  "REP",
] as const;
/** Organizational defaults for new companies; never an emission-counter confirmation. */
export const initialBillingLocation = {
  branch_code: "001",
  terminal_code: "00001",
} as const;
const location = z
  .object({
    province: text(1).default(""),
    canton: text(2).default(""),
    district: text(2).default(""),
    neighborhood: text(50).default(""),
  })
  .strict()
  .prefault({});
const billing = z
  .object({
    environment: z.enum(["test", "production"]).default("test"),
    currency: currency.default("CRC"),
    branch_code: z
      .union([z.string().regex(/^\d{3}$/), z.literal("")])
      .default(""),
    terminal_code: z
      .union([z.string().regex(/^\d{5}$/), z.literal("")])
      .default(""),
    send_email: optionalEmail,
    email_delivery_enabled: z.boolean().default(false),
    receive_email: optionalEmail,
    documents: z.array(z.enum(documentTypes)).max(7).default(["FE"]),
  })
  .strict()
  .prefault({});
const tax = z
  .object({
    registration_date: date,
    regime: text(100).default(""),
    vat_condition: text(100).default(""),
    pyme: z.boolean().default(false),
    pyme_registration: text(80).default(""),
    pyme_expiry: date,
  })
  .strict()
  .prefault({});
const accounting = z
  .object({
    functional_currency: currency.default("CRC"),
    secondary_currency: z.union([currency, z.literal("")]).default(""),
    fiscal_start: date,
    fiscal_end: date,
    operations_start: date,
    inventory_method: z.enum(["", "weighted_average", "fifo"]).default(""),
    money_decimals: z.number().int().min(0).max(5).default(2),
    cost_centers: z.boolean().default(false),
    departments: z.boolean().default(true),
    receivables: z.boolean().default(true),
    payables: z.boolean().default(true),
    inventories: z.boolean().default(false),
    fixed_assets: z.boolean().default(false),
    banks: z.boolean().default(false),
  })
  .strict()
  .prefault({});
export const companyConfiguration = z
  .object({
    location,
    billing,
    tax,
    accounting,
    website: z
      .union([
        z
          .url()
          .refine(
            (v) =>
              URL.canParse(v) &&
              ["http:", "https:"].includes(new URL(v).protocol),
          ),
        z.literal(""),
      ])
      .default(""),
    billing_email: optionalEmail,
    logo: z.string().max(90000).default(""),
  })
  .strict()
  .prefault({});
export const companyActivity = z
  .object({
    code: z.string().min(1, "Indica el código de la actividad.").max(30),
    name: text().min(1, "Indica la descripción de la actividad."),
    primary: z.boolean().default(false),
    active: z.boolean().default(true),
    source_url: z
      .union([
        z.url().refine((v) => {
          if (!URL.canParse(v)) return false;
          return new URL(v).protocol === "https:";
        }, "Utiliza una fuente oficial de Hacienda."),
        z.literal(""),
      ])
      .default(""),
  })
  .strict();
const base = z
  .object({
    legal_name: text().min(1, "Indica la razón social."),
    trade_name: text().default(""),
    person_type: z
      .enum(["physical", "legal", "unspecified"])
      .default("unspecified"),
    identification_type: text(40).min(1),
    identification: text(40)
      .min(1)
      .transform((v) => v.replace(/[-\s]/g, "")),
    contact_email: optionalEmail,
    phone: text(40).default(""),
    address: text(1000).default(""),
    active: z.boolean().default(true),
    configuration: companyConfiguration,
    activities: z.array(companyActivity).max(1000).default([]),
  })
  .strict();
function validate(v: z.infer<typeof base>, ctx: z.RefinementCtx) {
  const patterns: Record<string, RegExp> = {
    "01": /^\d{9}$/,
    "02": /^\d{10}$/,
    "03": /^\d{11,12}$/,
    "04": /^\d{10}$/,
  };
  if (
    patterns[v.identification_type] &&
    !patterns[v.identification_type].test(v.identification)
  )
    ctx.addIssue({
      code: "custom",
      path: ["identification"],
      message: "La identificación no corresponde al tipo seleccionado.",
    });
  if (
    (v.identification_type === "02" && v.person_type === "physical") ||
    (["01", "03"].includes(v.identification_type) && v.person_type === "legal")
  )
    ctx.addIssue({
      code: "custom",
      path: ["person_type"],
      message: "Revisa el tipo de persona y de identificación.",
    });
  if (v.activities.filter((a) => a.active && a.primary).length > 1)
    ctx.addIssue({
      code: "custom",
      path: ["activities"],
      message: "Selecciona una sola actividad principal activa.",
    });
  if (new Set(v.activities.map((a) => a.code)).size !== v.activities.length)
    ctx.addIssue({
      code: "custom",
      path: ["activities"],
      message: "No repitas códigos de actividad.",
    });
  const a = v.configuration.accounting;
  if (a.fiscal_start && a.fiscal_end && a.fiscal_start > a.fiscal_end)
    ctx.addIssue({
      code: "custom",
      path: ["configuration", "accounting", "fiscal_end"],
      message: "El cierre debe ser posterior al inicio del período.",
    });
  if (a.secondary_currency && a.secondary_currency === a.functional_currency)
    ctx.addIssue({
      code: "custom",
      path: ["configuration", "accounting", "secondary_currency"],
      message: "Las monedas deben ser diferentes.",
    });
  if (
    v.configuration.billing.terminal_code &&
    !v.configuration.billing.branch_code
  )
    ctx.addIssue({
      code: "custom",
      path: ["configuration", "billing", "branch_code"],
      message: "Indica la sucursal de la terminal.",
    });
}
export const companyInput = base.superRefine(validate);
export const createCompanyInput = base
  .extend({
    operation_id: z.uuid(),
    activities: z
      .array(companyActivity.extend({ code: economicActivityCode }))
      .max(30)
      .default([]),
  })
  .superRefine(validate)
  .refine(
    (v) =>
      ["01", "02", "03", "04"].includes(v.identification_type) &&
      v.person_type !== "unspecified" &&
      (!v.activities.some((a) => a.active) ||
        v.activities.some((a) => a.active && a.primary)),
    {
      message:
        "Selecciona tipo de persona e identificación para la nueva empresa.",
      path: ["identification_type"],
    },
  )
  .transform((value) => ({
    ...value,
    configuration: {
      ...value.configuration,
      billing: {
        ...value.configuration.billing,
        branch_code:
          value.configuration.billing.branch_code ||
          initialBillingLocation.branch_code,
        terminal_code:
          value.configuration.billing.terminal_code ||
          initialBillingLocation.terminal_code,
      },
    },
  }));
export const updateCompanyInput = base
  .extend({ expected_version: z.number().int().positive() })
  .superRefine(validate);
export type CompanyInput = z.infer<typeof companyInput>;
/** Delivery is an explicit choice frozen with the invoice, never inferred from an address. */
export function invoiceEmailDeliveryEnabled(configuration: unknown): boolean {
  const billing = (
    configuration as { billing?: Record<string, unknown> } | null
  )?.billing;
  if (typeof billing?.email_delivery_enabled === "boolean")
    return billing.email_delivery_enabled;
  // Compatibility for immutable invoices created before the company form used an address.
  return billing?.send_email === true;
}
export function companyPreparation(value: CompanyInput) {
  const missing: string[] = [];
  if (value.person_type === "unspecified")
    missing.push("Tipo de persona pendiente.");
  const loc = value.configuration.location;
  if (!loc.province || !loc.canton || !loc.district || !value.address)
    missing.push("Domicilio fiscal pendiente.");
  if (!value.activities.some((a) => a.primary && a.active))
    missing.push("Actividad económica principal pendiente.");
  if (value.activities.length)
    missing.push("Las actividades declaradas requieren verificación oficial.");
  if (
    !value.configuration.billing.branch_code ||
    !value.configuration.billing.terminal_code
  )
    missing.push("Sucursal o terminal pendiente.");
  missing.push(
    "Revisa los requisitos finales en Facturación para cada empresa y ambiente antes de emitir.",
  );
  return { status: "pending" as const, canEmit: false, issues: missing };
}
