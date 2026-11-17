import { ReferenceProfile } from "./ReferenceProfile";
import React, { useEffect, useRef, useState } from "react";
import { apiRequest, post } from "../../api/client";
import { useAlive, type Row } from "../billing/common";
import { CredentialForm } from "./CredentialForm";
import { ConnectionStatus } from "./ConnectionStatus";
import "../billing/billing.css";
import "../workflow/workflow.css";
export function HaciendaWorkspace({
  tenantId,
  permissions,
  company,
}: {
  tenantId: string;
  permissions: string[];
  company?: Row;
}) {
  const base = "/companies/" + tenantId,
    alive = useAlive(),
    [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    sequence = useRef(0);
  useEffect(() => {
    const controller = new AbortController(),
      token = ++sequence.current;
    void apiRequest(base + "/hacienda", { signal: controller.signal })
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
  }, [base]);
  async function action(path: string) {
    if (!data || busy) return;
    const token = ++sequence.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await post(base + "/hacienda/" + path, {
        environment: "test",
        expected_revision: data.configuration.revision,
      });
      if (alive.current && token === sequence.current) {
        setData(r);
        setConfirm(false);
        setNotice(
          path.includes("deactivate")
            ? "Desactivación local completada; no revoca la llave en Hacienda."
            : "Prueba de acceso finalizada. Revisa el resultado y el cierre de sesión.",
        );
      }
    } catch (e: any) {
      if (alive.current && token === sequence.current) setError(e.message);
    } finally {
      if (alive.current && token === sequence.current) setBusy(false);
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
    canManage = permissions.includes("hacienda.credentials.manage");
  return (
    <div className="billing-workspace">
      <div className="billing-toolbar">
        <button type="button" className="button primary" aria-pressed="true">
          Pruebas
        </button>
        <button type="button" className="button secondary" disabled>
          Producción
        </button>
      </div>
      <p>
        Producción permanece inactiva. No se emiten comprobantes desde esta
        sección.
      </p>
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
        <h3>Llave criptográfica</h3>
        {c.active_version === null ? (
          <p>Sin credenciales activas</p>
        ) : (
          <>
            <p>Versión activa: {c.active_version}</p>
            <p>Validación técnica local: correcta</p>
            <p>Identidad tributaria pendiente</p>
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
                  Esto impide usar esta versión en Conta Fácil y conserva el
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
            key={tenantId + ":" + c.revision}
            base={base}
            revision={c.revision}
            enabled={cap.can_store_credentials && !busy}
            onSaved={(r) => {
              sequence.current++;
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
        enabled={
          cap.can_test_connection &&
          permissions.includes("hacienda.connection.test")
        }
        busy={busy}
        onTest={() => void action("connection-test")}
      />
    </div>
  );
}
