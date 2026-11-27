import React, { useEffect, useRef, useState } from "react";
import { apiRequest, post } from "../../api/client";
import { Field, useAlive } from "./common";
import type { HaciendaEnvironment } from "../../../../../packages/domain/src/hacienda-environment";

type NumberingItem = {
  branch_code: string;
  terminal_code: string;
  last_value: string;
  legacy_floor: string;
  confirmed_at: string | null;
};
type NumberingOptions = { canConfirm: boolean; items: NumberingItem[] };

export function NumberingConfirmation(props: {
  base: string;
  environment: HaciendaEnvironment;
  documentType?: "FE" | "TE";
  onConfirmed?: () => void;
}) {
  return (
    <ConfirmationForm
      key={props.base + ":" + props.environment + ":" + props.documentType}
      {...props}
    />
  );
}

function ConfirmationForm({
  base,
  environment,
  documentType: initialDocumentType = "FE",
  onConfirmed,
}: {
  base: string;
  environment: HaciendaEnvironment;
  documentType?: "FE" | "TE";
  onConfirmed?: () => void;
}) {
  const alive = useAlive();
  const pending = useRef(false);
  const [options, setOptions] = useState<NumberingOptions | null>(null);
  const [documentType, setDocumentType] = useState<"FE" | "TE">(
    initialDocumentType,
  );
  const [selection, setSelection] = useState("");
  const [value, setValue] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const label = environment === "production" ? "producción" : "pruebas";
  const path =
    base +
    "/invoices/numbering-options?environment=" +
    environment +
    (documentType === "TE" ? "&document_type=TE" : "");
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    apiRequest<NumberingOptions>(path, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!cancelled && alive.current) setOptions(data);
      })
      .catch((error: { status?: number }) => {
        // Do not expose an owner-only form when permission cannot be verified.
        if (!cancelled && alive.current)
          setError(
            error.status === 403
              ? "Solo el superadministrador autorizado con MFA puede confirmar la numeración."
              : "No se pudo comprobar el permiso para configurar la numeración. Vuelve a abrir Facturación.",
          );
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [path, alive]);
  const item = options?.items.find(
    (row) => row.branch_code + "/" + row.terminal_code === selection,
  );
  const valid = Boolean(
    item &&
    /^\d{1,10}$/.test(value) &&
    /^\d+$/.test(item.last_value) &&
    /^\d+$/.test(item.legacy_floor) &&
    BigInt(value) >= BigInt(item.last_value) &&
    BigInt(value) >= BigInt(item.legacy_floor),
  );
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      pending.current ||
      !options?.canConfirm ||
      !item ||
      !confirmed ||
      !valid
    )
      return;
    pending.current = true;
    setBusy(true);
    setError("");
    setSuccess(false);
    try {
      await post(base + "/invoices/numbering", {
        environment,
        document_type: documentType,
        branch_code: item.branch_code,
        terminal_code: item.terminal_code,
        starting_value: value,
      });
      if (!alive.current) return;
      setSuccess(true);
      setConfirmed(false);
      onConfirmed?.();
      const data = await apiRequest<NumberingOptions>(path);
      if (alive.current) setOptions(data);
    } catch (e: any) {
      if (alive.current) setError(e.message);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  if (!options)
    return (
      <p role={error ? "alert" : undefined}>
        {error || "Consultando configuración de numeración…"}
      </p>
    );
  if (!options.canConfirm)
    return (
      <p>
        Solo el superadministrador autorizado con MFA puede confirmar la
        numeración.
      </p>
    );
  return (
    <details>
      <summary>Numeración de {label}</summary>
      <form onSubmit={submit}>
        <p>
          Confirma el último consecutivo utilizado en el ambiente de {label}.
        </p>
        <fieldset disabled={busy}>
          <label className="field">
            Tipo de documento de la numeración
            <select
              value={documentType}
              onChange={(event) => {
                setDocumentType(event.target.value as "FE" | "TE");
                setSelection("");
                setValue("");
                setConfirmed(false);
                setSuccess(false);
                setError("");
              }}
            >
              <option value="FE">Factura electrónica</option>
              <option value="TE">Tiquete electrónico</option>
            </select>
          </label>
          <label className="field">
            Sucursal / terminal
            <select
              required
              value={selection}
              onChange={(event) => {
                setSelection(event.target.value);
                setValue("");
                setConfirmed(false);
                setSuccess(false);
                setError("");
              }}
            >
              <option value="">Selecciona…</option>
              {options.items.map((row) => {
                const key = row.branch_code + "/" + row.terminal_code;
                return (
                  <option key={key} value={key}>
                    {row.branch_code} / {row.terminal_code}
                  </option>
                );
              })}
            </select>
          </label>
          {item && (
            <>
              <p>Último consecutivo registrado: {item.last_value}</p>
              <p>Piso histórico: {item.legacy_floor}</p>
              <Field
                label="Último consecutivo confirmado"
                value={value}
                required
                maxLength={10}
                onChange={(next) => {
                  setValue(next);
                  setConfirmed(false);
                  setSuccess(false);
                }}
              />
              {value && !valid && (
                <p role="alert">
                  Ingresa hasta 10 dígitos, sin disminuir el último consecutivo
                  ni el piso histórico.
                </p>
              )}
            </>
          )}
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            Confirmo que esta numeración corresponde al ambiente de {label} y
            que el último consecutivo es correcto
          </label>
          <button
            className="button primary"
            disabled={busy || !valid || !confirmed}
          >
            {busy ? "Confirmando…" : "Confirmar numeración de " + label}
          </button>
        </fieldset>
      </form>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p role="status">
          Numeración de {label} confirmada. Esto no activa el envío a Hacienda.
        </p>
      )}
    </details>
  );
}
