import React from "react";
import { OTHER_CHARGE_CODES } from "../../../../../packages/domain/src/invoice-extras";
import { isEconomicActivityCode } from "../../../../../packages/domain/src/economic-activity";
import { Field, type Row } from "./common";

export const PAYMENT_METHODS = [
  ["01", "Efectivo"],
  ["02", "Tarjeta"],
  ["03", "Cheque"],
  ["04", "Transferencia o depósito bancario"],
  ["05", "Recaudación por terceros"],
  ["06", "SINPE Móvil"],
  ["07", "Plataforma digital"],
  ["99", "Otros"],
] as const;

export function commercialDefaults(options: Row, currency = "CRC"): Row {
  const activities = (options.activities ?? []).filter((a: Row) =>
    isEconomicActivityCode(a.code),
  );
  const activity = activities.find((a: Row) => a.is_primary) ?? activities[0];
  const billing = options.issuer?.configuration?.billing ?? {};
  const terminal =
    options.terminals?.find(
      (t: Row) =>
        t.branch_code === billing.branch_code &&
        t.code === billing.terminal_code,
    ) ??
    options.terminals?.find(
      (t: Row) => t.branch_code === billing.branch_code,
    ) ??
    options.terminals?.[0];
  return {
    sale_condition: "01",
    credit_days: "",
    exchange_rate: currency === "CRC" ? "1" : "",
    payment_methods: [],
    branch_code: terminal?.branch_code ?? "",
    terminal_code: terminal?.code ?? "",
    issuer_activity: activity?.code ?? "",
    references: [],
  };
}

export function commercialPayload(value: Row, currency: string): Row {
  return {
    sale_condition: value.sale_condition ?? "01",
    credit_days:
      value.sale_condition === "02" &&
      value.credit_days !== "" &&
      value.credit_days != null
        ? /^\d{1,5}$/.test(String(value.credit_days))
          ? Number(value.credit_days)
          : value.credit_days
        : null,
    exchange_rate: currency === "CRC" ? "1" : (value.exchange_rate ?? ""),
    branch_code: value.branch_code ?? "",
    terminal_code: value.terminal_code ?? "",
    issuer_activity: value.issuer_activity ?? "",
    payment_methods: (value.payment_methods ?? []).map((p: Row) => ({
      code: p.code ?? "",
      amount: p.amount ?? "",
      other_description: p.other_description ?? "",
    })),
    references: value.references ?? [],
  };
}

// The business due date is derived from the Costa Rica calendar, never the browser zone.
export function provisionalDueDate(
  instant: string,
  days: string | number,
): string {
  if (!/^\d{1,5}$/.test(String(days)) || Number(days) < 1) return "";
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return new Date(
    Date.UTC(part("year"), part("month") - 1, part("day") + Number(days)),
  )
    .toISOString()
    .slice(0, 10);
}

export function netTaxAmount(tax: string, exoneration: string): string {
  const decimal = /^\d+(?:\.\d{1,5})?$/;
  if (!decimal.test(tax) || !decimal.test(exoneration)) return "Pendiente";
  const scaled = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * 100000n + BigInt(fraction.padEnd(5, "0"));
  };
  const amount = scaled(tax) - scaled(exoneration);
  if (amount < 0n) return "Pendiente";
  const digits = amount.toString().padStart(6, "0");
  return digits.slice(0, -5) + "." + digits.slice(-5);
}

