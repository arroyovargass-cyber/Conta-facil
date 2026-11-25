import { InvoiceActions } from "./InvoiceActions";
import { NumberingConfirmation } from "./NumberingConfirmation";
import React, { useRef, useState } from "react";
import { apiRequest, post } from "../../api/client";
import { Drafts } from "./Drafts";
import { Field, useAlive, useListing, type Row } from "./common";

const labels: Record<string, string> = {
  prepared: "Preparada",
  issued: "Emitida",
  pending: "Pendiente",
  signed: "Firmada",
  not_sent: "Sin enviar",
  queued: "En cola",
  sent: "Enviada",
  uncertain: "Resultado incierto",
  processing: "En proceso",
  technical_error: "Error técnico",
  accepted: "Aceptado por Hacienda",
  rejected: "Rechazado por Hacienda",
  not_queued: "Sin programar",
  provider_accepted: "Aceptado por proveedor de correo",
  error: "Error",
};
const monetaryLabels: Record<string, string> = {
  beforeDiscount: "Importe antes de descuentos",
  discounts: "Descuentos",
  subtotal: "Subtotal",
  tax: "Impuestos",
  exonerations: "Exoneraciones",
  total: "Total",
};
function money(snapshot?: Row) {
  return typeof snapshot?.totals?.total === "string"
    ? `${snapshot.currency} ${snapshot.totals.total}`
    : "Total pendiente de cálculo";
}
function netTax(tax: string, exoneration: string) {
  const scaled = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * 100000n + BigInt(fraction.padEnd(5, "0"));
  };
  if (
    !/^\d+(?:\.\d{1,5})?$/.test(tax) ||
    !/^\d+(?:\.\d{1,5})?$/.test(exoneration)
  )
    return "Pendiente";
  const result = scaled(tax) - scaled(exoneration);
  const digits = result.toString().padStart(6, "0");
  return digits.slice(0, -5) + "." + digits.slice(-5);
}
const paymentLabels: Record<string, string> = {
  "01": "Efectivo",
  "02": "Tarjeta",
  "03": "Cheque",
  "04": "Transferencia - depósito bancario",
  "05": "Recaudado por terceros",
  "06": "SINPE MOVIL",
  "07": "Plataforma Digital",
};
const emptyOptions = () => ({
  sale_condition: "01",
  credit_days: "",
  exchange_rate: "",
  branch_code: "",
  terminal_code: "",
  issuer_activity: "",
  payment_methods: [] as { code: string; amount: string }[],
});
export function Invoices({ base, options }: { base: string; options: Row }) {
  const alive = useAlive(),
    pending = useRef(false),
    generation = useRef(0);
  const operation = useRef<{ fingerprint: string; id: string } | null>(null);
  const list = useListing(base + "/invoices", "status");
  const drafts = useListing(base + "/invoice-drafts", "archived", "false");
  const [embeddedDrafts, setEmbeddedDrafts] = useState(false),
    [draftId, setDraftId] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState(emptyOptions),
    [item, setItem] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false);
  function change(key: string, value: any) {
    setForm((old) => ({ ...old, [key]: value }));
  }
  function fresh() {
    setEditing(null);
    setDraftId("");
    setForm(emptyOptions());
    setConfirm(false);
    setError("");
    operation.current = null;
  }
  function edit() {
    if (!item || item.document_status !== "prepared") return;
    setEditing(item);
    setDraftId(item.draft_id);
    setForm({
      ...emptyOptions(),
      ...item.options,
      credit_days:
        item.options.credit_days == null
          ? ""
          : String(item.options.credit_days),
      payment_methods: item.options.payment_methods ?? [],
    });
    setConfirm(false);
    setError("");
  }
  async function open(id: string) {
    const token = ++generation.current;
    fresh();
    setItem(null);
    setConfirm(false);
    setError("");
    try {
      const data = await apiRequest(base + "/invoices/" + id);
      if (alive.current && token === generation.current) setItem(data.item);
    } catch (e: any) {
      if (alive.current && token === generation.current) setError(e.message);
    }
  }
  async function refreshStatus() {
    if (!item || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const token = generation.current;
    try {
      const data = await apiRequest(base + "/invoices/" + item.id);
      if (alive.current && token === generation.current) {
        setItem(data.item);
        setConfirm(false);
        list.refresh();
      }
    } catch (e: any) {
      if (alive.current && token === generation.current) setError(e.message);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function prepare(e: React.FormEvent) {
    e.preventDefault();
    if (pending.current || !draftId) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setConfirm(false);
    const token = ++generation.current;
    try {
      const draft = (await apiRequest(base + "/invoice-drafts/" + draftId))
        .item;
      if (!alive.current || token !== generation.current) return;
      if (draft.archived_at || draft.document_type !== "FE")
        throw new Error("Selecciona un borrador nacional FE sin archivar.");
      const payload = {
        draft_id: draftId,
        expected_version: draft.version,
        options: {
          ...form,
          credit_days:
            form.sale_condition === "02" && form.credit_days !== ""
              ? Number(form.credit_days)
              : null,
        },
      };
      const fingerprint = JSON.stringify(payload);
      if (operation.current?.fingerprint !== fingerprint)
        operation.current = { fingerprint, id: crypto.randomUUID() };
      const data = editing
        ? await post(
            base + "/invoices/" + editing.id,
            {
              version: editing.version,
              expected_version: draft.version,
              options: payload.options,
            },
            "PATCH",
          )
        : await post(base + "/invoices", {
            ...payload,
            operation_id: operation.current!.id,
          });
      if (alive.current && token === generation.current) {
        setItem(data.item);
        if (editing) setEditing(data.item);
        list.refresh();
      }
    } catch (e: any) {
      if (alive.current && token === generation.current) setError(e.message);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function issue() {
    if (
      pending.current ||
      !item ||
      !confirm ||
      !item.readiness?.canEmit ||
      !department?.can_emit
    )
      return;
    pending.current = true;
    setBusy(true);
    setError("");
    const selected = item,
      token = generation.current;
    const fingerprint = "issue:" + item.id + ":" + item.version;
    if (operation.current?.fingerprint !== fingerprint)
      operation.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const data = await post(base + "/invoices/" + selected.id + "/issue", {
        version: selected.version,
        operation_id: operation.current!.id,
      });
      if (alive.current && token === generation.current) {
        setItem(data.item);
        setConfirm(false);
        list.refresh();
      }
    } catch (e: any) {
      if (alive.current && token === generation.current) setError(e.message);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const snapshot = item?.snapshot;
  const department = options.departments?.find(
    (d: Row) => d.id === item?.department_id,
  );
  const canManage =
    options.canManage || options.permissions?.includes("invoices.manage");
  const canEdit = department?.can_manage === true;
  const canEmit =
    department?.can_emit === true && item?.readiness?.canEmit === true;
  return (
    <section className="panel">
      <NumberingConfirmation
        base={base}
        onConfirmed={() => {
          list.refresh();
          if (item) void open(item.id);
        }}
      />
      <div className="table-toolbar">
        <div>
          <h3>Facturación nacional · STAG</h3>
          <p>Guardar una preparación no firma, transmite ni envía correo.</p>
        </div>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => setEmbeddedDrafts((v) => !v)}
        >
          {embeddedDrafts ? "Volver a Facturación" : "Mis borradores"}
        </button>
      </div>
      {embeddedDrafts ? (
        <Drafts key={base} base={base} options={options} />
      ) : (
        <>
          {canManage && (
            <form onSubmit={prepare}>
              <h3>
                {editing ? "Editar preparación" : "Preparar desde borrador"}
              </h3>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={fresh}
              >
                Nueva preparación
              </button>
              {editing && (
                <p>Se actualizará la copia desde el borrador actual</p>
              )}
              <label className="field">
                Borrador nacional FE
                <select
                  value={draftId}
                  disabled={busy || Boolean(editing)}
                  onChange={(e) => {
                    setDraftId(e.target.value);
                    setForm(emptyOptions());
                  }}
                >
                  <option value="">Selecciona…</option>
                  {editing && !drafts.rows.some((d) => d.id === draftId) && (
                    <option value={draftId}>
                      Borrador de esta preparación
                    </option>
                  )}
                  {drafts.rows
                    .filter((d) => d.document_type === "FE" && !d.archived_at)
                    .map((d) => (
                      <option value={d.id} key={d.id}>
                        {d.customer_snapshot?.name || "Receptor sin nombre"} ·{" "}
                        {d.currency} · {d.id.slice(0, 8)}
                      </option>
                    ))}
                </select>
              </label>
              {drafts.error && <p role="alert">{drafts.error}</p>}
              {drafts.next !== null && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={drafts.loadMore}
                  disabled={drafts.loading}
                >
                  Más borradores
                </button>
              )}
              <fieldset disabled={busy}>
                <legend>Condiciones de la factura</legend>
                <div className="form-grid">
                  <label className="field">
                    Condición de venta
                    <select
                      value={form.sale_condition}
                      onChange={(e) => change("sale_condition", e.target.value)}
                    >
                      <option value="01">Contado</option>
                      <option value="02">Crédito</option>
                    </select>
                  </label>
                  {form.sale_condition === "02" && (
                    <Field
                      label="Plazo de crédito (días)"
                      value={form.credit_days}
                      onChange={(v) => change("credit_days", v)}
                      type="number"
                    />
                  )}
                  <Field
                    label="Tipo de cambio (explícito para USD)"
                    value={form.exchange_rate}
                    onChange={(v) => change("exchange_rate", v)}
                  />
                  <Field
                    label="Sucursal (3 dígitos)"
                    value={form.branch_code}
                    maxLength={3}
                    onChange={(v) => change("branch_code", v)}
                  />
                  <Field
                    label="Terminal (5 dígitos)"
                    value={form.terminal_code}
                    maxLength={5}
                    onChange={(v) => change("terminal_code", v)}
                  />
                  <Field
                    label="Actividad económica del emisor (6 dígitos)"
                    value={form.issuer_activity}
                    maxLength={6}
                    onChange={(v) => change("issuer_activity", v)}
                  />
                </div>
                <h4>Medios de pago</h4>
                <p>
                  Registra el desglose de importes. Para crédito puede quedar
                  vacío.
                </p>
                {form.payment_methods.map((payment, index) => (
                  <div className="form-grid" key={index}>
                    <label className="field">
                      Medio de pago
                      <select
                        value={payment.code}
                        onChange={(e) =>
                          change(
                            "payment_methods",
                            form.payment_methods.map((p, i) =>
                              i === index ? { ...p, code: e.target.value } : p,
                            ),
                          )
                        }
                      >
                        {["01", "02", "03", "04", "05", "06", "07"].map(
                          (code) => (
                            <option key={code} value={code}>
                              {code} — {paymentLabels[code]}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <Field
                      label="Importe"
                      value={payment.amount}
                      onChange={(v) =>
                        change(
                          "payment_methods",
                          form.payment_methods.map((p, i) =>
                            i === index ? { ...p, amount: v } : p,
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() =>
                        change(
                          "payment_methods",
                          form.payment_methods.filter((_, i) => i !== index),
                        )
                      }
                    >
                      Quitar medio
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="button secondary"
                  disabled={form.payment_methods.length >= 4}
                  onClick={() =>
                    change("payment_methods", [
                      ...form.payment_methods,
                      { code: "01", amount: "" },
                    ])
                  }
                >
                  Agregar medio de pago
                </button>
              </fieldset>
              <button className="button primary" disabled={busy || !draftId}>
                {busy
                  ? "Procesando…"
                  : editing
                    ? "Actualizar preparación"
                    : "Guardar preparación"}
              </button>
            </form>
          )}
          <h3>Facturas preparadas y emitidas</h3>
          {list.loading && <p>Cargando facturas…</p>}
          {list.error && <p role="alert">{list.error}</p>}
          {!list.loading && !list.rows.length && (
            <p>Aún no hay facturas preparadas.</p>
          )}
          <div className="activity-list">
            {list.rows.map((row) => (
              <button
                className="button secondary"
                key={row.id}
                disabled={busy}
                onClick={() => void open(row.id)}
              >
                {row.snapshot?.receiver?.name || "Sin receptor"} ·{" "}
                {money(row.snapshot)} ·{" "}
                {labels[row.document_status] || row.document_status}
              </button>
            ))}
          </div>
          {list.next !== null && (
            <button
              className="button secondary"
              disabled={list.loading}
              onClick={list.loadMore}
            >
              Cargar más facturas
            </button>
          )}
          {item && snapshot && (
            <section aria-label="Detalle de factura">
              <h3>Detalle de factura</h3>
              <p>Ambiente: STAG · Pruebas</p>
              <dl className="fiscal-preview-totals">
                <dt>Emisor</dt>
                <dd>{snapshot.issuer?.legal_name || "Sin nombre"}</dd>
                <dt>Receptor</dt>
                <dd>{snapshot.receiver?.name || "Sin nombre"}</dd>
                <dt>Departamento</dt>
                <dd>{department?.name || item.department_id}</dd>
                <dt>Correo destinatario</dt>
                <dd>{snapshot.receiver?.email || "Sin correo"}</dd>
                <dt>Total</dt>
                <dd>{money(snapshot)}</dd>
              </dl>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void refreshStatus()}
              >
                Actualizar estado
              </button>
              <h4>Líneas y totales del servidor</h4>
              <p>Los precios unitarios no incluyen impuestos.</p>
              {snapshot.lines?.map((line: Row, i: number) => (
                <p key={i}>
                  {line.quantity} × {line.description} · {line.unit_price}
                </p>
              ))}
              <dl className="fiscal-preview-totals">
                {snapshot.totals?.status === "blocked" ? (
                  <>
                    <dt>Total pendiente</dt>
                    <dd>
                      Completa los requisitos fiscales para calcular los
                      totales.
                    </dd>
                  </>
                ) : (
                  Object.entries(monetaryLabels)
                    .filter(
                      ([key]) => typeof snapshot.totals?.[key] === "string",
                    )
                    .map(([key, label]) => (
                      <React.Fragment key={key}>
                        <dt>{label}</dt>
                        <dd>
                          {snapshot.currency} {snapshot.totals[key]}
                        </dd>
                      </React.Fragment>
                    ))
                )}
              </dl>
              {snapshot.totals?.groups?.length > 0 && (
                <section aria-label="Desglose de impuestos">
                  <h4>Desglose de impuestos</h4>
                  {snapshot.totals.groups.map((group: Row, index: number) => (
                    <div key={index}>
                      <p>
                        Tipo de impuesto{" "}
                        {group.tax_code === "01" ? "01 · IVA" : group.tax_code}{" "}
                        · Tarifa {group.tariff_code} · {group.rate}%
                      </p>
                      <dl className="fiscal-preview-totals">
                        <dt>Base imponible</dt>
                        <dd>
                          {snapshot.currency} {group.base}
                        </dd>
                        <dt>Impuesto</dt>
                        <dd>
                          {snapshot.currency} {group.tax}
                        </dd>
                        <dt>Exoneración</dt>
                        <dd>
                          {snapshot.currency} {group.exoneration}
                        </dd>
                        <dt>Impuesto neto</dt>
                        <dd>
                          {snapshot.currency}{" "}
                          {netTax(group.tax, group.exoneration)}
                        </dd>
                      </dl>
                    </div>
                  ))}
                </section>
              )}
              {department?.can_download === true && (
                <div>
                  {[
                    [
                      "signed_xml",
                      "Descargar XML",
                      item.signature_status === "signed",
                    ],
                    [
                      "hacienda_response",
                      "Respuesta Hacienda",
                      ["accepted", "rejected"].includes(item.hacienda_status),
                    ],
                    [
                      "pdf",
                      "Descargar PDF",
                      item.hacienda_status === "accepted",
                    ],
                  ]
                    .filter(
                      ([kind, , available]) =>
                        available && item.artifacts?.includes(kind),
                    )
                    .map(([kind, label]) => (
                      <a
                        className="button secondary"
                        key={String(kind)}
                        href={
                          "/api" +
                          base +
                          "/invoices/" +
                          item.id +
                          "/artifacts/" +
                          kind
                        }
                      >
                        {label}
                      </a>
                    ))}
                </div>
              )}
              {snapshot.totals?.status === "blocked" && (
                <ul>
                  {snapshot.totals.issues?.map((issue: Row, i: number) => (
                    <li key={i}>{issue.message}</li>
                  ))}
                </ul>
              )}
              <dl className="fiscal-preview-totals">
                {[
                  ["Documento", item.document_status],
                  ["Firma", item.signature_status],
                  ["Transmisión", item.transmission_status],
                  ["Hacienda", item.hacienda_status],
                  ["Correo", item.email_status],
                ].map(([key, value]) => (
                  <React.Fragment key={key}>
                    <dt>{key}</dt>
                    <dd>{labels[value] || value}</dd>
                  </React.Fragment>
                ))}
              </dl>
              {item.collections_review && (
                <p>
                  Revisión en Cuentas por cobrar:{" "}
                  {(
                    {
                      pending: "Pendiente",
                      in_review: "En revisión",
                      resolved: "Resuelta",
                      archived: "Archivada",
                    } as Record<string, string>
                  )[item.collections_review.state] ?? "Registrada"}
                  . Esta bandeja no registra saldos ni convierte la venta al
                  contado en deuda.
                </p>
              )}
              <InvoiceActions
                base={base}
                item={item}
                onUpdated={() => void refreshStatus()}
              />
              <h4>Requisitos para emitir</h4>
              {item.readiness?.issues?.length ? (
                <ul>
                  {item.readiness.issues.map((issue: Row, i: number) => (
                    <li key={i}>{issue.message}</li>
                  ))}
                </ul>
              ) : (
                <p>Sin observaciones de preparación.</p>
              )}
              {item.document_status === "prepared" && (
                <>
                  {canEdit && (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={edit}
                    >
                      Editar preparación
                    </button>
                  )}
                  <button
                    className="button secondary"
                    disabled={busy || !canEmit}
                    onClick={() => setConfirm(true)}
                  >
                    Revisar emisión en STAG
                  </button>
                  {confirm && (
                    <div
                      role="dialog"
                      aria-modal="true"
                      aria-label="Confirmar emisión en STAG"
                    >
                      <h4>Confirmar emisión en STAG</h4>
                      <p>
                        Emisor: {snapshot.issuer?.legal_name}. Receptor:{" "}
                        {snapshot.receiver?.name}. Total: {money(snapshot)}.
                        Departamento: {department?.name || item.department_id}.
                        Correo: {snapshot.receiver?.email || "Sin correo"}.
                      </p>
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => setConfirm(false)}
                      >
                        Cancelar
                      </button>
                      <button
                        className="button primary"
                        disabled={busy || !canEmit}
                        onClick={() => void issue()}
                      >
                        Confirmar emisión en STAG
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
