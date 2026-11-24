import { test, expect, type Page } from "@playwright/test";
import { workspace } from "../support/workspace";
import { totp } from "../support/totp";
async function login(
  page: Page,
  f: Awaited<ReturnType<typeof workspace>>,
  selectCompany = true,
) {
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Tipo de identificación", exact: true })
    .selectOption("other");
  await page.getByLabel("Número de identificación").fill(f.identification);
  await page.getByLabel("Contraseña", { exact: true }).fill(f.password);
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await page.getByRole("button", { name: "Configurar autenticador" }).click();
  await page.getByText("Usar clave manual", { exact: true }).click();
  await page
    .getByLabel("Código de 6 dígitos")
    .fill(totp(await page.locator("details code").innerText()));
  await page.getByRole("button", { name: "Verificar y continuar" }).click();
  if (!selectCompany) return;
  await page.getByRole("button", { name: /Empresa Norte/ }).click();
  const menu = page.getByRole("button", { name: "Abrir menú", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Mi empresa", exact: true })
    .click();
}
test("owner creates and reopens a basic company with six configuration tabs", async ({
  page,
}) => {
  const f = await workspace({ role: "admin", companies: 2, systemAdmin: true });
  try {
    await login(page, f);
    await page
      .getByRole("button", { name: "Nueva empresa", exact: true })
      .click();
    await page
      .getByLabel("Razón social *", { exact: true })
      .fill("Empresa del formulario");
    await page
      .getByRole("combobox", { name: "Tipo de persona *", exact: true })
      .selectOption("legal");
    await page
      .getByRole("combobox", { name: "Tipo de identificación *", exact: true })
      .selectOption("02");
    await page
      .getByLabel("Número de identificación *", { exact: true })
      .fill("3101" + String(Date.now()).slice(-6));
    await page
      .getByRole("button", { name: "Guardar empresa", exact: true })
      .click();
    await expect(
      page.getByText("Empresa guardada.", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: /Empresa del formulario/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Empresa del formulario/ }).click();
    const menu = page.getByRole("button", { name: "Abrir menú", exact: true });
    if (await menu.isVisible()) await menu.click();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Mi empresa", exact: true })
      .click();
    await expect(
      page.getByLabel("Razón social *", { exact: true }),
    ).toHaveValue("Empresa del formulario");
    await expect(page.getByRole("tab")).toHaveCount(6);
    await page
      .getByRole("button", { name: "Editar empresa", exact: true })
      .click();
    await page
      .getByRole("tab", { name: "Facturación electrónica", exact: true })
      .click();
    await page
      .getByLabel("Código de sucursal · 3 dígitos", { exact: true })
      .fill("001");
    await page
      .getByLabel("Código de terminal · 5 dígitos", { exact: true })
      .fill("00001");
    await page
      .getByRole("tab", { name: "Configuración contable", exact: true })
      .click();
    await page.getByLabel("Manejo de bancos").check();
    await page
      .getByRole("button", { name: "Guardar empresa", exact: true })
      .click();
    await expect(
      page.getByText("Empresa guardada.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("tab", { name: "Facturación electrónica", exact: true })
      .click();
    await expect(
      page.getByText(/Factura electrónica · terminal .* último consecutivo 0/),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  } finally {
    await f.pool.end();
  }
});
test("ordinary administrator cannot see create-company controls", async ({
  page,
}) => {
  const f = await workspace({ role: "admin", companies: 2 });
  try {
    await login(page, f);
    await expect(
      page.getByText(
        "Solo el superadministrador puede modificar los datos empresariales.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Nueva empresa", exact: true }),
    ).toHaveCount(0);
  } finally {
    await f.pool.end();
  }
});
test("owner can reopen an inactive company when no active companies remain", async ({
  page,
}) => {
  const f = await workspace({ role: "admin", companies: 2, systemAdmin: true });
  try {
    await f.pool.query(
      "update public.tenants set active=false where id=any($1::uuid[])",
      [f.tenants],
    );
    await page.goto("/");
    await page
      .getByRole("combobox", { name: "Tipo de identificación", exact: true })
      .selectOption("other");
    await page.getByLabel("Número de identificación").fill(f.identification);
    await page.getByLabel("Contraseña", { exact: true }).fill(f.password);
    await page
      .getByRole("button", { name: "Iniciar sesión", exact: true })
      .click();
    await page.getByRole("button", { name: "Configurar autenticador" }).click();
    await page.getByText("Usar clave manual", { exact: true }).click();
    await page
      .getByLabel("Código de 6 dígitos")
      .fill(totp(await page.locator("details code").innerText()));
    await page.getByRole("button", { name: "Verificar y continuar" }).click();
    await page
      .getByRole("button", {
        name: /Administrar inactiva: Empresa de prueba Norte/,
      })
      .click();
    await expect(
      page.getByRole("button", { name: "Editar empresa", exact: true }),
    ).toBeVisible();
  } finally {
    await f.pool.end();
  }
});

test("owner without assigned companies can start the first company", async ({
  page,
}) => {
  const f = await workspace({ role: "admin", companies: 0, systemAdmin: true });
  try {
    await login(page, f, false);
    await page
      .getByRole("button", { name: "Nueva empresa", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Nueva empresa", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Razón social *", { exact: true }),
    ).toBeEditable();
  } finally {
    await f.pool.end();
  }
});
test("failed complete company load never enables editing partial overview data", async ({
  page,
}) => {
  const f = await workspace({ role: "admin", companies: 2, systemAdmin: true });
  try {
    await page.route("**/api/company-administration/" + f.tenants[0], (r) =>
      r.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          message: "Detalle temporalmente no disponible.",
        }),
      }),
    );
    await login(page, f);
    await expect(page.getByRole("alert")).toContainText(
      "Detalle temporalmente no disponible.",
    );
    await expect(
      page.getByRole("button", { name: "Editar empresa", exact: true }),
    ).toHaveCount(0);
  } finally {
    await f.pool.end();
  }
});
