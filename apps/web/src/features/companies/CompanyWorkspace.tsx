import React, { useEffect, useRef, useState } from "react";
import { apiRequest, post } from "../../api/client";
import {
  companyInput,
  companyPreparation,
  documentTypes,
  initialBillingLocation,
  type CompanyInput,
} from "../../../../../packages/domain/src/company";
import { CredentialForm } from "../hacienda/CredentialForm";
import { useAlive } from "../billing/common";
import "./company.css";
import {
  companyFormSubmission,
  companyValidationMessage,
  companyValidationTab,
  companyApiErrorTab,
} from "./company-form";
type Row = Record<string, any>;
const tabs = [
  "Información general",
  "Domicilio fiscal",
  "Información tributaria",
  "Facturación electrónica",
  "Configuración contable",
  "Usuarios y permisos",
];
const types = [
  ["01", "Cédula física"],
  ["02", "Cédula jurídica"],
  ["03", "DIMEX"],
  ["04", "NITE"],
];
const docs: Record<string, string> = {
  FE: "Factura electrónica",
  TE: "Tiquete electrónico",
  NC: "Nota de crédito",
  ND: "Nota de débito",
  FEC: "Factura de compra",
  FEE: "Factura de exportación",
  REP: "Recibo electrónico de pago",
};
const keys = [
  "legal_name",
  "trade_name",
  "person_type",
  "identification_type",
  "identification",
  "contact_email",
  "phone",
  "address",
  "active",
  "configuration",
  "activities",
];
function fromRow(row: Row) {
  return companyInput.parse(
    Object.fromEntries(
      keys.filter((k) => row[k] !== undefined).map((k) => [k, row[k]]),
    ),
  );
}
const blank = () =>
  companyInput.parse({
    legal_name: "Pendiente",
    person_type: "unspecified",
    identification_type: "01",
    identification: "000000000",
  });
