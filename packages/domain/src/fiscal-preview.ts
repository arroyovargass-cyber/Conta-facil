import { z } from "zod";
import { decimalInput } from "./billing";
export const FISCAL_PROFILE = "FE_CRC_CASH_IVA13" as const;
export const fiscalPreviewRequest = z
  .object({
    profile: z.literal(FISCAL_PROFILE),
    expected_version: z.int().positive(),
    confirmed_general_vat: z.literal(true),
  })
  .strict();
export type FiscalPreviewSource = {
  currency: string;
  customerSnapshot: { identification_type?: string; identification?: string };
  lines: { position: number; quantity: string; unit_price: string }[];
};
export type FiscalIssue = {
  code: string;
  severity: "blocker";
  path?: string;
  position?: number;
  message: string;
  nextAction: string;
};
export type FiscalLine = {
  position: number;
  base: string;
  vat: string;
  total: string;
};
export type FiscalCalculation =
  | {
      status: "complete";
      currency: "CRC";
      lines: FiscalLine[];
      base: string;
      vat: string;
      total: string;
    }
  | { status: "blocked"; currency: "CRC" };
export type FiscalPreviewResult = {
  profile: typeof FISCAL_PROFILE;
  calculation: FiscalCalculation;
  readiness: {
    canGenerateXml: false;
    xsdValidation: "not_run";
    signature: "missing";
    haciendaStatus: "not_sent";
    issues: FiscalIssue[];
  };
};
const SCALE = 100000n,
  MAX = 999999999999999999n;
