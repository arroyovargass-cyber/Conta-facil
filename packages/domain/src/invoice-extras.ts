import { z } from "zod";

const text = (max: number) => z.string().trim().max(max).default("");
const preparatoryDecimal = z
  .union([z.literal(""), z.string().regex(/^\d{1,13}(?:\.\d{1,5})?$/)])
  .default("");

// Hacienda v4.4 annex note 16, p80. These are charge types, not tax rates.
export const OTHER_CHARGE_CODES = [
  { code: "01", label: "Contribución parafiscal" },
  { code: "02", label: "Timbre de la Cruz Roja" },
  { code: "03", label: "Timbre de Bomberos" },
  { code: "04", label: "Cobro de un tercero" },
  { code: "05", label: "Costos de exportación" },
  { code: "06", label: "Impuesto de servicio 10%" },
  { code: "07", label: "Timbre de colegios profesionales" },
  { code: "08", label: "Depósitos de garantía" },
  { code: "09", label: "Multas y penalizaciones" },
  { code: "10", label: "Intereses moratorios" },
  { code: "99", label: "Otros cargos" },
] as const;

export const otherChargeInput = z
  .object({
    code: text(2),
    other_description: text(100),
    description: text(160),
    third_party_type: text(2),
    third_party_identification: text(20),
    third_party_name: text(100),
    mode: z.enum(["amount", "percentage"]).default("amount"),
    amount: preparatoryDecimal,
    percentage: preparatoryDecimal,
    percentage_base: preparatoryDecimal,
  })
  .strict();

export type OtherChargeInput = z.infer<typeof otherChargeInput>;

// Annex pp47–49: only these charges permit an omitted DetalleServicio.
export const CHARGE_ONLY_CODES = ["04", "08", "09", "10"] as const;
