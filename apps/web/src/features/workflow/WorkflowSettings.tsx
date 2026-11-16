import React, { useEffect, useRef, useState } from "react";
import { apiRequest, post } from "../../api/client";
import { Lookup, useAlive, type Row } from "../billing/common";
import { People } from "./People";
const names: Record<string, string> = {
  collections: "Cuentas por cobrar",
  payables: "Cuentas por pagar",
};
export function WorkflowSettings({ base }: { base: string }) {
  const alive = useAlive(),
    sequence = useRef(0),
    [rows, setRows] = useState<Row[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function load() {
    const token = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const r = await apiRequest(base + "/document-routes");
      if (alive.current && sequence.current === token) setRows(r.items);
    } catch (e: any) {
      if (alive.current && sequence.current === token) setError(e.message);
    } finally {
      if (alive.current && sequence.current === token) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      sequence.current++;
    };
  }, [base]);
  async function setup() {
    if (busy) return;
    const token = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const r = await post(base + "/document-routes/setup", {});
      if (alive.current && sequence.current === token) {
        setRows(r.items);
        setNotice(
          "Departamentos y destinos preparados. Los accesos de usuarios se mantienen según sus permisos.",
        );
      }
    } catch (e: any) {
      if (alive.current && sequence.current === token) setError(e.message);
    } finally {
      if (alive.current && sequence.current === token) setBusy(false);
    }
  }
  return (
    <section className="billing-editor">
      <h3>Departamentos y destinos documentales</h3>
      <p>
        Elige los departamentos que recibirán las revisiones. Cada usuario
        necesita autorización para el destino.
      </p>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <div className="billing-actions">
        <button
          className="button secondary"
          type="button"
          disabled={busy || loading}
          onClick={() => void setup()}
        >
          Crear departamentos predeterminados
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={busy || loading}
          onClick={() => void load()}
        >
          Recargar configuración
        </button>
      </div>
      {loading ? (
        <p>Cargando destinos…</p>
      ) : (
        <div className="workflow-grid">
          {Object.keys(names).map((flow) => {
            const row = rows.find((r) => r.flow === flow) ?? {
              flow,
              version: 0,
              target_department_id: "",
              assignee_id: null,
              enabled: false,
            };
            return (
              <RouteForm
                key={flow + ":" + row.version}
                base={base}
                row={row}
                onSaved={(items) => {
                  setRows(items);
                  setNotice(
                    "Destino guardado. Las tareas anteriores conservan su departamento.",
                  );
                }}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
function RouteForm({
  base,
  row,
  onSaved,
}: {
  base: string;
  row: Row;
  onSaved: (items: Row[]) => void;
}) {
  const alive = useAlive(),
    [department, setDepartment] = useState(row.target_department_id ?? ""),
    [assignee, setAssignee] = useState(row.assignee_id ?? ""),
    [enabled, setEnabled] = useState(!!row.enabled),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !department) return;
    setBusy(true);
    setError("");
    try {
      const response = await post(
        base + "/document-routes",
        {
          flow: row.flow,
          expected_version: row.version,
          target_department_id: department,
          assignee_id: assignee || null,
          enabled,
        },
        "PATCH",
      );
      if (alive.current) onSaved(response.items);
    } catch (e: any) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="workflow-route">
      <h4>{names[row.flow]}</h4>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {row.requires_reassignment && (
        <p className="notice">El responsable requiere reasignación.</p>
      )}
      <fieldset disabled={busy}>
        <Lookup
          base={base + "/departments"}
          label={"Destino de " + names[row.flow]}
          value={department}
          current={
            row.target_department_id
              ? { id: row.target_department_id, name: row.department_name }
              : undefined
          }
          onChange={(id) => {
            setDepartment(id);
            setAssignee("");
          }}
        />
        <People
          base={base}
          flow={row.flow}
          department={department}
          value={assignee}
          onChange={setAssignee}
          current={
            row.assignee_id
              ? { id: row.assignee_id, name: row.assignee_name }
              : undefined
          }
        />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Destino habilitado
        </label>
        <button className="button primary" disabled={busy || !department}>
          {busy ? "Guardando…" : "Guardar destino de " + names[row.flow]}
        </button>
      </fieldset>
    </form>
  );
}