export function IssuerFields({
  options,
  value,
  onChange,
}: {
  options: Row;
  value: Row;
  onChange: (v: Row) => void;
}) {
  const issuer = options.issuer ?? {};
  const location =
    issuer.configuration?.location ?? issuer.configuration?.fiscal ?? {};
  const terminals = options.terminals ?? [];
  const branches = Array.from(
    new Map(terminals.map((t: Row) => [t.branch_code, t])).values(),
  ) as Row[];
  const activities = options.activities ?? [];
  return (
    <section className="billing-section" aria-labelledby="billing-issuer-title">
      <h3 id="billing-issuer-title">Datos del emisor</h3>
      <p>Información registrada en Mi empresa.</p>
      <dl className="billing-issuer-data">
        {[
          ["Nombre o razón social", issuer.legal_name],
          ["Nombre comercial", issuer.trade_name],
          [
            "Identificación del emisor",
            [issuer.identification_type, issuer.identification]
              .filter(Boolean)
              .join(" · "),
          ],
          ["Correo del emisor", issuer.contact_email],
          [
            "Teléfono del emisor",
            [issuer.configuration?.phone_country_code, issuer.phone]
              .filter(Boolean)
              .join(" "),
          ],
          [
            "Provincia, cantón y distrito del emisor",
            [location.province, location.canton, location.district]
              .filter(Boolean)
              .join(" · "),
          ],
          [
            "Dirección del emisor",
            [location.neighborhood, issuer.address].filter(Boolean).join(" · "),
          ],
        ].map(([label, text]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{text || "Pendiente en Mi empresa"}</dd>
          </div>
        ))}
      </dl>
      <div className="form-grid">
        <label className="field">
          Actividad económica del emisor
          <select
            value={value.issuer_activity ?? ""}
            onChange={(e) =>
              onChange({ ...value, issuer_activity: e.target.value })
            }
          >
            <option value="">Selecciona una actividad registrada…</option>
            {activities.map((a: Row) => (
              <option
                key={a.id ?? a.code}
                value={a.code}
                disabled={!isEconomicActivityCode(a.code)}
              >
                {a.code} · {a.name ?? a.description}
                {!isEconomicActivityCode(a.code) ? " (revisar código)" : ""}
              </option>
            ))}
            {value.issuer_activity &&
              !activities.some(
                (a: Row) => a.code === value.issuer_activity,
              ) && (
                <option value={value.issuer_activity}>
                  {value.issuer_activity} (revisar inscripción en Mi empresa)
                </option>
              )}
          </select>
        </label>
        <label className="field">
          Sucursal
          <select
            value={value.branch_code ?? ""}
            onChange={(e) => {
              const terminal = terminals.find(
                (t: Row) => t.branch_code === e.target.value,
              );
              onChange({
                ...value,
                branch_code: e.target.value,
                terminal_code: terminal?.code ?? "",
              });
            }}
          >
            <option value="">Selecciona…</option>
            {branches.map((b) => (
              <option key={b.branch_code} value={b.branch_code}>
                {b.branch_code} · {b.branch_name}
              </option>
            ))}
            {value.branch_code &&
              !branches.some((b) => b.branch_code === value.branch_code) && (
                <option value={value.branch_code}>
                  {value.branch_code} (revisar configuración)
                </option>
              )}
          </select>
        </label>
        <label className="field">
          Terminal
          <select
            value={value.terminal_code ?? ""}
            onChange={(e) =>
              onChange({ ...value, terminal_code: e.target.value })
            }
          >
            <option value="">Selecciona…</option>
            {terminals
              .filter((t: Row) => t.branch_code === value.branch_code)
              .map((t: Row) => (
                <option key={t.id} value={t.code}>
                  {t.code} · {t.name}
                </option>
              ))}
            {value.terminal_code &&
              !terminals.some(
                (t: Row) =>
                  t.branch_code === value.branch_code &&
                  t.code === value.terminal_code,
              ) && (
                <option value={value.terminal_code}>
                  {value.terminal_code} (revisar configuración)
                </option>
              )}
          </select>
        </label>
      </div>
      {(!activities.length || !terminals.length) && (
        <p className="fiscal-preview-warning">
          Completa las actividades vigentes, sucursal y terminal en Mi empresa
          antes de emitir.
        </p>
      )}
      <details className="billing-disclosure">
        <summary>Identificación del comprobante</summary>
        <dl className="billing-issuer-data">
          <div>
            <dt>Fecha y hora de emisión</dt>
            <dd>Se asignan al emitir · hora de Costa Rica</dd>
          </div>
          <div>
            <dt>Consecutivo y clave numérica</dt>
            <dd>Se asignan al emitir desde la numeración autorizada</dd>
          </div>
          <div>
            <dt>Proveedor del sistema 4.4</dt>
            <dd>
              {options.software_provider_id ||
                "Pendiente de configuración del sistema"}
            </dd>
          </div>
        </dl>
      </details>
    </section>
  );
}

