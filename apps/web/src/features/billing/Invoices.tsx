import { InvoiceActions } from "./InvoiceActions";
import { NumberingConfirmation } from "./NumberingConfirmation";
import { EmissionRequirements } from "./EmissionRequirements";
import React, { useRef, useState } from "react";
import { apiRequest, post } from "../../api/client";
import { Drafts } from "./Drafts";
import { useAlive, useListing, type Row } from "./common";
import {
  InvoiceSummary,
  provisionalDueDate,
  PAYMENT_METHODS,
} from "./BillingFields";
import { usePaged } from "../workflow/usePaged";
import {
  EnvironmentSelector,
  environmentLabel,
} from "../hacienda/EnvironmentSelector";
import type { HaciendaEnvironment } from "../../../../../packages/domain/src/hacienda-environment";

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
function money(snapshot?: Row) {
  return typeof snapshot?.totals?.total === "string"
    ? `${snapshot.currency} ${snapshot.totals.total}`
    : "Total pendiente de cálculo";
}
type Props = {
  base: string;
  options: Row;
  onConfigure?: (
    target: "company" | "hacienda" | "organization" | "tax",
  ) => void;
};

export function Invoices(props: Props) {
  return <InvoiceEnvironments key={props.base} {...props} />;
}

function InvoiceEnvironments(props: Props) {
  const [environment, setEnvironment] = useState<HaciendaEnvironment>("test");
  return (
    <section className="panel">
      <EnvironmentSelector
        label="Ambiente de facturación"
        environment={environment}
        onChange={setEnvironment}
      />
      <p>
        Cada factura conserva el ambiente elegido al prepararla. La lista y la
        numeración corresponden al ambiente seleccionado.
      </p>
      <InvoiceWorkspace
        key={environment}
        {...props}
        environment={environment}
      />
    </section>
  );
}

