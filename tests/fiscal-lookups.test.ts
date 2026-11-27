import { expect, it, vi } from "vitest";
import { FiscalLookups } from "../apps/api/src/services/fiscal-lookups";
const row = { codigo: "0123456789012", descripcion: "Producto", impuesto: 13 };
const json = (value: unknown) => new Response(JSON.stringify(value));
it("preserves exact CABYS codes, advisory rates and fixed endpoints; caches public data", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(json({ cabys: [row] }));
  const service = new FiscalLookups(fetcher);
  const result = await service.cabys("0123456789012");
  expect(result).toEqual({
    available: true,
    source: "Hacienda",
    items: [{ code: row.codigo, description: row.descripcion, tax_rate: 13 }],
  });
  expect(result).not.toHaveProperty("selected_tax");
  expect(String(fetcher.mock.calls[0][0])).toBe(
    "https://api.hacienda.go.cr/fe/cabys?codigo=0123456789012",
  );
  expect(fetcher.mock.calls[0][1]?.redirect).toBe("error");
  await service.cabys("0123456789012");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("encodes description searches, never interprets a search as a URL", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json([]));
  await new FiscalLookups(fetcher).cabys("https://evil.test/path");
  const url = new URL(String(fetcher.mock.calls[0][0]));
  expect(url.origin).toBe("https://api.hacienda.go.cr");
  expect(url.searchParams.get("q")).toBe("https://evil.test/path");
  expect(url.searchParams.get("top")).toBe("10");
});
it("preserves Hacienda's category hierarchy as advisory result metadata", async () => {
  const categories = [
    "Productos alimenticios",
    "Jugos de vegetales",
    "Jugo de tomate concentrado",
  ];
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(json([{ ...row, categorias: categories }]));
  const result = await new FiscalLookups(fetcher).cabys("Jugos de vegetales");
  expect(result.items[0]).toEqual({
    code: row.codigo,
    description: row.descripcion,
    tax_rate: 13,
    categories,
  });
  const url = new URL(String(fetcher.mock.calls[0][0]));
  expect([...url.searchParams.keys()].sort()).toEqual(["q", "top"]);
  expect(result).not.toHaveProperty("selected_tax");
});
it.each([
  () =>
    new Response(null, {
      status: 302,
      headers: { location: "https://evil.test" },
    }),
  () => new Response("x".repeat(512 * 1024 + 1)),
  () => new Response("{}", { headers: { "content-length": "524289" } }),
  () => json([{ ...row, codigo: 123456789012 }]),
  () => json([{ ...row, impuesto: -1 }]),
  () => new Response("Unavailable", { status: 503 }),
])(
  "degrades to manual entry for unsafe or unavailable provider responses",
  async (response) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response());
    expect(await new FiscalLookups(fetcher).cabys("producto")).toMatchObject({
      available: false,
      source: "Hacienda",
      items: [],
    });
  },
);
it("does not cache recipient data and never chooses an activity automatically", async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
    json({
      nombre: "Fixture only",
      tipoIdentificacion: "01",
      actividades: [{ codigo: "123456", descripcion: "Actividad" }],
    }),
  );
  const service = new FiscalLookups(fetcher);
  const result = await service.recipient("000000000");
  expect(result.recipient).toEqual({
    name: "Fixture only",
    identification: "000000000",
    identification_type: "01",
  });
  expect(result.recipient).not.toHaveProperty("economic_activity");
  await service.recipient("000000000");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("preserves dotted and legacy activity codes with the supplied taxpayer and activity status", async () => {
  const before = Date.now();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    json({
      nombre: "Contribuyente de prueba",
      tipoIdentificacion: "02",
      regimen: { codigo: 0, descripcion: "No tiene" },
      situacion: {
        estado: "Inscrito",
        moroso: "NO",
        omiso: "SI",
        administracionTributaria: "San José",
      },
      actividades: [
        {
          codigo: "4520.0",
          descripcion: "Mantenimiento",
          estado: "A",
          tipo: "P",
        },
        {
          codigo: "4100.0",
          descripcion: "Construcción",
          estado: "I",
          tipo: "S",
        },
        { codigo: "123456", descripcion: "Código anterior" },
      ],
    }),
  );
  const result = await new FiscalLookups(fetcher).recipient("0000000000");
  expect(result.available).toBe(true);
  expect(result.source).toBe("Hacienda");
  expect(result.source_url).toBe("https://api.hacienda.go.cr/fe/ae");
  expect(Date.parse(result.queried_at!)).toBeGreaterThanOrEqual(before);
  expect(result.regime).toEqual({ code: 0, description: "No tiene" });
  expect(result.situation).toEqual({
    state: "Inscrito",
    delinquent: "NO",
    missing_returns: "SI",
    tax_administration: "San José",
  });
  expect(result.activities).toEqual([
    {
      code: "4520.0",
      description: "Mantenimiento",
      state: "A",
      type: "P",
      active: true,
    },
    {
      code: "4100.0",
      description: "Construcción",
      state: "I",
      type: "S",
      active: false,
    },
    { code: "123456", description: "Código anterior" },
  ]);
  expect(result).not.toHaveProperty("registered");
  expect(result.recipient).not.toHaveProperty("economic_activity");
});
it("does not infer registration or activity validity from an absent source status", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    json({
      nombre: "Contribuyente de prueba",
      actividades: [
        { codigo: "4523.0", descripcion: "Texto de prueba", estado: "?" },
      ],
    }),
  );
  const result = await new FiscalLookups(fetcher).recipient("000000000");
  expect(result.activities).toEqual([
    { code: "4523.0", description: "Texto de prueba", state: "?" },
  ]);
  expect(result).not.toHaveProperty("situation");
  expect(result).not.toHaveProperty("registered");
});
it.each([4520, "4520", "45200.0", " 4520.0"])(
  "does not coerce, pad or trim an invalid provider activity code %j",
  async (code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        nombre: "Contribuyente de prueba",
        actividades: [{ codigo: code, descripcion: "Actividad", estado: "A" }],
      }),
    );
    expect(
      await new FiscalLookups(fetcher).recipient("000000000"),
    ).toMatchObject({
      available: false,
      reason: "invalid_response",
    });
  },
);
it.each([
  [400, "invalid_parameter"],
  [404, "not_found"],
  [429, "rate_limited"],
  [503, "unavailable"],
] as const)(
  "reports provider HTTP %s separately without retries",
  async (status, reason) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response("{}", { status }));
    const service = new FiscalLookups(fetcher);
    expect(await service.recipient("000000000")).toMatchObject({
      available: false,
      reason,
    });
    expect(await service.cabys("producto")).toMatchObject({
      available: false,
      reason,
      items: [],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  },
);
it("keeps failed identity lookups available for manual entry after network failure", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new TypeError("Network unavailable"));
  expect(await new FiscalLookups(fetcher).recipient("000000000")).toMatchObject(
    {
      available: false,
      reason: "unavailable",
    },
  );
});
it.each(["jugo de tomate", "palabras clave", "servicios de construcción"])(
  "uses the documented CABYS description query for %s",
  async (search) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json([]));
    await new FiscalLookups(fetcher).cabys(search);
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get("q")).toBe(search);
    expect([...url.searchParams.keys()].sort()).toEqual(["q", "top"]);
  },
);
it("bounds the public CABYS cache and returns copies that cannot mutate it", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => json([row]));
  const service = new FiscalLookups(fetcher);
  const first = await service.cabys("producto 0");
  first.items[0].description = "Mutated by caller";
  expect((await service.cabys("producto 0")).items[0].description).toBe(
    row.descripcion,
  );
  for (let i = 1; i <= 100; i++) await service.cabys("producto " + i);
  expect(fetcher).toHaveBeenCalledTimes(101);
  await service.cabys("producto 0");
  expect(fetcher).toHaveBeenCalledTimes(102);
});
it("rejects invalid input before contacting Hacienda", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const service = new FiscalLookups(fetcher);
  await expect(service.cabys("ab")).rejects.toThrow();
  await expect(service.recipient("https://evil.test")).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
