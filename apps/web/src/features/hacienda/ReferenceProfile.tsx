import React, { useState } from "react";
import type { Row } from "../billing/common";
import { usePaged } from "../workflow/usePaged";
export function ReferenceProfile({
  base,
  company,
  permissions,
}: {
  base: string;
  company?: Row;
  permissions: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="billing-editor">
      <h3>Empresa y requisitos de emisión</h3>
      <dl>
        <dt>Razón social</dt>
        <dd>{company?.legal_name ?? "Pendiente"}</dd>
        <dt>Identificación registrada</dt>
        <dd>{company?.identification ?? "Pendiente"}</dd>
      </dl>
      <p>
        Los datos de la empresa se usan en ambos ambientes. Revisa la
        identificación antes de registrar la autorización de la llave.
      </p>
      <ul>
        <li>Datos fiscales del emisor y del receptor completos.</li>
        <li>Llave vigente y revisión del administrador para este ambiente.</li>
        <li>Acceso a Hacienda y numeración de este ambiente confirmados.</li>
        <li>En producción, confirmación de una venta real autorizada.</li>
      </ul>
      <p>
        Consulta los requisitos de cada factura en Facturación. Comprobar el
        acceso no implica que Hacienda haya aceptado un documento.
      </p>
      <button
        type="button"
        className="button secondary"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded
          ? "Ocultar datos de referencia"
          : "Ver actividades y puntos de emisión"}
      </button>
      {expanded && (
        <div className="workflow-grid">
          {permissions.includes("tax.read") ? (
            <ReferenceList
              path={base + "/economic-activities"}
              title="Actividades económicas"
            />
          ) : (
            <p>Las actividades requieren permiso de consulta tributaria.</p>
          )}
          {permissions.includes("organization.read") ? (
            <>
              <ReferenceList path={base + "/branches"} title="Sucursales" />
              <ReferenceList path={base + "/terminals"} title="Terminales" />
            </>
          ) : (
            <p>
              Los puntos de emisión requieren permiso de consulta de estructura.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
function ReferenceList({ path, title }: { path: string; title: string }) {
  const list = usePaged(path, { active: "true" });
  return (
    <section>
      <h4>{title}</h4>
      {list.loading && <p>Cargando referencias…</p>}
      {list.error && (
        <p role="alert" className="alert">
          {list.error}
        </p>
      )}
      {!list.loading && !list.error && !list.rows.length && (
        <p>Sin registros activos.</p>
      )}
      <ul>
        {list.rows.map((r) => (
          <li key={r.id}>
            {r.code ? r.code + " · " : ""}
            {r.name}
          </li>
        ))}
      </ul>
      {list.next !== null && (
        <button
          type="button"
          className="button secondary"
          disabled={list.loading}
          onClick={() => void list.loadMore()}
        >
          Más {title.toLowerCase()}
        </button>
      )}
    </section>
  );
}