export function CommercialFields({
  currency,
  documentType,
  notes,
  value,
  instant,
  onCurrency,
  onDocumentType,
  onNotes,
  onChange,
  lockDocumentType = false,
}: {
  currency: string;
  documentType: string;
  notes: string;
  value: Row;
  instant: string;
  onCurrency: (v: string) => void;
  onDocumentType: (v: string) => void;
  onNotes: (v: string) => void;
  onChange: (v: Row) => void;
  lockDocumentType?: boolean;
}) {
  const dueDate =
    value.sale_condition === "02"
      ? provisionalDueDate(instant, value.credit_days)
      : "";
  return (
    <section
      className="billing-section"
      aria-labelledby="billing-commercial-title"
    >
      <h3 id="billing-commercial-title">Datos comerciales del comprobante</h3>
      <div className="form-grid">
        <label className="field">
          Tipo de documento
          <select
            value={documentType}
            disabled={lockDocumentType}
            onChange={(e) => onDocumentType(e.target.value)}
          >
            <option value="FE">Factura electrónica</option>
            <option value="TE">Tiquete electrónico</option>
          </select>
        </label>
        <label className="field">
          Moneda del borrador
          <select
            aria-label="Moneda del borrador"
            value={currency}
            onChange={(e) => onCurrency(e.target.value)}
          >
            <option value="CRC">CRC · Colón costarricense</option>
            <option value="USD">USD · Dólar estadounidense</option>
          </select>
        </label>
        <label className="field">
          Tipo de cambio
          <input
            value={currency === "CRC" ? "1" : (value.exchange_rate ?? "")}
            readOnly={currency === "CRC"}
            onChange={(e) =>
              onChange({ ...value, exchange_rate: e.target.value })
            }
            inputMode="decimal"
          />
        </label>
        <label className="field">
          Condición de venta
          <select
            value={value.sale_condition ?? "01"}
            onChange={(e) =>
              onChange({
                ...value,
                sale_condition: e.target.value,
                credit_days:
                  e.target.value === "02" ? (value.credit_days ?? "") : "",
              })
            }
          >
            <option value="01">01 · Contado</option>
            <option value="02">02 · Crédito</option>
          </select>
        </label>
        {value.sale_condition === "02" && (
          <>
            <Field
              label="Plazo de crédito (días)"
              value={String(value.credit_days ?? "")}
              onChange={(v) => onChange({ ...value, credit_days: v })}
              maxLength={5}
            />
            <label className="field">
              Vencimiento provisional (Costa Rica)
              <input value={dueDate} readOnly type="date" />
            </label>
          </>
        )}
      </div>
      {currency === "USD" && (
        <p>Revisa el tipo de cambio aplicable antes de emitir.</p>
      )}
      {value.sale_condition === "02" && (
        <p>
          El vencimiento comercial se calcula en días calendario de Costa Rica y
          se confirma con la fecha de emisión.
        </p>
      )}
      <Field
        label="Observaciones"
        value={notes}
        onChange={onNotes}
        maxLength={2000}
      />
      <ReferenceFields
        value={value.references ?? []}
        onChange={(references) => onChange({ ...value, references })}
      />
    </section>
  );
}

