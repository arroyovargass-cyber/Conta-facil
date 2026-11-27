import { test, expect, type Page } from "@playwright/test";
import { workspace } from "../support/workspace";
import { totp } from "../support/totp";
async function nav(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "Abrir menú", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
}
async function login(page: Page, f: Awaited<ReturnType<typeof workspace>>) {
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
    .getByRole("button", { name: /Empresa Norte/ })
    .filter({ hasText: f.tag })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tu empresa, en orden." }),
  ).toBeVisible();
}
test("occasional sale saves an independent recipient and explicit fiscal totals", async ({
  page,
}, info) => {
  const f = await workspace({ role: "admin", companies: 2 });
  try {
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Ventas')",
      [f.tenants[0]],
    );
    await login(page, f);
    await nav(page, "Borradores");
    await page
      .getByRole("button", { name: "Nuevo borrador", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Tipo de receptor", exact: true })
      .selectOption("occasional");
    await expect(
      page.getByLabel("Guardar cliente para futuras facturas"),
    ).not.toBeChecked();
    await page
      .getByLabel("Nombre del receptor", { exact: true })
      .fill("Receptor ocasional");
    await page
      .getByRole("combobox", { name: "Departamento", exact: true })
      .selectOption({ label: "Ventas" });
    await page
      .getByLabel("Descripción de línea 1", { exact: true })
      .fill("Servicio ocasional");
    await page.getByLabel("Cantidad de línea 1", { exact: true }).fill("2");
    await page.getByLabel("Precio de línea 1", { exact: true }).fill("1000");
    await page
      .getByLabel("Configurar impuestos y descuentos de línea 1", {
        exact: true,
      })
      .check();
    await page.getByLabel("CABYS", { exact: true }).fill("8399000000000");
    await page.getByLabel("Unidad de medida", { exact: true }).fill("Sp");
    await page
      .getByRole("combobox", { name: "Tratamiento tributario", exact: true })
      .selectOption("taxable");
    await page
      .getByRole("combobox", { name: "Tarifa de IVA", exact: true })
      .selectOption("08");
    await expect(
      page
        .getByRole("region", {
          name: "Totales calculados del borrador",
          exact: true,
        })
        .getByText("CRC 2260.00000", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Generar.*vista/ }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Guardar borrador", exact: true })
      .click();
    await expect(
      page.getByRole("status", { name: "Resultado del borrador" }),
    ).toContainText("Borrador guardado");
    expect(
      (
        await f.pool.query(
          "select count(*)::int n from public.customers where tenant_id=$1",
          [f.tenants[0]],
        )
      ).rows[0].n,
    ).toBe(0);
    await page
      .getByRole("button", { name: "Abrir borrador", exact: true })
      .click();
    await expect(
      page.getByLabel("Nombre del receptor", { exact: true }),
    ).toHaveValue("Receptor ocasional");
    await expect(
      page.getByRole("combobox", { name: "Tarifa de IVA", exact: true }),
    ).toHaveValue("08");
    await expect(
      page.getByRole("button", {
        name: "Imprimir borrador sin validez tributaria",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(
      page
        .getByRole("region", { name: "Importes de línea 1", exact: true })
        .getByText("CRC 2260.00000", { exact: true }),
    ).toBeVisible();
    const printedPromise = page.context().waitForEvent("page");
    await page
      .getByRole("button", {
        name: "Imprimir borrador sin validez tributaria",
        exact: true,
      })
      .click();
    const printed = await printedPromise;
    await printed.waitForLoadState();
    await expect(printed.locator("body")).toContainText("2260.00000");
    await expect(printed.locator("body")).toContainText(/sin validez/i);
    await printed.close();
    await page.screenshot({
      path: ".local/preview/fiscal-quick-sale-" + info.project.name + ".png",
      fullPage: true,
      scale: "css",
    });
    await page
      .getByLabel("Observaciones", { exact: true })
      .fill("Cambio pendiente");
    await expect(
      page.getByRole("button", {
        name: "Imprimir borrador sin validez tributaria",
        exact: true,
      }),
    ).toBeDisabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await f.pool.end();
  }
});

test("ignores recipient lookup results after manual edits", async ({
  page,
}) => {
  const f = await workspace({ role: "admin", companies: 2 });
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Ventas')",
      [f.tenants[0]],
    );
    await login(page, f);
    await nav(page, "Borradores");
    await page
      .getByRole("button", { name: "Nuevo borrador", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Tipo de receptor", exact: true })
      .selectOption("occasional");
    await page
      .getByLabel("Identificación tributaria", { exact: true })
      .fill("3101123456");
    let captured: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      captured = resolve;
    });
    await page.route("**/recipient-lookup?*", async (route) => {
      captured();
      await gate;
      await route.fulfill({
        json: {
          available: true,
          recipient: {
            name: "Nombre consultado anterior",
            identification: "3101123456",
          },
        },
      });
    });
    await page
      .getByRole("button", {
        name: "Consultar identificación en Hacienda",
        exact: true,
      })
      .click();
    await pending;
    await page
      .getByLabel("Nombre del receptor", { exact: true })
      .fill("Nombre corregido manualmente");
    const received = page.waitForResponse((r) =>
      r.url().includes("/recipient-lookup?"),
    );
    release();
    await (await received).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(
      page.getByLabel("Nombre del receptor", { exact: true }),
    ).toHaveValue("Nombre corregido manualmente");
  } finally {
    release();
    await f.pool.end();
  }
});
