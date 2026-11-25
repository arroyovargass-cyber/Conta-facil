/** FE (01) numbering layout from the v4.4 annex, note 3. */
export function formatInvoiceNumber(input: {
  branch: string;
  terminal: string;
  sequence: bigint;
}): string {
  if (
    typeof input.branch !== "string" ||
    !/^[0-9]{3}$/.test(input.branch) ||
    input.branch === "000"
  )
    throw new Error("Sucursal inválida");
  if (
    typeof input.terminal !== "string" ||
    !/^[0-9]{5}$/.test(input.terminal) ||
    input.terminal === "00000"
  )
    throw new Error("Terminal inválida");
  if (
    typeof input.sequence !== "bigint" ||
    input.sequence < 1n ||
    input.sequence > 9999999999n
  )
    throw new Error("Consecutivo fuera de rango");
  return `${input.branch}${input.terminal}01${input.sequence.toString().padStart(10, "0")}`;
}

/** Builds a normal-situation national FE clave; security is supplied by the caller. */
export function buildInvoiceClave(input: {
  consecutivo: string;
  issuerIdentification: string;
  issuedAt: Date;
  securityCode: string;
}): string {
  if (
    typeof input.consecutivo !== "string" ||
    !/^[0-9]{8}01[0-9]{10}$/.test(input.consecutivo)
  )
    throw new Error("Consecutivo FE inválido");
  formatInvoiceNumber({
    branch: input.consecutivo.slice(0, 3),
    terminal: input.consecutivo.slice(3, 8),
    sequence: BigInt(input.consecutivo.slice(10)),
  });
  if (
    typeof input.issuerIdentification !== "string" ||
    !/^[1-9][0-9]{8,11}$/.test(input.issuerIdentification)
  )
    throw new Error("Identificación del emisor inválida");
  if (
    !(input.issuedAt instanceof Date) ||
    !Number.isFinite(input.issuedAt.getTime())
  )
    throw new Error("Fecha de emisión inválida");
  // Costa Rica uses UTC−06:00. This API supports the unambiguous 2000–2099 window.
  const localDate = new Date(input.issuedAt.getTime() - 6 * 60 * 60 * 1000);
  const year = localDate.getUTCFullYear();
  if (year < 2000 || year > 2099)
    throw new Error("Año de emisión no soportado");
  if (
    typeof input.securityCode !== "string" ||
    !/^[0-9]{8}$/.test(input.securityCode)
  )
    throw new Error("Código de seguridad inválido");
  const date = [localDate.getUTCDate(), localDate.getUTCMonth() + 1, year % 100]
    .map((part) => part.toString().padStart(2, "0"))
    .join("");
  return `506${date}${input.issuerIdentification.padStart(12, "0")}${input.consecutivo}1${input.securityCode}`;
}
