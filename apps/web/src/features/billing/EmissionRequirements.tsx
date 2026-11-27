import React from "react";
import type { Row } from "./common";

const labels: Record<string, string> = {
  complete: "Cumplido",
  pending: "Pendiente de revisión",
  blocked: "Bloqueo de emisión",
  not_applicable: "No aplica",
};

/** Status and messages come exclusively from the server's emissionReadiness. */
export function EmissionRequirements({
  requirements,
  onConfigure,
  onEdit,
  onNumbering,
}: {
  requirements: Row[];
  onConfigure?: (target: "company" | "hacienda") => void;
  onEdit?: () => void;
  onNumbering: () => void;
}) {
  return (
    <ul
      className="emission-requirements"
      aria-label="Requisitos de emisión verificados por el servidor"
    >
      {requirements.map((requirement) => {
        const unresolved = ["blocked", "pending"].includes(requirement.status);
        const configure =
          requirement.target === "numbering"
            ? onNumbering
            : requirement.target === "invoice"
              ? onEdit
              : ["company", "hacienda"].includes(requirement.target) &&
                  onConfigure
                ? () => onConfigure(requirement.target)
                : undefined;
        return (
          <li key={requirement.code} data-status={requirement.status}>
            <div>
              <strong>{requirement.label}</strong>
              <span className="requirement-status">
                {labels[requirement.status] ?? "Pendiente de revisión"}
              </span>
              {requirement.status !== "complete" && (
                <p>{requirement.message}</p>
              )}
            </div>
            {unresolved && configure && (
              <button
                type="button"
                className="button secondary"
                onClick={configure}
                aria-label={`Ir a configurar: ${requirement.label}`}
              >
                Ir a configurar
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
