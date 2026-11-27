import { expect, test, type Page } from "@playwright/test";
import { workspace } from "../support/workspace";
import { totp } from "../support/totp";

async function openCompany(
  page: Page,
  fixture: Awaited<ReturnType<typeof workspace>>,
) {
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Tipo de identificación", exact: true })
    .selectOption("other");
  await page
    .getByLabel("Número de identificación")
    .fill(fixture.identification);
  await page.getByLabel("Contraseña", { exact: true }).fill(fixture.password);
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
    .filter({ hasText: fixture.tag })
    .click();
  const menu = page.getByRole("button", { name: "Abrir menú", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Mi empresa", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Editar empresa", exact: true })
    .click();
}

test("saves fiscal address while discarding only new empty activity rows", async ({
  page,
}) => {
  const f = await workspace({ role: "admin", companies: 2, systemAdmin: true });
  try {
    await openCompany(page, f);
    await page
      .getByRole("tab", { name: "Información tributaria", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Agregar actividad económica", exact: true })
      .click();
    await page
      .getByRole("tab", { name: "Domicilio fiscal", exact: true })
      .click();
    await page
      .getByLabel("Otras señas", { exact: true })
      .fill("Domicilio fiscal guardado desde el navegador");
    await page
      .getByRole("button", { name: "Guardar empresa", exact: true })
      .click();
    await expect(
      page.getByText("Empresa guardada.", { exact: true }),
    ).toBeVisible();
    const stored = (
      await f.pool.query(
        "select address,updated_by,configuration_version from public.tenants where id=$1",
        [f.tenants[0]],
      )
    ).rows[0];
    expect(stored).toMatchObject({
      address: "Domicilio fiscal guardado desde el navegador",
      updated_by: f.userId,
      configuration_version: 2,
    });
    expect(
      (
        await f.pool.query(
          "select count(*)::int n from public.economic_activities where tenant_id=$1",
          [f.tenants[0]],
        )
      ).rows[0].n,
    ).toBe(0);
    for (const name of [
      "Información general",
      "Domicilio fiscal",
      "Información tributaria",
      "Facturación electrónica",
      "Configuración contable",
      "Usuarios y permisos",
    ]) {
      await page
        .getByRole("button", { name: "Editar empresa", exact: true })
        .click();
      await page.getByRole("tab", { name, exact: true }).click();
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/company-administration/" + f.tenants[0]) &&
          r.request().method() === "PATCH",
      );
      await page
        .getByRole("button", { name: "Guardar empresa", exact: true })
        .click();
      expect((await response).status()).toBe(200);
      await expect(
        page.getByRole("button", { name: "Editar empresa", exact: true }),
      ).toBeVisible();
    }
    const final = (
      await f.pool.query(
        "select configuration_version,updated_by from public.tenants where id=$1",
        [f.tenants[0]],
      )
    ).rows[0];
    expect(final).toEqual({ configuration_version: 8, updated_by: f.userId });
  } finally {
    await f.pool.end();
  }
});

test("can remove unsaved activities but retains the persisted row", async ({
  page,
}) => {
  const f = await workspace({ role: "admin", companies: 2, systemAdmin: true });
  try {
    await f.pool.query(
      "insert into public.economic_activities(tenant_id,code,name,source_url) values($1,'123456','Actividad persistida de prueba','')",
      [f.tenants[0]],
    );
    await openCompany(page, f);
    await page
      .getByRole("tab", { name: "Información tributaria", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Agregar actividad económica", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Eliminar actividad nueva 2", exact: true })
      .click();
    await expect(
      page.getByLabel("Código de actividad 1 (6 caracteres)", { exact: true }),
    ).toHaveValue("123456");
    await expect(
      page.getByLabel("Código de actividad 2 (6 caracteres)", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Eliminar actividad nueva 1",
        exact: true,
      }),
    ).toHaveCount(0);
    await page
      .getByLabel("Código de actividad 1 (6 caracteres)", { exact: true })
      .fill("");
    await page
      .getByLabel("Descripción de actividad 1", { exact: true })
      .fill("");
    await page
      .getByRole("tab", { name: "Domicilio fiscal", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Guardar empresa", exact: true })
      .click();
    await expect(
      page.getByRole("tab", { name: "Información tributaria", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByLabel("Código de actividad 1 (6 caracteres)", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Código de actividad 1 (6 caracteres)", { exact: true })
      .fill("123456");
    await page
      .getByLabel("Descripción de actividad 1", { exact: true })
      .fill("Actividad persistida de prueba");
    await page
      .getByRole("tab", { name: "Domicilio fiscal", exact: true })
      .click();
    await page
      .getByLabel("Otras señas", { exact: true })
      .fill("Dirección con actividad existente");
    await page
      .getByRole("button", { name: "Guardar empresa", exact: true })
      .click();
    await expect(
      page.getByText("Empresa guardada.", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await f.pool.query(
          "select code,name,active from public.economic_activities where tenant_id=$1",
          [f.tenants[0]],
        )
      ).rows,
    ).toEqual([
      { code: "123456", name: "Actividad persistida de prueba", active: true },
    ]);
  } finally {
    await f.pool.end();
  }
});

test("shows server-side incomplete address validation in the fiscal address tab", async ({
  page,
}) => {
  const f = await workspace({ role: "admin", companies: 2, systemAdmin: true });
  try {
    await openCompany(page, f);
    await page
      .getByRole("tab", { name: "Domicilio fiscal", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Provincia", exact: true })
      .selectOption("1");
    await page
      .getByRole("tab", { name: "Configuración contable", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Guardar empresa", exact: true })
      .click();
    await expect(
      page.getByRole("tab", { name: "Domicilio fiscal", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("alert")).toContainText(
      "Domicilio fiscal: completa provincia, cantón y distrito",
    );
    expect(
      (
        await f.pool.query(
          "select configuration_version from public.tenants where id=$1",
          [f.tenants[0]],
        )
      ).rows[0].configuration_version,
    ).toBe(1);
  } finally {
    await f.pool.end();
  }
});

test("keeps partially filled rows and opens their tab with a Spanish validation error", async ({
  page,
}) => {
  const f = await workspace({ role: "admin", companies: 2, systemAdmin: true });
  try {
    await openCompany(page, f);
    await page
      .getByRole("tab", { name: "Información tributaria", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Agregar actividad económica", exact: true })
      .click();
    await page
      .getByLabel("Código de actividad 1 (6 caracteres)", { exact: true })
      .fill("123456");
    await page
      .getByRole("tab", { name: "Domicilio fiscal", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Guardar empresa", exact: true })
      .click();
    await expect(
      page.getByRole("tab", { name: "Información tributaria", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("alert")).toContainText(
      "Indica la descripción de la actividad",
    );
    await expect(
      page.getByLabel("Código de actividad 1 (6 caracteres)", { exact: true }),
    ).toHaveValue("123456");
    expect(
      (
        await f.pool.query(
          "select configuration_version from public.tenants where id=$1",
          [f.tenants[0]],
        )
      ).rows[0].configuration_version,
    ).toBe(1);
  } finally {
    await f.pool.end();
  }
});
