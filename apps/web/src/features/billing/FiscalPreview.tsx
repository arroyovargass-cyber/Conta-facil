import React, { useRef, useState } from "react";
import { post } from "../../api/client";
import type { FiscalPreviewResult } from "../../../../../packages/domain/src/fiscal-preview";
import { useAlive } from "./common";
type Response = FiscalPreviewResult & {
  draft_id: string;
  draft_version: number;
};
export function FiscalPreview({
  base,
  draftId,
  version,
  dirty,
  disabled,
  generation,
  isCurrent,
  onConflict,
}: {
  base: string;
  draftId: string;
  version: number;
  dirty: boolean;
  disabled: boolean;
  generation: number;
  isCurrent: (generation: number) => boolean;
  onConflict: () => void;
}) {
  const alive = useAlive(),
    pending = useRef(false);
  const [open, setOpen] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [loading, setLoading] = useState(false),
    [result, setResult] = useState<Response | null>(null),
    [error, setError] = useState("");
  async function calculate() {
    if (pending.current || !confirmed || dirty || disabled) return;
    pending.current = true;
    setLoading(true);
    setResult(null);
    setError("");
    try {
      const data = (await post(
        base + "/invoice-drafts/" + draftId + "/fiscal-preview",
        {
          profile: "FE_CRC_CASH_IVA13",
          expected_version: version,
          confirmed_general_vat: true,
        },
      )) as Response;
      if (alive.current && isCurrent(generation)) setResult(data);
    } catch (e: any) {
      if (alive.current && isCurrent(generation)) {
        setError(e.message);
        if (e.status === 409) onConflict();
      }
    } finally {
      pending.current = false;
      if (alive.current && isCurrent(generation)) setLoading(false);
    }
  }
  return (
    <section className="fiscal-preview" aria-label="Vista previa de impuestos">
      <button
        type="button"
        className="button secondary"
        disabled={disabled || loading}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setConfirmed(false);
          setResult(null);
          setError("");
        }}
      >
        Vista previa de impuestos
      </button>
      {open && (
        <div className="fiscal-preview-panel">
          <h3>Vista previa de impuestos — sin validez tributaria</h3>
          <p>
            Simulación de factura nacional en CRC, al contado e IVA general del
            13%, sin descuentos, exoneraciones ni otros impuestos. No determina
            la tarifa legal de un CABYS.
          </p>
          <p>
            La selección es temporal. El XML, la firma y el envío a Hacienda
            siguen inhabilitados.
          </p>
          <label className="billing-check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={loading || disabled}
              onChange={(e) => {
                setConfirmed(e.target.checked);
                setResult(null);
              }}
            />
            Confirmo el escenario: CRC, contado e IVA general del 13%
          </label>
          {dirty && (
            <p className="fiscal-preview-warning">
              Guarda tus cambios antes de calcular.
            </p>
          )}
          <button
            type="button"
            className="button primary"
            disabled={!confirmed || loading || dirty || disabled}
            onClick={() => void calculate()}
          >
            {loading ? "Calculando…" : "Calcular vista previa"}
          </button>
          {error && (
            <div role="alert" className="alert">
              {error}
            </div>
          )}
          {result && (
            <>
              <p className="fiscal-preview-status">
                Versión consultada: {result.draft_version}. Sin validación XSD,
                sin firma y sin envío.
              </p>
              {result.calculation.status === "complete" ? (
                <>
                  <dl className="fiscal-preview-totals">
                    <div>
                      <dt>Base antes de impuestos</dt>
                      <dd>
                        <output aria-label="Base calculada">
                          CRC {result.calculation.base}
                        </output>
                      </dd>
                    </div>
                    <div>
                      <dt>IVA general (13%)</dt>
                      <dd>
                        <output aria-label="IVA calculado">
                          CRC {result.calculation.vat}
                        </output>
                      </dd>
                    </div>
                    <div>
                      <dt>Total con IVA</dt>
                      <dd>
                        <output aria-label="Total calculado con IVA">
                          CRC {result.calculation.total}
                        </output>
                      </dd>
                    </div>
                  </dl>
                  <div className="billing-table">
                    <table>
                      <caption>Detalle del cálculo en CRC</caption>
                      <thead>
                        <tr>
                          <th>Línea</th>
                          <th>Base</th>
                          <th>IVA</th>
                          <th>Total con IVA</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.calculation.lines.map((l) => (
                          <tr key={l.position}>
                            <td>{l.position}</td>
                            <td>{l.base}</td>
                            <td>{l.vat}</td>
                            <td>{l.total}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="fiscal-preview-warning">
                  Cálculo bloqueado. No se presenta un total parcial.
                </p>
              )}
              <h4>Pendientes para la preparación fiscal</h4>
              <ul className="fiscal-preview-issues">
                {result.readiness.issues.map((i, index) => (
                  <li key={index}>
                    {i.position !== undefined && (
                      <strong>Línea {i.position}: </strong>
                    )}
                    <span>{i.message}</span>
                    <small>{i.nextAction}</small>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
