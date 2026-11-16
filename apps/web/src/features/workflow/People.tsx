import React from "react";
import { Field, type Row } from "../billing/common";
import { usePaged } from "./usePaged";
export function People({
  base,
  flow,
  department,
  value,
  onChange,
  current,
}: {
  base: string;
  flow: string;
  department: string;
  value: string;
  onChange: (id: string) => void;
  current?: Row;
}) {
  const list = usePaged(
    department ? base + "/document-routes/eligible-assignees" : null,
    { flow, department_id: department },
  );
  return (
    <div className="billing-lookup">
      <Field
        label="Buscar responsable"
        value={list.search}
        onChange={list.setSearch}
        maxLength={100}
      />
      <label className="field">
        Responsable
        <select
          aria-label="Responsable"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Sin responsable</option>
          {value && current && !list.rows.some((r) => r.id === value) && (
            <option value={value}>
              {current.name ?? "Responsable actual"}
            </option>
          )}
          {list.rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {list.loading && <small>Cargando responsables…</small>}
      {list.error && <p role="alert">{list.error}</p>}
      {list.next !== null && (
        <button
          type="button"
          className="button secondary"
          disabled={list.loading}
          onClick={() => void list.loadMore()}
        >
          Más responsables
        </button>
      )}
    </div>
  );
}