function InvoiceWorkspace({
  base,
  options,
  environment,
  onConfigure,
}: Props & { environment: HaciendaEnvironment }) {
  const alive = useAlive(),
    pending = useRef(false),
    generation = useRef(0);
  const numberingRef = useRef<HTMLDivElement>(null);
  const operation = useRef<{ fingerprint: string; id: string } | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const list = usePaged(base + "/invoices", {
    environment,
    include_summary: "true",
    ...filters,
  });
  const drafts = useListing(base + "/invoice-drafts", "archived", "false");
  const [embeddedDrafts, setEmbeddedDrafts] = useState(false),
    [draftId, setDraftId] = useState("");
  const [editing, setEditing] = useState<Row | null>(null),
    [duplicateFromInvoice, setDuplicateFromInvoice] = useState<Row | null>(
      null,
    ),
    [creating, setCreating] = useState(false),
    [editorKey, setEditorKey] = useState(0),
    [item, setItem] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false),
    [productionConfirmed, setProductionConfirmed] = useState(false);
  function fresh() {
    setEditing(null);
    setDuplicateFromInvoice(null);
    setCreating(false);
    setDraftId("");
    setConfirm(false);
    setProductionConfirmed(false);
    setError("");
    operation.current = null;
  }
  function edit() {
    if (
      !item ||
      item.document_status !== "prepared" ||
      item.transmission_status !== "not_sent"
    )
      return;
    setEditing(item);
    setDraftId(item.draft_id);
    setCreating(true);
    setEditorKey((value) => value + 1);
    setConfirm(false);
    setProductionConfirmed(false);
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
        setProductionConfirmed(false);
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
      (item.environment === "production" && !productionConfirmed) ||
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
        ...(selected.environment === "production"
          ? { production_confirmation: true }
          : {}),
      });
      if (alive.current && token === generation.current) {
        setItem(data.item);
        setConfirm(false);
        setProductionConfirmed(false);
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
  const documentEnvironment: HaciendaEnvironment =
    item?.environment === "production" ? "production" : "test";
  const issueLabel =
    documentEnvironment === "production" ? "producción" : "pruebas";
  const department = options.departments?.find(
    (d: Row) => d.id === item?.department_id,
  );
  const canCreate = options.departments?.some(
    (d: Row) => d.active && (d.can_create ?? d.can_manage),
  );
  const canPrepare = options.departments?.some(
    (d: Row) => d.active && (d.can_prepare ?? d.can_create ?? d.can_manage),
  );
  const canEdit =
    (department?.can_prepare ??
      department?.can_edit ??
      department?.can_manage) === true &&
    item?.transmission_status === "not_sent";
  const canEmit =
    department?.can_emit === true && item?.readiness?.canEmit === true;
  return (
    <div>
      <div ref={numberingRef}>
        <NumberingConfirmation
          base={base}
          environment={environment}
          documentType={item?.document_type === "TE" ? "TE" : "FE"}
          onConfirmed={() => {
            list.refresh();
            if (item) void open(item.id);
          }}
        />
      </div>
      <div className="table-toolbar">
        <div>
          <h3>Facturación nacional · {environmentLabel(environment)}</h3>
          <p>Guardar una preparación no firma, transmite ni envía correo.</p>
        </div>
        {canCreate && (
          <button
            className="button primary"
            disabled={busy}
            onClick={() => {
              fresh();
              setEmbeddedDrafts(false);
              setItem(null);
              setCreating(true);
              setEditorKey((v) => v + 1);
            }}
          >
            Nueva factura
          </button>
        )}
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => {
            fresh();
            setEmbeddedDrafts((v) => !v);
          }}
        >
          {embeddedDrafts ? "Volver a Facturación" : "Mis borradores"}
        </button>
      </div>
      {embeddedDrafts ? (
        <Drafts key={base} base={base} options={options} />
      ) : (
        <>
          {creating ? (
            <Drafts
              key={editorKey}
              base={base}
              options={options}
              mode="new"
              environment={environment}
              initialDraftId={draftId || undefined}
              duplicateFromInvoice={duplicateFromInvoice}
              preparedInvoice={editing}
              onPrepared={(prepared) => {
                fresh();
                setItem(prepared);
                list.refresh();
                drafts.refresh();
              }}
              onSaved={() => drafts.refresh()}
              onClose={fresh}
              onBusyChange={setBusy}
            />
          ) : (
            canPrepare && (
              <details className="billing-disclosure">
                <summary>Preparar desde borrador</summary>
                <label className="field">
                  Borrador nacional FE o TE
                  <select
                    value=""
                    disabled={busy}
                    onChange={(event) => {
                      if (!event.target.value) return;
                      fresh();
                      setDraftId(event.target.value);
                      setCreating(true);
                      setEditorKey((v) => v + 1);
                      setItem(null);
                    }}
                  >
                    <option value="">Selecciona un borrador guardado…</option>
                    {drafts.rows
                      .filter(
                        (d) =>
                          ["FE", "TE"].includes(d.document_type) &&
                          !d.archived_at,
                      )
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.customer_snapshot?.name ||
                            (d.receiver_mode === "consumer_final"
                              ? "Consumidor final"
                              : "Receptor sin nombre")}{" "}
                          · {d.currency} · {d.id.slice(0, 8)}
                        </option>
                      ))}
                  </select>
                </label>
                {drafts.error && <p role="alert">{drafts.error}</p>}
                {drafts.next !== null && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={drafts.loading}
                    onClick={drafts.loadMore}
                  >
                    Más borradores
                  </button>
                )}
              </details>
            )
          )}
          <h3>Facturas preparadas y emitidas</h3>
          <label className="field">
            Buscar cliente, identificación, consecutivo o clave
            <input
              value={list.search}
              onChange={(event) => list.setSearch(event.target.value)}
              maxLength={100}
            />
          </label>
          <details className="billing-disclosure">
            <summary>Filtros del historial de facturación</summary>
            <p>
              Las fechas corresponden a la emisión o preparación en la hora de
              Costa Rica.
            </p>
            <div className="billing-grid">
              {[
                ["from", "Fecha inicial", "date"],
                ["to", "Fecha final", "date"],
                ["identification", "Identificación del receptor", "text"],
                ["consecutivo", "Consecutivo del historial", "text"],
                ["clave", "Clave electrónica del historial", "text"],
                ["issued_by", "Identificador del usuario emisor", "text"],
              ].map(([key, label, type]) => (
                <label className="field" key={key}>
                  {label}
                  <input
                    type={type}
                    value={filters[key] ?? ""}
                    onChange={(event) =>
                      setFilters((old) => ({
                        ...old,
                        [key]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
              {[
                [
                  "document_type",
                  "Tipo de comprobante del historial",
                  [
                    ["FE", "Factura electrónica"],
                    ["TE", "Tiquete electrónico"],
                  ],
                ],
                [
                  "currency",
                  "Moneda del historial",
                  [
                    ["CRC", "Colones"],
                    ["USD", "Dólares"],
                  ],
                ],
                [
                  "document_status",
                  "Estado del documento",
                  [
                    ["prepared", "Preparada"],
                    ["issued", "Emitida"],
                  ],
                ],
                [
                  "hacienda_status",
                  "Estado de Hacienda del historial",
                  [
                    ["pending", "Pendiente"],
                    ["accepted", "Aceptada"],
                    ["rejected", "Rechazada"],
                  ],
                ],
                [
                  "sale_condition",
                  "Condición de venta del historial",
                  [
                    ["01", "Contado"],
                    ["02", "Crédito"],
                  ],
                ],
              ].map(([key, label, choices]) => (
                <label className="field" key={String(key)}>
                  {String(label)}
                  <select
                    value={filters[String(key)] ?? ""}
                    onChange={(event) =>
                      setFilters((old) => ({
                        ...old,
                        [String(key)]: event.target.value,
                      }))
                    }
                  >
                    <option value="">Todos</option>
                    {(choices as string[][]).map(([value, text]) => (
                      <option key={value} value={value}>
                        {text}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button
              className="button secondary"
              onClick={() => {
                setFilters({});
                list.setSearch("");
              }}
            >
              Limpiar filtros del historial
            </button>
          </details>
          {list.summary && !list.loading && (
            <section
              className="billing-history-summary"
              aria-label="Indicadores del historial filtrado"
            >
              <dl className="fiscal-preview-totals">
                {[
                  ["Preparadas sin emitir", "prepared"],
                  ["Aceptadas por Hacienda", "accepted"],
                  ["Rechazadas", "rejected"],
                  ["Emitidas pendientes", "pending"],
                  ["Aceptadas de contado", "cash"],
                  ["Aceptadas de crédito", "credit"],
                ].map(([label, key]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>{list.summary!.counts?.[key] ?? 0}</dd>
                  </div>
                ))}
              </dl>
              {list.summary.amounts?.map((amount: Row) => (
                <p key={amount.currency}>
                  Ventas aceptadas {amount.currency}: {amount.total} ·
                  Impuestos: {amount.tax} · Contado: {amount.cash} · Crédito:{" "}
                  {amount.credit}
                </p>
              ))}
              <p>
                Los importes incluyen únicamente documentos emitidos y aceptados
                por Hacienda. No se suman monedas distintas, preparaciones,
                pendientes ni rechazos.
              </p>
            </section>
          )}
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
                {" · Hacienda: "}
                {labels[row.hacienda_status] || row.hacienda_status}
                {row.consecutivo ? ` · ${row.consecutivo}` : ""}
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
          {item && snapshot && !creating && (
            <section aria-label="Detalle de factura">
              <h3>Detalle de factura</h3>
              <p>Ambiente: {environmentLabel(documentEnvironment)}</p>
              {canCreate && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    fresh();
                    setDuplicateFromInvoice(item);
                    setCreating(true);
                    setEditorKey((v) => v + 1);
                  }}
                >
                  Duplicar factura
                </button>
              )}
              {item.document_status === "issued" && (
                <div className="billing-section">
                  <p>
                    La factura emitida conserva sus datos fiscales. Las notas de
                    crédito y débito todavía requieren completar sus esquemas,
                    reglas y pruebas de envío.
                  </p>
                  <button type="button" className="button secondary" disabled>
                    Nota de crédito · pendiente de implementación
                  </button>
                  <button type="button" className="button secondary" disabled>
                    Nota de débito · pendiente de implementación
                  </button>
                </div>
              )}
              <details className="billing-disclosure">
                <summary>Datos del comprobante guardado</summary>
                <dl className="billing-issuer-data">
                  {[
                    [
                      "Tipo de comprobante",
                      (item.document_type ?? snapshot.document_type) === "TE"
                        ? "Tiquete electrónico"
                        : "Factura electrónica",
                    ],
                    [
                      "Fecha y hora de emisión",
                      item.issued_at
                        ? new Date(item.issued_at).toLocaleString("es-CR", {
                            timeZone: "America/Costa_Rica",
                          })
                        : "Se asignan al emitir",
                    ],
                    ["Consecutivo", item.consecutivo || "Se asigna al emitir"],
                    ["Clave numérica", item.clave || "Se asigna al emitir"],
                    [
                      "Actividad económica del emisor",
                      item.options?.issuer_activity || "Pendiente",
                    ],
                    [
                      "Sucursal y terminal",
                      [item.options?.branch_code, item.options?.terminal_code]
                        .filter(Boolean)
                        .join(" / ") || "Pendientes",
                    ],
                    [
                      "Moneda y tipo de cambio",
                      `${snapshot.currency} · ${item.options?.exchange_rate || "Pendiente"}`,
                    ],
                    [
                      "Condición de venta",
                      item.options?.sale_condition === "02"
                        ? `02 · Crédito · ${item.options?.credit_days ?? "—"} días`
                        : "01 · Contado",
                    ],
                    ...(item.issued_at && item.options?.sale_condition === "02"
                      ? [
                          [
                            "Vencimiento comercial (Costa Rica)",
                            provisionalDueDate(
                              item.issued_at,
                              item.options.credit_days,
                            ),
                          ],
                        ]
                      : []),
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                {item.options?.payment_methods?.map(
                  (payment: Row, i: number) => (
                    <p key={i}>
                      Pago {i + 1}:{" "}
                      {PAYMENT_METHODS.find(
                        ([code]) => code === payment.code,
                      )?.[1] ?? payment.code}{" "}
                      · {snapshot.currency} {payment.amount}
                      {payment.code === "99"
                        ? ` · ${payment.other_description}`
                        : ""}
                    </p>
                  ),
                )}
                {snapshot.notes && <p>Observaciones: {snapshot.notes}</p>}
              </details>
              <dl className="fiscal-preview-totals">
                {[
                  ["Emisor", snapshot.issuer?.legal_name || "Sin nombre"],
                  ["Receptor", snapshot.receiver?.name || "Sin nombre"],
                  ["Departamento", department?.name || item.department_id],
                  [
                    "Correo destinatario",
                    snapshot.receiver?.email || "Sin correo",
                  ],
                  ["Total", money(snapshot)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
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
              <InvoiceSummary
                calculation={snapshot.totals ?? null}
                currency={snapshot.currency}
              />
              {snapshot.other_charges?.length > 0 && (
                <details className="billing-disclosure">
                  <summary>Otros cargos del comprobante</summary>
                  {snapshot.other_charges.map((charge: Row, i: number) => (
                    <p key={i}>
                      {charge.code} · {charge.description} · {snapshot.currency}{" "}
                      {snapshot.totals?.charges?.[i]?.calculated_amount ??
                        charge.amount}
                    </p>
                  ))}
                </details>
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
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{labels[value] || value}</dd>
                  </div>
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
              {item.document_status === "prepared" &&
                item.readiness?.requirements?.length > 0 && (
                  <EmissionRequirements
                    requirements={item.readiness.requirements}
                    onConfigure={onConfigure}
                    onEdit={canEdit ? edit : undefined}
                    onNumbering={() => {
                      const panel =
                        numberingRef.current?.querySelector("details");
                      if (panel) {
                        panel.open = true;
                        panel.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        });
                      }
                    }}
                  />
                )}
              {item.document_status === "prepared" && !canEmit && (
                <p className="fiscal-preview-warning">
                  {department?.can_emit
                    ? "Completa los requisitos indicados y actualiza la preparación para habilitar Facturar."
                    : "Tu usuario no tiene permiso para emitir facturas de este departamento."}
                </p>
              )}
              {item.readiness?.issues?.length ? (
                <ul>
                  {item.readiness.issues
                    .filter(
                      (issue: Row) =>
                        !item.readiness.requirements?.some((r: Row) =>
                          r.message?.includes(issue.message),
                        ),
                    )
                    .map((issue: Row, i: number) => (
                      <li key={i}>{issue.message}</li>
                    ))}
                </ul>
              ) : (
                <p>Sin observaciones de preparación.</p>
              )}
              {item.document_status === "prepared" && (
                <>
                  {onConfigure && item.readiness?.issues?.length > 0 && (
                    <div className="billing-actions">
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        onClick={() => onConfigure("company")}
                      >
                        Configurar empresa
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        onClick={() => onConfigure("hacienda")}
                      >
                        Configurar Hacienda
                      </button>
                      {item.readiness.issues.some((issue: Row) =>
                        /ACTIVITY|TERMINAL/.test(issue.code),
                      ) && (
                        <button
                          type="button"
                          className="button secondary"
                          disabled={busy}
                          onClick={() => onConfigure("organization")}
                        >
                          Revisar actividad, sucursal y terminal
                        </button>
                      )}
                    </div>
                  )}
                  {item.readiness?.issues?.some((issue: Row) =>
                    /NUMBERING/.test(issue.code),
                  ) && (
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() => {
                        const panel =
                          numberingRef.current?.querySelector("details");
                        if (panel) {
                          panel.open = true;
                          panel.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          });
                        }
                      }}
                    >
                      Confirmar numeración
                    </button>
                  )}
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
                    className="button primary"
                    disabled={busy || !canEmit}
                    onClick={() => {
                      setProductionConfirmed(false);
                      setConfirm(true);
                    }}
                  >
                    Facturar en {issueLabel}
                  </button>
                  {confirm && (
                    <div
                      role="dialog"
                      aria-modal="true"
                      aria-label={"Confirmar emisión en " + issueLabel}
                    >
                      <h4>Confirmar emisión en {issueLabel}</h4>
                      <p>
                        Emisor: {snapshot.issuer?.legal_name}. Receptor:{" "}
                        {snapshot.receiver?.name ||
                          (snapshot.document_type === "TE"
                            ? "Consumidor final"
                            : "Sin nombre")}
                        . Total: {money(snapshot)}. Departamento:{" "}
                        {department?.name || item.department_id}. Correo:{" "}
                        {snapshot.receiver?.email || "Sin correo"}.
                      </p>
                      {documentEnvironment === "production" && (
                        <>
                          <p>
                            Esta operación emite un comprobante fiscal real en
                            producción.
                          </p>
                          <label className="billing-check">
                            <input
                              type="checkbox"
                              checked={productionConfirmed}
                              disabled={busy}
                              onChange={(event) =>
                                setProductionConfirmed(event.target.checked)
                              }
                            />
                            Confirmo que esta factura corresponde a una venta
                            real autorizada y que se emitirá en producción
                          </label>
                        </>
                      )}
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => {
                          setConfirm(false);
                          setProductionConfirmed(false);
                        }}
                      >
                        Cancelar
                      </button>
                      <button
                        className="button primary"
                        disabled={
                          busy ||
                          !canEmit ||
                          (documentEnvironment === "production" &&
                            !productionConfirmed)
                        }
                        onClick={() => void issue()}
                      >
                        Confirmar emisión en {issueLabel}
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
    </div>
  );
}
