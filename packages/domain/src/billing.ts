import { z } from "zod";
const text = z.string().trim().min(1).max(160);
const optionalText = (max: number) => z.string().trim().max(max).default("");
export const decimalInput = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,5})?$/);
const positiveDecimal = decimalInput.refine(
  (v) => BigInt(v.replace(".", "")) > 0n,
);
export const customerInput = z
  .object({
    name: text,
    identification_type: optionalText(40),
    identification: optionalText(40),
    email: z.union([z.email().max(254), z.literal("")]).default(""),
    phone: optionalText(40),
    address: optionalText(1000),
    active: z.boolean().default(true),
  })
  .strict()
  .refine((v) => Boolean(v.identification_type) === Boolean(v.identification), {
    message: "Completa tipo y número de identificación.",
    path: ["identification"],
  });
export const catalogInput = z
  .object({
    code: z.string().trim().min(1).max(60),
    description: text,
    kind: z.enum(["product", "service"]),
    currency: z.enum(["CRC", "USD"]),
    unit_price: decimalInput,
    cabys: optionalText(40),
    unit: optionalText(40),
    active: z.boolean().default(true),
  })
  .strict();
export const draftLineInput = z
  .object({
    catalog_item_id: z.uuid().nullable().optional().default(null),
    description: text,
    quantity: positiveDecimal,
    unit_price: decimalInput,
  })
  .strict();
export const draftFields = z
  .object({
    customer_id: z.uuid(),
    department_id: z.uuid(),
    currency: z.enum(["CRC", "USD"]),
    notes: optionalText(2000),
    lines: z.array(draftLineInput).min(1).max(100),
  })
  .strict();
export const draftInput = draftFields
  .extend({ operation_id: z.uuid() })
  .strict();
export const draftUpdateInput = draftFields
  .extend({ version: z.int().positive() })
  .strict();
export type CustomerInput = z.infer<typeof customerInput>;
export type CatalogInput = z.infer<typeof catalogInput>;
export type DraftInput = z.infer<typeof draftInput>;
function scaled(value: string): bigint {
  decimalInput.parse(value);
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer) * 100000n + BigInt(fraction.padEnd(5, "0"));
}
function format(value: bigint): string {
  const s = value.toString().padStart(11, "0");
  const integer = s.slice(0, -10),
    fraction = s.slice(-10).replace(/0+$/, "");
  return integer + (fraction ? "." + fraction : "");
}
export function lineAmount(quantity: string, price: string): string {
  return format(scaled(quantity) * scaled(price));
}
export function subtotal(
  lines: { quantity: string; unit_price: string }[],
): string {
  return format(
    lines.reduce((n, l) => n + scaled(l.quantity) * scaled(l.unit_price), 0n),
  );
}
