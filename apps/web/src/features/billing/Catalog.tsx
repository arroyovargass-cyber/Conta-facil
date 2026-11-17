import React from "react";
import { RecordCatalog } from "./RecordCatalog";
export function Catalog({
  base,
  canManage,
}: {
  base: string;
  canManage: boolean;
}) {
  return (
    <RecordCatalog
      base={base + "/catalog-items"}
      kind="product"
      canManage={canManage}
    />
  );
}