function ReferenceFields({
  value,
  onChange,
}: {
  value: Row[];
  onChange: (v: Row[]) => void;
}) {
  const update = (index: number, key: string, text: string) =>
    onChange(value.map((r, i) => (i === index ? { ...r, [key]: text } : r)));
  return (
    <details className="billing-disclosure">
      <summary>
        Información de referencia
        {value.length ? ` (${value.length})` : " (opcional)"}
      </summary>
      <p>
        Úsala únicamente cuando el comprobante requiera una referencia. La
        validación verifica los códigos oficiales.
      </p>
      {value.map((r, i) => (
        <div className="billing-line" key={i}>
          <div className="form-grid">
            {Object.entries({
              document_type: "Tipo de documento de referencia",
              number: "Número del documento de referencia",
              issue_date: "Fecha de emisión de referencia",
              code: "Código de referencia",
              reason: "Razón de referencia",
            }).map(([key, label]) => (
              <Field
                key={key}
                label={`${label} ${i + 1}`}
                value={r[key] ?? ""}
                onChange={(v) => update(i, key, v)}
                maxLength={
                  key === "number"
                    ? 50
                    : key === "reason"
                      ? 180
                      : key === "issue_date"
                        ? 35
                        : 2
                }
              />
            ))}
            {r.document_type === "99" && (
              <Field
                label={`Otro documento de referencia ${i + 1}`}
                value={r.document_other ?? ""}
                onChange={(v) => update(i, "document_other", v)}
                maxLength={100}
              />
            )}
            {r.code === "99" && (
              <Field
                label={`Otro código de referencia ${i + 1}`}
                value={r.code_other ?? ""}
                onChange={(v) => update(i, "code_other", v)}
                maxLength={100}
              />
            )}
          </div>
          <button
            type="button"
            className="button secondary"
            onClick={() => onChange(value.filter((_, n) => n !== i))}
          >
            Quitar referencia {i + 1}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button secondary"
        disabled={value.length >= 10}
        onClick={() =>
          onChange([
            ...value,
            {
              document_type: "",
              document_other: "",
              number: "",
              issue_date: "",
              code: "",
              code_other: "",
              reason: "",
            },
          ])
        }
      >
        Agregar referencia
      </button>
    </details>
  );
}

export function OtherChargesFields({
  value,
  onChange,
  calculation,
}: {
  value: Row[];
  onChange: (v: Row[]) => void;
  calculation?: Row | null;
}) {
  const update = (index: number, key: string, text: string) =>
    onChange(value.map((r, i) => (i === index ? { ...r, [key]: text } : r)));
  return (
    <section
      className="billing-section"
      aria-labelledby="billing-charges-title"
    >
      <h3 id="billing-charges-title">Otros cargos</h3>
      <div className="billing-charge-fields">
        <p>
          Los cargos se suman al comprobante. Si usas un porcentaje, define su
          base comercial explícita según el cargo.
        </p>
        {value.map((charge, i) => (
          <div className="billing-line" key={i}>
            <h4>Cargo {i + 1}</h4>
            <div className="form-grid">
              <label className="field">
                Tipo de cargo {i + 1}
                <select
                  value={charge.code}
                  onChange={(e) => update(i, "code", e.target.value)}
                >
                  <option value="">Selecciona…</option>
                  {OTHER_CHARGE_CODES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <Field
                label={`Descripción del cargo ${i + 1}`}
                value={charge.description ?? ""}
                onChange={(v) => update(i, "description", v)}
                maxLength={160}
              />
              {charge.code === "99" && (
                <Field
                  label={`Tipo de otro cargo ${i + 1}`}
                  value={charge.other_description ?? ""}
                  onChange={(v) => update(i, "other_description", v)}
                  maxLength={100}
                />
              )}
              <label className="field">
                Modalidad del cargo {i + 1}
                <select
                  value={charge.mode ?? "amount"}
                  onChange={(e) => update(i, "mode", e.target.value)}
                >
                  <option value="amount">Monto fijo</option>
                  <option value="percentage">Porcentaje</option>
                </select>
              </label>
              {charge.mode === "percentage" ? (
                <>
                  <Field
                    label={`Porcentaje del cargo ${i + 1}`}
                    value={charge.percentage ?? ""}
                    onChange={(v) => update(i, "percentage", v)}
                  />
                  <Field
                    label={`Base para el porcentaje del cargo ${i + 1}`}
                    value={charge.percentage_base ?? ""}
                    onChange={(v) => update(i, "percentage_base", v)}
                  />
                </>
              ) : (
                <Field
                  label={`Monto del cargo ${i + 1}`}
                  value={charge.amount ?? ""}
                  onChange={(v) => update(i, "amount", v)}
                />
              )}
              {charge.code === "04" && (
                <>
                  <label className="field">
                    Tipo de identificación del tercero {i + 1}
                    <select
                      value={charge.third_party_type ?? ""}
                      onChange={(e) =>
                        update(i, "third_party_type", e.target.value)
                      }
                    >
                      <option value="">Selecciona…</option>
                      {[
                        ["01", "Física"],
                        ["02", "Jurídica"],
                        ["03", "DIMEX"],
                        ["04", "NITE"],
                        ["05", "Extranjero no domiciliado"],
                        ["06", "No contribuyente"],
                      ].map(([code, label]) => (
                        <option key={code} value={code}>
                          {code} · {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Field
                    label={`Identificación del tercero ${i + 1}`}
                    value={charge.third_party_identification ?? ""}
                    onChange={(v) => update(i, "third_party_identification", v)}
                    maxLength={20}
                  />
                  <Field
                    label={`Nombre del tercero ${i + 1}`}
                    value={charge.third_party_name ?? ""}
                    onChange={(v) => update(i, "third_party_name", v)}
                    maxLength={100}
                  />
                </>
              )}
            </div>
            {calculation?.status === "complete" && (
              <p>
                Monto calculado del cargo:{" "}
                <strong>
                  {calculation.charges?.[i]?.calculated_amount ?? "—"}
                </strong>
              </p>
            )}
            <button
              type="button"
              className="button secondary"
              onClick={() => onChange(value.filter((_, n) => n !== i))}
            >
              Quitar cargo {i + 1}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button secondary"
          disabled={value.length >= 15}
          onClick={() =>
            onChange([
              ...value,
              {
                code: "",
                other_description: "",
                description: "",
                third_party_type: "",
                third_party_identification: "",
                third_party_name: "",
                mode: "amount",
                amount: "",
                percentage: "",
                percentage_base: "",
              },
            ])
          }
        >
          Agregar otro cargo
        </button>
      </div>
    </section>
  );
}

export function PaymentFields({
  value,
  saleCondition,
  currency,
  total,
  onChange,
}: {
  value: Row[];
  saleCondition: string;
  currency: string;
  total?: string;
  onChange: (v: Row[]) => void;
}) {
  const update = (index: number, key: string, text: string) =>
    onChange(value.map((r, i) => (i === index ? { ...r, [key]: text } : r)));
  return (
    <section
      className="billing-section"
      aria-labelledby="billing-payments-title"
    >
      <h3 id="billing-payments-title">Medios de pago</h3>
      <p>
        {saleCondition === "02"
          ? "En crédito pueden omitirse los medios de pago. Si combinas varios, sus importes deben conciliar con el comprobante."
          : "Distribuye el total entre los medios de pago. La validación compara los importes con precisión decimal."}
      </p>
      {value.map((payment, i) => (
        <div className="billing-line" key={i}>
          <div className="form-grid">
            <label className="field">
              Medio de pago {i + 1}
              <select
                value={payment.code}
                onChange={(e) => update(i, "code", e.target.value)}
              >
                {PAYMENT_METHODS.map(([code, label]) => (
                  <option key={code} value={code}>
                    {code} · {label}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label={`Importe de pago ${i + 1}`}
              value={payment.amount ?? ""}
              onChange={(v) => update(i, "amount", v)}
            />
            {payment.code === "99" && (
              <Field
                label={`Descripción de otro medio de pago ${i + 1}`}
                value={payment.other_description ?? ""}
                onChange={(v) => update(i, "other_description", v)}
                maxLength={100}
              />
            )}
          </div>
          <button
            type="button"
            className="button secondary"
            onClick={() => onChange(value.filter((_, n) => n !== i))}
          >
            Quitar medio de pago {i + 1}
          </button>
        </div>
      ))}
      <div className="billing-actions">
        <button
          type="button"
          className="button secondary"
          disabled={value.length >= 4}
          onClick={() =>
            onChange([
              ...value,
              { code: "01", amount: "", other_description: "" },
            ])
          }
        >
          Agregar medio de pago
        </button>
        {total && (
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              onChange([
                {
                  code: value[0]?.code ?? "01",
                  amount: total,
                  other_description: value[0]?.other_description ?? "",
                },
              ])
            }
          >
            Asignar total a un medio ({currency} {total})
          </button>
        )}
      </div>
    </section>
  );
}

export function InvoiceSummary({
  calculation,
  currency,
}: {
  calculation: Row | null;
  currency: string;
}) {
  return (
    <section
      className="fiscal-preview-panel billing-invoice-summary"
      aria-label="Totales calculados del borrador"
    >
      <h3>Resumen de la factura</h3>
      {calculation?.status === "complete" ? (
        <>
          <dl className="fiscal-preview-totals">
            {[
              ["Total de venta", calculation.beforeDiscount],
              ["Total de descuentos", calculation.discounts],
              ["Total de venta neta", calculation.subtotal],
              ["Impuestos antes de exoneraciones", calculation.tax],
              ["Exoneraciones", calculation.exonerations],
              [
                "Total de impuestos",
                netTaxAmount(calculation.tax, calculation.exonerations),
              ],
              ["Total de otros cargos", calculation.otherCharges ?? "0.00000"],
              ["Total de IVA devuelto", calculation.ivaReturned ?? "0.00000"],
              ["Total del comprobante", calculation.total],
            ].map(([label, amount]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <output aria-label={label}>
                    {currency} {amount}
                  </output>
                </dd>
              </div>
            ))}
          </dl>
          <details className="billing-disclosure">
            <summary>Mostrar u ocultar el desglose de totales</summary>
            <div className="billing-table">
              <table>
                <caption>Servicios y mercancías antes de descuentos</caption>
                <thead>
                  <tr>
                    <th>Clasificación</th>
                    <th>Gravados</th>
                    <th>Exentos</th>
                    <th>Exonerados</th>
                    <th>No sujetos</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["services", "Servicios"],
                    ["goods", "Mercancías"],
                    ["totals", "Totales"],
                  ].map(([key, label]) => (
                    <tr key={key}>
                      <th>{label}</th>
                      {["taxable", "exempt", "exonerated", "non_subject"].map(
                        (treatment) => (
                          <td key={treatment}>
                            {currency}{" "}
                            {calculation.summary?.[key]?.[treatment] ?? "—"}
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="billing-table">
              <table>
                <caption>Desglose de impuestos</caption>
                <thead>
                  <tr>
                    <th>Impuesto y tarifa</th>
                    <th>Base imponible</th>
                    <th>Impuestos antes de exoneraciones</th>
                    <th>Exoneración</th>
                    <th>Impuesto neto</th>
                  </tr>
                </thead>
                <tbody>
                  {calculation.groups?.map((group: Row, i: number) => (
                    <tr key={i}>
                      <td>
                        {group.tax_code} · {group.tariff_code || "—"} (
                        {group.rate} %)
                      </td>
                      <td>
                        {currency} {group.base}
                      </td>
                      <td>
                        {currency} {group.tax}
                      </td>
                      <td>
                        {currency} {group.exoneration}
                      </td>
                      <td>
                        {currency} {netTaxAmount(group.tax, group.exoneration)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              IVA devuelto: requiere elegibilidad oficial de servicios de salud
              y pago con tarjeta. Los casos que requieren datos no verificados
              se bloquean para revisión.
            </p>
          </details>
        </>
      ) : (
        <>
          <strong>Preparación fiscal incompleta</strong>
          <ul>
            {calculation?.issues?.map((issue: Row, i: number) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
          <p>
            Puedes guardar el borrador y completar los datos después. Los
            totales se muestran cuando todas las líneas y cargos son
            calculables.
          </p>
        </>
      )}
    </section>
  );
}
