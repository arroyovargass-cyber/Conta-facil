import React, { useRef, useState } from "react";
import { apiRequest, post } from "../../api/client";
import { Field, useAlive, useListing, type Row } from "./common";
export function RecordCatalog({
  base,
  kind,
  canManage,
}: {
  base: string;
  kind: "customer" | "product";
  canManage: boolean;
}) {
  const customer = kind === "customer",
    list = useListing(base, "active"),
    alive = useAlive();
  const editorGeneration = useRef(0),
    writing = useRef(false);
  const [editing, setEditing] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [conflict, setConflict] = useState(false);
  const defaults = customer
    ? {
        name: "",
        identification_type: "",
        identification: "",
        email: "",
        phone: "",
        address: "",
        active: true,
      }
    : {
        code: "",
        description: "",
        kind: "service",
        currency: "CRC",
        unit_price: "0",
        cabys: "",
        unit: "",
        active: true,
      };
  function change(key: string, value: any) {
    editorGeneration.current++;
    setEditing((v) => ({ ...v, [key]: value }));
  }
  async function open(id: string) {
    if (writing.current) return;
    const generation = ++editorGeneration.current;
    setError("");
    setNotice("");
    setConflict(false);
    try {
      const r = await apiRequest(base + "/" + id);
      if (alive.current && editorGeneration.current === generation)
        setEditing(r.item);
    } catch (e: any) {
      if (alive.current && editorGeneration.current === generation)
        setError(e.message);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || writing.current) return;
    writing.current = true;
    const generation = ++editorGeneration.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const payload = Object.fromEntries(
        Object.keys(defaults).map((k) => [k, editing[k]]),
      );
      if (editing.id) payload.version = editing.version;
      await post(
        base + (editing.id ? "/" + editing.id : ""),
        payload,
        editing.id ? "PATCH" : "POST",
      );
      if (!alive.current || editorGeneration.current !== generation) return;
      setEditing(null);
      setConflict(false);
      setNotice(customer ? "Cliente guardado." : "Producto guardado.");
      list.refresh();
    } catch (e: any) {
      if (alive.current && editorGeneration.current === generation) {
        setError(e.message);
        setConflict(e.status === 409 && Boolean(editing.id));
      }
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="billing-workspace">
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
          label="Buscar registros"
          value={list.search}
          onChange={list.setSearch}
          maxLength={100}
        />
        <label className="field">
          Estado del catálogo
          <select
            value={list.filter}
            onChange={(e) => list.setFilter(e.target.value)}
          >
            <option value="all">Todos</option>
            <option value="true">Activos</option>
            <option value="false">Inactivos</option>
          </select>
        </label>
        {canManage && (
          <button
            className="button primary"
            disabled={busy}
            onClick={() => {
              if (writing.current) return;
              editorGeneration.current++;
              setEditing({ ...defaults });
              setError("");
              setNotice("");
              setConflict(false);
            }}
          >
            {customer ? "Nuevo cliente" : "Nuevo producto o servicio"}
          </button>
        )}
      </div>
      {editing && (
        <form className="billing-editor" onSubmit={save}>
          <h2>
            {customer ? "Datos del cliente" : "Datos del producto o servicio"}
          </h2>
          <fieldset disabled={busy || !canManage}>
            <div className="form-grid">
              {customer ? (
                <>
                  <Field
                    label="Nombre del cliente"
                    value={editing.name}
                    onChange={(v) => change("name", v)}
                    required
                  />
                  <Field
                    label="Tipo de identificación tributaria"
                    value={editing.identification_type}
                    onChange={(v) => change("identification_type", v)}
                    maxLength={40}
                  />
                  <Field
                    label="Identificación tributaria"
                    value={editing.identification}
                    onChange={(v) => change("identification", v)}
                    maxLength={40}
                  />
                  <Field
                    label="Correo del cliente"
                    value={editing.email}
                    onChange={(v) => change("email", v)}
                    type="email"
                    maxLength={254}
                  />
                  <Field
                    label="Teléfono del cliente"
                    value={editing.phone}
                    onChange={(v) => change("phone", v)}
                    maxLength={40}
                  />
                  <Field
                    label="Dirección del cliente"
                    value={editing.address}
                    onChange={(v) => change("address", v)}
                    maxLength={1000}
                  />
                </>
              ) : (
                <>
                  <Field
                    label="Código comercial"
                    value={editing.code}
                    onChange={(v) => change("code", v)}
                    maxLength={60}
                    required
                  />
                  <Field
                    label="Descripción"
                    value={editing.description}
                    onChange={(v) => change("description", v)}
                    required
                  />
                  <label className="field">
                    Clase
                    <select
                      value={editing.kind}
                      onChange={(e) => change("kind", e.target.value)}
                    >
                      <option value="service">Servicio</option>
                      <option value="product">Producto</option>
                    </select>
                  </label>
                  <label className="field">
                    Moneda del producto
                    <select
                      value={editing.currency}
                      onChange={(e) => change("currency", e.target.value)}
                    >
                      <option>CRC</option>
                      <option>USD</option>
                    </select>
                  </label>
                  <Field
                    label="Precio unitario"
                    value={editing.unit_price}
                    onChange={(v) => change("unit_price", v)}
                    maxLength={15}
                    required
                  />
                  <Field
                    label="CABYS (pendiente de validación oficial)"
                    value={editing.cabys}
                    onChange={(v) => change("cabys", v)}
                    maxLength={40}
                  />
                  <Field
                    label="Unidad (pendiente de validación oficial)"
                    value={editing.unit}
                    onChange={(v) => change("unit", v)}
                    maxLength={40}
                  />
                </>
              )}
              <label className="billing-check">
                <input
                  type="checkbox"
                  checked={editing.active}
                  onChange={(e) => change("active", e.target.checked)}
                />
                Registro activo
              </label>
            </div>
          </fieldset>
          <div className="billing-actions">
            {canManage && (
              <button className="button primary" disabled={busy}>
                {busy
                  ? "Guardando…"
                  : customer
                    ? "Guardar cliente"
                    : "Guardar producto"}
              </button>
            )}
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => {
                editorGeneration.current++;
                setEditing(null);
                setConflict(false);
                setError("");
              }}
            >
              Cerrar formulario
            </button>
            {conflict && (
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
      {list.loading && <p>Cargando registros…</p>}
      <div className="billing-table">
        <table>
          <thead>
            <tr>
              <th>{customer ? "Cliente" : "Descripción"}</th>
              <th>{customer ? "Identificación" : "Código"}</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name ?? r.description}</td>
                <td>
                  {customer ? r.identification || "Sin registrar" : r.code}
                </td>
                <td>{r.active ? "Activo" : "Inactivo"}</td>
                <td>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void open(r.id)}
                  >
                    {canManage
                      ? customer
                        ? "Editar cliente"
                        : "Editar producto"
                      : "Ver registro"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!list.loading && !list.rows.length && !list.error && (
        <p>No hay registros para estos filtros.</p>
      )}
      {list.next !== null && (
        <button
          className="button secondary"
          disabled={list.loading}
          onClick={() => void list.loadMore()}
        >
          Cargar más registros
        </button>
      )}
    </section>
  );
}
