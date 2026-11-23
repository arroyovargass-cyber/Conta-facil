import React, { useRef, useState } from "react";
import { apiRequest, post } from "../../api/client";
import { calculateInvoice } from "../../../../../packages/domain/src/invoice-fiscal";
import { subtotal } from "../../../../../packages/domain/src/billing";
import {
  Field,
  Lookup,
  useAlive,
  useListing,
  type Row,
  ReceiverFields,
  FiscalFields,
  receiverDefaults,
  fiscalDefaults,
} from "./common";
import { FiscalPreview } from "./FiscalPreview";
function fingerprint(row: Row): string {
  return JSON.stringify({
    receiver_mode: row.receiver_mode,
    receiver: row.receiver,
    document_type: row.document_type,
    customer_id: row.customer_id,
    department_id: row.department_id,
    currency: row.currency,
    notes: row.notes,
    lines: row.lines.map((l: Row) => ({
      catalog_item_id: l.catalog_item_id || null,
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unit_price,
      fiscal: l.fiscal ?? null,
    })),
  });
}
const blankLine = () => ({
  fiscal: null,
  catalog_item_id: null,
  description: "",
  quantity: "1",
  unit_price: "0",
});
export function Drafts({ base, options }: { base: string; options: Row }) {
  const list = useListing(base + "/invoice-drafts", "archived", "false"),
    alive = useAlive(),
    operation = useRef("");
  const editorGeneration = useRef(0),
    writing = useRef(false);
  const [editing, setEditing] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [conflict, setConflict] = useState(false),
    [previewGeneration, setPreviewGeneration] = useState(0),
    [savedFingerprint, setSavedFingerprint] = useState(""),
    [detailLoading, setDetailLoading] = useState(false);
  function invalidateEditor() {
    const generation = ++editorGeneration.current;
    setPreviewGeneration(generation);
    setDetailLoading(false);
    return generation;
  }
  const manageable = (d: string) =>
    options.departments.some((v: Row) => v.id === d && v.can_manage);
  const editable =
    editing &&
    !editing.archived_at &&
    (editing.id ? manageable(editing.department_id) : options.canManage);
  function change(k: string, v: any) {
    invalidateEditor();
    setEditing((old) => ({ ...old, [k]: v }));
  }
  function lineChange(index: number, key: string, value: any) {
    invalidateEditor();
    setEditing((old) => ({
      ...old,
      lines: old!.lines.map((l: Row, i: number) =>
        i === index ? { ...l, [key]: value } : l,
      ),
    }));
  }
  function create() {
    if (writing.current) return;
    invalidateEditor();
    operation.current = crypto.randomUUID();
    setEditing({
      receiver_mode: "registered",
      receiver: receiverDefaults(),
      save_customer: false,
      document_type: "FE",
      customer_id: "",
      department_id: "",
      currency: "CRC",
      notes: "",
      lines: [blankLine()],
    });
    setError("");
    setNotice("");
    setConflict(false);
  }
  async function open(id: string) {
    if (writing.current) return;
    const generation = invalidateEditor();
    setDetailLoading(true);
    setError("");
    setNotice("");
    setConflict(false);
    try {
      const r = await apiRequest(base + "/invoice-drafts/" + id);
      if (alive.current && editorGeneration.current === generation) {
        setSavedFingerprint(
          fingerprint({
            ...r.item,
            receiver: { ...receiverDefaults(), ...r.item.customer_snapshot },
          }),
        );
        setEditing({
          ...r.item,
          receiver: { ...receiverDefaults(), ...r.item.customer_snapshot },
          save_customer: false,
        });
      }
    } catch (e: any) {
      if (alive.current && editorGeneration.current === generation)
        setError(e.message);
    } finally {
      if (alive.current && editorGeneration.current === generation)
        setDetailLoading(false);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || busy) return;
    const value = {
      receiver_mode: editing.receiver_mode ?? "registered",
      receiver: editing.receiver,
      save_customer: editing.save_customer ?? false,
      document_type: editing.document_type ?? "FE",
      customer_id: editing.customer_id || null,
      department_id: editing.department_id,
      currency: editing.currency,
      notes: editing.notes,
      lines: editing.lines.map((l: Row) => ({
        catalog_item_id: l.catalog_item_id || null,
        description: l.description,
        quantity: l.quantity || null,
        unit_price: l.unit_price || null,
        fiscal: l.fiscal ?? null,
      })),
      ...(editing.id
        ? { version: editing.version }
        : { operation_id: operation.current }),
    };
    await write(value, "Borrador guardado.");
  }
  async function write(value: Row, message: string) {
    if (!editing || writing.current) return;
    writing.current = true;
    const generation = invalidateEditor();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await post(
        base + "/invoice-drafts" + (editing.id ? "/" + editing.id : ""),
        value,
        editing.id ? "PATCH" : "POST",
      );
      if (!alive.current || editorGeneration.current !== generation) return;
      setEditing(null);
      setConflict(false);
      setNotice(message);
      list.refresh();
    } catch (e: any) {
      if (alive.current && editorGeneration.current === generation) {
        setError(e.message);
        setConflict(e.status === 409);
      }
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function assignReview() {
    if (
      !editing?.id ||
      writing.current ||
      fingerprint(editing) !== savedFingerprint
    )
      return;
    const generation = editorGeneration.current;
    writing.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await post(
        base + "/invoice-drafts/" + editing.id + "/collection-review",
        { expected_version: editing.version },
      );
      if (alive.current && editorGeneration.current === generation)
        setNotice("Revisión asignada a Cuentas por cobrar.");
    } catch (e: any) {
      if (alive.current && editorGeneration.current === generation) {
        setError(e.message);
        setConflict(e.status === 409);
      }
    } finally {
      writing.current = false;
      if (alive.current && editorGeneration.current === generation)
        setBusy(false);
    }
  }
  const calculation = editing
    ? calculateInvoice(
        editing.lines.map((l: Row) => ({
          ...l,
          quantity: l.quantity || null,
          unit_price: l.unit_price || null,
          fiscal: l.fiscal ?? null,
        })),
      )
    : null;
  let amount = "—";
  try {
    if (editing) amount = subtotal(editing.lines);
  } catch {
    /* Invalid inputs remain editable; server validates on save. */
  }
  return (
    <section className="billing-workspace">
      <div className="info-box">
        <strong>Borrador — sin validez tributaria</strong>
        <p>
          Prepara los datos comerciales. Este documento no se firma ni se envía
          a Hacienda.
        </p>
      </div>
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
      <div className="billing-toolbar">
        <Field
          label="Buscar borradores"
          value={list.search}
          onChange={list.setSearch}
          maxLength={100}
        />
        <label className="field">
          Estado de borradores
          <select
            aria-label="Estado de borradores"
            value={list.filter}
            onChange={(e) => list.setFilter(e.target.value)}
          >
            <option value="false">En preparación</option>
            <option value="true">Archivados</option>
            <option value="all">Todos</option>
          </select>
        </label>
        {options.canManage && (
          <button className="button primary" disabled={busy} onClick={create}>
            Nuevo borrador
          </button>
        )}
      </div>
      {!options.departments.some((d: Row) => d.active) && (
        <p>
          Necesitas un departamento activo y autorizado para crear borradores.
        </p>
      )}
      {editing && (
        <form className="billing-editor" onSubmit={save}>
          <h2>{editing.id ? "Detalle del borrador" : "Nuevo borrador"}</h2>
          <fieldset disabled={busy || !editable}>
            <div className="form-grid">
              <label className="field">
                Tipo de receptor
                <select
                  value={editing.receiver_mode ?? "registered"}
                  onChange={(e) => {
                    change("receiver_mode", e.target.value);
                    change("customer_id", "");
                    change("receiver", receiverDefaults());
                    change("save_customer", false);
                  }}
                >
                  <option value="registered">Cliente registrado</option>
                  <option value="occasional">
                    Venta rápida / cliente ocasional
                  </option>
                </select>
              </label>
              <label className="field">
                Tipo de documento
                <select
                  value={editing.document_type ?? "FE"}
                  onChange={(e) => change("document_type", e.target.value)}
                >
                  <option value="FE">Factura electrónica (preparación)</option>
                  <option value="TE">Tiquete electrónico (preparación)</option>
                </select>
              </label>
              {(editing.receiver_mode ?? "registered") === "registered" && (
                <Lookup
                  base={base + "/customers"}
                  label="Cliente"
                  value={editing.customer_id}
                  current={
                    editing.customer_id
                      ? {
                          id: editing.customer_id,
                          name:
                            editing.customer_snapshot?.name ??
                            editing.customer_name ??
                            "Cliente seleccionado",
                        }
                      : undefined
                  }
                  onChange={(id, row) => {
                    change("customer_id", id);
                    change("customer_name", row?.name);
                    if (row)
                      change(
                        "receiver",
                        Object.fromEntries(
                          Object.keys(receiverDefaults()).map((k) => [
                            k,
                            row[k] ??
                              receiverDefaults()[
                                k as keyof ReturnType<typeof receiverDefaults>
                              ],
                          ]),
                        ),
                      );
                  }}
                />
              )}
              <label className="field">
                Departamento
                <select
                  required
                  aria-label="Departamento"
                  value={editing.department_id}
                  onChange={(e) => change("department_id", e.target.value)}
                >
                  <option value="">Selecciona…</option>
                  {options.departments
                    .filter(
                      (d: Row) =>
                        d.id === editing.department_id ||
                        (d.active && d.can_manage),
                    )
                    .map((d: Row) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                        {!d.active ? " (inactivo)" : ""}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                Moneda del borrador
                <select
                  aria-label="Moneda del borrador"
                  value={editing.currency}
                  onChange={(e) => {
                    if (editing.lines.some((l: Row) => l.catalog_item_id)) {
                      setError(
                        "Retira las referencias a productos antes de cambiar la moneda.",
                      );
                      return;
                    }
                    change("currency", e.target.value);
                  }}
                >
                  <option>CRC</option>
                  <option>USD</option>
                </select>
              </label>
            </div>
            <h3>Receptor de este borrador</h3>
            <p>
              Estos datos se conservan en el borrador. Puedes completar la
              información fiscal después.
            </p>
            <ReceiverFields
              value={editing.receiver ?? receiverDefaults()}
              onChange={(v) => change("receiver", v)}
              base={base}
            />
            {editing.receiver_mode === "occasional" &&
              options.permissions?.includes("customers.manage") &&
              options.permissions?.includes("customers.read") && (
                <label className="billing-check">
                  <input
                    type="checkbox"
                    checked={Boolean(editing.save_customer)}
                    onChange={(e) => change("save_customer", e.target.checked)}
                  />
                  Guardar también como cliente (opcional)
                </label>
              )}
            <p>
              Los precios unitarios excluyen impuestos. Configura cada
              tratamiento y tarifa explícitamente.
            </p>
            {editing.lines.map((l: Row, index: number) => (
              <div className="billing-line" key={index}>
                <h3>Línea {index + 1}</h3>
                <Lookup
                  base={base + "/catalog-items"}
                  label={"Producto de línea " + (index + 1)}
                  value={l.catalog_item_id ?? ""}
                  current={
                    l.catalog_item_id
                      ? { id: l.catalog_item_id, name: l.description }
                      : undefined
                  }
                  compatible={(r) => r.currency === editing.currency}
                  onChange={(id, row) => {
                    invalidateEditor();
                    setEditing((old) => ({
                      ...old,
                      lines: old!.lines.map((line: Row, i: number) =>
                        i === index
                          ? {
                              ...line,
                              catalog_item_id: id || null,
                              ...(row
                                ? {
                                    description: row.description,
                                    unit_price: row.unit_price,
                                    fiscal: row.tax_defaults
                                      ? {
                                          ...fiscalDefaults(),
                                          ...row.tax_defaults,
                                          cabys:
                                            row.cabys ||
                                            row.tax_defaults.cabys ||
                                            "",
                                          unit:
                                            row.unit ||
                                            row.tax_defaults.unit ||
                                            "",
                                        }
                                      : row.cabys || row.unit
                                        ? {
                                            ...fiscalDefaults(),
                                            cabys: row.cabys || "",
                                            unit: row.unit || "",
                                          }
                                        : null,
                                  }
                                : {}),
                            }
                          : line,
                      ),
                    }));
                  }}
                />
                <div className="form-grid">
                  <Field
                    label={"Descripción de línea " + (index + 1)}
                    value={l.description}
                    onChange={(v) => lineChange(index, "description", v)}
                  />
                  <Field
                    label={"Cantidad de línea " + (index + 1)}
                    value={l.quantity ?? ""}
                    onChange={(v) => lineChange(index, "quantity", v)}
                    maxLength={15}
                  />
                  <Field
                    label={"Precio de línea " + (index + 1)}
                    value={l.unit_price ?? ""}
                    onChange={(v) => lineChange(index, "unit_price", v)}
                    maxLength={15}
                  />
                </div>
                <label className="billing-check">
                  <input
                    type="checkbox"
                    checked={Boolean(l.fiscal)}
                    onChange={(e) =>
                      lineChange(
                        index,
                        "fiscal",
                        e.target.checked ? fiscalDefaults() : null,
                      )
                    }
                  />
                  Configurar impuestos y descuentos de línea {index + 1}
                </label>
                {l.fiscal && (
                  <FiscalFields
                    value={l.fiscal}
                    onChange={(v) => lineChange(index, "fiscal", v)}
                    base={base}
                    receiverExoneration={editing.receiver?.exoneration}
                  />
                )}
                <LineTotals
                  line={l}
                  index={index}
                  currency={editing.currency}
                />
                <button
                  type="button"
                  className="button secondary"
                  disabled={editing.lines.length === 1}
                  onClick={() =>
                    change(
                      "lines",
                      editing.lines.filter((_: Row, i: number) => i !== index),
                    )
                  }
                >
                  Quitar línea {index + 1}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="button secondary"
              disabled={editing.lines.length >= 100}
              onClick={() => change("lines", [...editing.lines, blankLine()])}
            >
              Añadir línea
            </button>
            <Field
              label="Observaciones"
              value={editing.notes}
              onChange={(v) => change("notes", v)}
              maxLength={2000}
            />
          </fieldset>
          <div className="billing-subtotal">
            <span>Importe de líneas antes de impuestos</span>
            <strong>
              {editing.currency} {amount}
            </strong>
          </div>
          {calculation?.status === "complete" ? (
            <div
              className="fiscal-preview-panel"
              role="region"
              aria-label="Totales calculados del borrador"
            >
              <h3>Totales calculados del borrador</h3>
              <dl className="fiscal-preview-totals">
                {[
                  ["Importe antes de descuentos", calculation.beforeDiscount],
                  ["Descuentos", calculation.discounts],
                  ["Base", calculation.subtotal],
                  ["Impuestos antes de exoneración", calculation.tax],
                  ["Exoneraciones", calculation.exonerations],
                  ["Total", calculation.total],
                ].map(([label, v]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>
                      {editing.currency} {v}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="billing-table">
                <table>
                  <thead>
                    <tr>
                      <th>Tarifa</th>
                      <th>Base</th>
                      <th>Impuesto antes de exoneración</th>
                      <th>Exoneración</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calculation.groups.map((g, i) => (
                      <tr key={i}>
                        <td>
                          {g.tariff_code} ({g.rate} %)
                        </td>
                        <td>{g.base}</td>
                        <td>{g.tax}</td>
                        <td>{g.exoneration}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="info-box">
              <strong>Preparación fiscal incompleta</strong>
              <ul>
                {calculation?.issues.map((issue, i) => (
                  <li key={i}>
                    {issue.path ? issue.path + ": " : ""}
                    {issue.message}
                  </li>
                ))}
              </ul>
              <p>Puedes guardar este borrador y completar los datos después.</p>
            </div>
          )}
          {editing.id &&
            fingerprint(editing) === savedFingerprint &&
            editing.readiness?.issues?.length > 0 && (
              <div className="info-box">
                <h3>Datos pendientes del receptor y documento</h3>
                <ul>
                  {editing.readiness.issues.map((issue: Row, i: number) => (
                    <li key={i}>{issue.message}</li>
                  ))}
                </ul>
                <p>Este borrador no se emite ni se envía a Hacienda.</p>
              </div>
            )}
          {editing.id && !editing.lines.some((l: Row) => l.fiscal) && (
            <FiscalPreview
              key={editing.id + ":" + previewGeneration}
              base={base}
              draftId={editing.id}
              version={editing.version}
              dirty={fingerprint(editing) !== savedFingerprint}
              disabled={busy || detailLoading}
              generation={previewGeneration}
              isCurrent={(generation) =>
                editorGeneration.current === generation
              }
              onConflict={() => setConflict(true)}
            />
          )}
          <div className="billing-actions">
            {editing.id && (
              <button
                type="button"
                className="button secondary"
                disabled={busy || fingerprint(editing) !== savedFingerprint}
                onClick={() =>
                  window.open(
                    "/api" + base + "/invoice-drafts/" + editing.id + "/print",
                    "_blank",
                    "noopener",
                  )
                }
              >
                Imprimir borrador sin validez tributaria
              </button>
            )}
            {editing.id &&
              !editing.archived_at &&
              options.departments.some(
                (d: Row) =>
                  d.id === editing.department_id &&
                  d.can_assign &&
                  d.can_manage,
              ) && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={
                    busy ||
                    detailLoading ||
                    fingerprint(editing) !== savedFingerprint
                  }
                  onClick={() => void assignReview()}
                >
                  Asignar revisión a Cuentas por cobrar
                </button>
              )}
            {editable && (
              <button className="button primary" disabled={busy}>
                {busy ? "Guardando…" : "Guardar borrador"}
              </button>
            )}
            {editing.id && manageable(editing.department_id) && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void write(
                    {
                      version: editing.version,
                      archived: !editing.archived_at,
                    },
                    editing.archived_at
                      ? "Borrador restaurado."
                      : "Borrador archivado.",
                  )
                }
              >
                {editing.archived_at
                  ? "Restaurar borrador"
                  : "Archivar borrador"}
              </button>
            )}
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => {
                invalidateEditor();
                setEditing(null);
                setError("");
                setConflict(false);
              }}
            >
              Cerrar borrador
            </button>
            {conflict && editing.id && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => void open(editing.id)}
              >
                Recargar registro
              </button>
            )}
          </div>
        </form>
      )}
      {list.error && (
        <div role="alert" className="alert">
          {list.error}
        </div>
      )}
      {list.loading && <p>Cargando borradores…</p>}
      <div className="billing-table">
        <table>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Fecha</th>
              <th>Moneda</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.customer_snapshot?.name || "Receptor por completar"}</td>
                <td>{new Date(r.created_at).toLocaleDateString("es-CR")}</td>
                <td>{r.currency}</td>
                <td>{r.archived_at ? "Archivado" : "Borrador"}</td>
                <td>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void open(r.id)}
                  >
                    Abrir borrador
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!list.loading && !list.rows.length && !list.error && (
        <p>No hay borradores para estos filtros.</p>
      )}
      {list.next !== null && (
        <button
          className="button secondary"
          disabled={list.loading}
          onClick={() => void list.loadMore()}
        >
          Cargar más borradores
        </button>
      )}
    </section>
  );
}

function LineTotals({
  line,
  index,
  currency,
}: {
  line: Row;
  index: number;
  currency: string;
}) {
  const calculated = calculateInvoice([
    {
      ...line,
      quantity: line.quantity || null,
      unit_price: line.unit_price || null,
      fiscal: line.fiscal ?? null,
    },
  ]);
  if (calculated.status !== "complete")
    return (
      <p role="status">
        Totales de línea {index + 1} pendientes: completa los datos y el
        tratamiento fiscal.
      </p>
    );
  return (
    <section
      aria-label={"Importes de línea " + (index + 1)}
      className="billing-line-totals"
    >
      <dl className="fiscal-preview-totals">
        {[
          ["Base después de descuento", calculated.subtotal],
          ["IVA antes de exoneración", calculated.tax],
          ["Exoneración", calculated.exonerations],
          ["Total línea " + (index + 1), calculated.total],
        ].map(([label, v]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {currency} {v}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
