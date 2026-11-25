import React from "react";
import type { Row } from "../billing/common";
import type { HaciendaEnvironment } from "../../../../../packages/domain/src/hacienda-environment";
import { environmentLabel } from "./EnvironmentSelector";
const statuses: Record<string, string> = {
  not_tested: "Sin probar",
  success: "Autenticación comprobada",
  authentication_failed: "Credenciales rechazadas por el servicio",
  service_unavailable: "Servicio no disponible",
};
export function ConnectionStatus({
  configuration,
  environment,
  enabled,
  busy,
  onTest,
}: {
  configuration: Row;
  environment: HaciendaEnvironment;
  enabled: boolean;
  busy: boolean;
  onTest: () => void;
}) {
  return (
    <section className="billing-editor">
      <h3>Acceso al servicio de Hacienda · {environmentLabel(environment)}</h3>
      <p>
        Acceso API:{" "}
        <strong>{statuses[configuration.api_status] ?? "Sin probar"}</strong>
      </p>
      {configuration.api_checked_at && (
        <p>
          Última comprobación:{" "}
          {new Date(configuration.api_checked_at).toLocaleString("es-CR")}
        </p>
      )}
      {configuration.api_status === "success" && (
        <p>
          {configuration.session_closed
            ? "La sesión de comprobación se cerró."
            : "No se confirmó el cierre de la sesión de comprobación."}
        </p>
      )}
      <button
        type="button"
        className="button secondary"
        disabled={!enabled || busy}
        onClick={onTest}
      >
        Probar acceso a Hacienda
      </button>
      {!enabled && (
        <p className="form-hint">
          La prueba externa está pendiente de habilitación o no hay credenciales
          activas.
        </p>
      )}
      <p>
        Comprobar el acceso no emite comprobantes ni sustituye la revisión de la
        llave. Cada factura debe cumplir sus requisitos de emisión.
      </p>
    </section>
  );
}
