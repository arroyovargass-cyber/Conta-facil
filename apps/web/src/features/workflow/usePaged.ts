import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../../api/client";
import { useAlive, type Row } from "../billing/common";
export function usePaged(path: string | null, filters: Record<string, string>) {
  const alive = useAlive(),
    sequence = useRef(0),
    context = useRef("");
  const [rows, setRows] = useState<Row[]>([]),
    [summary, setSummary] = useState<Row | null>(null),
    [next, setNext] = useState<number | null>(null),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const fixed = JSON.stringify(filters),
    key = path + "|" + fixed + "|" + search;
  context.current = key;
  async function load(more = false) {
    if (!path) return;
    const token = ++sequence.current,
      captured = key;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ ...JSON.parse(fixed), search });
      if (more && next !== null) query.set("cursor", String(next));
      const data = await apiRequest(path + "?" + query);
      if (
        alive.current &&
        token === sequence.current &&
        context.current === captured
      ) {
        setRows((old) => (more ? [...old, ...data.items] : data.items));
        setNext(data.nextCursor);
        setSummary(data.summary ?? null);
      }
    } catch (e: any) {
      if (
        alive.current &&
        token === sequence.current &&
        context.current === captured
      )
        setError(e.message);
    } finally {
      if (
        alive.current &&
        token === sequence.current &&
        context.current === captured
      )
        setLoading(false);
    }
  }
  useEffect(() => {
    sequence.current++;
    setRows([]);
    setNext(null);
    setSummary(null);
    setError("");
    if (!path) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => void load(), 150);
    return () => {
      clearTimeout(timer);
      sequence.current++;
    };
  }, [key, revision]);
  return {
    rows,
    summary,
    next,
    search,
    setSearch,
    loading,
    error,
    loadMore: () => load(true),
    refresh: () => setRevision((n) => n + 1),
  };
}
