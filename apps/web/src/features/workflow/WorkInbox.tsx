import React, { useState } from "react";
import { post } from "../../api/client";
import { Field, useAlive, type Row } from "../billing/common";
import { usePaged } from "./usePaged";
import { People } from "./People";
import { WorkflowSettings } from "./WorkflowSettings";
import "../billing/billing.css";
import "./workflow.css";
const states: Record<string, string> = {
  pending: "Pendiente",
  in_review: "En revisión",
  resolved: "Resuelta",
  archived: "Archivada",
};
export function WorkInbox({
  tenantId,
  flow,
  permissions,
}: {
  tenantId: string;
  flow: "collections" | "payables";
  permissions: string[];
}) {
  const base = "/companies/" + tenantId,
    [state, setState] = useState("all"),
    [selected, setSelected] = useState<Row | null>(null),
    [settings, setSettings] = useState(false),
    [notice, setNotice] = useState("");
  const list = usePaged(base + "/document-work-items", {
    flow,
    ...(state === "all" ? {} : { state }),
  });
  const canConfigure =
    permissions.includes("company.manage") &&
    permissions.includes("organization.manage");
  return (
    <div className="billing-workspace">
      <p>
        Revisión documental interna. La emisión y aceptación tributarias siguen
        pendientes.
      </p>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <div className="billing-toolbar">
        <Field
          label="Buscar tarea"
          value={list.search}
          onChange={list.setSearch}
          maxLength={100}
        />
        <label className="field">
          Estado de la tarea
          <select
            aria-label="Estado de la tarea"
            value={state}
            onChange={(e) => {
              setSelected(null);
              setState(e.target.value);
            }}
          >
            <option value="all">Todos</option>
            {Object.entries(states).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button secondary"
          disabled={list.loading}
          onClick={() => {
            setSelected(null);
            list.refresh();
          }}
        >
          Actualizar bandeja
        </button>
        {canConfigure && (
          <button
            className="button secondary"
            onClick={() => setSettings((v) => !v)}
          >
            {settings ? "Ocultar configuración" : "Configurar departamentos"}
          </button>
        )}
      </div>
      {settings && canConfigure && <WorkflowSettings base={base} />}{" "}
      {list.error && (
        <p role="alert" className="alert">
          {list.error}
        </p>
      )}
      {list.loading && <p>Cargando bandeja…</p>}
      {flow === "payables" && !list.loading && !list.error ? (
        <section className="billing-editor">
          <h3>Recepción pendiente</h3>
          <p>La recepción de comprobantes todavía no está implementada.</p>
          <p>
            Este departamento estará listo para revisar documentos cuando se
            habilite la importación y validación de XML.
          </p>
        </section>
      ) : (
        <>
          {!list.rows.length && !list.loading && !list.error && (
            <p>No hay tareas para los filtros y permisos actuales.</p>
          )}
          {list.rows.length > 0 && (
            <div className="billing-table">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Revisión</th>
                    <th>Responsable</th>
                    <th>Seguimiento</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.customer_name}
                        <small className="workflow-reference">
                          Borrador {row.source_id.slice(0, 8)}
                        </small>
                      </td>
                      <td>{states[row.state]}</td>
                      <td>
                        {row.assignee_name ?? "Sin responsable"}
                        {row.requires_reassignment && (
                          <small className="workflow-warning">
                            Requiere reasignación
                          </small>
                        )}
                      </td>
                      <td>
                        {row.needs_review ? (
                          <span className="workflow-warning">
                            Origen actualizado: requiere revisión
                          </span>
                        ) : (
                          "Versión revisada vigente"
                        )}
                      </td>
                      <td>
                        {row.can_manage ? (
                          <button
                            className="button secondary"
                            onClick={() => {
                              setSelected(row);
                              setNotice("");
                            }}
                          >
                            Revisar tarea
                          </button>
                        ) : (
                          <span>Solo consulta</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {list.next !== null && (
            <button
              className="button secondary"
              disabled={list.loading}
              onClick={() => void list.loadMore()}
            >
              Más tareas
            </button>
          )}
        </>
      )}
      {selected && (
        <WorkEditor
          key={selected.id + ":" + selected.version}
          base={base}
          row={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            setNotice("Revisión interna guardada.");
            list.refresh();
          }}
        />
      )}
    </div>
  );
}
function WorkEditor({
  base,
  row,
  onSaved,
  onClose,
}: {
  base: string;
  row: Row;
  onSaved: () => void;
  onClose: () => void;
}) {
  const alive = useAlive(),
    [state, setState] = useState(row.state),
    [assignee, setAssignee] = useState(row.assignee_id ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || conflict) return;
    setBusy(true);
    setError("");
    try {
      await post(
        base + "/document-work-items/" + row.id,
        {
          expected_version: row.version,
          expected_source_version: row.current_version,
          state,
          assignee_id: assignee || null,
        },
        "PATCH",
      );
      if (alive.current) onSaved();
    } catch (e: any) {
      if (alive.current) {
        setError(e.message);
        setConflict(e.status === 409);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <form className="billing-editor" onSubmit={submit}>
      <h3>Revisar tarea de {row.customer_name}</h3>
      <p>Origen: borrador comercial. Versión actual: {row.current_version}.</p>
      {row.needs_review && (
        <p className="notice">
          El origen cambió después de la revisión anterior.
        </p>
      )}
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {conflict && (
        <p>
          Cierra este panel y actualiza la bandeja para revisar la versión
          vigente.
        </p>
      )}
      <fieldset disabled={busy || conflict}>
        <label className="field">
          Estado de revisión
          <select
            aria-label="Estado de revisión"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            {Object.entries(states).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <People
          base={base}
          flow="collections"
          department={row.target_department_id}
          value={assignee}
          onChange={setAssignee}
          current={
            row.assignee_id
              ? { id: row.assignee_id, name: row.assignee_name }
              : undefined
          }
        />
        <button className="button primary" disabled={busy || conflict}>
          {busy ? "Guardando…" : "Guardar revisión"}
        </button>
      </fieldset>
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={onClose}
      >
        Cerrar revisión
      </button>
    </form>
  );
}
