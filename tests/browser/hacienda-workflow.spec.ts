import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { workspace } from "../support/workspace";
import { totp } from "../support/totp";
import { syntheticPkcs12 } from "../support/pkcs12";
import resetLocalBrowserLimit from "./setup";
test.afterAll(async () => {
  await resetLocalBrowserLimit();
});
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
test("registers synthetic credentials, clears secrets after errors and success, and deactivates locally", async ({
  page,
}, info) => {
  const f = await workspace({ role: "admin", companies: 2, systemAdmin: true });
  const file = await syntheticPkcs12({ pin: "1234" });
  try {
    await login(page, f);
    await nav(page, "Hacienda");
    await expect(
      page.getByRole("button", { name: "Producción", exact: true }),
    ).toBeEnabled();
    await expect(page.getByText(f.tag + "-0", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Datos fiscales del emisor y del receptor completos.", {
        exact: true,
      }),
    ).toBeVisible();
    async function fill(pin: string) {
      await page.getByLabel("Usuario de API").fill("BROWSER-PRIVATE-USER");
      await page
        .getByLabel("Contraseña de API")
        .fill("BROWSER-PRIVATE-PASSWORD");
      await page.getByLabel("PIN de la llave").fill(pin);
      await page.getByLabel("Llave criptográfica (.p12 o .pfx)").setInputFiles({
        name: "synthetic.p12",
        mimeType: "application/x-pkcs12",
        buffer: file,
      });
    }
    await fill("INCORRECTO");
    await page
      .getByRole("button", {
        name: "Guardar credenciales de pruebas",
        exact: true,
      })
      .click();
    await expect(page.getByRole("alert")).toContainText("No se pudo validar");
    await expect(page.getByLabel("Contraseña de API")).toHaveValue("");
    await expect(page.getByLabel("PIN de la llave")).toHaveValue("");
    await fill("1234");
    await page
      .getByRole("button", {
        name: "Guardar credenciales de pruebas",
        exact: true,
      })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Credenciales guardadas",
    );
    await expect(page.getByLabel("Usuario de API")).toHaveValue("");
    await expect(page.getByLabel("Contraseña de API")).toHaveValue("");
    await expect(page.getByLabel("PIN de la llave")).toHaveValue("");
    await expect(
      page.getByLabel("Llave criptográfica (.p12 o .pfx)"),
    ).toHaveValue("");
    await expect(
      page.getByText("Identidad tributaria pendiente", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Probar acceso a Hacienda",
        exact: true,
      }),
    ).toBeDisabled();
    const storage = await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    );
    expect(storage).not.toContain("BROWSER-PRIVATE");
    expect(page.url()).not.toContain("BROWSER-PRIVATE");
    await page.screenshot({
      path: ".local/preview/hacienda-" + info.project.name + ".png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Desactivar credenciales", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Confirmar desactivación local",
        exact: true,
      })
      .click();
    await expect(
      page.getByText("Sin credenciales activas", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText("no revoca");
    await fill("1234");
    const menu = page.getByRole("button", { name: "Abrir menú", exact: true });
    if (await menu.isVisible()) await menu.click();
    await page
      .getByRole("button", { name: /Empresa Norte Espacio de empresa/ })
      .click();
    await page.getByRole("button", { name: /Empresa Sur/ }).click();
    await nav(page, "Hacienda");
    await expect(page.getByLabel("Usuario de API")).toHaveValue("");
    await expect(page.getByLabel("Contraseña de API")).toHaveValue("");
    await expect(page.getByLabel("PIN de la llave")).toHaveValue("");
    await expect(
      page.getByLabel("Llave criptográfica (.p12 o .pfx)"),
    ).toHaveValue("");
  } finally {
    await f.pool.end();
  }
});
test("sets up departments and routes a saved draft to an internal collection review", async ({
  page,
}, info) => {
  const f = await workspace({ role: "admin", companies: 2, systemAdmin: true });
  try {
    const t = f.tenants[0],
      dep = (
        await f.pool.query(
          "insert into public.departments(tenant_id,name) values($1,'Ventas') returning id",
          [t],
        )
      ).rows[0].id,
      c = (
        await f.pool.query(
          "insert into public.customers(tenant_id,name) values($1,'Cliente CxC navegador') returning id",
          [t],
        )
      ).rows[0].id;
    const id = (
      await f.pool.query(
        `insert into public.invoice_drafts(tenant_id,customer_id,department_id,currency,customer_snapshot,created_by,updated_by,operation_id,request_hash) values($1,$2,$3,'CRC','{"name":"Cliente CxC navegador"}',$4,$4,$5,'fixture') returning id`,
        [t, c, dep, f.userId, randomUUID()],
      )
    ).rows[0].id;
    await f.pool.query(
      "insert into public.invoice_draft_lines(tenant_id,draft_id,position,description,quantity,unit_price) values($1,$2,1,'Servicio',1,1000)",
      [t, id],
    );
    await login(page, f);
    await nav(page, "Cuentas por cobrar");
    await page
      .getByRole("button", { name: "Configurar departamentos", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Crear departamentos predeterminados",
        exact: true,
      })
      .click();
    await expect(
      page.getByLabel("Destino de Cuentas por cobrar", { exact: true }),
    ).toHaveValue(/.+/);
    await nav(page, "Borradores");
    await page
      .getByRole("row")
      .filter({
        has: page.getByRole("cell", {
          name: "Cliente CxC navegador",
          exact: true,
        }),
      })
      .getByRole("button", { name: "Abrir borrador", exact: true })
      .click();
    const assign = page.getByRole("button", {
      name: "Asignar revisión a Cuentas por cobrar",
      exact: true,
    });
    await expect(assign).toBeEnabled();
    await page.getByLabel("Observaciones").fill("Cambio sin guardar");
    await expect(assign).toBeDisabled();
    await page.getByLabel("Observaciones").fill("");
    await assign.click();
    await expect(
      page.getByRole("status").filter({ hasText: "Revisión asignada" }),
    ).toContainText("Revisión asignada a Cuentas por cobrar.");
    await nav(page, "Cuentas por cobrar");
    await expect(
      page.getByRole("cell", { name: /^Cliente CxC navegador/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Revisar tarea", exact: true })
      .click();
    await page
      .getByLabel("Estado de revisión", { exact: true })
      .selectOption("resolved");
    await page
      .getByRole("button", { name: "Guardar revisión", exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: "Resuelta", exact: true }),
    ).toBeVisible();
    await f.pool.query(
      "update public.invoice_drafts set version=version+1 where id=$1",
      [id],
    );
    await page
      .getByRole("button", { name: "Actualizar bandeja", exact: true })
      .click();
    await expect(
      page.getByText("Origen actualizado: requiere revisión", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: ".local/preview/collections-" + info.project.name + ".png",
      fullPage: true,
    });
    await nav(page, "Cuentas por pagar");
    await expect(
      page.getByText(
        "La recepción de comprobantes todavía no está implementada.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: /^Cliente CxC navegador/ }),
    ).toHaveCount(0);
  } finally {
    await f.pool.end();
  }
});
test("ignores a delayed Hacienda error after switching companies", async ({
  page,
}) => {
  const f = await workspace({ role: "admin", companies: 2, systemAdmin: true });
  let release: () => void = () => {};
  try {
    await login(page, f);
    const gate = new Promise<void>((r) => (release = r));
    let captured: () => void = () => {};
    const started = new Promise<void>((r) => (captured = r));
    await page.route(
      "**/companies/" + f.tenants[0] + "/hacienda?*",
      async (route) => {
        const response = await route.fetch();
        captured();
        await gate;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "ERROR_EMPRESA_ANTERIOR" }),
        });
      },
    );
    await nav(page, "Hacienda");
    await started;
    const menu = page.getByRole("button", { name: "Abrir menú", exact: true });
    if (await menu.isVisible()) await menu.click();
    await page
      .getByRole("button", { name: /Empresa Norte Espacio de empresa/ })
      .click();
    await page.getByRole("button", { name: /Empresa Sur/ }).click();
    await nav(page, "Hacienda");
    await expect(
      page.getByText("Sin credenciales activas", { exact: true }),
    ).toBeVisible();
    release();

    await page.evaluate(
      () =>
        new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        ),
    );
    await expect(
      page.getByText("ERROR_EMPRESA_ANTERIOR", { exact: true }),
    ).toHaveCount(0);
  } finally {
    release();
    await f.pool.end();
  }
});
