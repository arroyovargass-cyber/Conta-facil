import React, { useEffect, useRef, useState } from "react";
import { apiRequest } from "../../api/client";
import { useAlive, type Row } from "../billing/common";
import type { HaciendaEnvironment } from "../../../../../packages/domain/src/hacienda-environment";
export function CredentialForm({
  base,
  environment = "test",
  revision,
  enabled,
  onSaved,
  onBusyChange,
}: {
  base: string;
  environment?: HaciendaEnvironment;
  revision: number;
  enabled: boolean;
  onSaved: (data: Row) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const form = useRef<HTMLFormElement>(null),
    controller = useRef<AbortController | null>(null),
    alive = useAlive(),
    pending = useRef(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(
    () => () => {
      controller.current?.abort();
      form.current?.reset();
    },
    [],
  );
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending.current || !enabled) return;
    const element = e.currentTarget,
      data = new FormData(element),
      file = data.get("file") as File;
    pending.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    let bytes: Uint8Array | undefined;
    controller.current = new AbortController();
    try {
      if (!file || !file.size || file.size > 2097152)
        throw Error("Selecciona un archivo PKCS#12 de hasta 2 MiB.");
      bytes = new Uint8Array(await file.arrayBuffer());
      if (!alive.current || controller.current.signal.aborted) return;
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const response = await apiRequest(base + "/hacienda/credentials", {
        method: "POST",
        signal: controller.current.signal,
        body: JSON.stringify({
          environment,
          expected_revision: revision,
          username: data.get("username"),
          password: data.get("password"),
          pin: data.get("pin"),
          pkcs12_base64: btoa(binary),
        }),
      });
      if (alive.current) onSaved(response);
    } catch (err: any) {
      if (alive.current && err.name !== "AbortError") setError(err.message);
    } finally {
      bytes?.fill(0);
      element.reset();
      for (const name of ["username", "password", "pin", "file"])
        data.delete(name);
      pending.current = false;
      if (alive.current) {
        setBusy(false);
        onBusyChange?.(false);
      }
    }
  }
  return (
    <form
      ref={form}
      onSubmit={submit}
      autoComplete="off"
      className="billing-editor"
    >
      <h3>
        Credenciales del ambiente de{" "}
        {environment === "production" ? "producción" : "pruebas"}
      </h3>
      <p>
        El usuario y la contraseña de API son distintos del PIN de la llave. Los
        valores se limpian al terminar cada intento.
      </p>
      <p className="form-hint">
        Importar una llave no confirma la identidad tributaria ni habilita firma
        o envío.
      </p>
      {error && (
        <div role="alert" className="alert">
          {error}
        </div>
      )}
      <fieldset disabled={busy || !enabled} className="hacienda-fields">
        <label className="field">
          Usuario de API
          <input name="username" required maxLength={1024} autoComplete="off" />
        </label>
        <label className="field">
          Contraseña de API
          <input
            name="password"
            type="password"
            required
            maxLength={1024}
            autoComplete="new-password"
          />
        </label>
        <label className="field">
          PIN de la llave
          <input
            name="pin"
            type="password"
            required
            maxLength={1023}
            autoComplete="new-password"
          />
        </label>
        <label className="field">
          Llave criptográfica (.p12 o .pfx)
          <input
            name="file"
            type="file"
            accept=".p12,.pfx,application/x-pkcs12"
            required
          />
        </label>
        <p className="form-hint">
          Máximo 2 MiB. El PIN admite hasta 1023 bytes UTF-8, sin saltos de
          línea.
        </p>
        <button className="button primary" disabled={busy || !enabled}>
          {busy
            ? "Validando y guardando…"
            : environment === "production"
              ? "Guardar credenciales de producción"
              : "Guardar credenciales de pruebas"}
        </button>
      </fieldset>
    </form>
  );
}
