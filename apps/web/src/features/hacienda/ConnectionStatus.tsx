import React from "react";
import type { Row } from "../billing/common";
const statuses: Record<string, string> = {
  not_tested: "Sin probar",
  success: "Autenticación comprobada",
  authentication_failed: "Credenciales rechazadas por el servicio",
  service_unavailable: "Servicio no disponible",
};
export function ConnectionStatus({
  configuration,
  enabled,
  busy,
  onTest,
}: {
  configuration: Row;
  enabled: boolean;
  busy: boolean;
  onTest: () => void;
}) {
  return (
    <section className="billing-editor">
      <h3>Acceso al servicio de Hacienda</h3>
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
            ? "La sesión de prueba se cerró."
            : "No se confirmó el cierre de la sesión de prueba."}
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
      <p>Firma fiscal: pendiente. Envío de comprobantes: no habilitado.</p>
    </section>
  );
}
