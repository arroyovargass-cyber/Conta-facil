import React, { useEffect, useId, useRef, useState } from "react";
import { apiRequest, post } from "../../api/client";
import { calculateInvoice } from "../../../../../packages/domain/src/invoice-fiscal";
import { prepareEmission } from "../../../../../packages/domain/src/emission";
import { subtotal } from "../../../../../packages/domain/src/billing";
import type { HaciendaEnvironment } from "../../../../../packages/domain/src/hacienda-environment";
import {
  Field,
  Lookup,
  useAlive,
  useListing,
  type Row,
  ReceiverFields,
  FiscalFields,
  receiverDefaults,
  fiscalDefaults,
} from "./common";
import { FiscalPreview } from "./FiscalPreview";
import {
  commercialDefaults,
  commercialPayload,
  IssuerFields,
  CommercialFields,
  OtherChargesFields,
  PaymentFields,
  InvoiceSummary,
  netTaxAmount,
} from "./BillingFields";

export function draftFingerprint(row: Row): string {
  return JSON.stringify({
    receiver_mode: row.receiver_mode,
    receiver: row.receiver,
    save_customer: row.save_customer ?? false,
    document_type: row.document_type,
    customer_id: row.customer_id || null,
    department_id: row.department_id,
    currency: row.currency,
    notes: row.notes,
    commercial: commercialPayload(row.commercial ?? {}, row.currency),
    other_charges: row.other_charges ?? [],
    lines: row.lines.map((line: Row) => ({
      catalog_item_id: line.catalog_item_id || null,
      save_catalog_item: line.save_catalog_item ?? false,
      description: line.description,
      quantity: line.quantity || null,
      unit_price: line.unit_price || null,
      fiscal: line.fiscal ?? null,
    })),
  });
}
const blankLine = (withFiscal = false) => ({
  fiscal: withFiscal ? fiscalDefaults() : null,
  catalog_item_id: null,
  save_catalog_item: false,
  description: "",
  quantity: "1",
  unit_price: "0",
});
function allows(department: Row | undefined, capability: string): boolean {
  return Boolean(
    department && (department[capability] ?? department.can_manage),
  );
}
function newDraft(options: Row, withFiscal = false): Row {
  const currency =
    options.issuer?.configuration?.billing?.currency === "USD" ? "USD" : "CRC";
  const departments = (options.departments ?? []).filter(
    (d: Row) => d.active && allows(d, "can_create"),
  );
  return {
    receiver_mode: options.permissions?.includes("customers.read")
      ? "registered"
      : "occasional",
    receiver: receiverDefaults(),
    save_customer: false,
    document_type: "FE",
    customer_id: "",
    department_id: departments.length === 1 ? departments[0].id : "",
    currency,
    notes: "",
    lines: [blankLine(withFiscal)],
    commercial: commercialDefaults(options, currency),
    other_charges: [],
  };
}
export function duplicatedDraftFromInvoice(invoice: Row, options: Row): Row {
  const snapshot = invoice.snapshot,
    draft = newDraft(options, true),
    receiver = structuredClone({ ...receiverDefaults(), ...snapshot.receiver });
  const documentType = invoice.document_type ?? snapshot.document_type ?? "FE";
  const department = options.departments?.find(
    (d: Row) =>
      d.id === invoice.department_id && d.active && allows(d, "can_create"),
  );
  return {
    ...draft,
    document_type: documentType,
    receiver_mode:
      documentType === "TE" && !receiver.name && !receiver.identification
        ? "consumer_final"
        : "occasional",
    customer_id: "",
    receiver,
    save_customer: false,
    department_id: department?.id ?? draft.department_id,
    currency: snapshot.currency,
    notes: snapshot.notes ?? "",
    commercial: {
      ...commercialDefaults(options, snapshot.currency),
      ...structuredClone(invoice.options ?? {}),
      references: [],
    },
    other_charges: structuredClone(snapshot.other_charges ?? []),
    lines: snapshot.lines.map((line: Row) => ({
      catalog_item_id: null,
      save_catalog_item: false,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unit_price,
      fiscal: line.fiscal ? structuredClone(line.fiscal) : null,
    })),
  };
}
function fromSaved(item: Row, options: Row, legacyCommercial?: Row): Row {
  const defaults = commercialDefaults(options, item.currency);
  const source =
    item.commercial &&
    (item.commercial.issuer_activity ||
      item.commercial.branch_code ||
      item.commercial.terminal_code ||
      item.commercial.payment_methods?.length ||
      item.commercial.sale_condition === "02" ||
      item.commercial.references?.length)
      ? item.commercial
      : (legacyCommercial ?? item.commercial ?? {});
  const saved: Row = {
    ...item,
    customer_id: item.customer_id ?? "",
    receiver: { ...receiverDefaults(), ...item.customer_snapshot },
    save_customer: false,
    lines: item.lines.map((line: Row) => ({
      ...line,
      save_catalog_item: false,
    })),
    commercial: {
      ...defaults,
      ...source,
      issuer_activity: source.issuer_activity || defaults.issuer_activity,
      branch_code: source.branch_code || defaults.branch_code,
      terminal_code: source.terminal_code || defaults.terminal_code,
      exchange_rate:
        item.currency === "CRC" ? "1" : (source.exchange_rate ?? ""),
      credit_days: source.credit_days == null ? "" : String(source.credit_days),
    },
    other_charges: item.other_charges ?? [],
  };
  return {
    ...saved,
    _commercialNeedsSave:
      JSON.stringify(commercialPayload(saved.commercial, saved.currency)) !==
      JSON.stringify(commercialPayload(item.commercial ?? {}, item.currency)),
  };
}
type Props = {
  base: string;
  options: Row;
  mode?: "drafts" | "new";
  environment?: HaciendaEnvironment;
  initialDraftId?: string;
  duplicateFromInvoice?: Row | null;
  preparedInvoice?: Row | null;
  onPrepared?: (item: Row) => void;
  onSaved?: (item: Row) => void;
  onClose?: () => void;
  onBusyChange?: (busy: boolean) => void;
};

