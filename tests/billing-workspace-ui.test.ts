import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  commercialDefaults,
  commercialPayload,
  provisionalDueDate,
  netTaxAmount,
  IssuerFields,
  CommercialFields,
  InvoiceSummary,
} from "../apps/web/src/features/billing/BillingFields";
import {
  Drafts,
  draftFingerprint,
  duplicatedDraftFromInvoice,
} from "../apps/web/src/features/billing/Drafts";
import {
  fiscalDefaults,
  receiverDefaults,
} from "../apps/web/src/features/billing/common";
import {
  calculateInvoice,
  lineFiscalInput,
} from "../packages/domain/src/invoice-fiscal";

const options = {
  issuer: {
    legal_name: "Emisor configurado",
    identification_type: "02",
    identification: "3101000000",
    contact_email: "emisor@example.test",
    address: "Dirección guardada",
    configuration: {
      location: { province: "1", canton: "01", district: "01" },
    },
  },
  activities: [
    { code: "12345", name: "Código incompleto", is_primary: true },
    { code: "4520.0", name: "Actividad vigente", is_primary: true },
    { code: "123456", name: "Otra actividad" },
  ],
  terminals: [
    {
      id: "terminal",
      name: "Principal",
      code: "00001",
      branch_code: "001",
      branch_name: "Principal",
    },
  ],
  departments: [
    {
      id: "department",
      name: "Ventas",
      active: true,
      can_manage: true,
      can_create: true,
      can_edit: true,
    },
  ],
  permissions: [
    "customers.read",
    "customers.manage",
    "catalog.read",
    "catalog.manage",
  ],
};

it("duplicates frozen fiscal data into a new occasional draft without reusing document identity or catalog references", () => {
  const source = {
    id: "original-invoice",
    clave: "1".repeat(50),
    consecutivo: "1".repeat(20),
    issued_at: "2026-11-26T10:00:00Z",
    document_type: "FE",
    department_id: "department",
    version: 9,
    options: {
      issuer_activity: "4520.0",
      references: [{ number: "old-reference" }],
    },
    snapshot: {
      currency: "CRC",
      receiver: { name: "Receptor congelado", identification: "123456789" },
      lines: [
        {
          id: "old-line",
          catalog_item_id: "old-product",
          description: "Original",
          quantity: "2",
          unit_price: "1000",
          fiscal: fiscalDefaults(),
        },
      ],
      other_charges: [],
      notes: "Datos originales",
    },
  };
  const draft = duplicatedDraftFromInvoice(source, options);
  expect(draft).toMatchObject({
    receiver_mode: "occasional",
    save_customer: false,
    customer_id: "",
    document_type: "FE",
    currency: "CRC",
  });
  for (const field of [
    "id",
    "clave",
    "consecutivo",
    "issued_at",
    "version",
    "operation_id",
  ])
    expect(draft[field]).toBeUndefined();
  expect(draft.commercial.references).toEqual([]);
  expect(draft.lines[0].catalog_item_id).toBeNull();
  expect(draft.lines[0].id).toBeUndefined();
  draft.lines[0].fiscal.cabys = "0000000000001";
  expect(source.snapshot.lines[0].fiscal.cabys).not.toBe("0000000000001");
});

