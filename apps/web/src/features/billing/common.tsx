import React, { useEffect, useRef, useState, useId } from "react";
import { HACIENDA_UNITS } from "../../../../../packages/domain/src/hacienda-units";
import { PHARMACEUTICAL_FORMS } from "../../../../../packages/domain/src/pharmaceutical-forms";
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
  enabled = true,
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
    if (!enabled) return;
    setRows([]);
    setNext(null);
    setLoading(true);
    const timer = setTimeout(() => void load(), 300);
    return () => {
      clearTimeout(timer);
      sequence.current++;
    };
  }, [key, revision, enabled]);
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
  phone_country_code: "",
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
  internal_code: "",
  commercial_codes: [],
  cabys: "",
  unit: "",
  commercial_unit: "",
  treatment: "pending",
  tax_code: "01",
  tariff_code: "",
  discount_amount: "0",
  discount_mode: "amount",
  discount_percentage: "0",
  discount_code: "",
  discount_reason: "",
  discount_other: "",
  transaction_type: "",
  vin_numbers: [],
  medicine_registration: "",
  pharmaceutical_form: "",
  other_taxes: [],
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
  const [lookupActivities, setLookupActivities] = useState<Row[]>([]),
    [lookedUpIdentification, setLookedUpIdentification] = useState("");
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
    ["phone_country_code", "Código de país del teléfono", 3],
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
                  setLookupActivities(r.activities ?? []);
                  setLookedUpIdentification(value.identification);
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
          {lookedUpIdentification === value.identification &&
            lookupActivities.length > 0 && (
              <label className="field">
                Actividad consultada en Hacienda
                <select
                  value={value.economic_activity ?? ""}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      economic_activity: event.target.value,
                    })
                  }
                >
                  <option value="">
                    Selecciona una actividad vigente consultada…
                  </option>
                  {lookupActivities.map((activity) => (
                    <option
                      key={activity.code}
                      value={activity.code}
                      disabled={activity.active !== true}
                    >
                      {activity.code} · {activity.description}
                      {activity.active === true
                        ? ""
                        : activity.active === false
                          ? " (inactiva)"
                          : " (vigencia por confirmar)"}
                    </option>
                  ))}
                </select>
                <small>
                  Solo se habilitan las actividades cuya vigencia confirma la
                  consulta. La consulta no proporciona domicilio, correo ni
                  teléfono.
                </small>
              </label>
            )}
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
  documentType = "FE",
  onCabysSelected,
}: {
  value: Row;
  onChange: (v: Row) => void;
  base?: string;
  receiverExoneration?: Row | null;
  documentType?: string;
  onCabysSelected?: (row: Row) => void;
}) {
  const unitListId = useId();
  const [search, setSearch] = useState(""),
    [results, setResults] = useState<Row[]>([]),
    [cabysReference, setCabysReference] = useState<Row | null>(null),
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
          label="Código interno del producto o servicio"
          value={value.internal_code ?? ""}
          onChange={(v) => onChange({ ...value, internal_code: v })}
          maxLength={40}
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
        <label className="field">
          Modalidad de descuento
          <select
            value={value.discount_mode ?? "amount"}
            onChange={(e) =>
              onChange({ ...value, discount_mode: e.target.value })
            }
          >
            <option value="amount">Monto fijo</option>
            <option value="percentage">Porcentaje</option>
          </select>
        </label>
        {value.discount_mode === "percentage" ? (
          <Field
            label="Descuento (porcentaje)"
            value={value.discount_percentage ?? "0"}
            onChange={(v) => onChange({ ...value, discount_percentage: v })}
          />
        ) : (
          <Field
            label="Descuento (importe)"
            value={value.discount_amount}
            onChange={(v) => onChange({ ...value, discount_amount: v })}
          />
        )}
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
          <small>
            Busca por código de 13 dígitos, descripción, palabras clave o nombre
            de categoría. La tarifa del catálogo es una referencia y debe
            revisarse para esta venta.
          </small>
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
                if (resultsContext.current === currentSearchContext.current) {
                  onChange({ ...value, cabys: r.code });
                  onCabysSelected?.(r);
                  setCabysReference(r);
                  setNotice(
                    `CABYS ${r.code} seleccionado.${r.tax_rate !== undefined ? ` Tarifa de referencia: ${r.tax_rate} %. Confirma el tratamiento aplicable.` : " Confirma el tratamiento aplicable."}`,
                  );
                }
              }}
            >
              {r.code} — {r.description}
              {r.tax_rate !== undefined ? ` · Referencia: ${r.tax_rate} %` : ""}
              {r.categories?.length ? ` · ${r.categories.join(" › ")}` : ""}
            </button>
          ))}
          {cabysReference?.code === value.cabys && (
            <p>
              Descripción sugerida: {cabysReference?.description}.
              {cabysReference?.tax_rate !== undefined
                ? ` Tarifa de referencia: ${cabysReference.tax_rate} %.`
                : ""}{" "}
              Confirma el tratamiento tributario de esta venta.
              {cabysReference?.categories?.length
                ? ` Categorías: ${cabysReference.categories.join(" › ")}.`
                : ""}
            </p>
          )}
        </>
      )}
      {value.treatment === "exonerated" && (
        <ExonerationFields
          value={value.exoneration}
          onChange={(v) => onChange({ ...value, exoneration: v })}
        />
      )}
      <details className="billing-disclosure">
        <summary>
          Códigos comerciales y campos especializados (si corresponden)
        </summary>
        <div className="form-grid">
          <Field
            label="Unidad de medida comercial"
            value={value.commercial_unit ?? ""}
            onChange={(v) => onChange({ ...value, commercial_unit: v })}
            maxLength={20}
          />
          {documentType !== "TE" && (
            <label className="field">
              Tipo de transacción
              <select
                value={value.transaction_type ?? ""}
                onChange={(e) =>
                  onChange({ ...value, transaction_type: e.target.value })
                }
              >
                <option value="">No corresponde</option>
                {[
                  ["01", "Venta normal"],
                  ["02", "Mercancía autoconsumo exento"],
                  ["03", "Mercancía autoconsumo gravado"],
                  ["04", "Servicio autoconsumo exento"],
                  ["05", "Servicio autoconsumo gravado"],
                  ["06", "Cuota de afiliación"],
                  ["07", "Cuota de afiliación exenta"],
                  ["08", "Bienes de capital del emisor"],
                  ["09", "Bienes de capital del receptor"],
                  ["10", "Bienes de capital del emisor y receptor"],
                  ["11", "Bienes de capital autoconsumo exento del emisor"],
                  [
                    "12",
                    "Bienes de capital sin contraprestación a terceros exento del emisor",
                  ],
                  ["13", "Sin contraprestación a terceros"],
                ].map(([code, label]) => (
                  <option key={code} value={code}>
                    {code} · {label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {(value.commercial_codes ?? []).map((code: Row, i: number) => (
          <div className="form-grid" key={i}>
            <label className="field">
              Tipo de código comercial {i + 1}
              <select
                value={code.type}
                onChange={(e) =>
                  onChange({
                    ...value,
                    commercial_codes: value.commercial_codes.map(
                      (c: Row, n: number) =>
                        n === i ? { ...c, type: e.target.value } : c,
                    ),
                  })
                }
              >
                <option value="">Selecciona…</option>
                {[
                  ["01", "Vendedor"],
                  ["02", "Comprador"],
                  ["03", "Fabricante o importador"],
                  ["04", "Uso interno"],
                  ["99", "Otros"],
                ].map(([k, label]) => (
                  <option key={k} value={k}>
                    {k} · {label}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label={`Código comercial ${i + 1}`}
              value={code.code}
              maxLength={20}
              onChange={(v) =>
                onChange({
                  ...value,
                  commercial_codes: value.commercial_codes.map(
                    (c: Row, n: number) => (n === i ? { ...c, code: v } : c),
                  ),
                })
              }
            />
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                onChange({
                  ...value,
                  commercial_codes: value.commercial_codes.filter(
                    (_: Row, n: number) => n !== i,
                  ),
                })
              }
            >
              Quitar código comercial {i + 1}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button secondary"
          disabled={(value.commercial_codes?.length ?? 0) >= 5}
          onClick={() =>
            onChange({
              ...value,
              commercial_codes: [
                ...(value.commercial_codes ?? []),
                { type: "", code: "" },
              ],
            })
          }
        >
          Agregar código comercial
        </button>
        <details>
          <summary>
            Vehículos, aeronaves o embarcaciones con VIN o serie
          </summary>
          <p>Completa esta numeración solo para los bienes que la requieren.</p>
          {(value.vin_numbers ?? []).map((vin: string, i: number) => (
            <div className="billing-actions" key={i}>
              <Field
                label={`VIN o serie ${i + 1}`}
                value={vin}
                maxLength={17}
                onChange={(v) =>
                  onChange({
                    ...value,
                    vin_numbers: value.vin_numbers.map(
                      (s: string, n: number) => (n === i ? v : s),
                    ),
                  })
                }
              />
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  onChange({
                    ...value,
                    vin_numbers: value.vin_numbers.filter(
                      (_: string, n: number) => n !== i,
                    ),
                  })
                }
              >
                Quitar VIN o serie {i + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            disabled={(value.vin_numbers?.length ?? 0) >= 1000}
            onClick={() =>
              onChange({
                ...value,
                vin_numbers: [...(value.vin_numbers ?? []), ""],
              })
            }
          >
            Agregar VIN o serie
          </button>
        </details>
        <details>
          <summary>Medicamentos con registro sanitario</summary>
          <div className="form-grid">
            <Field
              label="Registro sanitario del medicamento"
              value={value.medicine_registration ?? ""}
              maxLength={100}
              onChange={(v) => onChange({ ...value, medicine_registration: v })}
            />
            <label className="field">
              Código oficial de forma farmacéutica
              <select
                value={value.pharmaceutical_form ?? ""}
                onChange={(e) =>
                  onChange({ ...value, pharmaceutical_form: e.target.value })
                }
              >
                <option value="">Selecciona cuando corresponda…</option>
                {PHARMACEUTICAL_FORMS.map((form) => (
                  <option key={form.code} value={form.code}>
                    {form.code} · {form.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p>
            Catálogo oficial de formas farmacéuticas de Hacienda. Confirma por
            separado la clasificación CABYS y el registro sanitario del
            medicamento.
          </p>
        </details>
      </details>
      <details className="billing-disclosure">
        <summary>Otros impuestos de la línea (si corresponden)</summary>
        <p>
          El impuesto al cemento (12) tiene cálculo verificado al 5 %. Los demás
          regímenes requieren revisión de su base y regla específica antes de
          emitir.
        </p>
        {(value.other_taxes ?? []).map((tax: Row, i: number) => (
          <div className="form-grid" key={i}>
            <label className="field">
              Otro impuesto {i + 1}
              <select
                value={tax.code}
                onChange={(e) =>
                  onChange({
                    ...value,
                    other_taxes: value.other_taxes.map((t: Row, n: number) =>
                      n === i
                        ? {
                            ...t,
                            code: e.target.value,
                            rate: e.target.value === "12" ? "5" : t.rate,
                          }
                        : t,
                    ),
                  })
                }
              >
                <option value="12">12 · Impuesto al cemento (5 %)</option>
                {tax.code !== "12" && (
                  <option value={tax.code}>
                    {tax.code} · Requiere revisión tributaria
                  </option>
                )}
              </select>
            </label>
            <label className="field">
              Tarifa de otro impuesto {i + 1}
              <input readOnly value={tax.rate ?? "5"} />
            </label>
            {tax.code === "99" && (
              <Field
                label={`Descripción de otro impuesto ${i + 1}`}
                value={tax.other_description ?? ""}
                maxLength={100}
                onChange={(v) =>
                  onChange({
                    ...value,
                    other_taxes: value.other_taxes.map((t: Row, n: number) =>
                      n === i ? { ...t, other_description: v } : t,
                    ),
                  })
                }
              />
            )}
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                onChange({
                  ...value,
                  other_taxes: value.other_taxes.filter(
                    (_: Row, n: number) => n !== i,
                  ),
                })
              }
            >
              Quitar otro impuesto {i + 1}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button secondary"
          disabled={(value.other_taxes?.length ?? 0) >= 10}
          onClick={() =>
            onChange({
              ...value,
              other_taxes: [
                ...(value.other_taxes ?? []),
                { code: "12", rate: "5", other_description: "" },
              ],
            })
          }
        >
          Agregar impuesto al cemento
        </button>
      </details>
    </div>
  );
}
