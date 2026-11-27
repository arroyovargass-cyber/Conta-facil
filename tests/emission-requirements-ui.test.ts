import { expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmissionRequirements } from "../apps/web/src/features/billing/EmissionRequirements";

it("shows server requirements individually, with accessible statuses and configuration destinations", () => {
  const html = renderToStaticMarkup(
    React.createElement(EmissionRequirements, {
      requirements: [
        {
          code: "issuer",
          label: "Datos del emisor",
          status: "complete",
          target: "company",
        },
        {
          code: "credentials",
          label: "Credenciales API",
          status: "blocked",
          message: "Verifica la conexión en Pruebas.",
          target: "hacienda",
        },
        {
          code: "receiver",
          label: "Receptor",
          status: "pending",
          message: "Revisar el XML.",
          target: "invoice",
        },
        {
          code: "email",
          label: "Correo",
          status: "not_applicable",
          message: "No solicitado.",
        },
      ],
      onConfigure: () => {},
      onEdit: () => {},
      onNumbering: () => {},
    }),
  );
  for (const status of [
    "Cumplido",
    "Bloqueo de emisión",
    "Pendiente de revisión",
    "No aplica",
  ])
    expect(html).toContain(status);
  expect(html).toContain("Ir a configurar: Credenciales API");
  expect(html).toContain("Ir a configurar: Receptor");
  expect(html).not.toContain("Ir a configurar: Datos del emisor");
  expect(html).not.toContain("Aceptado por Hacienda");
});
