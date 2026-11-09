import { it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { MembershipFields } from "../apps/web/src/features/users/membership-fields";
it("selects current permissions rather than the first administrator role", () => {
  const html = renderToStaticMarkup(
    React.createElement(MembershipFields, {
      row: {
        role_ids: ["worker"],
        department_ids: ["maint"],
        scope: "departments",
        active: true,
      },
      roles: [
        { id: "admin", name: "Administrador" },
        { id: "worker", name: "Operativo" },
      ],
      departments: [
        { id: "maint", name: "Mantenimiento" },
        { id: "sales", name: "Ventas" },
      ],
    }),
  );
  expect(html).toContain('value="worker" selected=""');
  expect(html).not.toContain('value="admin" selected=""');
  expect(html).toContain('value="maint" selected=""');
  expect(html).not.toContain('value="sales" selected=""');
});
