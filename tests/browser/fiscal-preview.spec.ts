import { test, expect, type Page } from "@playwright/test";
import { workspace } from "../support/workspace";
import { totp } from "../support/totp";
import { randomUUID } from "node:crypto";
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
async function login(
  page: Page,
  f: Awaited<ReturnType<typeof workspace>>,
  mfa = true,
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
  if (mfa) {
    await page.getByRole("button", { name: "Configurar autenticador" }).click();
    await page.getByText("Usar clave manual", { exact: true }).click();
    await page
      .getByLabel("Código de 6 dígitos")
      .fill(totp(await page.locator("details code").innerText()));
    await page.getByRole("button", { name: "Verificar y continuar" }).click();
  }
  await page.getByRole("button", { name: /Empresa Norte/ }).click();
  await expect(
    page.getByRole("heading", { name: "Tu empresa, en orden." }),
  ).toBeVisible();
}
async function draft(
  f: Awaited<ReturnType<typeof workspace>>,
  name = "Cliente de prueba",
  price = "1000",
  currency = "CRC",
) {
  const t = f.tenants[0],
    d = (
      await f.pool.query(
        "insert into public.departments(tenant_id,name) values($1,$2) returning id",
        [t, "Ventas " + randomUUID()],
      )
    ).rows[0].id,
    c = (
      await f.pool.query(
        "insert into public.customers(tenant_id,name) values($1,$2) returning id",
        [t, name],
      )
    ).rows[0].id;
  const id = (
    await f.pool.query(
      "insert into public.invoice_drafts(tenant_id,customer_id,department_id,currency,customer_snapshot,created_by,updated_by,operation_id,request_hash) values($1,$2,$3,$4,$5,$6,$6,$7,'fixture') returning id",
      [t, c, d, currency, { name }, f.userId, randomUUID()],
    )
  ).rows[0].id;
  await f.pool.query(
    "insert into public.invoice_draft_lines(tenant_id,draft_id,position,description,quantity,unit_price) values($1,$2,1,'Servicio de prueba',1,$3)",
    [t, id, price],
  );
  return id;
}
async function openPreview(page: Page) {
  await page
    .getByRole("button", { name: "Vista previa de impuestos", exact: true })
    .click();
}
async function calculate(page: Page) {
  await page
    .getByRole("checkbox", {
      name: "Confirmo el escenario: CRC, contado e IVA general del 13%",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Calcular vista previa", exact: true })
    .click();
}
async function openRow(page: Page, name: string) {
  await page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name, exact: true }) })
    .getByRole("button", { name: "Abrir borrador", exact: true })
    .click();
}
test("shows confirmed exact tax preview and invalidates it after unsaved changes", async ({
  page,
}, info) => {
  const f = await workspace({ role: "admin", companies: 2 });
  try {
    await draft(f);
    await login(page, f);
    await nav(page, "Borradores");
    await openRow(page, "Cliente de prueba");
    await openPreview(page);
    await expect(
      page.getByRole("button", { name: "Calcular vista previa", exact: true }),
    ).toBeDisabled();
    await calculate(page);
    await expect(page.getByLabel("Base calculada", { exact: true })).toHaveText(
      "CRC 1000",
    );
    await expect(page.getByLabel("IVA calculado", { exact: true })).toHaveText(
      "CRC 130",
    );
    await expect(
      page.getByLabel("Total calculado con IVA", { exact: true }),
    ).toHaveText("CRC 1130");
    await expect(
      page.getByText("Vista previa de impuestos — sin validez tributaria", {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("checkbox", { name: /Confirmo el escenario/ }).focus();
    await page.keyboard.press("Shift+Tab");
    await expect(
      page.getByRole("button", {
        name: "Vista previa de impuestos",
        exact: true,
      }),
    ).toBeFocused();
    await expect(
      page.getByText("Cargando opciones…", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("region", { name: "Vista previa de impuestos", exact: true })
      .screenshot({
        path: ".local/preview/conta-facil-fiscal-" + info.project.name + ".png",
        scale: "css",
      });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByLabel("Observaciones").fill("Cambio local");
    await expect(
      page.getByLabel("Total calculado con IVA", { exact: true }),
    ).toHaveCount(0);
    await openPreview(page);
    await expect(
      page.getByRole("button", { name: "Calcular vista previa", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText("Guarda tus cambios antes de calcular.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Cerrar borrador", exact: true })
      .click();
    await openRow(page, "Cliente de prueba");
    await openPreview(page);
    await expect(
      page.getByRole("checkbox", { name: /Confirmo el escenario/ }),
    ).not.toBeChecked();
  } finally {
    await f.pool.end();
  }
});
test("reports precision and currency blockers without partial totals, and lets readers preview archived drafts", async ({
  page,
}) => {
  const f = await workspace({ role: "accountant", companies: 2 });
  try {
    const archived = await draft(f, "Archivado");
    await f.pool.query(
      "update public.invoice_drafts set archived_at=now() where id=$1",
      [archived],
    );
    await draft(f, "Precisión", "0.00001");
    await draft(f, "Dólares", "1000", "USD");
    await login(page, f, false);
    await nav(page, "Borradores");
    await openRow(page, "Precisión");
    await openPreview(page);
    await calculate(page);
    await expect(
      page.getByText(
        "El IVA de la línea requiere una política de redondeo pendiente de confirmar.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByLabel("Total calculado con IVA", { exact: true }),
    ).toHaveCount(0);
    await openRow(page, "Dólares");
    await openPreview(page);
    await calculate(page);
    await expect(
      page.getByText(
        "Este perfil solo calcula operaciones nacionales en colones.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByLabel("Total calculado con IVA", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Cerrar borrador", exact: true })
      .click();
    await page.getByLabel("Estado de borradores").selectOption("true");
    await openRow(page, "Archivado");
    await openPreview(page);
    await calculate(page);
    await expect(
      page.getByLabel("Total calculado con IVA", { exact: true }),
    ).toHaveText("CRC 1130");
    await expect(
      page.getByRole("button", { name: "Guardar borrador", exact: true }),
    ).toHaveCount(0);
  } finally {
    await f.pool.end();
  }
});
test("discards delayed preview when another editor or company is selected", async ({
  page,
}) => {
  const f = await workspace({ role: "admin", companies: 2 });
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  try {
    const id = await draft(f, "Primero");
    const secondId = await draft(f, "Segundo", "2000");
    await login(page, f);
    await nav(page, "Borradores");
    await openRow(page, "Primero");
    await openPreview(page);
    let capture: () => void = () => {};
    const captured = new Promise<void>((r) => {
      capture = r;
    });
    let count = 0;
    await page.route(
      "**/invoice-drafts/" + id + "/fiscal-preview",
      async (route) => {
        count++;
        const response = await route.fetch();
        capture();
        await gate;
        await route.fulfill({ response });
      },
    );
    await calculate(page);
    await captured;
    await expect(
      page.getByRole("button", { name: "Calculando…", exact: true }),
    ).toBeDisabled();
    await openRow(page, "Segundo");
    await expect(page.getByLabel("Observaciones")).toBeVisible();
    const responsePromise = page.waitForResponse((r) =>
      r.url().endsWith("/" + id + "/fiscal-preview"),
    );
    release();
    await (await responsePromise).finished();
    await page.evaluate(
      () =>
        new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        ),
    );
    await expect(
      page.getByLabel("Total calculado con IVA", { exact: true }),
    ).toHaveCount(0);
    expect(count).toBe(1);
    await openPreview(page);
    await calculate(page);
    await expect(
      page.getByLabel("Total calculado con IVA", { exact: true }),
    ).toHaveText("CRC 2260");
    // An old error must not reappear after the same editor is modified.
    let releaseError: () => void = () => {};
    const errorGate = new Promise<void>((r) => {
      releaseError = r;
    });
    let captureError: () => void = () => {};
    const errorCaptured = new Promise<void>((r) => {
      captureError = r;
    });
    await page.route(
      "**/invoice-drafts/" + secondId + "/fiscal-preview",
      async (route) => {
        await route.fetch();
        captureError();
        await errorGate;
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ message: "ERROR_ANTERIOR" }),
        });
      },
    );
    await calculate(page);
    await errorCaptured;
    await page.getByLabel("Observaciones").fill("Cambio durante cálculo");
    const oldError = page.waitForResponse((r) =>
      r.url().endsWith("/" + secondId + "/fiscal-preview"),
    );
    releaseError();
    await (await oldError).finished();
    await page.evaluate(
      () =>
        new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        ),
    );
    await expect(page.getByText("ERROR_ANTERIOR", { exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByLabel("Observaciones")).toHaveValue(
      "Cambio durante cálculo",
    );
    await page.unroute("**/invoice-drafts/" + id + "/fiscal-preview");
    await page
      .getByRole("button", { name: "Cerrar borrador", exact: true })
      .click();
    await openRow(page, "Primero");
    await openPreview(page);
    let releaseCompany: () => void = () => {};
    const companyGate = new Promise<void>((r) => {
      releaseCompany = r;
    });
    let captureCompany: () => void = () => {};
    const companyCaptured = new Promise<void>((r) => {
      captureCompany = r;
    });
    await page.route(
      "**/invoice-drafts/" + id + "/fiscal-preview",
      async (route) => {
        const response = await route.fetch();
        captureCompany();
        await companyGate;
        await route.fulfill({ response });
      },
    );
    await calculate(page);
    await companyCaptured;
    const menu = page.getByRole("button", { name: "Abrir menú", exact: true });
    if (await menu.isVisible()) await menu.click();
    await page
      .getByRole("button", { name: /Empresa Norte Espacio de empresa/ })
      .click();
    await page.getByRole("button", { name: /Empresa Sur/ }).click();
    await nav(page, "Borradores");
    const oldCompany = page.waitForResponse((r) =>
      r.url().endsWith("/" + id + "/fiscal-preview"),
    );
    releaseCompany();
    await (await oldCompany).finished();
    await page.evaluate(
      () =>
        new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        ),
    );
    await expect(
      page.getByLabel("Total calculado con IVA", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("No hay borradores para estos filtros.", { exact: true }),
    ).toBeVisible();
  } finally {
    release();
    await f.pool.end();
  }
});
test("keeps draft fields and offers explicit reload when persisted version changes", async ({
  page,
}) => {
  const f = await workspace({ role: "admin", companies: 2 });
  try {
    const id = await draft(f);
    await login(page, f);
    await nav(page, "Borradores");
    await openRow(page, "Cliente de prueba");
    await openPreview(page);
    await f.pool.query(
      "update public.invoice_drafts set version=version+1,notes='Cambio remoto' where id=$1",
      [id],
    );
    await calculate(page);
    await expect(page.getByRole("alert")).toContainText("Recarga");
    await expect(page.getByLabel("Observaciones")).toHaveValue("");
    await page
      .getByRole("button", { name: "Recargar registro", exact: true })
      .click();
    await expect(page.getByLabel("Observaciones")).toHaveValue("Cambio remoto");
  } finally {
    await f.pool.end();
  }
});
