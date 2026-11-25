import { useEffect, useRef, useState } from "react";
import { apiRequest, post } from "../../api/client";
import type { Row } from "./common";

const labels = {
  retry_signature: "Reintentar firma",
  retry_transmission: "Reintentar envío",
  query: "Consultar en Hacienda",
  resend_email: "Reenviar al cliente",
};
type Action = keyof typeof labels;
type Props = { base: string; item: Row; onUpdated: () => void };

export function InvoiceActions(props: Props) {
  return (
    <Actions
      key={`${props.base}:${props.item.id}:${props.item.environment}`}
      {...props}
    />
  );
}
function Actions({ base, item, onUpdated }: Props) {
  const [actions, setActions] = useState<Action[]>([]);
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const generation = useRef(0);
  const operations = useRef(new Map<string, string>());
  const path = `${base}/invoices/${item.id}/actions`;
  useEffect(() => {
    const token = ++generation.current;
    setActions([]);
    setConfirm(null);
    setError("");
    void apiRequest(path)
      .then((data) => {
        if (alive.current && generation.current === token)
          setActions(
            Array.isArray(data.actions)
              ? data.actions.filter((a: string) => Object.hasOwn(labels, a))
              : [],
          );
      })
      .catch((e: Error) => {
        if (alive.current && generation.current === token) setError(e.message);
      });
    return () => {
      generation.current++;
    };
  }, [
    path,
    item.version,
    item.signature_status,
    item.transmission_status,
    item.hacienda_status,
    item.email_status,
  ]);

  async function queue(action: Action) {
    if (pending.current || !actions.includes(action)) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const token = generation.current;
    const key = `${item.id}:${item.version}:${action}`;
    if (!operations.current.has(key))
      operations.current.set(key, crypto.randomUUID());
    try {
      await post(path, { operation_id: operations.current.get(key), action });
      if (!alive.current || generation.current !== token) return;
      setConfirm(null);
      setNotice(
        "Solicitud guardada. Actualiza el estado para consultar el resultado.",
      );
      onUpdated();
    } catch (e: any) {
      if (alive.current && generation.current === token) setError(e.message);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const snapshot = item.snapshot;
  if (!actions.length && !error && !notice) return null;
  return (
    <section aria-label="Acciones de factura">
      {actions.map((action) => (
        <button
          type="button"
          className="button secondary"
          key={action}
          disabled={busy}
          onClick={() =>
            action === "query" ? void queue(action) : setConfirm(action)
          }
        >
          {labels[action]}
        </button>
      ))}
      {confirm && actions.includes(confirm) && (
        <section
          role="alertdialog"
          aria-label={`Confirmar: ${labels[confirm]}`}
        >
          <h4>
            {labels[confirm]} ·{" "}
            {item.environment === "production" ? "Producción" : "Pruebas"}
          </h4>
          <p>Emisor: {snapshot?.issuer?.legal_name || "Sin nombre"}</p>
          <p>Receptor: {snapshot?.receiver?.name || "Sin nombre"}</p>
          <p>
            Total: {snapshot?.currency} {snapshot?.totals?.total || "Pendiente"}
          </p>
          {confirm === "resend_email" && (
            <>
              <p>
                Correo destinatario: {snapshot?.receiver?.email || "Sin correo"}
              </p>
              <p>
                Esta acción crea un nuevo correo. La aceptación por el proveedor
                SMTP no garantiza la entrega al destinatario.
              </p>
            </>
          )}
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => setConfirm(null)}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={() => void queue(confirm)}
          >
            Confirmar: {labels[confirm]}
          </button>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
