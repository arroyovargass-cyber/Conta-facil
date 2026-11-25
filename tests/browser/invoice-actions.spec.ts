import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { workspace } from "../support/workspace";
import { totp } from "../support/totp";
import resetLocalBrowserLimit from "./setup";

test.afterAll(async () => {
  await resetLocalBrowserLimit();
});
async function openInvoices(
  page: Page,
  f: Awaited<ReturnType<typeof workspace>>,
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
  await page.getByRole("button", { name: /Empresa Norte/ }).click();
  await expect(
    page.getByRole("heading", { name: "Tu empresa, en orden." }),
  ).toBeVisible();
  const menu = page.getByRole("button", { name: "Abrir menú", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Facturación", exact: true })
    .click();
  await page.getByRole("button", { name: /Receptor guardado · CRC/ }).click();
}
function invoice() {
  return {
    id: randomUUID(),
    version: 7,
    document_status: "issued",
    signature_status: "signed",
    transmission_status: "uncertain",
    hacienda_status: "accepted",
    email_status: "provider_accepted",
    snapshot: {
      issuer: { legal_name: "Emisor guardado" },
      receiver: { name: "Receptor guardado", email: "original@example.test" },
      currency: "CRC",
      lines: [],
      totals: { total: "2260.00000" },
    },
    readiness: { canEmit: false, issues: [] },
  };
}
test("server actions confirm the saved recipient and reuse operation after uncertain HTTP", async ({
  page,
}) => {
  const f = await workspace({ role: "admin", systemAdmin: true, companies: 2 });
  const item = invoice();
  const operations: string[] = [];
  let gets = 0;
  try {
    await page.route("**/api/companies/*/invoices**", async (route) => {
      if (route.request().url().split("?")[0].endsWith("/actions")) {
        if (route.request().method() === "GET") {
          gets++;
          await route.fulfill({ json: { actions: ["query", "resend_email"] } });
        } else {
          const body = route.request().postDataJSON();
          expect(body.action).toBe("resend_email");
          operations.push(body.operation_id);
          if (operations.length === 1) await route.abort("failed");
          else
            await route.fulfill({
              json: { queued: true, action: body.action },
            });
        }
      } else
        await route.fulfill({
          json: route.request().url().includes(item.id)
            ? { item }
            : { items: [item], nextCursor: null },
        });
    });
    await openInvoices(page, f);
    await expect(
      page.getByRole("button", { name: "Consultar en Hacienda", exact: true }),
    ).toBeVisible();
    expect(gets).toBeGreaterThan(0);
    await expect(
      page.getByRole("button", { name: "Reintentar envío", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Reenviar al cliente", exact: true })
      .click();
    const confirmation = page.getByRole("alertdialog");
    for (const text of [
      "STAG",
      "Emisor guardado",
      "Receptor guardado",
      "original@example.test",
      "CRC 2260.00000",
      "no garantiza la entrega",
    ])
      await expect(confirmation).toContainText(text);
    expect(operations).toHaveLength(0);
    await confirmation
      .getByRole("button", {
        name: "Confirmar: Reenviar al cliente",
        exact: true,
      })
      .click();
    await expect(
      page
        .getByRole("region", { name: "Acciones de factura" })
        .getByRole("alert"),
    ).toBeVisible();
    await confirmation
      .getByRole("button", {
        name: "Confirmar: Reenviar al cliente",
        exact: true,
      })
      .click();
    await expect(page.getByRole("status")).toHaveText(
      "Solicitud guardada. Actualiza el estado para consultar el resultado.",
    );
    expect(operations).toHaveLength(2);
    expect(operations[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(operations[1]).toBe(operations[0]);
  } finally {
    await f.pool.end();
  }
});
test("empty server permissions hide manual actions", async ({ page }) => {
  const f = await workspace({ role: "admin", companies: 2 });
  const item = invoice();
  let loaded = false;
  try {
    await page.route("**/api/companies/*/invoices**", async (route) => {
      if (route.request().url().split("?")[0].endsWith("/actions")) {
        loaded = true;
        await route.fulfill({ json: { actions: [] } });
      } else
        await route.fulfill({
          json: route.request().url().includes(item.id)
            ? { item }
            : { items: [item], nextCursor: null },
        });
    });
    await openInvoices(page, f);
    await expect.poll(() => loaded).toBe(true);
    await expect(
      page.getByRole("region", { name: "Acciones de factura" }),
    ).toHaveCount(0);
  } finally {
    await f.pool.end();
  }
});
