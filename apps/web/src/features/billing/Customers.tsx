import React from "react";
import { RecordCatalog } from "./RecordCatalog";
export function Customers({
  base,
  canManage,
}: {
  base: string;
  canManage: boolean;
}) {
  return (
    <RecordCatalog
      base={base + "/customers"}
      kind="customer"
      canManage={canManage}
    />
  );
}
