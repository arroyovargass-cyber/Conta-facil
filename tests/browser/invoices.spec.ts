import { test, expect, type Page } from "@playwright/test";
import { workspace } from "../support/workspace";
import { totp } from "../support/totp";
import { randomUUID, randomInt } from "node:crypto";
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
  await page
    .getByRole("button", { name: /Empresa Norte/ })
    .filter({ hasText: f.tag })
    .click();
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
async function issuerChoices(f: Awaited<ReturnType<typeof workspace>>) {
  const tenant = f.tenants[0];
  await f.pool.query(
    "insert into public.economic_activities(tenant_id,code,name,source_url) values($1,'123456','Actividad sintética','https://example.test')",
    [tenant],
  );
  for (const code of ["001", "002"]) {
    const branch = (
      await f.pool.query(
        "insert into public.branches(tenant_id,code,name) values($1,$2,$3) returning id",
        [tenant, code, "Sucursal de prueba " + code],
      )
    ).rows[0].id;
    await f.pool.query(
      "insert into public.terminals(tenant_id,branch_id,code,name) values($1,$2,'00001','Terminal de prueba')",
      [tenant, branch],
    );
  }
}
test("prepared invoice edits refresh the snapshot and render only monetary totals", async ({
  page,
}) => {
  const f = await workspace({ role: "admin", companies: 2 });
  try {
    const draftId = await draft(f);
    await issuerChoices(f);
    const departmentId = (
      await f.pool.query(
        "select department_id from public.invoice_drafts where id=$1",
        [draftId],
      )
    ).rows[0].department_id;
    const invoiceId = randomUUID();
    let saved = false;
    const invoice = {
      id: invoiceId,
      version: 1,
      draft_id: draftId,
      department_id: departmentId,
      document_status: "prepared",
      signature_status: "pending",
      transmission_status: "not_sent",
      hacienda_status: "pending",
      email_status: "not_queued",
      options: {
        sale_condition: "01",
        credit_days: null,
        exchange_rate: "1",
        branch_code: "001",
        terminal_code: "00001",
        issuer_activity: "123456",
        payment_methods: [],
      },
      snapshot: {
        issuer: { legal_name: "Emisor de prueba" },
        receiver: { name: "Cliente de prueba", email: "prueba@example.test" },
        currency: "CRC",
        lines: [],
        totals: {
          status: "complete",
          beforeDiscount: "2000.00000",
          discounts: "0.00000",
          subtotal: "2000.00000",
          tax: "260.00000",
          exonerations: "0.00000",
          total: "2260.00000",
          groups: [{ tax: "260.00000" }],
        },
      },
      readiness: {
        canEmit: false,
        issues: [
          { code: "signature", message: "Falta configurar firma fiscal." },
        ],
      },
    };
    await page.route("**/api/companies/*/invoices**", async (route) => {
      const request = route.request();
      if (request.method() === "PATCH") {
        const body = request.postDataJSON();
        expect(body.version).toBe(1);
        expect(body.expected_version).toBeGreaterThan(0);
        const commercial = (
          await f.pool.query(
            "select commercial from public.invoice_drafts where id=$1",
            [draftId],
          )
        ).rows[0].commercial;
        expect(commercial.branch_code).toBe("002");
        saved = true;
        await route.fulfill({
          json: { item: { ...invoice, version: 2, options: commercial } },
        });
      } else
        await route.fulfill({
          json: request.url().includes(invoiceId)
            ? { item: invoice }
            : { items: [invoice], nextCursor: null },
        });
    });
    await login(page, f);
    await nav(page, "Facturación");
    await page.getByRole("button", { name: /Cliente de prueba · CRC/ }).click();
    const detail = page.getByRole("region", { name: "Detalle de factura" });
    await expect(
      detail.getByText("[object Object]", { exact: false }),
    ).toHaveCount(0);
    await expect(
      detail.getByText("CRC 2260.00000", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Facturar en pruebas" }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Editar preparación", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Editar preparación", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Sucursal", exact: true })
      .selectOption("002");
    await page
      .getByRole("button", { name: "Actualizar preparación", exact: true })
      .click();
    await expect.poll(() => saved).toBe(true);
    await page
      .getByRole("button", { name: "Nueva factura", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Sucursal", exact: true }),
    ).toHaveValue("001");
    await expect(
      page.getByRole("button", { name: "Guardar preparación", exact: true }),
    ).toBeVisible();
  } finally {
    await f.pool.end();
  }
});

// Synthetic CABYS below is test-only and does not assert catalog validity.
test("prepares a fiscal invoice through the real API and retains server totals", async ({
  page,
}) => {
  const f = await workspace({ role: "admin", companies: 2 });
  try {
    const draftId = await draft(f, "Receptor fiscal de prueba");
    await issuerChoices(f);
    await f.pool.query(
      "update public.tenants set identification_type='02', identification=$2, contact_email='emisor@example.test', address='San José' where id=$1",
      [f.tenants[0], String(randomInt(1000000000, 9999999999))],
    );
    await f.pool.query(
      "update public.invoice_drafts set customer_snapshot=$2 where id=$1",
      [
        draftId,
        {
          name: "Receptor fiscal de prueba",
          identification_type: "01",
          identification: "123456789",
          email: "receptor@example.test",
          domicile: "domestic",
          province: "1",
          canton: "01",
          district: "01",
          address: "San José",
        },
      ],
    );
    await f.pool.query(
      "update public.invoice_draft_lines set quantity=2, fiscal=$2 where draft_id=$1",
      [
        draftId,
        {
          cabys: "0000000000000",
          unit: "Unid",
          treatment: "taxable",
          tax_code: "01",
          tariff_code: "08",
          discount_amount: "0",
          discount_code: "",
          discount_reason: "",
          discount_other: "",
          commercial_unit: "",
          exoneration: null,
        },
      ],
    );
    await login(page, f);
    await nav(page, "Facturación");
    await page.getByText("Preparar desde borrador", { exact: true }).click();
    await page
      .getByRole("combobox", { name: "Borrador nacional FE o TE", exact: true })
      .selectOption(draftId);
    await expect(
      page.getByRole("combobox", { name: "Sucursal", exact: true }),
    ).toHaveValue("001");
    await expect(
      page.getByRole("combobox", { name: "Terminal", exact: true }),
    ).toHaveValue("00001");
    await expect(
      page.getByRole("combobox", {
        name: "Actividad económica del emisor",
        exact: true,
      }),
    ).toHaveValue("123456");
    await page
      .getByRole("button", { name: "Agregar medio de pago", exact: true })
      .click();
    await page.getByLabel("Importe de pago 1", { exact: true }).fill("2260");
    await page
      .getByRole("button", { name: "Guardar preparación", exact: true })
      .click();
    const detail = page.getByRole("region", { name: "Detalle de factura" });
    await expect(
      detail.getByText("CRC 2260.00000", { exact: true }).first(),
    ).toBeVisible();
    await detail
      .getByText("Mostrar u ocultar el desglose de totales", { exact: true })
      .click();
    await expect(
      detail
        .getByRole("table", { name: "Desglose de impuestos" })
        .getByText(/01 · 08 \(13 %\)/),
    ).toBeVisible();
    await expect(
      detail.getByRole("button", { name: "Facturar en pruebas" }),
    ).toBeDisabled();
    await detail
      .getByRole("button", { name: "Actualizar estado", exact: true })
      .click();
    await expect(
      detail.getByText("CRC 2260.00000", { exact: true }).first(),
    ).toBeVisible();
    await page.reload();
    await page
      .getByRole("button", { name: /Empresa Norte/ })
      .filter({ hasText: f.tag })
      .click();
    await expect(
      page.getByRole("heading", { name: "Tu empresa, en orden." }),
    ).toBeVisible();
    await nav(page, "Facturación");
    await page
      .getByRole("button", { name: /Receptor fiscal de prueba · CRC/ })
      .click();
    await expect(
      detail.getByText("CRC 2260.00000", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      detail.getByRole("button", { name: "Facturar en pruebas" }),
    ).toBeDisabled();
    await expect(
      detail.getByRole("link", { name: "Descargar XML" }),
    ).toHaveCount(0);
  } finally {
    await f.pool.end();
  }
});