function scaled(v: string) {
  const [i, f = ""] = v.split(".");
  return BigInt(i) * SCALE + BigInt(f.padEnd(5, "0"));
}
function decimal(v: bigint) {
  const s = v.toString().padStart(6, "0"),
    fraction = s.slice(-5).replace(/0+$/, "");
  return s.slice(0, -5) + (fraction ? "." + fraction : "");
}
export function prepareFiscalPreview(
  source: FiscalPreviewSource,
): FiscalPreviewResult {
  const issues: FiscalIssue[] = [];
  let calculationBlocked = false;
  function issue(
    code: string,
    message: string,
    nextAction: string,
    position?: number,
    path?: string,
  ) {
    issues.push({
      code,
      severity: "blocker",
      message,
      nextAction,
      ...(position !== undefined ? { position } : {}),
      ...(path ? { path } : {}),
    });
  }
  issue(
    "SCHEMA_REVISION_UNCONFIRMED",
    "La revisión vigente del XSD todavía no está confirmada.",
    "Requiere verificar el paquete oficial antes de habilitar XML.",
  );
  issue(
    "SIGNATURE_MISSING",
    "Este borrador todavía no tiene firma electrónica.",
    "La firma real se habilitará en un próximo incremento.",
  );
  issue(
    "XML_GENERATION_DISABLED",
    "La generación de XML está inhabilitada en esta vista previa.",
    "Completar la verificación normativa y la integración de firma.",
  );
  issue(
    "ISSUER_PROFILE_PENDING",
    "El perfil fiscal estructurado del emisor está pendiente de habilitación.",
    "Su captura y verificación estarán disponibles en el próximo incremento.",
  );
  issue(
    "ISSUER_ACTIVITY_UNCONFIRMED",
    "La actividad del emisor no se ha confirmado en este flujo.",
    "Confirmarla con el catálogo oficial cuando se habilite el perfil fiscal.",
  );
  if (
    !source.customerSnapshot.identification_type?.trim() ||
    !source.customerSnapshot.identification?.trim()
  )
    issue(
      "RECEIVER_IDENTIFICATION_MISSING",
      "La copia comercial del cliente no contiene identificación completa.",
      "Completar los datos comerciales; su validación fiscal vendrá después.",
    );
  else
    issue(
      "RECEIVER_IDENTIFICATION_UNCONFIRMED",
      "La identificación comercial del cliente no está confirmada para uso fiscal.",
      "Verificar tipo e inscripción en el próximo flujo de preparación fiscal.",
    );
  if (source.currency !== "CRC") {
    calculationBlocked = true;
    issue(
      "UNSUPPORTED_CURRENCY",
      "Este perfil solo calcula operaciones nacionales en colones.",
      "Seleccionar un borrador CRC; no se realiza conversión de moneda.",
      undefined,
      "currency",
    );
  }
  if (source.lines.length < 1 || source.lines.length > 100) {
    calculationBlocked = true;
    issue(
      "INVALID_LINE_COUNT",
      "El perfil requiere entre una y cien líneas comerciales.",
      "Corregir las líneas del borrador antes de solicitar la vista previa.",
    );
  }
  let baseSum = 0n,
    vatSum = 0n,
    totalSum = 0n;
  const lines: FiscalLine[] = [];
  for (const [index, l] of source.lines.slice(0, 100).entries()) {
    const path = "lines." + index;
    issue(
      "FISCAL_CLASSIFICATION_PENDING",
      "La clasificación fiscal de esta línea está pendiente.",
      "Confirmar CABYS, unidad y tratamiento en el próximo incremento.",
      l.position,
      path,
    );
    if (
      !decimalInput.safeParse(l.quantity).success ||
      !decimalInput.safeParse(l.unit_price).success ||
      scaled(l.quantity) === 0n
    ) {
      calculationBlocked = true;
      issue(
        "INVALID_COMMERCIAL_VALUES",
        "La línea contiene una cantidad o precio fuera de los límites comerciales.",
        "Corregir cantidad positiva y precio no negativo, con hasta cinco decimales.",
        l.position,
        path,
      );
      continue;
    }
    if ((l.quantity.split(".")[1] ?? "").replace(/0+$/, "").length > 3) {
      calculationBlocked = true;
      issue(
        "QUANTITY_PRECISION",
        "La cantidad supera tres decimales significativos.",
        "Corregir explícitamente la cantidad del borrador; no se redondeará automáticamente.",
        l.position,
        path + ".quantity",
      );
      continue;
    }
    const product = scaled(l.quantity) * scaled(l.unit_price);
    if (product % SCALE !== 0n) {
      calculationBlocked = true;
      issue(
        "ROUNDING_POLICY_PENDING",
        "El importe de línea requiere una política de redondeo pendiente de confirmar.",
        "Revisar la precisión o esperar la política normativa; no se truncará el importe.",
        l.position,
        path,
      );
      continue;
    }
    const base = product / SCALE;
    if ((base * 13n) % 100n !== 0n) {
      calculationBlocked = true;
      issue(
        "ROUNDING_POLICY_PENDING",
        "El IVA de la línea requiere una política de redondeo pendiente de confirmar.",
        "Revisar la precisión o esperar la política normativa; no se truncará el IVA.",
        l.position,
        path,
      );
      continue;
    }
    const vat = (base * 13n) / 100n,
      total = base + vat;
    if ([base, vat, total].some((v) => v > MAX)) {
      calculationBlocked = true;
      issue(
        "AMOUNT_LIMIT",
        "Un importe de la línea supera el límite monetario del perfil.",
        "Revisar cantidades y precios antes de volver a calcular.",
        l.position,
        path,
      );
      continue;
    }
    baseSum += base;
    vatSum += vat;
    totalSum += total;
    lines.push({
      position: l.position,
      base: decimal(base),
      vat: decimal(vat),
      total: decimal(total),
    });
  }
  if ([baseSum, vatSum, totalSum].some((v) => v > MAX)) {
    calculationBlocked = true;
    issue(
      "AMOUNT_LIMIT",
      "La suma del documento supera el límite monetario del perfil.",
      "Revisar el documento completo; no se mostrará un total parcial.",
    );
  }
  return {
    profile: FISCAL_PROFILE,
    calculation: calculationBlocked
      ? { status: "blocked", currency: "CRC" }
      : {
          status: "complete",
          currency: "CRC",
          lines,
          base: decimal(baseSum),
          vat: decimal(vatSum),
          total: decimal(totalSum),
        },
    readiness: {
      canGenerateXml: false,
      xsdValidation: "not_run",
      signature: "missing",
      haciendaStatus: "not_sent",
      issues,
    },
  };
}