describe("billing form defaults and exact commercial values", () => {
  it("uses configured activity and terminal without normalizing dotted codes", () => {
    expect(commercialDefaults(options)).toMatchObject({
      issuer_activity: "4520.0",
      branch_code: "001",
      terminal_code: "00001",
      exchange_rate: "1",
      payment_methods: [],
    });
    expect(commercialDefaults(options, "USD").exchange_rate).toBe("");
    expect(
      commercialDefaults({
        ...options,
        issuer: {
          configuration: {
            billing: { branch_code: "002", terminal_code: "00002" },
          },
        },
        terminals: [
          ...options.terminals,
          { id: "configured", branch_code: "002", code: "00002" },
        ],
      }),
    ).toMatchObject({ branch_code: "002", terminal_code: "00002" });
    expect(commercialDefaults({})).toMatchObject({
      issuer_activity: "",
      branch_code: "",
      terminal_code: "",
    });
  });
  it("preserves payment decimals, other descriptions, reference data and explicit USD exchange rate", () => {
    const references = [
      {
        document_type: "99",
        document_other: "Contrato",
        number: "ABC",
        issue_date: "2026-11-26T10:00:00-06:00",
        code: "99",
        code_other: "Referencia",
        reason: "Contrato comercial",
      },
    ];
    const form = {
      ...commercialDefaults(options, "USD"),
      sale_condition: "02",
      credit_days: "30",
      exchange_rate: "512.12345",
      payment_methods: [
        {
          code: "99",
          amount: "0.00001",
          other_description: "Pago por convenio",
        },
      ],
      references,
    };
    expect(commercialPayload(form, "USD")).toMatchObject({
      credit_days: 30,
      exchange_rate: "512.12345",
      payment_methods: form.payment_methods,
      references,
    });
    expect(commercialPayload(form, "CRC").exchange_rate).toBe("1");
    expect(
      commercialPayload({ ...form, sale_condition: "01" }, "USD").credit_days,
    ).toBeNull();
  });
  it("keeps invalid credit text visible to schema validation instead of coercing it to null or exponent notation", () => {
    expect(
      commercialPayload({ sale_condition: "02", credit_days: "1e3" }, "CRC")
        .credit_days,
    ).toBe("1e3");
    expect(
      commercialPayload({ sale_condition: "02", credit_days: "" }, "CRC")
        .credit_days,
    ).toBeNull();
  });
  it("derives a date from the Costa Rica calendar at UTC midnight and leap-year boundaries", () => {
    expect(provisionalDueDate("2026-01-01T02:00:00Z", 1)).toBe("2026-01-01");
    expect(provisionalDueDate("2024-02-28T18:00:00Z", "1")).toBe("2024-02-29");
    expect(provisionalDueDate("2026-11-26T18:00:00Z", "30")).toBe("2026-12-26");
    for (const invalid of ["", "0", "-1", "1.5", "1e3", "100000"])
      expect(provisionalDueDate("2026-01-01T12:00:00Z", invalid)).toBe("");
  });
  it("shows exact net tax without losing monetary digits", () => {
    expect(netTaxAmount("9999999999999.99999", "0.00001")).toBe(
      "9999999999999.99998",
    );
    expect(netTaxAmount("260", "160")).toBe("100.00000");
    expect(netTaxAmount("0.1", "0.1")).toBe("0.00000");
    expect(netTaxAmount("invalid", "0")).toBe("Pendiente");
    expect(netTaxAmount("1", "2")).toBe("Pendiente");
  });
});

