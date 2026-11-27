import { z } from "zod";

/** XSD 4.4 requires six characters. Registration and current activity are separate checks. */
export function isEconomicActivityCode(value: string): boolean {
  return Array.from(value).length === 6;
}

export const economicActivityCode = z.string().refine(isEconomicActivityCode, {
  message: "El código de actividad debe tener exactamente seis caracteres.",
});
