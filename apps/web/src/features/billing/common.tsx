import React, { useEffect, useRef, useState, useId } from "react";
import { HACIENDA_UNITS } from "../../../../../packages/domain/src/hacienda-units";
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
  list,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  maxLength?: number;
  list?: string;
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
        list={list}
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

export const receiverDefaults = () => ({
  domicile: "unspecified",
  foreign_address: "",
  requires_activity: false,
  requires_email: false,
  name: "",
  identification_type: "",
  identification: "",
  email: "",
  phone: "",
  address: "",
  trade_name: "",
  economic_activity: "",
  province: "",
  canton: "",
  district: "",
  neighborhood: "",
  exoneration: null,
});
export const fiscalDefaults = () => ({
  cabys: "",
  unit: "",
  commercial_unit: "",
  treatment: "pending",
  tax_code: "01",
  tariff_code: "",
  discount_amount: "0",
  discount_code: "",
  discount_reason: "",
  discount_other: "",
  exoneration: null,
});
export function ExonerationFields({
  value,
  onChange,
}: {
  value: Row | null;
  onChange: (v: Row | null) => void;
}) {
  return (
    <div className="billing-line">
      <label className="billing-check">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? {
                    document_other: "",
                    institution_other: "",
                    document_type: "",
                    document_number: "",
                    institution: "",
                    issue_date: "",
                    article: "",
                    inciso: "",
                    rate: "0",
                  }
                : null,
            )
          }
        />
        Registrar exoneración
      </label>
      {value && (
        <div className="form-grid">
          <label className="field">
            Tipo de documento de exoneración
            <select
              value={value.document_type}
              onChange={(e) =>
                onChange({ ...value, document_type: e.target.value })
              }
            >
              <option value="">Selecciona…</option>
              {[
                "01",
                "02",
                "03",
                "04",
                "05",
                "06",
                "07",
                "08",
                "09",
                "10",
                "11",
                "99",
              ].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          {value.document_type === "99" && (
            <Field
              label="Otro documento de exoneración"
              value={value.document_other ?? ""}
              onChange={(v) => onChange({ ...value, document_other: v })}
            />
          )}
          <label className="field">
            Institución de exoneración
            <select
              value={value.institution}
              onChange={(e) =>
                onChange({ ...value, institution: e.target.value })
              }
            >
              <option value="">Selecciona…</option>
              {[
                ["01", "Hacienda"],
                ["02", "Relaciones Exteriores"],
                ["03", "MAG"],
                ["04", "MEIC"],
                ["05", "Cruz Roja"],
                ["06", "Bomberos"],
                ["07", "Obras del Espíritu Santo"],
                ["08", "Fecrunapa"],
                ["09", "EARTH"],
                ["10", "INCAE"],
                ["11", "JPS"],
                ["12", "ARESEP"],
                ["99", "Otros"],
              ].map(([k, l]) => (
                <option key={k} value={k}>
                  {k} — {l}
                </option>
              ))}
            </select>
          </label>
          {value.institution === "99" && (
            <Field
              label="Otra institución"
              value={value.institution_other ?? ""}
              onChange={(v) => onChange({ ...value, institution_other: v })}
            />
          )}
          {Object.entries({
            document_number: "Número de documento de exoneración",
            issue_date: "Fecha de emisión de exoneración",
            article: "Artículo",
            inciso: "Inciso",
            rate: "Puntos porcentuales exonerados",
          }).map(([key, label]) => (
            <Field
              key={key}
              label={label}
              value={value[key] ?? ""}
              onChange={(v) => onChange({ ...value, [key]: v })}
              maxLength={
                key === "institution"
                  ? 160
                  : key === "document_number"
                    ? 40
                    : key === "issue_date"
                      ? 35
                      : 10
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
export function ReceiverFields({
  value,
  onChange,
  base,
  customerLabels = false,
}: {
  value: Row;
  onChange: (v: Row) => void;
  base?: string;
  customerLabels?: boolean;
}) {
  const [lookupNotice, setLookupNotice] = useState("");
  const lookupAlive = useAlive(),
    lookupSequence = useRef(0);
  const lookupContext = JSON.stringify([base, value]);
  const currentLookupContext = useRef(lookupContext);
  currentLookupContext.current = lookupContext;
  useEffect(() => {
    setLookupNotice("");
    lookupSequence.current++;
  }, [lookupContext]);
  const [locations, setLocations] = useState<Row[]>([]);
  useEffect(() => {
    let live = true;
    if (base)
      void apiRequest(base + "/locations")
        .then((r) => {
          if (live) setLocations(r.provinces ?? []);
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [base]);
  const province = locations.find((r) => r.code === value.province),
    canton = province?.cantons?.find((r: Row) => r.code === value.canton);

  const fields: [string, string, number][] = [
    [
      "name",
      customerLabels ? "Nombre del cliente" : "Nombre del receptor",
      160,
    ],
    ["identification_type", "Tipo de identificación tributaria", 40],
    ["identification", "Identificación tributaria", 40],
    [
      "email",
      customerLabels ? "Correo del cliente" : "Correo del receptor",
      customerLabels ? 254 : 160,
    ],
    [
      "phone",
      customerLabels ? "Teléfono del cliente" : "Teléfono del receptor",
      40,
    ],
    [
      "address",
      customerLabels ? "Dirección del cliente" : "Dirección del receptor",
      1000,
    ],
    ["trade_name", "Nombre comercial del receptor", 80],
    ["economic_activity", "Actividad económica del receptor", 6],
    ["province", "Provincia (código)", 1],
    ["canton", "Cantón (código)", 2],
    ["district", "Distrito (código)", 2],
    ["neighborhood", "Barrio", 50],
  ];
  return (
    <>
      <div className="form-grid">
        <label className="field">
          Domicilio del receptor
          <select
            value={value.domicile ?? "unspecified"}
            onChange={(e) => onChange({ ...value, domicile: e.target.value })}
          >
            <option value="unspecified">Por confirmar</option>
            <option value="domestic">Costa Rica</option>
            <option value="foreign">Extranjero</option>
          </select>
        </label>
        {value.domicile === "foreign" && (
          <Field
            label="Dirección en el extranjero"
            value={value.foreign_address ?? ""}
            onChange={(v) => onChange({ ...value, foreign_address: v })}
            maxLength={300}
          />
        )}
        {[
          [
            "requires_activity",
            "Requiere actividad para crédito/gasto deducible",
          ],
          ["requires_email", "Solicita envío por correo"],
        ].map(([k, label]) => (
          <label key={k} className="billing-check">
            <input
              type="checkbox"
              checked={Boolean(value[k])}
              onChange={(e) => onChange({ ...value, [k]: e.target.checked })}
            />
            {label}
          </label>
        ))}
        {locations.length > 0 && (
          <>
            {[
              ["province", "Provincia", locations],
              ["canton", "Cantón", province?.cantons ?? []],
              ["district", "Distrito", canton?.districts ?? []],
            ].map(([key, label, rows]: any) => (
              <label key={key} className="field">
                {label}
                <select
                  value={value[key] ?? ""}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      [key]: e.target.value,
                      ...(key === "province"
                        ? { canton: "", district: "" }
                        : key === "canton"
                          ? { district: "" }
                          : {}),
                    })
                  }
                >
                  <option value="">Por confirmar</option>
                  {rows.map((r: Row) => (
                    <option key={r.code} value={r.code}>
                      {r.code} — {r.name}
                    </option>
                  ))}
                  {value[key] &&
                    !rows.some((r: Row) => r.code === value[key]) && (
                      <option value={value[key]}>{value[key]} (revisar)</option>
                    )}
                </select>
              </label>
            ))}
          </>
        )}
        {fields
          .filter(
            ([key]) =>
              !locations.length ||
              !["province", "canton", "district"].includes(key),
          )
          .map(([key, label, max]) =>
            key === "identification_type" ? (
              <label className="field" key={key}>
                {label}
                <select
                  value={value[key] ?? ""}
                  onChange={(e) =>
                    onChange({ ...value, [key]: e.target.value })
                  }
                >
                  <option value="">Por confirmar</option>
                  {[
                    ["01", "Física"],
                    ["02", "Jurídica"],
                    ["03", "DIMEX"],
                    ["04", "NITE"],
                    ["05", "Extranjero"],
                    ["06", "No contribuyente"],
                  ].map(([k, l]) => (
                    <option key={k} value={k}>
                      {k} — {l}
                    </option>
                  ))}
                  {value[key] &&
                    !["01", "02", "03", "04", "05", "06"].includes(
                      value[key],
                    ) && <option>{value[key]}</option>}
                </select>
              </label>
            ) : (
              <Field
                key={key}
                label={label}
                value={value[key] ?? ""}
                onChange={(v) => onChange({ ...value, [key]: v })}
                maxLength={max}
                required={customerLabels && key === "name"}
                type={key === "email" ? "email" : "text"}
              />
            ),
          )}
      </div>
      {base && (
        <>
          <button
            type="button"
            className="button secondary"
            onClick={async () => {
              const request = ++lookupSequence.current,
                context = lookupContext;
              const current = () =>
                lookupAlive.current &&
                lookupSequence.current === request &&
                currentLookupContext.current === context;
              try {
                const r = await apiRequest(
                  base +
                    "/recipient-lookup?identification=" +
                    encodeURIComponent(value.identification ?? ""),
                );
                if (!current()) return;
                if (r.available && r.recipient) {
                  onChange({ ...value, ...r.recipient });
                  setLookupNotice(
                    "Datos consultados en Hacienda. Revisa el receptor antes de guardar.",
                  );
                } else
                  setLookupNotice(
                    "Consulta no disponible. Puedes completar los datos manualmente.",
                  );
              } catch {
                if (!current()) return;
                setLookupNotice(
                  "Consulta no disponible. Puedes completar los datos manualmente.",
                );
              }
            }}
          >
            Consultar identificación en Hacienda
          </button>
          {lookupNotice && <p role="status">{lookupNotice}</p>}
        </>
      )}
      <ExonerationFields
        value={value.exoneration ?? null}
        onChange={(v) => onChange({ ...value, exoneration: v })}
      />
    </>
  );
}
export function FiscalFields({
  value,
  onChange,
  base,
  receiverExoneration,
}: {
  value: Row;
  onChange: (v: Row) => void;
  base?: string;
  receiverExoneration?: Row | null;
}) {
  const unitListId = useId();
  const [search, setSearch] = useState(""),
    [results, setResults] = useState<Row[]>([]),
    [notice, setNotice] = useState("");
  const searchAlive = useAlive(),
    searchSequence = useRef(0),
    resultsContext = useRef("");
  const searchContext = JSON.stringify([base, value, search]);
  const currentSearchContext = useRef(searchContext);
  currentSearchContext.current = searchContext;
  useEffect(() => {
    searchSequence.current++;
    setResults([]);
    setNotice("");
    resultsContext.current = "";
  }, [searchContext]);
  return (
    <div className="billing-line">
      <h4>Datos fiscales de la línea</h4>
      <div className="form-grid">
        <label className="field">
          Tipo de impuesto
          <select value="01" disabled aria-label="Tipo de impuesto de la línea">
            <option value="01">01 — Impuesto al valor agregado (IVA)</option>
          </select>
        </label>
        <Field
          label="CABYS"
          value={value.cabys}
          maxLength={13}
          onChange={(v) => onChange({ ...value, cabys: v })}
        />
        <Field
          label="Unidad de medida"
          list={unitListId}
          value={value.unit}
          maxLength={15}
          onChange={(v) => onChange({ ...value, unit: v })}
        />
        <datalist id={unitListId}>
          {HACIENDA_UNITS.map((unit) => (
            <option key={unit.code} value={unit.code}>
              {unit.description}
            </option>
          ))}
        </datalist>
        {value.unit === "Otros" && (
          <Field
            label="Unidad comercial"
            value={value.commercial_unit ?? ""}
            onChange={(v) => onChange({ ...value, commercial_unit: v })}
            maxLength={20}
          />
        )}

        <label className="field">
          Tratamiento tributario
          <select
            value={value.treatment}
            onChange={(e) =>
              onChange({
                ...value,
                treatment: e.target.value,
                exoneration:
                  e.target.value === "exonerated"
                    ? (value.exoneration ?? receiverExoneration ?? null)
                    : null,
              })
            }
          >
            <option value="pending">Pendiente de definir</option>
            <option value="taxable">Gravado</option>
            <option value="exempt">Exento</option>
            <option value="exonerated">Exonerado</option>
            <option value="non_subject">No sujeto</option>
          </select>
        </label>
        <label className="field">
          Tarifa de IVA
          <select
            value={value.tariff_code}
            onChange={(e) =>
              onChange({ ...value, tariff_code: e.target.value })
            }
          >
            <option value="">Selecciona explícitamente…</option>
            {[
              ["01", "0 %"],
              ["02", "1 %"],
              ["03", "2 %"],
              ["04", "4 %"],
              ["08", "13 %"],
              ["09", "0,5 %"],
              ["10", "Exento"],
              ["11", "No sujeto"],
            ].map(([k, l]) => (
              <option key={k} value={k}>
                {k} — {l}
              </option>
            ))}
          </select>
        </label>
        <Field
          label="Descuento (importe)"
          value={value.discount_amount}
          onChange={(v) => onChange({ ...value, discount_amount: v })}
        />
        <label className="field">
          Código de descuento
          <select
            value={value.discount_code}
            onChange={(e) =>
              onChange({ ...value, discount_code: e.target.value })
            }
          >
            <option value="">Sin definir</option>
            {[
              ["04", "Volumen"],
              ["05", "Temporada"],
              ["06", "Promocional"],
              ["07", "Comercial"],
              ["08", "Frecuencia"],
              ["09", "Sostenido"],
              ["99", "Otros"],
            ].map(([k, l]) => (
              <option key={k} value={k}>
                {k} — {l}
              </option>
            ))}
            {["01", "02", "03"].includes(value.discount_code) && (
              <option value={value.discount_code}>
                {value.discount_code} — Reglas especiales no disponibles
              </option>
            )}
          </select>
        </label>
        {value.discount_code === "99" && (
          <Field
            label="Otro descuento"
            value={value.discount_other ?? ""}
            onChange={(v) => onChange({ ...value, discount_other: v })}
          />
        )}
        <Field
          label="Motivo de descuento"
          value={value.discount_reason}
          maxLength={80}
          onChange={(v) => onChange({ ...value, discount_reason: v })}
        />
      </div>
      {base && (
        <>
          <Field
            label="Buscar CABYS oficial"
            value={search}
            onChange={setSearch}
          />
          <button
            type="button"
            className="button secondary"
            onClick={async () => {
              const request = ++searchSequence.current,
                context = searchContext;
              const current = () =>
                searchAlive.current &&
                searchSequence.current === request &&
                currentSearchContext.current === context;
              try {
                const r = await apiRequest(
                  base + "/cabys?search=" + encodeURIComponent(search),
                );
                if (!current()) return;
                resultsContext.current = context;
                setResults(r.items ?? []);
                setNotice(
                  r.available
                    ? "Resultados de Hacienda; confirma la clasificación y tarifa."
                    : "Catálogo no disponible. Ingresa el CABYS manualmente.",
                );
              } catch {
                if (!current()) return;
                setNotice(
                  "Catálogo no disponible. Ingresa el CABYS manualmente.",
                );
              }
            }}
          >
            Consultar CABYS
          </button>
          <p>{notice}</p>
          {results.map((r) => (
            <button
              type="button"
              className="button secondary"
              key={r.code}
              onClick={() => {
                if (resultsContext.current === currentSearchContext.current)
                  onChange({ ...value, cabys: r.code });
              }}
            >
              {r.code} — {r.description}
            </button>
          ))}
        </>
      )}
      {value.treatment === "exonerated" && (
        <ExonerationFields
          value={value.exoneration}
          onChange={(v) => onChange({ ...value, exoneration: v })}
        />
      )}
    </div>
  );
}
