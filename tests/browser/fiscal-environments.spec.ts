import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
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
  await page.getByRole("button", { name: /Empresa Norte/ }).click();
  await expect(
    page.getByRole("heading", { name: "Tu empresa, en orden." }),
  ).toBeVisible();
}
function configuration(environment: "test" | "production") {
  return {
    environment,
    revision: environment === "test" ? 3 : 7,
    active_version: environment === "test" ? 3 : 7,
    certificate_metadata: {
      fingerprint: environment === "test" ? "a".repeat(64) : "b".repeat(64),
      valid_until: "2030-01-01T00:00:00.000Z",
    },
    api_status: "success",
    api_checked_at: "2026-11-25T12:00:00.000Z",
    session_closed: true,
    enrollment: null as Record<string, unknown> | null,
  };
}
const capabilities = {
  can_store_credentials: true,
  synthetic_only: true,
  can_test_connection: true,
  can_enroll: true,
};

test("switching Hacienda environments clears secrets and records an explicit administrative review", async ({
  page,
}) => {
  const fixture = await workspace({
    role: "admin",
    companies: 2,
    systemAdmin: true,
  });
  const prod = configuration("production");
  prod.api_status = "not_tested";
  let connected = false;
  let enrollment: Record<string, unknown> | undefined;
  const environments: string[] = [];
  try {
    await page.route("**/api/companies/*/hacienda**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "GET") {
        const environment = url.searchParams.get("environment");
        environments.push(environment ?? "missing");
        await route.fulfill({
          json: {
            configuration:
              environment === "production" ? prod : configuration("test"),
            capabilities: {
              ...capabilities,
              can_enroll: environment !== "production" || connected,
            },
          },
        });
      } else if (url.pathname.endsWith("/connection-test")) {
        expect(request.postDataJSON()).toEqual({
          environment: "production",
          expected_revision: 7,
        });
        connected = true;
        prod.api_status = "success";
        await route.fulfill({ json: { configuration: prod, capabilities } });
      } else if (url.pathname.endsWith("/credentials/enroll")) {
        enrollment = request.postDataJSON();
        prod.enrollment = {
          environment: "production",
          version: 7,
          status: "operator_verified",
          issuer_identification: "3101123456",
          issuer_identification_type: "02",
          certificate_fingerprint: "b".repeat(64),
          confirmed_by: fixture.userId,
          confirmed_at: "2026-11-25T12:10:00.000Z",
          evidence_reference: enrollment!.evidence_reference,
        };
        await route.fulfill({ json: { configuration: prod, capabilities } });
      } else await route.abort();
    });
    await login(page, fixture);
    await nav(page, "Hacienda");
    await expect(
      page.getByText("Versión activa: 3", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Usuario de API").fill("PRIVATE-TEST-USER");
    await page.getByLabel("Contraseña de API").fill("PRIVATE-TEST-PASSWORD");
    await page.getByLabel("PIN de la llave").fill("PRIVATE-TEST-PIN");
    await page.getByLabel("Llave criptográfica (.p12 o .pfx)").setInputFiles({
      name: "synthetic.p12",
      mimeType: "application/x-pkcs12",
      buffer: Buffer.from("synthetic-only"),
    });
    await page.getByRole("button", { name: "Producción", exact: true }).click();
    await expect(
      page.getByText("Versión activa: 7", { exact: true }),
    ).toBeVisible();
    for (const label of [
      "Usuario de API",
      "Contraseña de API",
      "PIN de la llave",
      "Llave criptográfica (.p12 o .pfx)",
    ])
      await expect(page.getByLabel(label, { exact: true })).toHaveValue("");
    await expect(
      page.getByText("Versión activa: 3", { exact: true }),
    ).toHaveCount(0);
    const review = page.getByRole("region", {
      name: "Revisión del administrador",
      exact: true,
    });
    await expect(review).toContainText("autenticación multifactor");
    const submit = review.getByRole("button", {
      name: "Registrar revisión del administrador",
      exact: true,
    });
    await expect(submit).toBeDisabled();
    await expect(
      review.getByLabel("Referencia de la revisión", { exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Probar acceso a Hacienda", exact: true })
      .click();
    await expect(
      review.getByLabel("Referencia de la revisión", { exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByLabel("Llave criptográfica (.p12 o .pfx)", { exact: true }),
    ).toHaveValue("");
    await review
      .getByLabel("Referencia de la revisión", { exact: true })
      .fill("Expediente interno 2026-11-25");
    await expect(submit).toBeDisabled();
    await review.getByRole("checkbox").check();
    await submit.click();
    await expect
      .poll(() => enrollment)
      .toEqual({
        environment: "production",
        expected_revision: 7,
        confirmed: true,
        evidence_reference: "Expediente interno 2026-11-25",
      });
    await expect(review).toContainText("Revisión registrada");
    await expect(review).toContainText("3101123456");
    await expect(review).toContainText(fixture.userId);
    await expect(review).toContainText("b".repeat(64));
    await expect(review).toContainText(
      "no es una validación de identidad por Hacienda",
    );
    await page.getByRole("button", { name: "Pruebas", exact: true }).click();
    await expect(
      page.getByText("Versión activa: 3", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Revisión registrada", { exact: true }),
    ).toHaveCount(0);
    expect(environments).toEqual(["test", "production", "test"]);
  } finally {
    await fixture.pool.end();
  }
});

test("late Hacienda responses cannot replace the selected environment", async ({
  page,
}) => {
  const fixture = await workspace({
    role: "admin",
    companies: 2,
    systemAdmin: true,
  });
  let release: () => void = () => {};
  let started: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const captured = new Promise<void>((resolve) => {
    started = resolve;
  });
  try {
    await page.route("**/api/companies/*/hacienda?*", async (route) => {
      const environment = new URL(route.request().url()).searchParams.get(
        "environment",
      );
      if (environment === "test") {
        started();
        await gate;
        await route
          .fulfill({
            status: 500,
            json: { message: "ERROR_AMBIENTE_ANTERIOR" },
          })
          .catch(() => {});
      } else
        await route.fulfill({
          json: { configuration: configuration("production"), capabilities },
        });
    });
    await login(page, fixture);
    await nav(page, "Hacienda");
    await captured;
    await page.getByRole("button", { name: "Producción", exact: true }).click();
    await expect(
      page.getByText("Versión activa: 7", { exact: true }),
    ).toBeVisible();
    release();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(
      page.getByText("ERROR_AMBIENTE_ANTERIOR", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Producción", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  } finally {
    release();
    await fixture.pool.end();
  }
});

test("production preparation and issuance keep the document environment and require a real-sale confirmation", async ({
  page,
}) => {
  const fixture = await workspace({
    role: "admin",
    companies: 2,
    systemAdmin: true,
  });
  const tenant = fixture.tenants[0];
  const invoiceId = randomUUID();
  const draftId = randomUUID();
  let prepareBody: Record<string, any> | undefined;
  let issueBody: Record<string, any> | undefined;
  let saved = false;
  try {
    const department = (
      await fixture.pool.query(
        "insert into public.departments(tenant_id,name) values($1,'Ventas autorizadas') returning id",
        [tenant],
      )
    ).rows[0].id;
    const item = {
      id: invoiceId,
      environment: "production",
      version: 1,
      draft_id: draftId,
      department_id: department,
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
        issuer: { legal_name: "Emisor autorizado" },
        receiver: { name: "Venta autorizada", email: "venta@example.test" },
        currency: "CRC",
        lines: [],
        totals: { total: "2260.00000" },
      },
      readiness: { canEmit: true, issues: [] },
    };
    const draft = {
      id: draftId,
      version: 1,
      document_type: "FE",
      archived_at: null,
      customer_snapshot: { name: "Venta autorizada" },
      receiver_mode: "occasional",
      customer_id: null,
      department_id: department,
      notes: "",
      lines: [],
      commercial: {},
      other_charges: [],
      currency: "CRC",
    };
    await page.route("**/api/companies/*/invoice-drafts**", async (route) => {
      const request = route.request();
      if (request.method() === "PATCH") {
        const body = request.postDataJSON();
        await route.fulfill({
          json: {
            item: {
              ...draft,
              ...body,
              version: 2,
              customer_snapshot: body.receiver,
            },
          },
        });
      } else
        await route.fulfill({
          json: new URL(request.url()).pathname.endsWith(draftId)
            ? { item: draft }
            : { items: [draft], nextCursor: null },
        });
    });
    await page.route("**/api/companies/*/invoices**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.endsWith("/numbering-options")) {
        await route.fulfill({ json: { canConfirm: false, items: [] } });
      } else if (url.pathname.endsWith("/actions")) {
        await route.fulfill({ json: { actions: [] } });
      } else if (url.pathname.endsWith("/issue")) {
        issueBody = request.postDataJSON();
        await route.fulfill({
          json: {
            item: {
              ...item,
              document_status: "issued",
              transmission_status: "queued",
              readiness: { canEmit: false, issues: [] },
            },
          },
        });
      } else if (request.method() === "POST") {
        prepareBody = request.postDataJSON();
        saved = true;
        await route.fulfill({ json: { item } });
      } else if (url.pathname.endsWith(invoiceId)) {
        await route.fulfill({ json: { item } });
      } else {
        const environment = url.searchParams.get("environment");
        expect(["test", "production"]).toContain(environment);
        await route.fulfill({
          json: {
            items: saved && environment === "production" ? [item] : [],
            nextCursor: null,
          },
        });
      }
    });
    await login(page, fixture);
    await nav(page, "Facturación");
    await page
      .getByRole("button", { name: "Nueva factura", exact: true })
      .click();
    await page
      .getByLabel("Observaciones", { exact: true })
      .fill("Cambios exclusivos de Pruebas");
    await page.getByRole("button", { name: "Producción", exact: true }).click();
    await expect(page.getByLabel("Observaciones", { exact: true })).toHaveCount(
      0,
    );
    await page.getByText("Preparar desde borrador", { exact: true }).click();
    await page
      .getByRole("combobox", { name: "Borrador nacional FE o TE", exact: true })
      .selectOption(draftId);
    await expect(page.getByLabel("Observaciones", { exact: true })).toHaveValue(
      "",
    );
    await page
      .getByRole("button", { name: "Guardar preparación", exact: true })
      .click();
    await expect.poll(() => prepareBody?.environment).toBe("production");
    const detail = page.getByRole("region", {
      name: "Detalle de factura",
      exact: true,
    });
    await expect(detail).toContainText("Ambiente: Producción");
    await expect(detail).not.toContainText("STAG");
    await detail
      .getByRole("button", {
        name: "Facturar en producción",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Confirmar emisión en producción",
      exact: true,
    });
    const submit = dialog.getByRole("button", {
      name: "Confirmar emisión en producción",
      exact: true,
    });
    await expect(submit).toBeDisabled();
    expect(issueBody).toBeUndefined();
    await dialog
      .getByRole("checkbox", {
        name: "Confirmo que esta factura corresponde a una venta real autorizada y que se emitirá en producción",
        exact: true,
      })
      .check();
    await submit.click();
    await expect.poll(() => issueBody?.production_confirmation).toBe(true);
    await expect(detail).toContainText("Emitida");
    await expect(detail).not.toContainText("Aceptado por Hacienda");
    await page.getByRole("button", { name: "Pruebas", exact: true }).click();
    await expect(detail).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Venta autorizada · CRC/ }),
    ).toHaveCount(0);
  } finally {
    await fixture.pool.end();
  }
});

test("late invoice detail and list responses cannot appear in another environment", async ({
  page,
}) => {
  const fixture = await workspace({ role: "admin", companies: 2 });
  const testId = randomUUID();
  let release: () => void = () => {};
  let captured: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    captured = resolve;
  });
  let delayedList: () => void = () => {};
  let listStarted: () => void = () => {};
  const listGate = new Promise<void>((resolve) => {
    delayedList = resolve;
  });
  const waitingForList = new Promise<void>((resolve) => {
    listStarted = resolve;
  });
  let testGets = 0;
  try {
    const item = {
      id: testId,
      environment: "test",
      version: 1,
      document_status: "prepared",
      snapshot: {
        receiver: { name: "Documento del ambiente anterior" },
        currency: "CRC",
        lines: [],
        totals: { total: "1000.00000" },
      },
      readiness: { canEmit: false, issues: [] },
    };
    await page.route("**/api/companies/*/invoices**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith(testId)) {
        captured();
        await gate;
        await route.fulfill({ json: { item } }).catch(() => {});
      } else if (url.pathname.endsWith("/numbering-options")) {
        await route.fulfill({ json: { canConfirm: false, items: [] } });
      } else if (url.searchParams.get("environment") === "test") {
        testGets++;
        if (testGets > 1) {
          listStarted();
          await listGate;
        }
        await route
          .fulfill({ json: { items: [item], nextCursor: null } })
          .catch(() => {});
      } else await route.fulfill({ json: { items: [], nextCursor: null } });
    });
    await login(page, fixture);
    await nav(page, "Facturación");
    await page
      .getByRole("button", { name: /Documento del ambiente anterior · CRC/ })
      .click();
    await started;
    await page.getByRole("button", { name: "Producción", exact: true }).click();
    release();
    await expect(
      page.getByRole("heading", {
        name: "Facturación nacional · Producción",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Pruebas", exact: true }).click();
    await waitingForList;
    await page.getByRole("button", { name: "Producción", exact: true }).click();
    delayedList();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(
      page.getByRole("region", { name: "Detalle de factura", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: /Documento del ambiente anterior · CRC/,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", {
        name: "Facturación nacional · Producción",
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    release();
    delayedList();
    await fixture.pool.end();
  }
});

test("company credentials use the configured fiscal environment and clear secrets when it changes", async ({
  page,
}) => {
  const fixture = await workspace({
    role: "admin",
    companies: 2,
    systemAdmin: true,
  });
  const environments: string[] = [];
  let stored: Record<string, unknown> | undefined;
  try {
    await page.route("**/api/companies/*/hacienda**", async (route) => {
      const request = route.request();
      if (request.method() === "GET") {
        const environment = new URL(request.url()).searchParams.get(
          "environment",
        );
        environments.push(environment ?? "missing");
        await route.fulfill({
          json: {
            configuration: configuration(
              environment === "production" ? "production" : "test",
            ),
            capabilities,
          },
        });
      } else {
        stored = request.postDataJSON();
        await route.fulfill({
          json: {
            configuration: {
              ...configuration("production"),
              revision: 8,
              active_version: 8,
            },
            capabilities,
          },
        });
      }
    });
    await login(page, fixture);
    await nav(page, "Mi empresa");
    await page
      .getByRole("tab", { name: "Facturación electrónica", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Credenciales del ambiente de pruebas",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByLabel("Contraseña de API", { exact: true })
      .fill("PRIVATE-COMPANY-TEST-SECRET");
    await page
      .getByRole("button", { name: "Editar empresa", exact: true })
      .click();
    await page
      .getByLabel("Ambiente de facturación", { exact: true })
      .selectOption("production");
    await expect(
      page.getByRole("heading", {
        name: "Credenciales del ambiente de producción",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Contraseña de API", { exact: true }),
    ).toHaveValue("");
    await page
      .getByRole("button", { name: "Guardar empresa", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Guardar credenciales de producción",
        exact: true,
      }),
    ).toBeEnabled();
    await page
      .getByLabel("Usuario de API", { exact: true })
      .fill("PRIVATE-COMPANY-PRODUCTION-USER");
    await page
      .getByLabel("Contraseña de API", { exact: true })
      .fill("PRIVATE-COMPANY-PRODUCTION-PASSWORD");
    await page
      .getByLabel("PIN de la llave", { exact: true })
      .fill("PRIVATE-COMPANY-PRODUCTION-PIN");
    await page
      .getByLabel("Llave criptográfica (.p12 o .pfx)", { exact: true })
      .setInputFiles({
        name: "synthetic.p12",
        mimeType: "application/x-pkcs12",
        buffer: Buffer.from("synthetic-only"),
      });
    await page
      .getByRole("button", {
        name: "Guardar credenciales de producción",
        exact: true,
      })
      .click();
    await expect.poll(() => stored?.environment).toBe("production");
    expect(stored?.expected_revision).toBe(7);
    await expect(
      page.getByLabel("Contraseña de API", { exact: true }),
    ).toHaveValue("");
    expect(environments).toContain("test");
    expect(environments).toContain("production");
    expect(environments).not.toContain("missing");
  } finally {
    await fixture.pool.end();
  }
});
