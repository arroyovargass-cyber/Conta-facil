import { test, expect, type Page } from "@playwright/test";
import { randomInt, randomUUID } from "node:crypto";
import { workspace } from "../support/workspace";
import { totp } from "../support/totp";
import resetLocalBrowserLimit from "./setup";
import {
  calculateInvoice,
  lineFiscalInput,
  receiverInput,
} from "../../packages/domain/src/invoice-fiscal";

test.afterAll(resetLocalBrowserLimit);
test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

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
  const menu = page.getByRole("button", { name: "Abrir menú", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Facturación", exact: true })
    .click();
}

async function setupCompany(f: Awaited<ReturnType<typeof workspace>>) {
  const tenant = f.tenants[0];
  await f.pool.query(
    "update public.tenants set identification_type='02',identification=$2,contact_email='emisor@example.test',address='Dirección de prueba local' where id=$1",
    [tenant, String(randomInt(1000000000, 9999999999))],
  );
  const department = (
    await f.pool.query(
      "insert into public.departments(tenant_id,name) values($1,'Ventas') returning id",
      [tenant],
    )
  ).rows[0].id;
  // Synthetic local activity/CABYS are fixtures, never evidence of registration.
  await f.pool.query(
    "insert into public.economic_activities(tenant_id,code,name,source_url) values($1,'123456','Actividad de prueba local','https://example.test')",
    [tenant],
  );
  const branch = (
    await f.pool.query(
      "insert into public.branches(tenant_id,code,name) values($1,'001','Casa matriz de prueba') returning id",
      [tenant],
    )
  ).rows[0].id;
  await f.pool.query(
    "insert into public.terminals(tenant_id,branch_id,code,name) values($1,$2,'00001','Terminal de prueba')",
    [tenant, branch],
  );
  return department;
}

async function addTaxedLine(page: Page) {
  await page
    .getByRole("combobox", { name: "Departamento", exact: true })
    .selectOption({ label: "Ventas" });
  await page
    .getByLabel("Descripción de línea 1", { exact: true })
    .fill("Servicio de prueba local");
  await page.getByLabel("Cantidad de línea 1", { exact: true }).fill("2");
  await page.getByLabel("Precio de línea 1", { exact: true }).fill("1000");
  await page
    .getByLabel("Configurar impuestos y descuentos de línea 1", { exact: true })
    .check();
  await page.getByLabel("CABYS", { exact: true }).fill("8399000000000");
  await page.getByLabel("Unidad de medida", { exact: true }).fill("Sp");
  await page
    .getByRole("combobox", { name: "Tratamiento tributario", exact: true })
    .selectOption("taxable");
  await page
    .getByRole("combobox", { name: "Tarifa de IVA", exact: true })
    .selectOption("08");
}

test("new invoice preserves occasional recipient, commercial data and server totals in the same editor", async ({
  page,
}, info) => {
  const f = await workspace({ role: "admin", systemAdmin: true, companies: 2 });
  try {
    await setupCompany(f);
    await login(page, f);
    await page
      .getByRole("button", { name: "Nueva factura", exact: true })
      .click();
    for (const name of [
      "Datos del emisor",
      "Datos comerciales del comprobante",
      "Datos del receptor",
      "Líneas de productos y servicios",
      "Medios de pago",
      "Resumen de la factura",
    ])
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Tipo de receptor", exact: true })
      .selectOption("occasional");
    await expect(
      page.getByLabel("Guardar cliente para futuras facturas", { exact: true }),
    ).not.toBeChecked();
    await page
      .getByLabel("Nombre del receptor", { exact: true })
      .fill("Cliente ocasional de prueba local");
    await addTaxedLine(page);
    const summary = page.getByRole("region", {
      name: "Totales calculados del borrador",
      exact: true,
    });
    await expect(
      summary.getByText("CRC 2260.00000", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Agregar medio de pago", exact: true })
      .click();
    await page.getByLabel("Importe de pago 1", { exact: true }).fill("2260");
    await page
      .getByRole("button", { name: "Guardar preparación", exact: true })
      .click();
    const detail = page.getByRole("region", {
      name: "Detalle de factura",
      exact: true,
    });
    await expect(
      detail.getByText("CRC 2260.00000", { exact: true }).first(),
    ).toBeVisible();
    const requirements = detail.getByRole("list", {
      name: "Requisitos de emisión verificados por el servidor",
    });
    await expect(
      requirements.getByText("Numeración confirmada", { exact: true }),
    ).toBeVisible();
    await expect(
      requirements.getByText("Bloqueo de emisión", { exact: true }).first(),
    ).toBeVisible();
    await requirements
      .getByRole("button", {
        name: "Ir a configurar: Numeración confirmada",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("combobox", {
        name: "Tipo de documento de la numeración",
        exact: true,
      }),
    ).toBeVisible();
    const invoices = (
      await f.pool.query(
        "select document_type,snapshot,options,hacienda_status from public.electronic_invoices where tenant_id=$1",
        [f.tenants[0]],
      )
    ).rows;
    expect(invoices).toHaveLength(1);
    expect(invoices[0].snapshot.receiver.name).toBe(
      "Cliente ocasional de prueba local",
    );
    expect(invoices[0].snapshot.totals).toMatchObject({
      subtotal: "2000.00000",
      tax: "260.00000",
      total: "2260.00000",
    });
    expect(invoices[0].options).toMatchObject({
      issuer_activity: "123456",
      branch_code: "001",
      terminal_code: "00001",
      exchange_rate: "1",
    });
    expect(invoices[0].hacienda_status).toBe("pending");
    expect(
      (
        await f.pool.query(
          "select count(*)::int n from public.customers where tenant_id=$1",
          [f.tenants[0]],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await f.pool.query(
          "select count(*)::int n from public.electronic_invoices where tenant_id=$1",
          [f.tenants[1]],
        )
      ).rows[0].n,
    ).toBe(0);
    await page.screenshot({
      path: `.local/preview/billing44-${info.project.name}.png`,
      fullPage: true,
      scale: "css",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page
      .getByText("Filtros del historial de facturación", { exact: true })
      .click();
    await page
      .getByRole("combobox", {
        name: "Estado de Hacienda del historial",
        exact: true,
      })
      .selectOption("accepted");
    await expect(page.locator(".activity-list > button")).toHaveCount(0);
    await page
      .getByRole("button", {
        name: "Limpiar filtros del historial",
        exact: true,
      })
      .click();
    await expect(page.locator(".activity-list > button")).toHaveCount(1);
    await detail
      .getByRole("button", { name: "Duplicar factura", exact: true })
      .click();
    await expect(
      page.getByLabel("Nombre del receptor", { exact: true }),
    ).toHaveValue("Cliente ocasional de prueba local");
    await page
      .getByRole("button", { name: "Duplicar línea 1", exact: true })
      .click();
    await expect(
      page.getByLabel("Cantidad de línea 2", { exact: true }),
    ).toHaveValue("2.00000");
    await page
      .getByRole("button", { name: "Quitar línea 2", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Guardar borrador", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await f.pool.query(
              "select count(*)::int n from public.invoice_drafts where tenant_id=$1",
              [f.tenants[0]],
            )
          ).rows[0].n,
      )
      .toBe(2);
    expect(
      (
        await f.pool.query(
          "select count(*)::int n from public.electronic_invoices where tenant_id=$1",
          [f.tenants[0]],
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await f.pool.end();
  }
});

test("Facturar confirms once, requests issuance and displays queued separately from Hacienda acceptance", async ({
  page,
}) => {
  const f = await workspace({ role: "admin", companies: 2 });
  try {
    const department = await setupCompany(f),
      tenant = f.tenants[0];
    const receiver = receiverInput.parse({
      name: "Receptor del botón de prueba",
      identification_type: "01",
      identification: "123456789",
      domicile: "domestic",
    });
    const draftId = (
      await f.pool.query(
        "insert into public.invoice_drafts(tenant_id,department_id,currency,customer_snapshot,created_by,updated_by,operation_id,request_hash) values($1,$2,'CRC',$3,$4,$4,$5,'local-browser-fixture') returning id",
        [tenant, department, receiver, f.userId, randomUUID()],
      )
    ).rows[0].id;
    const lines = [
      {
        description: "Servicio local sintético",
        quantity: "2",
        unit_price: "1000",
        fiscal: lineFiscalInput.parse({
          cabys: "8399000000000",
          unit: "Sp",
          treatment: "taxable",
          tariff_code: "08",
        }),
      },
    ];
    const snapshot = {
      document_type: "FE",
      issuer: { legal_name: "Emisor local sintético" },
      receiver,
      currency: "CRC",
      lines,
      totals: calculateInvoice(lines),
    };
    const options = {
      sale_condition: "01",
      credit_days: null,
      exchange_rate: "1",
      branch_code: "001",
      terminal_code: "00001",
      issuer_activity: "123456",
      payment_methods: [{ code: "01", amount: "2260" }],
    };
    const stored = (
      await f.pool.query(
        "insert into public.electronic_invoices(tenant_id,draft_id,draft_version,department_id,snapshot,options,created_by,operation_id,request_hash) values($1,$2,1,$3,$4,$5,$6,$7,$8) returning *",
        [
          tenant,
          draftId,
          department,
          snapshot,
          options,
          f.userId,
          randomUUID(),
          "b".repeat(64),
        ],
      )
    ).rows[0];
    let current = {
        ...stored,
        artifacts: [],
        readiness: { canEmit: true, issues: [] },
      },
      calls = 0;
    // UI transport fixture only: real fiscal emission is separately covered by
    // local integration tests. All external emission flags stay disabled here.
    await page.route(
      `**/api/companies/${tenant}/invoices/${stored.id}**`,
      async (route) => {
        const req = route.request();
        if (req.url().endsWith("/actions")) {
          await route.fulfill({ json: { actions: [] } });
          return;
        }
        if (req.method() === "POST" && req.url().endsWith("/issue")) {
          calls++;
          const body = req.postDataJSON();
          expect(body.version).toBe(1);
          expect(body.operation_id).toMatch(/^[a-f0-9-]{36}$/);
          expect(body.production_confirmation).not.toBe(true);
          current = {
            ...current,
            document_status: "issued",
            transmission_status: "queued",
            hacienda_status: "pending",
            version: 2,
            readiness: { canEmit: false, issues: [] },
          };
        }
        await route.fulfill({ json: { item: current } });
      },
    );
    await login(page, f);
    await page
      .getByRole("button", { name: /Receptor del botón de prueba · CRC/ })
      .click();
    const detail = page.getByRole("region", {
      name: "Detalle de factura",
      exact: true,
    });
    await detail
      .getByRole("button", { name: /^Facturar/, exact: false })
      .click();
    expect(calls).toBe(0);
    const confirm = detail.getByRole("button", {
      name: /Confirmar.*emisión|Confirmar.*factur/i,
    });
    await confirm.click();
    await expect.poll(() => calls).toBe(1);
    await expect(detail.getByText("En cola", { exact: true })).toBeVisible();
    await expect(
      detail.getByText("Aceptado por Hacienda", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await f.pool.end();
  }
});

test("consumer explicitly selects a ticket and prepares without a fictitious recipient or customer", async ({
  page,
}) => {
  const f = await workspace({ role: "admin", companies: 2 });
  try {
    await setupCompany(f);
    await login(page, f);
    await page
      .getByRole("button", { name: "Nueva factura", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Tipo de receptor", exact: true })
      .selectOption("consumer_final");
    await addTaxedLine(page);
    await page
      .getByRole("button", { name: "Agregar medio de pago", exact: true })
      .click();
    await page.getByLabel("Importe de pago 1", { exact: true }).fill("2260");
    await page
      .getByRole("button", { name: "Guardar preparación", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Detalle de factura", exact: true }),
    ).toBeVisible();
    const row = (
      await f.pool.query(
        "select document_type,snapshot from public.electronic_invoices where tenant_id=$1",
        [f.tenants[0]],
      )
    ).rows[0];
    expect(row.document_type).toBe("TE");
    expect(row.snapshot.receiver.identification).toBe("");
    expect(row.snapshot.totals.total).toBe("2260.00000");
    expect(
      (
        await f.pool.query(
          "select customer_id,receiver_mode from public.invoice_drafts where tenant_id=$1",
          [f.tenants[0]],
        )
      ).rows[0],
    ).toEqual({ customer_id: null, receiver_mode: "consumer_final" });
    expect(
      (
        await f.pool.query(
          "select count(*)::int n from public.customers where tenant_id=$1",
          [f.tenants[0]],
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await f.pool.end();
  }
});

test("detail and charges tabs retain their values and reopen the exact saved commercial calculation", async ({
  page,
}) => {
  const f = await workspace({ role: "admin", companies: 2 });
  try {
    await setupCompany(f);
    await login(page, f);
    await page
      .getByRole("button", { name: "Nueva factura", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Tipo de receptor", exact: true })
      .selectOption("occasional");
    await page
      .getByLabel("Nombre del receptor", { exact: true })
      .fill("Cliente con cargo de prueba local");
    await addTaxedLine(page);
    await page.getByRole("tab", { name: "Otros cargos", exact: true }).click();
    await page
      .getByRole("button", { name: "Agregar otro cargo", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Tipo de cargo 1", exact: true })
      .selectOption("99");
    await page
      .getByLabel("Descripción del cargo 1", { exact: true })
      .fill("Cargo comercial de prueba local");
    await page
      .getByLabel("Tipo de otro cargo 1", { exact: true })
      .fill("Cargo de prueba local");
    await page
      .getByRole("combobox", { name: "Modalidad del cargo 1", exact: true })
      .selectOption("percentage");
    await page.getByLabel("Porcentaje del cargo 1", { exact: true }).fill("5");
    await page
      .getByLabel("Base para el porcentaje del cargo 1", { exact: true })
      .fill("2000");
    const summary = page.getByRole("region", {
      name: "Totales calculados del borrador",
      exact: true,
    });
    await expect(
      summary.getByText("CRC 2360.00000", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("tab", { name: "Líneas de detalle", exact: true })
      .click();
    await expect(
      page.getByLabel("Descripción de línea 1", { exact: true }),
    ).toHaveValue("Servicio de prueba local");
    await page
      .getByRole("button", { name: "Agregar medio de pago", exact: true })
      .click();
    await page.getByLabel("Importe de pago 1", { exact: true }).fill("2360");
    await page
      .getByRole("button", { name: "Guardar borrador", exact: true })
      .click();
    await expect(
      page.getByRole("status", { name: "Resultado del borrador" }),
    ).toContainText("Borrador guardado");
    const row = (
      await f.pool.query(
        "select id,other_charges,commercial,fiscal_totals from public.invoice_drafts where tenant_id=$1",
        [f.tenants[0]],
      )
    ).rows[0];
    expect(row.other_charges[0]).toMatchObject({
      mode: "percentage",
      percentage: "5",
      percentage_base: "2000",
    });
    expect(row.fiscal_totals).toMatchObject({
      subtotal: "2000.00000",
      tax: "260.00000",
      otherCharges: "100.00000",
      total: "2360.00000",
    });
    expect(row.commercial.payment_methods[0].amount).toBe("2360");
    await page.reload();
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
    await page.getByText("Preparar desde borrador", { exact: true }).click();
    await page
      .getByRole("combobox", { name: "Borrador nacional FE o TE", exact: true })
      .selectOption(row.id);
    await expect(
      page.getByLabel("Cantidad de línea 1", { exact: true }),
    ).toHaveValue("2.00000");
    await page.getByRole("tab", { name: "Otros cargos", exact: true }).click();
    await expect(
      page.getByLabel("Porcentaje del cargo 1", { exact: true }),
    ).toHaveValue("5");
    await expect(
      page.getByLabel("Importe de pago 1", { exact: true }),
    ).toHaveValue("2360");
    await expect(
      summary.getByText("CRC 2360.00000", { exact: true }),
    ).toBeVisible();
  } finally {
    await f.pool.end();
  }
});
