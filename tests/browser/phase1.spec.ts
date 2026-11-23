import { test, expect, type Page } from "@playwright/test";
import { workspace } from "../support/workspace";
import { totp } from "../support/totp";
test.describe.configure({ mode: "serial" });
async function login(
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
  await expect(
    page.getByRole("heading", { name: "Protege tu acceso" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Configurar autenticador" }).click();
  await page.getByText("Usar clave manual", { exact: true }).click();
  const secret = await page.locator("details code").innerText();
  await page.getByLabel("Código de 6 dígitos").fill(totp(secret));
  await page.getByRole("button", { name: "Verificar y continuar" }).click();
  await expect(
    page.getByRole("heading", { name: "¿Con cuál empresa trabajamos?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Empresa Norte/ }).click();
  await expect(
    page.getByRole("heading", { name: "Tu empresa, en orden." }),
  ).toBeVisible();
}
async function navigate(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "Abrir menú", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
}
async function createDepartment(page: Page, name: string) {
  await navigate(page, "Estructura organizativa");
  await page.getByRole("button", { name: "Crear departamento" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nombre", { exact: true }).fill(name);
  await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
}

test("completes login, MFA, organization and immediate activity refresh", async ({
  page,
}, testInfo) => {
  const fixture = await workspace({ role: "admin", companies: 2 });
  try {
    await login(page, fixture);
    await createDepartment(page, "Mantenimiento de prueba");
    await navigate(page, "Configuración tributaria");
    await page.getByRole("button", { name: "Registrar actividad" }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Nombre", { exact: true })
      .fill("Actividad de prueba");
    await dialog.getByLabel("Código oficial").fill("PRUEBA-NO-FISCAL");
    await dialog
      .getByLabel("URL de la fuente oficial")
      .fill("https://www.hacienda.go.cr/");
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(
      page.getByText("Actividad de prueba", { exact: true }),
    ).toBeVisible();
    await navigate(page, "Inicio");
    await expect(
      page.getByRole("heading", { name: "Tu empresa, en orden." }),
    ).toBeVisible();
    await page.screenshot({
      path:
        ".local/preview/conta-facil-preview-" + testInfo.project.name + ".png",
      scale: "css",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await fixture.pool.end();
  }
});

test("keeps the first tab writable and returns to login after revocation", async ({
  page,
  context,
}) => {
  const fixture = await workspace({ role: "admin", companies: 2 });
  try {
    await login(page, fixture);
    const second = await context.newPage();
    await second.goto("/");
    await expect(
      second.getByRole("heading", { name: "¿Con cuál empresa trabajamos?" }),
    ).toBeVisible();
    await createDepartment(page, "Desde primera pestaña");
    await fixture.pool.query(
      "update private.sessions set revoked_at=now() where user_id=$1",
      [fixture.userId],
    );
    await navigate(page, "Mi empresa");
    await expect(
      page.getByRole("heading", { name: "Bienvenido a Conta Fácil" }),
    ).toBeVisible();
    await expect(
      page.getByText("Tu sesión terminó. Ingresa nuevamente para continuar."),
    ).toBeVisible();
    await second.close();
  } finally {
    await fixture.pool.end();
  }
});

test("finds later-page records in server search and keeps company scopes separate", async ({
  page,
}) => {
  const fixture = await workspace({ role: "admin", companies: 2 });
  try {
    for (let i = 0; i < 55; i++)
      await fixture.pool.query(
        "insert into public.departments(tenant_id,name) values($1,$2)",
        [fixture.tenants[0], "Departamento " + String(i).padStart(2, "0")],
      );
    await fixture.pool.query(
      "insert into public.departments(tenant_id,name,active) values($1,'Zeta Mantenimiento',false),($2,'Solo Sur',true)",
      [fixture.tenants[0], fixture.tenants[1]],
    );
    await login(page, fixture);
    await navigate(page, "Estructura organizativa");
    const search = page.getByRole("textbox", { name: "Buscar registros" });
    await search.fill("Zeta");
    await expect(
      page.getByRole("cell", { name: "Zeta Mantenimiento", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Filtrar por estado" })
      .selectOption("true");
    await expect(
      page.getByRole("cell", { name: "Zeta Mantenimiento", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("combobox", { name: "Filtrar por estado" })
      .selectOption("false");
    await expect(
      page.getByRole("cell", { name: "Zeta Mantenimiento", exact: true }),
    ).toBeVisible();
    const menu = page.getByRole("button", { name: "Abrir menú", exact: true });
    if (await menu.isVisible()) await menu.click();
    await page.locator(".company-select").click();
    await page.getByRole("button", { name: /Empresa Sur/ }).click();
    await navigate(page, "Estructura organizativa");
    await expect(
      page.getByRole("cell", { name: "Solo Sur", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "Zeta Mantenimiento", exact: true }),
    ).toHaveCount(0);
  } finally {
    await fixture.pool.end();
  }
});

test("loads the destination when navigating before search debounce completes", async ({
  page,
}) => {
  const fixture = await workspace({ role: "admin", companies: 2 });
  try {
    await fixture.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Administración inicial')",
      [fixture.tenants[0]],
    );
    await fixture.pool.query(
      "insert into public.branches(tenant_id,name,code) values($1,'Sucursal central','001')",
      [fixture.tenants[0]],
    );
    await login(page, fixture);
    await navigate(page, "Estructura organizativa");
    await expect(
      page.getByRole("cell", { name: "Administración inicial", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Buscar registros" })
      .fill("búsqueda pendiente");
    await page.getByRole("button", { name: "Sucursales", exact: true }).click();
    await expect(
      page.getByRole("cell", { name: "Sucursal central", exact: true }),
    ).toBeVisible();
  } finally {
    await fixture.pool.end();
  }
});

test("never shows the previous user company list after logout and a new login", async ({
  page,
}) => {
  const old = await workspace({ role: "operative", companies: 2 }),
    fresh = await workspace({ role: "operative" });
  let release = () => {};
  try {
    const enter = async (f: typeof old) => {
      await page
        .getByRole("combobox", { name: "Tipo de identificación", exact: true })
        .selectOption("other");
      await page.getByLabel("Número de identificación").fill(f.identification);
      await page.getByLabel("Contraseña", { exact: true }).fill(f.password);
      await page
        .getByRole("button", { name: "Iniciar sesión", exact: true })
        .click();
    };
    await page.goto("/");
    await enter(old);
    await page.getByRole("button", { name: /Empresa Norte/ }).click();
    await expect(
      page.getByRole("heading", { name: "Tu empresa, en orden." }),
    ).toBeVisible();
    let ready!: () => void;
    const captured = new Promise<void>((r) => (ready = r)),
      wait = new Promise<void>((r) => (release = r));
    let first = true;
    await page.route("**/api/companies", async (route) => {
      if (!first) return route.continue();
      first = false;
      const response = await route.fetch();
      ready();
      await wait;
      await route.fulfill({ response });
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await captured;
    await page
      .getByRole("button", { name: "Cerrar sesión", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Bienvenido a Conta Fácil" }),
    ).toBeVisible();
    await enter(fresh);
    await expect(
      page.getByRole("heading", { name: "Tu empresa, en orden." }),
    ).toBeVisible();
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/api/companies") && r.status() === 200,
    );
    release();
    await response;
    await page.evaluate(
      () =>
        new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        ),
    );
    const menu = page.getByRole("button", { name: "Abrir menú", exact: true });
    if (await menu.isVisible()) await menu.click();
    await page.locator(".company-select").click();
    await expect(
      page.getByText("Empresa de prueba Norte " + fresh.tag, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Empresa de prueba Norte " + old.tag, { exact: true }),
    ).toHaveCount(0);
  } finally {
    release();
    await old.pool.end();
    await fresh.pool.end();
  }
});
