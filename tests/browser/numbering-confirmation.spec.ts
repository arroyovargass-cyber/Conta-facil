import { test, expect, type Page } from "@playwright/test";
import { workspace } from "../support/workspace";
import { totp } from "../support/totp";
import resetLocalBrowserLimit from "./setup";
test.afterAll(resetLocalBrowserLimit);
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

for (const owner of [true, false]) {
  test(
    owner
      ? "owner explicitly confirms test numbering"
      : "non-owner cannot see numbering confirmation",
    async ({ page }) => {
      const f = await workspace({
        role: "admin",
        systemAdmin: owner,
        companies: 2,
      });
      try {
        let payload: unknown;
        let gets = 0;
        await page.route(
          "**/api/companies/*/invoices/numbering-options?*",
          async (route) => {
            gets++;
            const environment = new URL(route.request().url()).searchParams.get(
              "environment",
            );
            expect(["test", "production"]).toContain(environment);
            await route.fulfill({
              json: {
                canConfirm: owner,
                items: [
                  {
                    branch_code: "001",
                    terminal_code: "00001",
                    last_value: environment === "production" ? "400" : "120",
                    legacy_floor: "100",
                    confirmed_at: null,
                  },
                ],
              },
            });
          },
        );
        await page.route(
          "**/api/companies/*/invoices/numbering",
          async (route) => {
            payload = route.request().postDataJSON();
            await route.fulfill({ json: { ok: true } });
          },
        );
        await login(page, f);
        await nav(page, "Facturación");
        const summary = page.getByText("Numeración de pruebas", {
          exact: true,
        });
        await expect.poll(() => gets).toBeGreaterThan(0);
        if (!owner) {
          await expect(summary).toHaveCount(0);
          return;
        }
        await expect(summary).toBeVisible();
        await expect(
          page.getByLabel("Último consecutivo confirmado"),
        ).not.toBeVisible();
        await summary.click();
        const select = page.getByRole("combobox", {
          name: "Sucursal / terminal",
        });
        await expect(select).toHaveValue("");
        await select.selectOption("001/00001");
        await expect(
          page.getByText("Último consecutivo registrado: 120", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("Piso histórico: 100", { exact: true }),
        ).toBeVisible();
        const value = page.getByLabel("Último consecutivo confirmado");
        await expect(value).toHaveValue("");
        await value.fill("119");
        await page
          .getByRole("checkbox", {
            name: "Confirmo que esta numeración corresponde al ambiente de pruebas y que el último consecutivo es correcto",
          })
          .check();
        const submit = page.getByRole("button", {
          name: "Confirmar numeración de pruebas",
          exact: true,
        });
        await expect(submit).toBeDisabled();
        await value.fill("125");
        await page
          .getByRole("checkbox", {
            name: "Confirmo que esta numeración corresponde al ambiente de pruebas y que el último consecutivo es correcto",
          })
          .check();
        await submit.click();
        await expect(
          page.getByText(
            "Numeración de pruebas confirmada. Esto no activa el envío a Hacienda.",
            { exact: true },
          ),
        ).toBeVisible();
        expect(payload).toEqual({
          environment: "test",
          document_type: "FE",
          branch_code: "001",
          terminal_code: "00001",
          starting_value: "125",
        });
        await expect.poll(() => gets).toBeGreaterThan(1);
        await page
          .getByRole("button", { name: "Producción", exact: true })
          .click();
        await page
          .getByText("Numeración de producción", { exact: true })
          .click();
        await expect(select).toHaveValue("");
        await select.selectOption("001/00001");
        await expect(value).toHaveValue("");
        await expect(
          page.getByText("Último consecutivo registrado: 400", { exact: true }),
        ).toBeVisible();
        const productionSubmit = page.getByRole("button", {
          name: "Confirmar numeración de producción",
          exact: true,
        });
        await value.fill("405");
        await expect(productionSubmit).toBeDisabled();
        await page
          .getByRole("checkbox", {
            name: "Confirmo que esta numeración corresponde al ambiente de producción y que el último consecutivo es correcto",
            exact: true,
          })
          .check();
        await productionSubmit.click();
        await expect(
          page.getByText(
            "Numeración de producción confirmada. Esto no activa el envío a Hacienda.",
            { exact: true },
          ),
        ).toBeVisible();
        expect(payload).toEqual({
          environment: "production",
          document_type: "FE",
          branch_code: "001",
          terminal_code: "00001",
          starting_value: "405",
        });
      } finally {
        await f.pool.end();
      }
    },
  );
}
