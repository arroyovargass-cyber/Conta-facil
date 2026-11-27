import type { CompanyInput } from "../../../../../packages/domain/src/company";

/** Saved rows retain their positions: only unsaved rows can be removed. */
export function companyFormSubmission(
  value: CompanyInput,
  persistedActivities: number,
): CompanyInput {
  return {
    ...value,
    activities: value.activities.filter(
      (activity, index) =>
        index < persistedActivities ||
        [activity.code, activity.name, activity.source_url].some((text) =>
          Boolean(text?.trim()),
        ),
    ),
  };
}

export function companyValidationTab(path: readonly PropertyKey[]): number {
  if (
    path[0] === "address" ||
    (path[0] === "configuration" && path[1] === "location")
  )
    return 1;
  if (
    path[0] === "activities" ||
    (path[0] === "configuration" && path[1] === "tax")
  )
    return 2;
  if (path[0] === "configuration" && path[1] === "billing") return 3;
  if (path[0] === "configuration" && path[1] === "accounting") return 4;
  return 0;
}

export function companyValidationMessage(issue: {
  path: readonly PropertyKey[];
  code: string;
  message: string;
}): string {
  if (issue.code === "custom") return issue.message;
  const path = issue.path.map(String);
  if (path[0] === "activities") {
    const number = Number(path[1]) + 1;
    if (path[2] === "code")
      return `Indica el código de la actividad ${number}.`;
    if (path[2] === "name")
      return `Indica la descripción de la actividad ${number}.`;
    if (path[2] === "source_url")
      return `Revisa la URL HTTPS de la actividad ${number}.`;
    return "Revisa los datos de las actividades económicas.";
  }
  if (path.at(-1)?.includes("email"))
    return "Indica un correo electrónico válido o deja el campo vacío.";
  if (path.includes("branch_code"))
    return "La sucursal debe tener tres dígitos.";
  if (path.includes("terminal_code"))
    return "La terminal debe tener cinco dígitos.";
  if (path.includes("location"))
    return "Revisa provincia, cantón, distrito y barrio.";
  if (issue.code === "too_big")
    return "Uno de los campos supera el tamaño permitido.";
  if (issue.code === "unrecognized_keys")
    return "La configuración contiene campos no admitidos.";
  if (issue.code === "invalid_value") return "Selecciona una opción válida.";
  return "Completa o corrige el campo indicado antes de guardar.";
}

export function companyApiErrorTab(message: string): number | null {
  if (message.startsWith("Domicilio fiscal:")) return 1;
  if (/actividad/i.test(message)) return 2;
  if (/logotipo/i.test(message)) return 0;
  if (/sucursal|terminal/i.test(message)) return 3;
  return null;
}
