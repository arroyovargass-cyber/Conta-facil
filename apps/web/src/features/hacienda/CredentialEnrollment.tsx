import { useState } from "react";
import type { HaciendaEnvironment } from "../../../../../packages/domain/src/hacienda-environment";
import type { Row } from "../billing/common";
import { environmentLabel } from "./EnvironmentSelector";

const identificationTypes: Record<string, string> = {
  "01": "Cédula física",
  "02": "Cédula jurídica",
  "03": "DIMEX",
  "04": "NITE",
};

export function CredentialEnrollment({
  configuration,
  environment,
  company,
  canManage,
  canEnroll,
  busy,
  onEnroll,
}: {
  configuration: Row;
  environment: HaciendaEnvironment;
  company?: Row;
  canManage: boolean;
  canEnroll: boolean;
  busy: boolean;
  onEnroll: (evidence: string) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [evidence, setEvidence] = useState("");
  const enrollment = configuration.enrollment;
  const reviewed = enrollment?.status === "operator_verified";
  return (
    <section className="billing-editor" aria-label="Revisión del administrador">
      <h3>Revisión del administrador</h3>
      <p>
        Esta revisión registra la autorización del titular; no es una validación
        de identidad por Hacienda. Solo el administrador autorizado con
        autenticación multifactor puede registrarla.
      </p>
      {reviewed ? (
        <>
          <p>Revisión registrada</p>
          <dl>
            <dt>Ambiente</dt>
            <dd>{environmentLabel(environment)}</dd>
            <dt>Versión de credenciales</dt>
            <dd>{enrollment.version}</dd>
            <dt>Tipo de identificación</dt>
            <dd>
              {identificationTypes[enrollment.issuer_identification_type] ??
                enrollment.issuer_identification_type}
            </dd>
            <dt>Identificación del emisor</dt>
            <dd>{enrollment.issuer_identification}</dd>
            <dt>Huella SHA-256</dt>
            <dd className="credential-fingerprint">
              {enrollment.certificate_fingerprint}
            </dd>
            <dt>Registrada por</dt>
            <dd className="credential-fingerprint">
              {enrollment.confirmed_by}
            </dd>
            <dt>Fecha de revisión</dt>
            <dd>{new Date(enrollment.confirmed_at).toLocaleString("es-CR")}</dd>
            <dt>Referencia de la revisión</dt>
            <dd style={{ overflowWrap: "anywhere" }}>
              {enrollment.evidence_reference}
            </dd>
          </dl>
          <p>
            Cambiar la llave o la identificación del emisor requiere una nueva
            revisión antes de emitir.
          </p>
        </>
      ) : (
        <>
          <p>Revisión pendiente para {environmentLabel(environment)}.</p>
          {canManage && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (confirmed && evidence.trim() && canEnroll && !busy)
                  onEnroll(evidence.trim());
              }}
            >
              <p>
                Empresa: {company?.legal_name || "Sin razón social"}.
                Identificación: {company?.identification || "Pendiente"}.
                Ambiente: {environmentLabel(environment)}. Versión:{" "}
                {configuration.active_version ?? "Sin credenciales activas"}.
              </p>
              <p className="credential-fingerprint">
                Huella SHA-256:{" "}
                {configuration.certificate_metadata?.fingerprint || "Pendiente"}
              </p>
              {!canEnroll && (
                <p>
                  Guarda una llave vigente y comprueba el acceso a Hacienda en
                  este ambiente antes de registrar la revisión.
                </p>
              )}
              <p>
                Si cambió la identificación del emisor, registra una nueva
                versión de credenciales antes de revisar su autorización.
              </p>
              <fieldset disabled={busy || !canEnroll}>
                <label className="field">
                  Referencia de la revisión
                  <input
                    value={evidence}
                    onChange={(event) => {
                      setEvidence(event.target.value);
                      setConfirmed(false);
                    }}
                    required
                    maxLength={500}
                  />
                </label>
                <p>
                  Indica el expediente o comprobante de autorización. No
                  incluyas contraseñas ni el PIN de la llave.
                </p>
                <label className="billing-check">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  Confirmo que la llave de esta versión está autorizada para la
                  identificación del emisor y el ambiente indicados
                </label>
                <button
                  className="button primary"
                  disabled={
                    busy || !canEnroll || !confirmed || !evidence.trim()
                  }
                >
                  Registrar revisión del administrador
                </button>
              </fieldset>
            </form>
          )}
        </>
      )}
    </section>
  );
}