export function Drafts({
  base,
  options,
  mode = "drafts",
  environment = "test",
  initialDraftId,
  duplicateFromInvoice,
  preparedInvoice,
  onPrepared,
  onSaved,
  onClose,
  onBusyChange,
}: Props) {
  const list = useListing(
      base + "/invoice-drafts",
      "archived",
      "false",
      mode === "drafts",
    ),
    alive = useAlive(),
    operation = useRef(crypto.randomUUID()),
    editorGeneration = useRef(0),
    writing = useRef(false),
    preparationOperation = useRef<{ fingerprint: string; id: string } | null>(
      null,
    );
  const [editing, setEditing] = useState<Row | null>(() =>
      mode === "new" && !initialDraftId
        ? duplicateFromInvoice
          ? duplicatedDraftFromInvoice(duplicateFromInvoice, options)
          : newDraft(options, true)
        : null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [conflict, setConflict] = useState(false),
    [previewGeneration, setPreviewGeneration] = useState(0),
    [savedFingerprint, setSavedFingerprint] = useState(""),
    [detailLoading, setDetailLoading] = useState(false),
    [validation, setValidation] = useState<Row | null>(null),
    [showPreview, setShowPreview] = useState(false),
    [detailTab, setDetailTab] = useState<"lines" | "charges">("lines"),
    [reviewInstant] = useState(() => new Date().toISOString());
  const detailId = useId();
  const lineTabId = detailId + "-lines-tab",
    chargeTabId = detailId + "-charges-tab";
  function detailTabKey(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? "lines"
        : event.key === "End"
          ? "charges"
          : detailTab === "lines"
            ? "charges"
            : "lines";
    setDetailTab(next);
    document
      .getElementById(next === "lines" ? lineTabId : chargeTabId)
      ?.focus();
  }
  const department = options.departments?.find(
    (d: Row) => d.id === editing?.department_id,
  );
  const canCreate = options.departments?.some(
    (d: Row) => d.active && allows(d, "can_create"),
  );
  const editable = Boolean(
    editing &&
    !editing.archived_at &&
    (editing.id
      ? allows(department, "can_edit")
      : editing.department_id
        ? allows(department, "can_create")
        : canCreate),
  );
  const dirty = Boolean(
    editing &&
    (editing._commercialNeedsSave ||
      draftFingerprint(editing) !== savedFingerprint),
  );
  const canPrepare = Boolean(
    department &&
    (department.can_prepare ?? department.can_create ?? department.can_manage),
  );
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  function invalidateEditor() {
    const generation = ++editorGeneration.current;
    setPreviewGeneration(generation);
    setValidation(null);
    setShowPreview(false);
    return generation;
  }
  function change(key: string, value: any) {
    invalidateEditor();
    setEditing((old) => (old ? { ...old, [key]: value } : old));
  }
  function lineChange(index: number, key: string, value: any) {
    invalidateEditor();
    setEditing((old) =>
      old
        ? {
            ...old,
            lines: old.lines.map((line: Row, i: number) =>
              i === index ? { ...line, [key]: value } : line,
            ),
          }
        : old,
    );
  }
  function create() {
    if (writing.current) return;
    invalidateEditor();
    operation.current = crypto.randomUUID();
    preparationOperation.current = null;
    setDetailLoading(false);
    setEditing(newDraft(options, mode === "new"));
    setDetailTab("lines");
    setSavedFingerprint("");
    setError("");
    setNotice("");
    setConflict(false);
  }
  async function open(id: string) {
    if (writing.current) return;
    const generation = invalidateEditor();
    setDetailLoading(true);
    setError("");
    setNotice("");
    setConflict(false);
    setDetailTab("lines");
    try {
      const response = await apiRequest(base + "/invoice-drafts/" + id);
      if (alive.current && editorGeneration.current === generation) {
        const item = fromSaved(
          response.item,
          options,
          preparedInvoice?.options,
        );
        setSavedFingerprint(draftFingerprint(item));
        setEditing(item);
      }
    } catch (e: any) {
      if (alive.current && editorGeneration.current === generation)
        setError(e.message);
    } finally {
      if (alive.current && editorGeneration.current === generation)
        setDetailLoading(false);
    }
  }
  useEffect(() => {
    if (initialDraftId) void open(initialDraftId);
  }, [initialDraftId]);

  async function persist(keepOpen: boolean): Promise<Row | null> {
    if (!editing || writing.current || !editable) return null;
    if (
      preparedInvoice &&
      (editing.document_type !==
        (preparedInvoice.document_type ??
          preparedInvoice.snapshot?.document_type ??
          "FE") ||
        editing.department_id !== preparedInvoice.department_id)
    ) {
      setError(
        "Esta preparación conserva su tipo de documento y departamento. Crea un comprobante nuevo para cambiarlos.",
      );
      return null;
    }
    writing.current = true;
    const generation = invalidateEditor();
    setBusy(true);
    setError("");
    setNotice("");
    const value = {
      receiver_mode: editing.receiver_mode ?? "registered",
      receiver: editing.receiver,
      save_customer: editing.save_customer ?? false,
      document_type: editing.document_type ?? "FE",
      customer_id: editing.customer_id || null,
      department_id: editing.department_id,
      currency: editing.currency,
      notes: editing.notes,
      commercial: commercialPayload(editing.commercial ?? {}, editing.currency),
      other_charges: editing.other_charges ?? [],
      lines: editing.lines.map((line: Row) => ({
        catalog_item_id: line.catalog_item_id || null,
        save_catalog_item: line.save_catalog_item ?? false,
        description: line.description,
        quantity: line.quantity || null,
        unit_price: line.unit_price || null,
        fiscal: line.fiscal ?? null,
      })),
      ...(editing.id
        ? { version: editing.version }
        : { operation_id: operation.current }),
    };
    try {
      const response = await post(
        base + "/invoice-drafts" + (editing.id ? "/" + editing.id : ""),
        value,
        editing.id ? "PATCH" : "POST",
      );
      if (!alive.current || editorGeneration.current !== generation)
        return null;
      const saved = fromSaved(response.item, options);
      setSavedFingerprint(draftFingerprint(saved));
      setEditing(keepOpen ? saved : null);
      setConflict(false);
      setNotice("Borrador guardado. Sin firma ni envío a Hacienda.");
      if (mode === "drafts") list.refresh();
      onSaved?.(response.item);
      return saved;
    } catch (e: any) {
      if (alive.current && editorGeneration.current === generation) {
        setError(e.message);
        setConflict(e.status === 409);
      }
      return null;
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    await persist(mode === "new");
  }
  async function validate() {
    if (!editing || writing.current) return;
    const saved = editing.id && !dirty ? editing : await persist(true);
    if (!saved || !alive.current) return;
    try {
      const result = prepareEmission({
        document_type: saved.document_type,
        currency: saved.currency,
        receiver: saved.receiver,
        lines: saved.lines,
        options: commercialPayload(saved.commercial, saved.currency),
        other_charges: saved.other_charges,
      } as any);
      const issues = [
        ...(saved.readiness?.issues ?? []),
        ...result.issues,
      ].filter(
        (issue, i, all) =>
          all.findIndex(
            (other) => other.code === issue.code && other.path === issue.path,
          ) === i,
      );
      setValidation({ issues });
      setNotice("");
    } catch {
      setError(
        "Revisa los formatos de los datos comerciales antes de validar la factura.",
      );
    }
  }
  async function prepare() {
    if (!editing || writing.current || !canPrepare || (!editable && dirty))
      return;
    const saved = editing.id && !dirty ? editing : await persist(true);
    if (!saved || !alive.current) return;
    writing.current = true;
    const generation = editorGeneration.current;
    setBusy(true);
    setError("");
    setNotice("");
    const payload = {
      environment,
      draft_id: saved.id,
      expected_version: saved.version,
    };
    const fingerprint = JSON.stringify({
      ...payload,
      prepared_id: preparedInvoice?.id,
      prepared_version: preparedInvoice?.version,
    });
    if (preparationOperation.current?.fingerprint !== fingerprint)
      preparationOperation.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const response = preparedInvoice
        ? await post(
            base + "/invoices/" + preparedInvoice.id,
            {
              version: preparedInvoice.version,
              expected_version: saved.version,
            },
            "PATCH",
          )
        : await post(base + "/invoices", {
            ...payload,
            operation_id: preparationOperation.current.id,
          });
      if (!alive.current || editorGeneration.current !== generation) return;
      setNotice(
        "Preparación guardada. Revisa los requisitos y confirma la emisión por separado.",
      );
      onPrepared?.(response.item);
    } catch (e: any) {
      if (alive.current && editorGeneration.current === generation) {
        setError(e.message);
        setConflict(e.status === 409);
      }
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function archive() {
    if (!editing?.id || writing.current || !allows(department, "can_delete"))
      return;
    writing.current = true;
    const generation = invalidateEditor();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await post(
        base + "/invoice-drafts/" + editing.id,
        { version: editing.version, archived: !editing.archived_at },
        "PATCH",
      );
      if (!alive.current || editorGeneration.current !== generation) return;
      setNotice(
        editing.archived_at ? "Borrador restaurado." : "Borrador archivado.",
      );
      setEditing(null);
      list.refresh();
    } catch (e: any) {
      if (alive.current && editorGeneration.current === generation) {
        setError(e.message);
        setConflict(e.status === 409);
      }
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function assignReview() {
    if (!editing?.id || dirty || writing.current) return;
    writing.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const generation = editorGeneration.current;
    try {
      await post(
        base + "/invoice-drafts/" + editing.id + "/collection-review",
        { expected_version: editing.version },
      );
      if (alive.current && editorGeneration.current === generation)
        setNotice("Revisión asignada a Cuentas por cobrar.");
    } catch (e: any) {
      if (alive.current && editorGeneration.current === generation) {
        setError(e.message);
        setConflict(e.status === 409);
      }
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const calculation = editing
    ? calculateInvoice(
        editing.lines.map((line: Row) => ({
          ...line,
          quantity: line.quantity || null,
          unit_price: line.unit_price || null,
          fiscal: line.fiscal ?? null,
        })),
        editing.other_charges ?? [],
      )
    : null;
  const commercial = editing?.commercial ?? {};
  let commercialAmount: string | null = null;
  try {
    if (
      editing?.lines.length &&
      editing.lines.every(
        (line: Row) =>
          line.quantity && line.unit_price !== null && line.unit_price !== "",
      )
    )
      commercialAmount = subtotal(editing.lines);
  } catch {
    /* Incomplete decimal entry remains a draft, without partial totals. */
  }
  return (
    <section className="billing-workspace">
      <div className="info-box">
        <strong>Borrador — sin validez tributaria</strong>
        <p>
          Guarda y revisa la factura antes de preparar su emisión. Hacienda
          confirma la aceptación después del envío.
        </p>
      </div>
      {error && (
        <div role="alert" className="alert">
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          aria-label="Resultado del borrador"
          className="notice"
        >
          {notice}
        </div>
      )}
      {mode === "drafts" && (
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
          {canCreate && (
            <button className="button primary" disabled={busy} onClick={create}>
              Nuevo borrador
            </button>
          )}
        </div>
      )}
      {!canCreate && (
        <p>Necesitas un departamento activo y permiso para crear facturas.</p>
      )}
      {detailLoading && <p>Cargando borrador…</p>}
      {editing && (
        <form className="billing-editor" onSubmit={save} noValidate>
          <div className="billing-editor-heading">
            <h2>
              {preparedInvoice
                ? "Editar preparación"
                : mode === "new"
                  ? "Nueva factura"
                  : editing.id
                    ? "Detalle del borrador"
                    : "Nuevo borrador"}
            </h2>
            <span className="billing-state">
              {dirty ? "Borrador con cambios" : "Borrador guardado"}
            </span>
          </div>
          <fieldset disabled={busy || detailLoading || !editable}>
            <IssuerFields
              options={options}
              value={commercial}
              onChange={(v) => change("commercial", v)}
            />
            <CommercialFields
              currency={editing.currency}
              documentType={editing.document_type ?? "FE"}
              notes={editing.notes ?? ""}
              value={commercial}
              instant={reviewInstant}
              lockDocumentType={Boolean(preparedInvoice)}
              onChange={(v) => change("commercial", v)}
              onNotes={(v) => change("notes", v)}
              onDocumentType={(v) => {
                invalidateEditor();
                setEditing((old) =>
                  old
                    ? {
                        ...old,
                        document_type: v,
                        ...(v === "FE" && old.receiver_mode === "consumer_final"
                          ? { receiver_mode: "occasional" }
                          : {}),
                      }
                    : old,
                );
              }}
              onCurrency={(v) => {
                if (editing.lines.some((line: Row) => line.catalog_item_id)) {
                  setError(
                    "Retira las referencias a productos antes de cambiar la moneda.",
                  );
                  return;
                }
                invalidateEditor();
                setEditing((old) =>
                  old
                    ? {
                        ...old,
                        currency: v,
                        commercial: {
                          ...old.commercial,
                          exchange_rate: v === "CRC" ? "1" : "",
                        },
                      }
                    : old,
                );
              }}
            />
            <section
              className="billing-section"
              aria-labelledby="billing-receiver-title"
            >
              <h3 id="billing-receiver-title">Datos del receptor</h3>
              <div className="form-grid">
                <label className="field">
                  Tipo de receptor
                  <select
                    value={editing.receiver_mode ?? "registered"}
                    onChange={(e) => {
                      const selected = e.target.value;
                      invalidateEditor();
                      setEditing((old) =>
                        old
                          ? {
                              ...old,
                              receiver_mode: selected,
                              customer_id: "",
                              receiver: receiverDefaults(),
                              save_customer: false,
                              ...(selected === "consumer_final"
                                ? { document_type: "TE" }
                                : {}),
                            }
                          : old,
                      );
                    }}
                  >
                    <option
                      value="registered"
                      disabled={
                        !options.permissions?.includes("customers.read")
                      }
                    >
                      Cliente registrado
                    </option>
                    <option value="occasional">
                      Cliente nuevo o no recurrente
                    </option>
                    <option
                      value="consumer_final"
                      disabled={Boolean(
                        preparedInvoice &&
                        (preparedInvoice.document_type ??
                          preparedInvoice.snapshot?.document_type ??
                          "FE") !== "TE",
                      )}
                    >
                      Consumidor final mediante tiquete electrónico
                    </option>
                  </select>
                </label>
                <label className="field">
                  Departamento
                  <select
                    aria-label="Departamento"
                    disabled={Boolean(preparedInvoice)}
                    value={editing.department_id}
                    onChange={(e) => change("department_id", e.target.value)}
                  >
                    <option value="">Selecciona…</option>
                    {options.departments
                      .filter(
                        (d: Row) =>
                          d.id === editing.department_id ||
                          (d.active &&
                            allows(d, editing.id ? "can_edit" : "can_create")),
                      )
                      .map((d: Row) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                          {!d.active ? " (inactivo)" : ""}
                        </option>
                      ))}
                  </select>
                </label>
                {editing.receiver_mode === "registered" && (
                  <Lookup
                    base={base + "/customers"}
                    label="Cliente"
                    value={editing.customer_id ?? ""}
                    current={
                      editing.customer_id
                        ? {
                            id: editing.customer_id,
                            name:
                              editing.receiver?.name || "Cliente seleccionado",
                          }
                        : undefined
                    }
                    onChange={(id, row) => {
                      invalidateEditor();
                      setEditing((old) =>
                        old
                          ? {
                              ...old,
                              customer_id: id,
                              receiver: row
                                ? Object.fromEntries(
                                    Object.entries(receiverDefaults()).map(
                                      ([key, defaultValue]) => [
                                        key,
                                        row[key] ?? defaultValue,
                                      ],
                                    ),
                                  )
                                : receiverDefaults(),
                            }
                          : old,
                      );
                    }}
                  />
                )}
              </div>
              {editing.receiver_mode === "consumer_final" ? (
                <p>
                  Has elegido explícitamente un tiquete electrónico para
                  consumidor final. Se omite el receptor y no se crea un
                  cliente.
                </p>
              ) : (
                <>
                  <p>
                    Los datos incompletos pueden guardarse como borrador. La
                    validación aplica las condiciones de la factura o del
                    tiquete elegido.
                  </p>
                  <ReceiverFields
                    value={editing.receiver ?? receiverDefaults()}
                    onChange={(v) => change("receiver", v)}
                    base={base}
                  />
                  {editing.receiver_mode === "occasional" &&
                    options.permissions?.includes("customers.manage") &&
                    options.permissions?.includes("customers.read") && (
                      <label className="billing-check">
                        <input
                          type="checkbox"
                          checked={Boolean(editing.save_customer)}
                          onChange={(e) =>
                            change("save_customer", e.target.checked)
                          }
                        />
                        Guardar cliente para futuras facturas
                      </label>
                    )}
                </>
              )}
            </section>
          </fieldset>
          <div
            role="tablist"
            aria-label="Detalle de la factura"
            className="tabs billing-detail-tabs"
          >
            <button
              type="button"
              role="tab"
              id={lineTabId}
              aria-controls={detailId + "-lines-panel"}
              aria-selected={detailTab === "lines"}
              tabIndex={detailTab === "lines" ? 0 : -1}
              className={detailTab === "lines" ? "selected" : ""}
              disabled={busy || detailLoading}
              onClick={() => setDetailTab("lines")}
              onKeyDown={detailTabKey}
            >
              Líneas de detalle
            </button>
            <button
              type="button"
              role="tab"
              id={chargeTabId}
              aria-controls={detailId + "-charges-panel"}
              aria-selected={detailTab === "charges"}
              tabIndex={detailTab === "charges" ? 0 : -1}
              className={detailTab === "charges" ? "selected" : ""}
              disabled={busy || detailLoading}
              onClick={() => setDetailTab("charges")}
              onKeyDown={detailTabKey}
            >
              Otros cargos
            </button>
          </div>
          <fieldset disabled={busy || detailLoading || !editable}>
            <div
              role="tabpanel"
              id={detailId + "-lines-panel"}
              aria-labelledby={lineTabId}
              hidden={detailTab !== "lines"}
              tabIndex={0}
              className="billing-detail-panel"
            >
              <section
                className="billing-section"
                aria-labelledby="billing-lines-title"
              >
                <h3 id="billing-lines-title">
                  Líneas de productos y servicios
                </h3>
                <p>
                  Los precios unitarios son antes de impuestos. Puedes agregar
                  un producto o servicio sin guardarlo en el catálogo.
                </p>
                {editing.lines.map((line: Row, index: number) => (
                  <div className="billing-line" key={index}>
                    <h4>Línea {index + 1}</h4>
                    {options.permissions?.includes("catalog.read") && (
                      <Lookup
                        base={base + "/catalog-items"}
                        label={"Producto de línea " + (index + 1)}
                        value={line.catalog_item_id ?? ""}
                        current={
                          line.catalog_item_id
                            ? {
                                id: line.catalog_item_id,
                                name: line.description,
                              }
                            : undefined
                        }
                        compatible={(r) => r.currency === editing.currency}
                        onChange={(id, row) => {
                          invalidateEditor();
                          setEditing((old) =>
                            old
                              ? {
                                  ...old,
                                  lines: old.lines.map((l: Row, i: number) =>
                                    i === index
                                      ? {
                                          ...l,
                                          catalog_item_id: id || null,
                                          save_catalog_item: false,
                                          ...(row
                                            ? {
                                                description: row.description,
                                                unit_price: row.unit_price,
                                                fiscal:
                                                  row.tax_defaults ||
                                                  row.cabys ||
                                                  row.unit
                                                    ? {
                                                        ...fiscalDefaults(),
                                                        ...row.tax_defaults,
                                                        internal_code:
                                                          row.code ?? "",
                                                        cabys:
                                                          row.cabys ||
                                                          row.tax_defaults
                                                            ?.cabys ||
                                                          "",
                                                        unit:
                                                          row.unit ||
                                                          row.tax_defaults
                                                            ?.unit ||
                                                          "",
                                                      }
                                                    : null,
                                              }
                                            : {}),
                                        }
                                      : l,
                                  ),
                                }
                              : old,
                          );
                        }}
                      />
                    )}
                    <div className="form-grid">
                      <Field
                        label={"Descripción de línea " + (index + 1)}
                        value={line.description}
                        onChange={(v) => lineChange(index, "description", v)}
                      />
                      <Field
                        label={"Cantidad de línea " + (index + 1)}
                        value={line.quantity ?? ""}
                        onChange={(v) => lineChange(index, "quantity", v)}
                        maxLength={15}
                      />
                      <Field
                        label={"Precio de línea " + (index + 1)}
                        value={line.unit_price ?? ""}
                        onChange={(v) => lineChange(index, "unit_price", v)}
                        maxLength={15}
                      />
                    </div>
                    <label className="billing-check">
                      <input
                        type="checkbox"
                        checked={Boolean(line.fiscal)}
                        onChange={(e) =>
                          lineChange(
                            index,
                            "fiscal",
                            e.target.checked ? fiscalDefaults() : null,
                          )
                        }
                      />
                      Configurar impuestos y descuentos de línea {index + 1}
                    </label>
                    {line.fiscal && (
                      <FiscalFields
                        value={line.fiscal}
                        onChange={(v) => lineChange(index, "fiscal", v)}
                        base={base}
                        documentType={editing.document_type}
                        receiverExoneration={editing.receiver?.exoneration}
                        onCabysSelected={(row) => {
                          invalidateEditor();
                          setEditing((old) =>
                            old
                              ? {
                                  ...old,
                                  lines: old.lines.map((l: Row, i: number) =>
                                    i === index
                                      ? {
                                          ...l,
                                          description:
                                            l.description || row.description,
                                          fiscal: {
                                            ...l.fiscal,
                                            cabys: row.code,
                                          },
                                        }
                                      : l,
                                  ),
                                }
                              : old,
                          );
                        }}
                      />
                    )}
                    {options.permissions?.includes("catalog.manage") &&
                      !line.catalog_item_id && (
                        <label className="billing-check">
                          <input
                            type="checkbox"
                            checked={Boolean(line.save_catalog_item)}
                            onChange={(e) => {
                              invalidateEditor();
                              setEditing((old) =>
                                old
                                  ? {
                                      ...old,
                                      lines: old.lines.map(
                                        (l: Row, i: number) =>
                                          i === index
                                            ? {
                                                ...l,
                                                save_catalog_item:
                                                  e.target.checked,
                                                fiscal: e.target.checked
                                                  ? {
                                                      ...fiscalDefaults(),
                                                      ...l.fiscal,
                                                    }
                                                  : l.fiscal,
                                              }
                                            : l,
                                      ),
                                    }
                                  : old,
                              );
                            }}
                          />
                          Guardar producto o servicio de línea {index + 1} para
                          futuras facturas
                        </label>
                      )}
                    <LineTotals
                      line={line}
                      calculated={
                        calculation?.status === "complete"
                          ? calculation.lines[index]
                          : null
                      }
                      index={index}
                      currency={editing.currency}
                    />
                    <div className="billing-actions">
                      <button
                        type="button"
                        className="button secondary"
                        disabled={editing.lines.length >= 100}
                        onClick={() =>
                          change("lines", [
                            ...editing.lines,
                            {
                              catalog_item_id: line.catalog_item_id ?? null,
                              save_catalog_item: false,
                              description: line.description,
                              quantity: line.quantity,
                              unit_price: line.unit_price,
                              fiscal: line.fiscal
                                ? structuredClone(line.fiscal)
                                : null,
                            },
                          ])
                        }
                      >
                        Duplicar línea {index + 1}
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => {
                          invalidateEditor();
                          setEditing((old) =>
                            old
                              ? {
                                  ...old,
                                  lines: old.lines.map((l: Row, i: number) =>
                                    i === index ? blankLine(mode === "new") : l,
                                  ),
                                }
                              : old,
                          );
                        }}
                      >
                        Limpiar línea {index + 1}
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={editing.lines.length === 1}
                        onClick={() =>
                          change(
                            "lines",
                            editing.lines.filter(
                              (_: Row, i: number) => i !== index,
                            ),
                          )
                        }
                      >
                        Quitar línea {index + 1}
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  className="button secondary"
                  disabled={editing.lines.length >= 100}
                  onClick={() =>
                    change("lines", [
                      ...editing.lines,
                      blankLine(mode === "new"),
                    ])
                  }
                >
                  Añadir línea
                </button>
              </section>
            </div>
            <div
              role="tabpanel"
              id={detailId + "-charges-panel"}
              aria-labelledby={chargeTabId}
              hidden={detailTab !== "charges"}
              tabIndex={0}
              className="billing-detail-panel"
            >
              <OtherChargesFields
                value={editing.other_charges ?? []}
                onChange={(v) => change("other_charges", v)}
                calculation={calculation}
              />
            </div>
            <PaymentFields
              value={commercial.payment_methods ?? []}
              saleCondition={commercial.sale_condition}
              currency={editing.currency}
              total={
                calculation?.status === "complete"
                  ? calculation.total
                  : undefined
              }
              onChange={(v) =>
                change("commercial", { ...commercial, payment_methods: v })
              }
            />
          </fieldset>
          {calculation?.status === "blocked" && commercialAmount !== null && (
            <aside
              className="fiscal-preview-panel"
              aria-label="Importe comercial sin impuestos"
            >
              <p>
                Importe antes de descuentos e impuestos:{" "}
                <strong>
                  {editing.currency} {commercialAmount}
                </strong>
              </p>
              <p>
                El total fiscal sigue pendiente hasta completar las líneas y su
                clasificación tributaria.
              </p>
            </aside>
          )}
          <InvoiceSummary
            calculation={calculation}
            currency={editing.currency}
          />
          {showPreview && (
            <section
              className="fiscal-preview-panel"
              aria-label="Vista previa de la factura"
            >
              <h3>Vista previa — sin validez tributaria</h3>
              <p>
                {options.issuer?.legal_name || "Emisor pendiente"} ·{" "}
                {editing.document_type === "TE"
                  ? "Tiquete electrónico"
                  : "Factura electrónica"}
              </p>
              <p>
                Receptor:{" "}
                {editing.receiver_mode === "consumer_final"
                  ? "Consumidor final"
                  : editing.receiver?.name || "Por completar"}
              </p>
              {editing.lines.map((line: Row, i: number) => (
                <p key={i}>
                  {line.quantity} × {line.description || "Sin descripción"} ·{" "}
                  {editing.currency} {line.unit_price} antes de impuestos
                </p>
              ))}
              <p>
                Total:{" "}
                {calculation?.status === "complete"
                  ? `${editing.currency} ${calculation.total}`
                  : "Pendiente de cálculo"}
              </p>
              <p>
                Sin clave ni consecutivo asignados. Esta vista no valida el XML,
                firma ni envía a Hacienda.
              </p>
            </section>
          )}
          {validation && (
            <section className="info-box" aria-label="Resultado de validación">
              <h3>
                {validation.issues.length
                  ? "Pendiente de validación"
                  : "Datos de la factura revisados"}
              </h3>
              {validation.issues.length ? (
                <ul>
                  {validation.issues.map((issue: Row, i: number) => (
                    <li key={i}>{issue.message}</li>
                  ))}
                </ul>
              ) : (
                <p>Sin observaciones fiscales o comerciales en estos datos.</p>
              )}
              <p>
                La preparación verificará además la configuración del emisor y
                la disponibilidad de emisión. El XML y la respuesta de Hacienda
                se verifican en sus respectivas etapas.
              </p>
            </section>
          )}
          {editing.id &&
            !dirty &&
            !validation &&
            editing.readiness?.issues?.length > 0 && (
              <details className="billing-disclosure">
                <summary>Datos pendientes del borrador</summary>
                <ul>
                  {editing.readiness.issues.map((issue: Row, i: number) => (
                    <li key={i}>{issue.message}</li>
                  ))}
                </ul>
              </details>
            )}
          {editing.id && !editing.lines.some((line: Row) => line.fiscal) && (
            <FiscalPreview
              key={editing.id + ":" + previewGeneration}
              base={base}
              draftId={editing.id}
              version={editing.version}
              dirty={dirty}
              disabled={busy || detailLoading}
              generation={previewGeneration}
              isCurrent={(generation) =>
                editorGeneration.current === generation
              }
              onConflict={() => setConflict(true)}
            />
          )}
          <section
            className="billing-section"
            aria-label="Guardado, validación y emisión"
          >
            <h3>Guardado, validación y emisión</h3>
            <p>
              Una preparación guardada todavía no es un comprobante emitido. La
              firma y el envío requieren una confirmación de emisión.
            </p>
            <div className="billing-actions">
              {editable && (
                <button
                  className="button primary"
                  disabled={busy || detailLoading}
                >
                  {busy ? "Guardando…" : "Guardar borrador"}
                </button>
              )}
              <button
                type="button"
                className="button secondary"
                disabled={busy || detailLoading}
                onClick={() => setShowPreview((v) => !v)}
              >
                Vista previa
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={busy || detailLoading || !editable}
                onClick={() => void validate()}
              >
                Validar factura
              </button>
              {mode === "new" && (
                <button
                  type="button"
                  className="button primary"
                  disabled={
                    busy || detailLoading || !canPrepare || (!editable && dirty)
                  }
                  onClick={() => void prepare()}
                >
                  {preparedInvoice
                    ? "Actualizar preparación"
                    : "Guardar preparación"}
                </button>
              )}
              {mode === "new" && !canPrepare && (
                <p>
                  Tu usuario necesita permiso de preparación para generar o
                  actualizar el comprobante.
                </p>
              )}
              {mode === "new" && canPrepare && !editable && dirty && (
                <p>
                  El borrador tiene datos pendientes de guardar. Solicita su
                  actualización a una persona con permiso de edición antes de
                  prepararlo.
                </p>
              )}
              {editing.id && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || dirty}
                  onClick={() =>
                    window.open(
                      "/api" +
                        base +
                        "/invoice-drafts/" +
                        editing.id +
                        "/print",
                      "_blank",
                      "noopener",
                    )
                  }
                >
                  Imprimir borrador sin validez tributaria
                </button>
              )}
              {editing.id &&
                !editing.archived_at &&
                department?.can_assign &&
                allows(department, "can_edit") && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy || dirty}
                    onClick={() => void assignReview()}
                  >
                    Asignar revisión a Cuentas por cobrar
                  </button>
                )}
              {mode === "drafts" &&
                editing.id &&
                allows(department, "can_delete") && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void archive()}
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
                  invalidateEditor();
                  setEditing(null);
                  setError("");
                  setConflict(false);
                  onClose?.();
                }}
              >
                Cerrar borrador
              </button>
              {conflict && editing.id && (
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
          </section>
        </form>
      )}
      {mode === "drafts" && (
        <>
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
                {list.rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.receiver_mode === "consumer_final"
                        ? "Consumidor final"
                        : row.customer_snapshot?.name ||
                          "Receptor por completar"}
                    </td>
                    <td>
                      {new Date(row.created_at).toLocaleDateString("es-CR", {
                        timeZone: "America/Costa_Rica",
                      })}
                    </td>
                    <td>{row.currency}</td>
                    <td>{row.archived_at ? "Archivado" : "Borrador"}</td>
                    <td>
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => void open(row.id)}
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
        </>
      )}
    </section>
  );
}

function LineTotals({
  calculated,
  line,
  index,
  currency,
}: {
  calculated: Row | null;
  line: Row;
  index: number;
  currency: string;
}) {
  if (!calculated) {
    const single = calculateInvoice([
      {
        ...line,
        quantity: line.quantity || null,
        unit_price: line.unit_price || null,
        fiscal: line.fiscal ?? null,
      },
    ]);
    if (single.status === "complete") calculated = single.lines[0];
  }
  if (!calculated)
    return (
      <p>
        Totales de línea {index + 1} pendientes: completa los datos y el
        tratamiento fiscal.
      </p>
    );
  return (
    <section
      aria-label={"Importes de línea " + (index + 1)}
      className="billing-line-totals"
    >
      <dl className="fiscal-preview-totals">
        {[
          ["Monto bruto", calculated.beforeDiscount],
          ["Descuento calculado", calculated.discount],
          ["Subtotal de línea", calculated.base],
          ["Base imponible", calculated.tax_base ?? calculated.base],
          ["Impuestos antes de exoneraciones", calculated.tax],
          ["Exoneración", calculated.exoneration],
          [
            "Impuesto neto",
            netTaxAmount(calculated.tax, calculated.exoneration),
          ],
          ["Total línea " + (index + 1), calculated.total],
        ].map(([label, amount]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {currency} {amount}
            </dd>
          </div>
        ))}
      </dl>
      {calculated.taxes?.map((tax: Row, i: number) => (
        <p key={i}>
          Impuesto {tax.code} · tarifa {tax.tariff_code || "—"} · {tax.rate} % ·
          monto {currency} {tax.amount} · exonerado {currency} {tax.exoneration}{" "}
          · neto {currency} {netTaxAmount(tax.amount, tax.exoneration)}
        </p>
      ))}
    </section>
  );
}