describe("billing form source data and calculated summary", () => {
  it("renders stored issuer fields as read-only text and registered activity/terminal choices", () => {
    const html = renderToStaticMarkup(
      React.createElement(IssuerFields, {
        options,
        value: commercialDefaults(options),
        onChange: () => {},
      }),
    );
    expect(html).toContain("Emisor configurado");
    expect(html).toContain("Dirección guardada");
    expect(html).not.toContain('value="Emisor configurado"');
    expect(html).not.toContain('value="Dirección guardada"');
    expect(html).toContain('value="4520.0" selected=""');
  });
  it("locks the prepared document type and presents a provisional commercial due date", () => {
    const html = renderToStaticMarkup(
      React.createElement(CommercialFields, {
        currency: "CRC",
        documentType: "FE",
        notes: "",
        value: {
          ...commercialDefaults(options),
          sale_condition: "02",
          credit_days: "1",
        },
        instant: "2026-01-01T02:00:00Z",
        onCurrency: () => {},
        onDocumentType: () => {},
        onNotes: () => {},
        onChange: () => {},
        lockDocumentType: true,
      }),
    );
    expect(html).toContain('Tipo de documento<select disabled=""');
    expect(html).toContain('value="2026-01-01"');
  });
  it("uses shared calculated amounts and distinguishes gross taxes from net taxes", () => {
    const calculation = calculateInvoice([
      {
        description: "Servicio",
        quantity: "2",
        unit_price: "1000",
        fiscal: lineFiscalInput.parse({
          cabys: "8399000000000",
          unit: "Sp",
          treatment: "taxable",
          tariff_code: "08",
        }),
      },
    ]);
    expect(calculation.status).toBe("complete");
    const html = renderToStaticMarkup(
      React.createElement(InvoiceSummary, { calculation, currency: "CRC" }),
    );
    expect(html).toContain('aria-label="Total del comprobante">CRC 2260.00000');
    expect(html).toContain('aria-label="Total de impuestos">CRC 260.00000');
    expect(html).toContain("Impuestos antes de exoneraciones");
    expect(html).toContain("Servicios y mercancías");
  });
  it("preserves the ordered editor and allows incomplete drafts without HTML required fields", () => {
    const html = renderToStaticMarkup(
      React.createElement(Drafts, {
        base: "/companies/local",
        options,
        mode: "new",
      }),
    );
    const headings = [
      "Datos del emisor",
      "Datos comerciales del comprobante",
      "Datos del receptor",
      "Líneas de productos y servicios",
      "Otros cargos",
      "Medios de pago",
      "Resumen de la factura",
      "Guardado, validación y emisión",
    ];
    const renderedHeadings = [
      ...html.matchAll(/<h3(?:\s[^>]*)?>([^<]+)<\/h3>/g),
    ].map((match) => match[1]);
    expect(
      renderedHeadings.filter((heading) => headings.includes(heading)),
    ).toEqual(headings);
    expect(html).toContain('noValidate=""');
    expect(html).not.toContain('required=""');
    expect(html).toContain('value="consumer_final"');
    expect(html).not.toContain('value="consumer_final" selected');
    expect(html).toContain("Guardar borrador");
    expect(html).toContain("Guardar preparación");
    expect(html).toContain(">CABYS<input");
    expect(html).toContain('value="pending" selected=""');
    expect(html).not.toContain('value="08" selected=""');
  });
  it("connects accessible detail tabs to mounted panels with lines selected and charges ready to add", () => {
    const html = renderToStaticMarkup(
      React.createElement(Drafts, {
        base: "/companies/local",
        options,
        mode: "new",
      }),
    );
    expect(html).toContain('role="tablist" aria-label="Detalle de la factura"');
    const tabs = [
      ...html.matchAll(/<button[^>]*role="tab"[^>]*>[^<]+<\/button>/g),
    ].map((match) => match[0]);
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toContain('aria-selected="true"');
    expect(tabs[0]).toContain('tabindex="0"');
    expect(tabs[0]).toContain("Líneas de detalle");
    expect(tabs[1]).toContain('aria-selected="false"');
    expect(tabs[1]).toContain("Otros cargos");
    const panels = [...html.matchAll(/<div role="tabpanel"[^>]*>/g)].map(
      (match) => match[0],
    );
    expect(panels).toHaveLength(2);
    expect(panels[0]).not.toContain('hidden=""');
    expect(panels[1]).toContain('hidden=""');
    expect(html).not.toContain("Otros cargos (opcional)");
    expect(html).toContain("Agregar otro cargo");
  });
  it("honors an explicit deny even when the legacy manage permission is true", () => {
    const html = renderToStaticMarkup(
      React.createElement(Drafts, {
        base: "/companies/local",
        mode: "new",
        options: {
          ...options,
          departments: [{ ...options.departments[0], can_create: false }],
        },
      }),
    );
    expect(html).toContain('fieldset disabled=""');
    expect(html).not.toContain('class="button primary">Guardar borrador');
  });
  it("tracks charges, commercial data and explicit save choices as unsaved changes", () => {
    const row = {
      receiver_mode: "occasional",
      receiver: receiverDefaults(),
      document_type: "FE",
      customer_id: null,
      department_id: "d",
      currency: "CRC",
      notes: "",
      commercial: commercialDefaults(options),
      other_charges: [],
      lines: [
        {
          description: "Servicio",
          quantity: "1",
          unit_price: "1",
          fiscal: fiscalDefaults(),
        },
      ],
    };
    const initial = draftFingerprint(row);
    expect(draftFingerprint({ ...row, save_customer: true })).not.toBe(initial);
    expect(
      draftFingerprint({
        ...row,
        other_charges: [{ code: "08", amount: "10" }],
      }),
    ).not.toBe(initial);
    expect(
      draftFingerprint({
        ...row,
        commercial: {
          ...row.commercial,
          sale_condition: "02",
          credit_days: "30",
        },
      }),
    ).not.toBe(initial);
    expect(
      draftFingerprint({
        ...row,
        lines: [{ ...row.lines[0], save_catalog_item: true }],
      }),
    ).not.toBe(initial);
  });
});