export function CompanyWorkspace({
  tenantId,
  company,
  onSaved,
  onUsers,
  onCancel,
}: {
  tenantId: string;
  company: Row;
  onSaved: (id: string) => Promise<void>;
  onUsers: () => void;
  onCancel?: () => void;
}) {
  const alive = useAlive(),
    generation = useRef(0),
    credentialContext = useRef(""),
    submitLock = useRef(false),
    operation = useRef(crypto.randomUUID()),
    persistedActivityCount = useRef(company.activities?.length ?? 0);
  const [canManage, setCanManage] = useState(false),
    [ready, setReady] = useState(false),
    [detailReady, setDetailReady] = useState(false),
    [items, setItems] = useState<Row[]>([]),
    [value, setValue] = useState<CompanyInput>(() => fromRow(company)),
    [id, setId] = useState(tenantId),
    [version, setVersion] = useState(1),
    [tab, setTab] = useState(0),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [locations, setLocations] = useState<Row | null>(null),
    [lookup, setLookup] = useState<Row | null>(null),
    [activitySearch, setActivitySearch] = useState(""),
    [credentials, setCredentials] = useState<Row | null>(null),
    [credentialsContext, setCredentialsContext] = useState(""),
    [sequences, setSequences] = useState<Row[]>([]);
  const fiscalEnvironment = value.configuration.billing.environment;
  const currentCredentialContext = id + ":" + fiscalEnvironment;
  credentialContext.current = currentCredentialContext;
  useEffect(() => {
    let current = true;
    const seq = ++generation.current;
    void apiRequest("/company-administration")
      .then(async (r) => {
        if (!current || !alive.current || seq !== generation.current) return;
        setCanManage(r.canManage);
        setItems(r.items);
        if (r.canManage) {
          if (tenantId) {
            const result = await apiRequest(
              "/company-administration/" + tenantId,
            );
            if (!current || seq !== generation.current) return;
            const saved = fromRow(result.item);
            persistedActivityCount.current = saved.activities.length;
            setValue(saved);
            setVersion(result.item.configuration_version);
            setSequences(result.sequences);
          } else {
            const next = blank();
            next.legal_name = "";
            next.identification = "";
            setValue(next);
            setEditing(true);
          }
          setDetailReady(true);
          void apiRequest("/company-administration/locations")
            .then((l) => {
              if (current && seq === generation.current) setLocations(l);
            })
            .catch(() => {});
        }
        if (current) setReady(true);
      })
      .catch((e) => {
        if (current) {
          setError(e.message);
          setReady(true);
        }
      });
    return () => {
      current = false;
      generation.current++;
    };
  }, [tenantId]);
  useEffect(() => {
    const controller = new AbortController();
    const context = currentCredentialContext;
    setCredentials(null);
    setCredentialsContext("");
    if (tab === 3 && id && canManage && value.active)
      void apiRequest(
        "/companies/" + id + "/hacienda?environment=" + fiscalEnvironment,
        { signal: controller.signal },
      )
        .then((r) => {
          if (
            alive.current &&
            !controller.signal.aborted &&
            credentialContext.current === context
          ) {
            setCredentials(r);
            setCredentialsContext(context);
          }
        })
        .catch((e) => {
          if (
            alive.current &&
            !controller.signal.aborted &&
            credentialContext.current === context
          )
            setNotice(e.message);
        });
    return () => controller.abort();
  }, [tab, id, fiscalEnvironment, canManage, value.active]);
  function change(path: string, next: any) {
    setValue((old) => {
      const copy = structuredClone(old) as any;
      const parts = path.split(".");
      let target = copy;
      for (const p of parts.slice(0, -1)) target = target[p];
      target[parts.at(-1)!] = next;
      return copy;
    });
    setError("");
    setLookup(null);
  }
  const get = (path: string) =>
    path.split(".").reduce((o, k) => o?.[k], value as any);
  const field = (
    label: string,
    path: string,
    type = "text",
    required = false,
  ) => (
    <label className="field" key={path}>
      {label}
      {required ? " *" : ""}
      <input
        type={type}
        value={get(path) ?? ""}
        disabled={!editing || busy}
        onChange={(e) => change(path, e.target.value)}
        maxLength={type === "email" ? 254 : 1000}
      />
    </label>
  );
  const select = (
    label: string,
    path: string,
    options: string[][],
    required = false,
  ) => (
    <label className="field" key={path}>
      {label}
      {required ? " *" : ""}
      <select
        aria-label={label + (required ? " *" : "")}
        value={String(get(path))}
        disabled={!editing || busy}
        onChange={(e) =>
          change(
            path,
            path === "active" ? e.target.value === "true" : e.target.value,
          )
        }
      >
        {options.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );
  const checkbox = (label: string, path: string) => (
    <label className="company-check" key={path}>
      <input
        type="checkbox"
        checked={!!get(path)}
        disabled={!editing || busy}
        onChange={(e) => change(path, e.target.checked)}
      />
      {label}
    </label>
  );
  function apply(row: Row, seqs: Row[] = []) {
    setDetailReady(true);
    const saved = fromRow(row);
    persistedActivityCount.current = saved.activities.length;
    setValue(saved);
    setId(row.id);
    setVersion(row.configuration_version);
    setSequences(seqs);
    setEditing(false);
    setLookup(null);
  }
  function newCompany() {
    setDetailReady(true);
    generation.current++;
    operation.current = crypto.randomUUID();
    persistedActivityCount.current = 0;
    const next = blank();
    next.configuration.billing = {
      ...next.configuration.billing,
      ...initialBillingLocation,
    };
    next.legal_name = "";
    next.identification = "";
    setValue(next);
    setId("");
    setVersion(1);
    setSequences([]);
    setTab(0);
    setEditing(true);
    setError("");
    setNotice("");
    setLookup(null);
  }
  async function loadCompany(target: string, edit = false) {
    setError("");
    setBusy(true);
    const seq = ++generation.current;
    try {
      const r = await apiRequest("/company-administration/" + target);
      if (alive.current && seq === generation.current) {
        apply(r.item, r.sequences);
        setEditing(edit);
        setNotice("");
      }
    } catch (e: any) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (submitLock.current || !canManage || !editing) return;
    submitLock.current = true;
    setBusy(true);
    setError("");
    const seq = generation.current;
    try {
      const candidate = companyFormSubmission(
        value,
        persistedActivityCount.current,
      );
      setValue(candidate);
      const parsed = companyInput.safeParse(candidate);
      if (!parsed.success) {
        setTab(companyValidationTab(parsed.error.issues[0].path));
        throw new Error(
          parsed.error.issues.map(companyValidationMessage).join(" "),
        );
      }
      const body = id
        ? { ...parsed.data, expected_version: version }
        : { ...parsed.data, operation_id: operation.current };
      const r = await post(
        "/company-administration" + (id ? "/" + id : ""),
        body,
        id ? "PATCH" : "POST",
      );
      if (!alive.current || seq !== generation.current) return;
      apply(r.item, r.sequences ?? []);
      await onSaved(r.item.id);
    } catch (e: any) {
      if (alive.current && seq === generation.current) {
        setError(e.message);
        const errorTab = companyApiErrorTab(e.message);
        if (errorTab !== null) setTab(errorTab);
      }
    } finally {
      submitLock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function consult() {
    if (busy) return;
    const fingerprint = JSON.stringify(value),
      seq = generation.current;
    setBusy(true);
    setError("");
    try {
      const r = await apiRequest(
        "/company-administration/identity-lookup?identification=" +
          encodeURIComponent(value.identification.replace(/[-\s]/g, "")),
      );
      if (alive.current && seq === generation.current)
        setValue((current) => {
          if (JSON.stringify(current) === fingerprint) {
            setLookup(r);
            if (!r.available)
              setNotice(
                "La consulta no está disponible. Puedes completar los datos manualmente.",
              );
          }
          return current;
        });
    } catch (e: any) {
      if (alive.current) setNotice(e.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function logo(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 65536 || !["image/png", "image/jpeg"].includes(file.type))
        throw Error("Utiliza un logotipo PNG o JPEG de hasta 64 KiB.");
      const seq = generation.current;
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      if (alive.current && seq === generation.current)
        change("configuration.logo", data);
    } catch (e: any) {
      if (alive.current) setError(e.message);
    }
  }
  const loc = value.configuration.location,
    province = locations?.provinces.find((p: Row) => p.code === loc.province),
    canton = province?.cantons.find((c: Row) => c.code === loc.canton);
  if (!ready) return <p>Cargando administración de empresas…</p>;
  return (
    <section className="panel form-panel company-workspace">
      <div className="company-heading">
        <div>
          <h3>{!id ? "Nueva empresa" : "Configuración de empresa"}</h3>
          <p>
            {canManage
              ? "Superadministrador del sistema"
              : "Solo el superadministrador puede modificar los datos empresariales."}
          </p>
        </div>
        {canManage && (
          <div className="company-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy || editing}
              onClick={newCompany}
            >
              Nueva empresa
            </button>
            {!editing && detailReady && (
              <button
                type="button"
                className="button primary"
                disabled={busy}
                onClick={() => setEditing(true)}
              >
                Editar empresa
              </button>
            )}
          </div>
        )}
      </div>
      {canManage && items.some((r) => !r.active) && (
        <p>
          Empresas inactivas:{" "}
          {items
            .filter((r) => !r.active)
            .map((r) => (
              <button
                type="button"
                className="text-button"
                key={r.id}
                disabled={busy || editing}
                onClick={() => void loadCompany(r.id, true)}
              >
                {r.legal_name}
              </button>
            ))}
        </p>
      )}
      <p className={"company-state " + (error ? "error" : "pending")}>
        {error ? "Configuración con errores" : "Configuración pendiente"} · No
        habilita emisión electrónica.
      </p>
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
      <div
        className="tabs company-tabs"
        role="tablist"
        aria-label="Configuración empresarial"
      >
        {tabs.map((name, i) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === i}
            className={tab === i ? "selected" : ""}
            key={name}
            onClick={() => setTab(i)}
          >
            {name}
          </button>
        ))}
      </div>
      <form onSubmit={save} autoComplete="off" noValidate>
        <div role="tabpanel" aria-label={tabs[tab]}>
          {tab === 0 && (
            <div className="form-grid">
              {field("Razón social", "legal_name", "text", true)}
              {field("Nombre comercial", "trade_name")}
              {select(
                "Tipo de persona",
                "person_type",
                [
                  ["unspecified", "Seleccionar"],
                  ["physical", "Persona física"],
                  ["legal", "Persona jurídica"],
                ],
                true,
              )}
              {select(
                "Tipo de identificación",
                "identification_type",
                [
                  ...(!types.some(([t]) => t === value.identification_type)
                    ? [
                        [
                          value.identification_type,
                          "Tipo histórico: " + value.identification_type,
                        ],
                      ]
                    : []),
                  ...types,
                ],
                true,
              )}
              {field(
                "Número de identificación",
                "identification",
                "text",
                true,
              )}
              {field("Teléfono", "phone", "tel")}
              {field("Correo principal", "contact_email", "email")}
              {field(
                "Correo de facturación",
                "configuration.billing_email",
                "email",
              )}
              {field("Sitio web", "configuration.website", "url")}
              {select("Estado", "active", [
                ["true", "Activa"],
                ["false", "Inactiva"],
              ])}
              {editing && (
                <label className="field">
                  Logotipo opcional · PNG/JPEG, hasta 64 KiB
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    disabled={busy}
                    onChange={(e) => {
                      void logo(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
              {value.configuration.logo && (
                <div>
                  <img
                    className="company-logo"
                    src={value.configuration.logo}
                    alt="Logotipo de la empresa"
                  />
                  {editing && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => change("configuration.logo", "")}
                    >
                      Quitar logotipo
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {tab === 1 && (
            <>
              <p>
                Catálogo territorial oficial aportado a Conta Ágil. Puedes
                completar el domicilio después del alta.
              </p>
              <div className="form-grid">
                {locations ? (
                  <>
                    <label className="field">
                      Provincia
                      <select
                        value={loc.province}
                        disabled={!editing || busy}
                        onChange={(e) =>
                          change("configuration.location", {
                            province: e.target.value,
                            canton: "",
                            district: "",
                            neighborhood: loc.neighborhood,
                          })
                        }
                      >
                        <option value="">Seleccionar</option>
                        {locations.provinces.map((p: Row) => (
                          <option key={p.code} value={p.code}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      Cantón
                      <select
                        value={loc.canton}
                        disabled={!editing || busy || !loc.province}
                        onChange={(e) =>
                          change("configuration.location", {
                            ...loc,
                            canton: e.target.value,
                            district: "",
                          })
                        }
                      >
                        <option value="">Seleccionar</option>
                        {province?.cantons.map((c: Row) => (
                          <option key={c.code} value={c.code}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      Distrito
                      <select
                        value={loc.district}
                        disabled={!editing || busy || !loc.canton}
                        onChange={(e) =>
                          change(
                            "configuration.location.district",
                            e.target.value,
                          )
                        }
                      >
                        <option value="">Seleccionar</option>
                        {canton?.districts.map((d: Row) => (
                          <option key={d.code} value={d.code}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : (
                  <>
                    {field(
                      "Código de provincia",
                      "configuration.location.province",
                    )}
                    {field("Código de cantón", "configuration.location.canton")}
                    {field(
                      "Código de distrito",
                      "configuration.location.district",
                    )}
                  </>
                )}
                {field("Barrio", "configuration.location.neighborhood")}
                {field("Otras señas", "address")}
              </div>
            </>
          )}
          {tab === 2 && (
            <>
              <p>
                Los datos declarados quedan pendientes de verificación. La
                condición PYME no aplica exoneraciones automáticamente.
              </p>
              <button
                type="button"
                className="button secondary"
                disabled={!editing || busy}
                onClick={() => void consult()}
              >
                Consultar identificación y actividades en Hacienda
              </button>
              {lookup?.available && (
                <div className="company-lookup">
                  <p>Resultado para revisar: {lookup.recipient?.name}</p>
                  {lookup.situation?.state && (
                    <p>Estado tributario informado: {lookup.situation.state}</p>
                  )}
                  <button
                    type="button"
                    className="text-button"
                    disabled={!editing}
                    onClick={() => change("legal_name", lookup.recipient.name)}
                  >
                    Usar razón social consultada
                  </button>
                  <label className="field">
                    Buscar actividades consultadas por código o descripción
                    <input
                      value={activitySearch}
                      onChange={(e) => setActivitySearch(e.target.value)}
                    />
                  </label>
                  {lookup.activities
                    ?.filter((a: Row) =>
                      (a.code + " " + a.description)
                        .toLowerCase()
                        .includes(activitySearch.toLowerCase()),
                    )
                    .map((a: Row) => (
                      <button
                        type="button"
                        className="text-button"
                        key={a.code}
                        disabled={
                          !editing ||
                          a.active !== true ||
                          value.activities.some((v) => v.code === a.code)
                        }
                        onClick={() =>
                          change("activities", [
                            ...value.activities,
                            {
                              code: a.code,
                              name: a.description,
                              primary: !value.activities.some((v) => v.primary),
                              active: true,
                              source_url: "https://api.hacienda.go.cr/fe/ae",
                            },
                          ])
                        }
                      >
                        {a.code} · {a.description} ·{" "}
                        {a.active === true
                          ? "Activa"
                          : a.active === false
                            ? "Inactiva"
                            : "Vigencia no confirmada"}
                      </button>
                    ))}
                </div>
              )}
              <p className="form-hint">
                Selecciona una actividad vigente asociada a la identificación.
                Puedes preparar los datos manualmente si la consulta no está
                disponible. Los códigos tienen seis caracteres: conserva el
                punto, por ejemplo 4520.0, sin completar ceros ni sustituirlo.
              </p>
              {value.activities.map((a, i) => (
                <div className="company-activity" key={i}>
                  <label className="field">
                    Código de actividad {i + 1} (6 caracteres)
                    <input
                      value={a.code}
                      disabled={!editing || busy}
                      onChange={(e) =>
                        change(
                          "activities",
                          value.activities.map((v, j) =>
                            j === i ? { ...v, code: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="field">
                    Descripción de actividad {i + 1}
                    <input
                      value={a.name}
                      disabled={!editing || busy}
                      onChange={(e) =>
                        change(
                          "activities",
                          value.activities.map((v, j) =>
                            j === i ? { ...v, name: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="company-check">
                    <input
                      type="radio"
                      name="principal"
                      checked={a.primary}
                      disabled={!editing || busy || !a.active}
                      onChange={() =>
                        change(
                          "activities",
                          value.activities.map((v, j) => ({
                            ...v,
                            primary: j === i,
                          })),
                        )
                      }
                    />
                    Principal
                  </label>
                  <label className="company-check">
                    <input
                      type="checkbox"
                      checked={a.active}
                      disabled={!editing || busy}
                      onChange={(e) =>
                        change(
                          "activities",
                          value.activities.map((v, j) =>
                            j === i
                              ? {
                                  ...v,
                                  active: e.target.checked,
                                  primary: e.target.checked && v.primary,
                                }
                              : v,
                          ),
                        )
                      }
                    />
                    Activa
                  </label>
                  {editing && i >= persistedActivityCount.current && (
                    <button
                      type="button"
                      className="button secondary"
                      aria-label={`Eliminar actividad nueva ${i + 1}`}
                      disabled={busy}
                      onClick={() =>
                        change(
                          "activities",
                          value.activities.filter((_, index) => index !== i),
                        )
                      }
                    >
                      Eliminar actividad nueva
                    </button>
                  )}
                </div>
              ))}
              {editing && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || value.activities.length >= 30}
                  onClick={() =>
                    change("activities", [
                      ...value.activities,
                      {
                        code: "",
                        name: "",
                        primary: !value.activities.some(
                          (a) => a.primary && a.active,
                        ),
                        active: true,
                        source_url: "",
                      },
                    ])
                  }
                >
                  Agregar actividad económica
                </button>
              )}
              <div className="form-grid">
                {field(
                  "Fecha de inscripción ante Hacienda",
                  "configuration.tax.registration_date",
                  "date",
                )}
                {field(
                  "Régimen tributario declarado",
                  "configuration.tax.regime",
                )}
                {field(
                  "Condición de contribuyente de IVA declarada",
                  "configuration.tax.vat_condition",
                )}
                {checkbox("Condición PYME", "configuration.tax.pyme")}
                {field("Registro PYME", "configuration.tax.pyme_registration")}
                {field(
                  "Vencimiento de registro PYME",
                  "configuration.tax.pyme_expiry",
                  "date",
                )}
              </div>
            </>
          )}
          {tab === 3 && (
            <>
              <p>
                Documentos y moneda por empresa. No se firman ni transmiten
                comprobantes desde esta pantalla.
              </p>
              <div className="form-grid">
                {select(
                  "Ambiente de facturación",
                  "configuration.billing.environment",
                  [
                    ["test", "Pruebas"],
                    ["production", "Producción"],
                  ],
                )}
                {select(
                  "Moneda predeterminada",
                  "configuration.billing.currency",
                  [
                    ["CRC", "CRC · Colón"],
                    ["USD", "USD · Dólar"],
                  ],
                )}
                {field(
                  "Código de sucursal · 3 dígitos",
                  "configuration.billing.branch_code",
                )}
                {field(
                  "Código de terminal · 5 dígitos",
                  "configuration.billing.terminal_code",
                )}
                {field(
                  "Correo de envío de comprobantes",
                  "configuration.billing.send_email",
                  "email",
                )}
                {field(
                  "Correo de recepción de comprobantes",
                  "configuration.billing.receive_email",
                  "email",
                )}
              </div>
              <div className="company-options">
                <label className="company-check">
                  <input
                    type="checkbox"
                    checked={value.configuration.billing.email_delivery_enabled}
                    disabled={!editing || busy}
                    onChange={(event) =>
                      change(
                        "configuration.billing.email_delivery_enabled",
                        event.target.checked,
                      )
                    }
                  />
                  Enviar comprobantes aceptados al correo del cliente
                </label>
                <p>
                  Requiere correo del receptor y servicio de entrega
                  configurado. La dirección de envío por sí sola no activa las
                  entregas.
                </p>
                {documentTypes.map((t) => (
                  <label className="company-check" key={t}>
                    <input
                      type="checkbox"
                      checked={value.configuration.billing.documents.includes(
                        t,
                      )}
                      disabled={!editing || busy || !["FE", "TE"].includes(t)}
                      onChange={(e) =>
                        change(
                          "configuration.billing.documents",
                          e.target.checked
                            ? [...value.configuration.billing.documents, t]
                            : value.configuration.billing.documents.filter(
                                (d) => d !== t,
                              ),
                        )
                      }
                    />
                    {docs[t]}
                    {!["FE", "TE"].includes(t)
                      ? " · pendiente de implementación fiscal"
                      : ""}
                  </label>
                ))}
              </div>
              <p>No se consumen ni reinician consecutivos al guardar.</p>
              {sequences.length > 0 && (
                <ul>
                  {sequences.map((s) => (
                    <li key={s.terminal_id + s.document_type}>
                      {docs[s.document_type]} · terminal{" "}
                      {s.terminal_id.slice(0, 8)} · último consecutivo{" "}
                      {s.last_value}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {tab === 4 && (
            <>
              <p>
                Parámetros para la etapa contable futura. No generan asientos ni
                cambian el cálculo fiscal por línea.
              </p>
              <div className="form-grid">
                {select(
                  "Moneda funcional",
                  "configuration.accounting.functional_currency",
                  [
                    ["CRC", "CRC"],
                    ["USD", "USD"],
                  ],
                )}
                {select(
                  "Moneda secundaria",
                  "configuration.accounting.secondary_currency",
                  [
                    ["", "Sin moneda secundaria"],
                    ["CRC", "CRC"],
                    ["USD", "USD"],
                  ],
                )}
                {field(
                  "Inicio del período fiscal",
                  "configuration.accounting.fiscal_start",
                  "date",
                )}
                {field(
                  "Cierre del período fiscal",
                  "configuration.accounting.fiscal_end",
                  "date",
                )}
                {field(
                  "Inicio de operaciones contables",
                  "configuration.accounting.operations_start",
                  "date",
                )}
                {select(
                  "Valoración de inventarios",
                  "configuration.accounting.inventory_method",
                  [
                    ["", "Pendiente"],
                    ["weighted_average", "Promedio ponderado"],
                    ["fifo", "PEPS"],
                  ],
                )}
                <label className="field">
                  Decimales monetarios de presentación
                  <input
                    type="number"
                    min="0"
                    max="5"
                    value={value.configuration.accounting.money_decimals}
                    disabled={!editing || busy}
                    onChange={(e) =>
                      change(
                        "configuration.accounting.money_decimals",
                        Number(e.target.value),
                      )
                    }
                  />
                </label>
              </div>
              <div className="company-options">
                {[
                  ["cost_centers", "Uso de centros de costos"],
                  ["departments", "Uso de departamentos"],
                  ["receivables", "Manejo de cuentas por cobrar"],
                  ["payables", "Manejo de cuentas por pagar"],
                  ["inventories", "Manejo de inventarios"],
                  ["fixed_assets", "Manejo de activos fijos"],
                  ["banks", "Manejo de bancos"],
                ].map(([k, l]) => checkbox(l, "configuration.accounting." + k))}
              </div>
            </>
          )}
          {tab === 5 && (
            <>
              <p>
                El creador queda asociado como administrador de la empresa. Solo
                el superadministrador puede invitar personas, cambiar roles y
                revocar accesos.
              </p>
              <p>
                Departamentos configurables: Administración, Facturación,
                Contabilidad, Cuentas por cobrar, Cuentas por pagar, Tesorería y
                bancos, Inventarios, Reportes y Auditoría.
              </p>
              <p>
                Los permisos se asignan expresamente por empresa y departamento
                en el módulo existente.
              </p>
              {canManage && id === tenantId && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={editing || busy}
                  onClick={onUsers}
                >
                  Administrar usuarios y permisos
                </button>
              )}
              {!id && (
                <p>
                  Guarda primero la empresa para administrar sus usuarios y
                  departamentos.
                </p>
              )}
            </>
          )}
        </div>
        {canManage && editing && (
          <div className="form-actions">
            <span>
              Los campos con * son obligatorios. Los cambios quedan en
              auditoría.
            </span>
            <div className="company-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  tenantId ? void loadCompany(tenantId) : onCancel?.()
                }
              >
                Cancelar
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? "Guardando…" : "Guardar empresa"}
              </button>
            </div>
          </div>
        )}
      </form>
      {tab === 3 && canManage && (
        <div className="company-credentials">
          {!id ? (
            <p>
              Guarda primero la empresa para registrar su llave criptográfica.
            </p>
          ) : credentials && credentialsContext === currentCredentialContext ? (
            <>
              <p>
                Estado de credenciales:{" "}
                {credentials.configuration.active_version
                  ? credentials.configuration.enrollment?.status ===
                    "operator_verified"
                    ? "Registradas · revisión del administrador registrada"
                    : "Registradas · revisión del administrador pendiente"
                  : "Pendientes"}
                . Vencimiento:{" "}
                {credentials.configuration.certificate_metadata?.valid_until ??
                  "Sin verificación disponible"}
                .
              </p>
              {!value.active ? (
                <p>Reactiva la empresa para gestionar sus credenciales.</p>
              ) : (
                <CredentialForm
                  key={
                    currentCredentialContext +
                    ":" +
                    credentials.configuration.revision
                  }
                  base={"/companies/" + id}
                  environment={fiscalEnvironment}
                  revision={credentials.configuration.revision}
                  enabled={
                    credentials.capabilities.can_store_credentials &&
                    !busy &&
                    !editing
                  }
                  onSaved={(r) => {
                    if (
                      !alive.current ||
                      credentialContext.current !== currentCredentialContext
                    )
                      return;
                    setCredentials(r);
                    setCredentialsContext(currentCredentialContext);
                    setNotice(
                      "Credenciales guardadas para el ambiente seleccionado. Completa la revisión del administrador en Hacienda.",
                    );
                  }}
                />
              )}
            </>
          ) : (
            <p>
              Consultando credenciales de{" "}
              {fiscalEnvironment === "production" ? "producción" : "pruebas"}…
            </p>
          )}
        </div>
      )}
      <details className="company-pending">
        <summary>Requisitos pendientes de facturación</summary>
        <ul>
          {companyPreparation(value).issues.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

// Access to inactive companies stays inside the existing company selector.
export function InactiveCompanyAccess({
  onSelect,
}: {
  onSelect: (row: Row, saved?: boolean) => void;
}) {
  const [items, setItems] = useState<Row[]>([]),
    [canManage, setCanManage] = useState(false),
    [creating, setCreating] = useState(false);
  useEffect(() => {
    let current = true;
    void apiRequest("/company-administration")
      .then((r) => {
        if (current) {
          setCanManage(r.canManage);
          if (r.canManage) setItems(r.items.filter((i: Row) => !i.active));
        }
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);
  if (creating)
    return (
      <CompanyWorkspace
        tenantId=""
        company={blank()}
        onCancel={() => setCreating(false)}
        onUsers={() => {}}
        onSaved={async (id) => {
          const r = await apiRequest("/company-administration/" + id);
          onSelect(r.item, true);
        }}
      />
    );
  return (
    <>
      {canManage && (
        <button
          type="button"
          className="button secondary"
          onClick={() => setCreating(true)}
        >
          Nueva empresa
        </button>
      )}
      {items.map((row) => (
        <button
          type="button"
          className="button secondary"
          key={row.id}
          onClick={() => onSelect(row)}
        >
          Administrar inactiva: {row.legal_name}
        </button>
      ))}
    </>
  );
}
