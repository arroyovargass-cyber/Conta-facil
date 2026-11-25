import { ReferenceProfile } from "./ReferenceProfile";
import React, { useEffect, useRef, useState } from "react";
import { apiRequest, post } from "../../api/client";
import { useAlive, type Row } from "../billing/common";
import { CredentialForm } from "./CredentialForm";
import { ConnectionStatus } from "./ConnectionStatus";
import { CredentialEnrollment } from "./CredentialEnrollment";
import { EnvironmentSelector, environmentLabel } from "./EnvironmentSelector";
import type { HaciendaEnvironment } from "../../../../../packages/domain/src/hacienda-environment";
import "../billing/billing.css";
import "../workflow/workflow.css";
type Props = {
  tenantId: string;
  permissions: string[];
  company?: Row;
};

export function HaciendaWorkspace(props: Props) {
  return <HaciendaEnvironments key={props.tenantId} {...props} />;
}

function HaciendaEnvironments(props: Props) {
  const [environment, setEnvironment] = useState<HaciendaEnvironment>("test");
  return (
    <div className="billing-workspace">
      <EnvironmentSelector
        label="Ambiente de Hacienda"
        environment={environment}
        onChange={setEnvironment}
      />
      <p>
        Las credenciales, la conexión y la revisión se conservan por separado en
        cada ambiente.
      </p>
      <HaciendaConfiguration
        key={environment}
        {...props}
        environment={environment}
      />
    </div>
  );
}

function HaciendaConfiguration({
  tenantId,
  permissions,
  company,
  environment,
}: Props & { environment: HaciendaEnvironment }) {
  const base = "/companies/" + tenantId,
    alive = useAlive(),
    [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    sequence = useRef(0),
    pending = useRef(false);
  useEffect(() => {
    const controller = new AbortController(),
      token = ++sequence.current;
    void apiRequest(base + "/hacienda?environment=" + environment, {
      signal: controller.signal,
    })
      .then((r) => {
        if (alive.current && token === sequence.current) setData(r);
      })
      .catch((e) => {
        if (
          alive.current &&
          e.name !== "AbortError" &&
          token === sequence.current
        )
          setError(e.message);
      });
    return () => {
      sequence.current++;
      controller.abort();
    };
  }, [base, environment]);
  async function action(path: string, extra: Row = {}) {
    if (!data || pending.current) return;
    const token = ++sequence.current;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await post(base + "/hacienda/" + path, {
        environment,
        expected_revision: data.configuration.revision,
        ...extra,
      });
      if (alive.current && token === sequence.current) {
        setData(r);
        setConfirm(false);
        setNotice(
          path.includes("deactivate")
            ? "Desactivación local completada; no revoca la llave en Hacienda."
            : path.includes("enroll")
              ? "Revisión del administrador registrada para este ambiente y versión."
              : "Prueba de acceso finalizada. Revisa el resultado y el cierre de sesión.",
        );
      }
    } catch (e: any) {
      if (alive.current && token === sequence.current) setError(e.message);
    } finally {
      if (alive.current && token === sequence.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  if (error && !data)
    return (
      <div role="alert" className="alert">
        {error}
      </div>
    );
  if (!data) return <p>Cargando configuración de Hacienda…</p>;
  const c = data.configuration,
    cap = data.capabilities,
    canManage = permissions.includes("hacienda.credentials.manage"),
    canEnroll = Boolean(
      cap.can_enroll ??
      (c.active_version !== null &&
        c.api_status === "success" &&
        Date.parse(c.certificate_metadata?.valid_until) > Date.now()),
    );
  return (
    <div className="billing-workspace">
      {error && (
        <div role="alert" className="alert">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="notice">
          {notice}
        </div>
      )}
      <section className="billing-editor">
        <h3>Llave criptográfica · {environmentLabel(environment)}</h3>
        {c.active_version === null ? (
          <p>Sin credenciales activas</p>
        ) : (
          <>
            <p>Versión activa: {c.active_version}</p>
            <p>Validación técnica local: correcta</p>
            <p>
              {c.enrollment?.status === "operator_verified"
                ? "Autorización de la llave revisada por el administrador"
                : "Identidad tributaria pendiente"}
            </p>
            <p className="credential-fingerprint">
              Huella SHA-256: {c.certificate_metadata?.fingerprint}
            </p>
            <p>
              Vigencia hasta:{" "}
              {new Date(c.certificate_metadata?.valid_until).toLocaleDateString(
                "es-CR",
              )}
            </p>
            {canManage && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setConfirm(true)}
              >
                Desactivar credenciales
              </button>
            )}
            {confirm && (
              <div className="workflow-confirm">
                <p>
                  Esto impide usar esta versión en Conta Ágil y conserva el
                  historial. La revocación oficial debe gestionarse en Hacienda.
                </p>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void action("credentials/deactivate")}
                >
                  Confirmar desactivación local
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setConfirm(false)}
                >
                  Cancelar
                </button>
              </div>
            )}
          </>
        )}
      </section>
      {canManage && (
        <>
          {!cap.can_store_credentials && (
            <p className="notice">
              El registro está pendiente: configura la bóveda y valida un
              inspector apto para este entorno. No cargues llaves reales en el
              entorno de desarrollo.
            </p>
          )}
          {cap.synthetic_only && (
            <p className="form-hint">
              Inspector de desarrollo: únicamente material sintético en pruebas
              automatizadas.
            </p>
          )}
          <CredentialForm
            key={c.revision}
            base={base}
            environment={environment}
            revision={c.revision}
            enabled={cap.can_store_credentials && !busy}
            onBusyChange={(value) => {
              pending.current = value;
              setBusy(value);
            }}
            onSaved={(r) => {
              if (!alive.current) return;
              sequence.current++;
              pending.current = false;
              setBusy(false);
              setData(r);
              setNotice(
                "Credenciales guardadas. La identidad tributaria sigue pendiente.",
              );
              setError("");
            }}
          />
        </>
      )}
      <ReferenceProfile
        base={base}
        company={company}
        permissions={permissions}
      />
      <ConnectionStatus
        configuration={c}
        environment={environment}
        enabled={
          cap.can_test_connection &&
          permissions.includes("hacienda.connection.test")
        }
        busy={busy}
        onTest={() => void action("connection-test")}
      />
      <CredentialEnrollment
        key={c.active_version ?? "empty"}
        configuration={c}
        environment={environment}
        company={company}
        canManage={canManage}
        canEnroll={canEnroll}
        busy={busy}
        onEnroll={(evidence) =>
          void action("credentials/enroll", {
            confirmed: true,
            evidence_reference: evidence,
          })
        }
      />
    </div>
  );
}
