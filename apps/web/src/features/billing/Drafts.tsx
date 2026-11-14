import React, { useRef, useState } from "react";
import { apiRequest, post } from "../../api/client";
import { subtotal } from "../../../../../packages/domain/src/billing";
import { Field, Lookup, useAlive, useListing, type Row } from "./common";
const blankLine = () => ({
  catalog_item_id: null,
  description: "",
  quantity: "1",
  unit_price: "0",
});
export function Drafts({ base, options }: { base: string; options: Row }) {
  const list = useListing(base + "/invoice-drafts", "archived", "false"),
    alive = useAlive(),
    operation = useRef("");
  const [editing, setEditing] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [conflict, setConflict] = useState(false);
  const manageable = (d: string) =>
    options.departments.some((v: Row) => v.id === d && v.can_manage);
  const editable =
    editing &&
    !editing.archived_at &&
    (editing.id ? manageable(editing.department_id) : options.canManage);
  function change(k: string, v: any) {
    setEditing((old) => ({ ...old, [k]: v }));
  }
  function lineChange(index: number, key: string, value: any) {
    setEditing((old) => ({
      ...old,
      lines: old!.lines.map((l: Row, i: number) =>
        i === index ? { ...l, [key]: value } : l,
      ),
    }));
  }
  function create() {
    operation.current = crypto.randomUUID();
    setEditing({
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
    setError("");
    setNotice("");
    setConflict(false);
    try {
      const r = await apiRequest(base + "/invoice-drafts/" + id);
      if (alive.current) setEditing(r.item);
    } catch (e: any) {
      if (alive.current) setError(e.message);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || busy) return;
    const value = {
      customer_id: editing.customer_id,
      department_id: editing.department_id,
      currency: editing.currency,
      notes: editing.notes,
      lines: editing.lines.map((l: Row) => ({
        catalog_item_id: l.catalog_item_id || null,
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unit_price,
      })),
      ...(editing.id
        ? { version: editing.version }
        : { operation_id: operation.current }),
    };
    await write(value, "Borrador guardado.");
  }
  async function write(value: Row, message: string) {
    if (!editing || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await post(
        base + "/invoice-drafts" + (editing.id ? "/" + editing.id : ""),
        value,
        editing.id ? "PATCH" : "POST",
      );
      if (!alive.current) return;
      setEditing(null);
      setConflict(false);
      setNotice(message);
      list.refresh();
    } catch (e: any) {
      if (alive.current) {
        setError(e.message);
        setConflict(e.status === 409);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
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
                }}
              />
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
                    required
                  />
                  <Field
                    label={"Cantidad de línea " + (index + 1)}
                    value={l.quantity}
                    onChange={(v) => lineChange(index, "quantity", v)}
                    required
                    maxLength={15}
                  />
                  <Field
                    label={"Precio de línea " + (index + 1)}
                    value={l.unit_price}
                    onChange={(v) => lineChange(index, "unit_price", v)}
                    required
                    maxLength={15}
                  />
                </div>
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
          <div className="billing-actions">
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
                <td>{r.customer_snapshot.name}</td>
                <td>{new Date(r.created_at).toLocaleDateString("es-CR")}</td>
                <td>{r.currency}</td>
                <td>{r.archived_at ? "Archivado" : "Borrador"}</td>
                <td>
                  <button
                    className="button secondary"
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
