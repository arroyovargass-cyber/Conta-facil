import React, { useEffect, useRef, useState } from "react";
import { apiRequest } from "../../api/client";
export type Row = Record<string, any>;
export function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}
export function Field({
  label,
  value,
  onChange,
  required = false,
  type = "text",
  maxLength = 160,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  maxLength?: number;
}) {
  return (
    <label className="field">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        type={type}
        maxLength={maxLength}
      />
    </label>
  );
}
export function useListing(
  base: string,
  filterName: string,
  initialFilter = "all",
) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState(initialFilter),
    [rows, setRows] = useState<Row[]>([]),
    [next, setNext] = useState<number | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const sequence = useRef(0),
    alive = useAlive(),
    context = useRef("");
  const key = base + "|" + search + "|" + filter;
  context.current = key;
  async function load(append = false) {
    const token = ++sequence.current,
      captured = key;
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams({ search });
      if (filter !== "all") q.set(filterName, filter);
      if (append && next !== null) q.set("cursor", String(next));
      const data = await apiRequest(base + "?" + q);
      if (
        !alive.current ||
        sequence.current !== token ||
        context.current !== captured
      )
        return;
      setRows((prev) => (append ? [...prev, ...data.items] : data.items));
      setNext(data.nextCursor);
    } catch (e: any) {
      if (
        alive.current &&
        sequence.current === token &&
        context.current === captured
      )
        setError(e.message);
    } finally {
      if (
        alive.current &&
        sequence.current === token &&
        context.current === captured
      )
        setLoading(false);
    }
  }
  useEffect(() => {
    setRows([]);
    setNext(null);
    setLoading(true);
    const timer = setTimeout(() => void load(), 300);
    return () => {
      clearTimeout(timer);
      sequence.current++;
    };
  }, [key, revision]);
  return {
    search,
    setSearch,
    filter,
    setFilter,
    rows,
    next,
    loading,
    error,
    loadMore: () => load(true),
    refresh: () => setRevision((v) => v + 1),
  };
}
export function Lookup({
  base,
  label,
  value,
  onChange,
  current,
  compatible,
}: {
  base: string;
  label: string;
  value: string;
  onChange: (id: string, row?: Row) => void;
  current?: { id: string; name: string };
  compatible?: (r: Row) => boolean;
}) {
  const list = useListing(base, "active", "true");
  const rows = list.rows.filter((r) => !compatible || compatible(r));
  return (
    <div className="billing-lookup">
      <Field
        label={"Buscar " + label.toLowerCase()}
        value={list.search}
        onChange={list.setSearch}
        maxLength={100}
      />
      <label className="field">
        {label}
        <select
          aria-label={label}
          value={value}
          onChange={(e) =>
            onChange(
              e.target.value,
              rows.find((r) => r.id === e.target.value),
            )
          }
        >
          <option value="">Selecciona…</option>
          {current && !rows.some((r) => r.id === current.id) && (
            <option value={current.id}>{current.name}</option>
          )}
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name ?? r.description}
            </option>
          ))}
        </select>
      </label>
      {list.loading && <small>Cargando opciones…</small>}
      {list.error && <span role="alert">{list.error}</span>}
      {list.next !== null && (
        <button
          type="button"
          className="button secondary"
          disabled={list.loading}
          onClick={() => void list.loadMore()}
        >
          Más opciones de {label.toLowerCase()}
        </button>
      )}
    </div>
  );
}
