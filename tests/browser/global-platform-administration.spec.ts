import { expect, test, type Page } from "@playwright/test";
import { randomInt } from "node:crypto";
import { workspace } from "../support/workspace";
import { totp } from "../support/totp";
import resetLocalBrowserLimit from "./setup";

test.afterAll(resetLocalBrowserLimit);
async function login(
  page: Page,
  f: Awaited<ReturnType<typeof workspace>>,
  secret?: string,
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
  if (!secret) {
    await page.getByRole("button", { name: "Configurar autenticador" }).click();
    await page.getByText("Usar clave manual", { exact: true }).click();
    secret = await page.locator("details code").innerText();
  }
  await page.getByLabel("Código de 6 dígitos").fill(totp(secret));
  await page.getByRole("button", { name: "Verificar y continuar" }).click();
  return secret;
}
async function menu(page: Page) {
  const open = page.getByRole("button", { name: "Abrir menú", exact: true });
  if (await open.isVisible()) await open.click();
}
async function nav(page: Page, name: string) {
  await menu(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
}

test("global owner saves an unassigned company, creates a complete company and retains access after MFA login", async ({
  page,
}, info) => {
  const owner = await workspace({ systemAdmin: true, companies: 0 });
  const existing = await workspace({ role: "admin", companies: 2 });
  const oldName = "Empresa existente " + owner.tag;
  const newName = "Empresa nueva " + owner.tag;
  try {
    await existing.pool.query(
      "update public.tenants set trade_name=$2 where id=$1",
      [existing.tenants[0], oldName],
    );
    const secret = await login(page, owner);
    await page.getByRole("button", { name: new RegExp(oldName) }).click();
    await menu(page);
    await expect(
      page.getByText("Superadministrador global", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Mi empresa", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Editar empresa", exact: true })
      .click();
    await page
      .getByRole("tab", { name: "Domicilio fiscal", exact: true })
      .click();
    await page
      .getByLabel("Otras señas", { exact: true })
      .fill("Domicilio guardado por propietario global sin membresía");
    await page
      .getByRole("button", { name: "Guardar empresa", exact: true })
      .click();
    await expect(
      page.getByText("Empresa guardada.", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await owner.pool.query(
          "select count(*)::int n from public.memberships where tenant_id=$1 and user_id=$2",
          [existing.tenants[0], owner.userId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await owner.pool.query(
          "select updated_by from public.tenants where id=$1",
          [existing.tenants[0]],
        )
      ).rows[0].updated_by,
    ).toBe(owner.userId);
    const oldPermissions = (
      await (
        await page.request.get(`/api/companies/${existing.tenants[0]}/overview`)
      ).json()
    ).permissions;
    await page
      .getByRole("button", { name: "Nueva empresa", exact: true })
      .click();
    await page.getByLabel("Razón social *", { exact: true }).fill(newName);
    await page
      .getByRole("combobox", { name: "Tipo de persona *", exact: true })
      .selectOption("legal");
    await page
      .getByRole("combobox", { name: "Tipo de identificación *", exact: true })
      .selectOption("02");
    await page
      .getByLabel("Número de identificación *", { exact: true })
      .fill(String(randomInt(1000000000, 9999999999)));
    const creationResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/company-administration") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Guardar empresa", exact: true })
      .click();
    const savedResponse = await creationResponse;
    expect(savedResponse.status()).toBe(200);
    await expect(
      page.getByText("Empresa guardada.", { exact: true }),
    ).toBeVisible();
    const created = (
      await owner.pool.query(
        "select id,configuration from public.tenants where legal_name=$1",
        [newName],
      )
    ).rows[0];
    expect(created.id).toBe((await savedResponse.json()).item.id);
    expect(created.configuration.billing).toMatchObject({
      branch_code: "001",
      terminal_code: "00001",
      environment: "test",
    });
    expect(
      (
        await owner.pool.query(
          "select count(*)::int n from public.departments where tenant_id=$1 and active",
          [created.id],
        )
      ).rows[0].n,
    ).toBe(3);
    expect(
      (
        await (
          await page.request.get(`/api/companies/${created.id}/overview`)
        ).json()
      ).permissions.sort(),
    ).toEqual(oldPermissions.sort());
    await page.reload();
    await page.getByRole("button", { name: new RegExp(newName) }).click();
    await nav(page, "Clientes");
    await page
      .getByRole("button", { name: "Nuevo cliente", exact: true })
      .click();
    await page
      .getByLabel("Nombre del cliente")
      .fill("Cliente de la empresa nueva");
    await page
      .getByRole("button", { name: "Guardar cliente", exact: true })
      .click();
    await expect(
      page.getByRole("cell", {
        name: "Cliente de la empresa nueva",
        exact: true,
      }),
    ).toBeVisible();
    const oldCustomers = (
      await (
        await page.request.get(
          `/api/companies/${existing.tenants[0]}/customers`,
        )
      ).json()
    ).items;
    expect(
      oldCustomers.some((v: any) => v.name === "Cliente de la empresa nueva"),
    ).toBe(false);
    await nav(page, "Facturación");
    await expect(
      page.getByRole("button", { name: "Nueva factura", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Nueva factura", exact: true })
      .click();
    await expect(
      page.getByLabel("Departamento", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Guardar borrador", exact: true }),
    ).toBeVisible();
    await menu(page);
    await page.getByTitle("Cerrar sesión", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Iniciar sesión", exact: true }),
    ).toBeVisible();
    await login(page, owner, secret);
    await page.getByRole("button", { name: new RegExp(oldName) }).click();
    await menu(page);
    await expect(
      page.getByText("Superadministrador global", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `.local/preview/global-admin-${info.project.name}.png`,
      fullPage: true,
      scale: "css",
    });
  } finally {
    await owner.pool.end();
    await existing.pool.end();
  }
});

test("secondary administrator can save customers but cannot create companies, claim the global role or read another tenant", async ({
  page,
}) => {
  const f = await workspace({ role: "admin", companies: 2 });
  try {
    const foreign = (
      await f.pool.query(
        "insert into public.tenants(legal_name,identification_type,identification) values($1,'other',$2) returning id",
        ["Empresa ajena " + f.tag, "foreign-" + f.tag],
      )
    ).rows[0].id;
    await login(page, f);
    await page
      .getByRole("button", { name: /Empresa Norte/ })
      .filter({ hasText: f.tag })
      .click();
    await nav(page, "Clientes");
    await page
      .getByRole("button", { name: "Nuevo cliente", exact: true })
      .click();
    await page
      .getByLabel("Nombre del cliente")
      .fill("Cliente autorizado secundario");
    await page
      .getByRole("button", { name: "Guardar cliente", exact: true })
      .click();
    await expect(
      page.getByRole("cell", {
        name: "Cliente autorizado secundario",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Superadministrador global", { exact: true }),
    ).toHaveCount(0);
    const session = await (await page.request.get("/api/auth/session")).json();
    expect(session.user.platform_role).toBeNull();
    expect(
      (await page.request.get(`/api/companies/${foreign}/overview`)).status(),
    ).toBe(404);
    const blocked = await page.request.post("/api/company-administration", {
      data: {},
      headers: {
        origin: new URL(page.url()).origin,
        "x-csrf-token": session.csrf,
      },
    });
    expect(blocked.status()).toBe(403);
    await nav(page, "Mi empresa");
    await expect(
      page.getByRole("button", { name: "Nueva empresa", exact: true }),
    ).toHaveCount(0);
  } finally {
    await f.pool.end();
  }
});
