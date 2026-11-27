import React, { useEffect, useState } from "react";
import { apiRequest } from "../../api/client";
import { Customers } from "./Customers";
import { Catalog } from "./Catalog";
import { Invoices } from "./Invoices";
import { Drafts } from "./Drafts";
import type { Row } from "./common";
import "./billing.css";
export function BillingWorkspace({
  tenantId,
  view,
  onConfigure,
}: {
  tenantId: string;
  view: "customers" | "catalog" | "drafts" | "invoices";
  permissions: string[];
  onConfigure?: (
    target: "company" | "hacienda" | "organization" | "tax",
  ) => void;
}) {
  const base = "/companies/" + tenantId,
    [options, setOptions] = useState<Row | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void apiRequest(base + "/invoice-options")
      .then((data) => {
        if (live) setOptions(data);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [base]);
  if (error)
    return (
      <div role="alert" className="alert">
        {error}
      </div>
    );
  if (!options) return <p>Cargando permisos…</p>;
  if (view === "customers")
    return (
      <Customers
        base={base}
        canManage={options.permissions.includes("customers.manage")}
      />
    );
  if (view === "catalog")
    return (
      <Catalog
        base={base}
        canManage={options.permissions.includes("catalog.manage")}
      />
    );
  if (view === "invoices")
    return (
      <Invoices
        key={base}
        base={base}
        options={options}
        onConfigure={onConfigure}
      />
    );
  return <Drafts base={base} options={options} />;
}
