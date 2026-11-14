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
  await page.getByRole("button", { name: /Empresa Norte/ }).click();
  await expect(
    page.getByRole("heading", { name: "Tu empresa, en orden." }),
  ).toBeVisible();
}
test("creates catalogs and edits, archives and restores a commercial draft", async ({
  page,
}, info) => {
  const f = await workspace({ role: "admin", companies: 2 });
  try {
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Ventas')",
      [f.tenants[0]],
    );
    await login(page, f);
    await nav(page, "Clientes");
    await page
      .getByRole("button", { name: "Nuevo cliente", exact: true })
      .click();
    await page.getByLabel("Nombre del cliente").fill("Cliente de prueba");
    await page
      .getByRole("button", { name: "Guardar cliente", exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: "Cliente de prueba", exact: true }),
    ).toBeVisible();
    await nav(page, "Productos y servicios");
    await page
      .getByRole("button", { name: "Nuevo producto o servicio", exact: true })
      .click();
    await page.getByLabel("Código comercial").fill("S1");
    await page
      .getByLabel("Descripción", { exact: true })
      .fill("Servicio de prueba");
    await page.getByLabel("Precio unitario", { exact: true }).fill("0.2");
    await page
      .getByRole("button", { name: "Guardar producto", exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: "Servicio de prueba", exact: true }),
    ).toBeVisible();
    await nav(page, "Borradores");
    await page
      .getByRole("button", { name: "Nuevo borrador", exact: true })
      .click();
    await page
      .getByLabel("Cliente", { exact: true })
      .selectOption({ label: "Cliente de prueba" });
    await page
      .getByLabel("Departamento", { exact: true })
      .selectOption({ label: "Ventas" });
    await page
      .getByLabel("Producto de línea 1", { exact: true })
      .selectOption({ label: "Servicio de prueba" });
    await page.getByLabel("Cantidad de línea 1").fill("0.1");
    await page
      .getByRole("button", { name: "Guardar borrador", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Borrador guardado");
    await expect(
      page.getByText("Borrador — sin validez tributaria", { exact: true }),
    ).toBeVisible();
    await f.pool.query(
      "update public.customers set active=false where tenant_id=$1",
      [f.tenants[0]],
    );
    await f.pool.query(
      "update public.catalog_items set active=false where tenant_id=$1",
      [f.tenants[0]],
    );
    await page
      .getByRole("button", { name: "Abrir borrador", exact: true })
      .click();
    await expect(page.getByLabel("Cantidad de línea 1")).toHaveValue("0.10000");
    await expect(page.getByText("CRC 0.02", { exact: true })).toBeVisible();
    await page.getByLabel("Observaciones").fill("Revisar antes de emitir");
    await page
      .getByRole("button", { name: "Guardar borrador", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Borrador guardado");
    await page
      .getByRole("button", { name: "Abrir borrador", exact: true })
      .click();
    await expect(page.getByLabel("Observaciones")).toHaveValue(
      "Revisar antes de emitir",
    );
    await page.screenshot({
      path: ".local/preview/conta-facil-phase2a-" + info.project.name + ".png",
      scale: "css",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Archivar borrador", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Borrador archivado");
    await page.getByLabel("Estado de borradores").selectOption("true");
    await page
      .getByRole("button", { name: "Abrir borrador", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Restaurar borrador", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Borrador restaurado");
  } finally {
    await f.pool.end();
  }
});
test("retains entered values after a concurrent edit conflict", async ({
  page,
}) => {
  const f = await workspace({ role: "admin", companies: 2 });
  try {
    await login(page, f);
    await nav(page, "Clientes");
    await page
      .getByRole("button", { name: "Nuevo cliente", exact: true })
      .click();
    await page.getByLabel("Nombre del cliente").fill("Cliente original");
    await page
      .getByRole("button", { name: "Guardar cliente", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Editar cliente", exact: true })
      .click();
    await page.getByLabel("Nombre del cliente").fill("Cambio local");
    await f.pool.query(
      "update public.customers set name='Cambio remoto',version=version+1 where tenant_id=$1",
      [f.tenants[0]],
    );
    await page
      .getByRole("button", { name: "Guardar cliente", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("Recarga");
    await expect(page.getByLabel("Nombre del cliente")).toHaveValue(
      "Cambio local",
    );
    await page
      .getByRole("button", { name: "Recargar registro", exact: true })
      .click();
    await expect(page.getByLabel("Nombre del cliente")).toHaveValue(
      "Cambio remoto",
    );
  } finally {
    await f.pool.end();
  }
});

test("discards delayed catalog responses after changing company", async ({
  page,
}) => {
  const f = await workspace({ role: "admin", companies: 2 });
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  try {
    await f.pool.query(
      "insert into public.customers(tenant_id,name) values($1,'Dato reservado Norte')",
      [f.tenants[0]],
    );
    await login(page, f);
    let intercepted: () => void = () => {};
    const pending = new Promise<void>((r) => {
      intercepted = r;
    });
    await page.route(
      "**/api/companies/" + f.tenants[0] + "/customers?*",
      async (route) => {
        const response = await route.fetch();
        intercepted();
        await gate;
        await route.fulfill({ response });
      },
    );
    await nav(page, "Clientes");
    await pending;
    const menu = page.getByRole("button", { name: "Abrir menú", exact: true });
    if (await menu.isVisible()) await menu.click();
    await page
      .getByRole("button", { name: /Empresa Norte Espacio de empresa/ })
      .click();
    await page.getByRole("button", { name: /Empresa Sur/ }).click();
    await nav(page, "Clientes");
    await expect(
      page.getByText("No hay registros para estos filtros."),
    ).toBeVisible();
    release();
    await expect(
      page.getByRole("cell", { name: "Dato reservado Norte", exact: true }),
    ).toHaveCount(0);
  } finally {
    release();
    await f.pool.end();
  }
});
