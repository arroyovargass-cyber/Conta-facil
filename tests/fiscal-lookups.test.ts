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
    expect(await new FiscalLookups(fetcher).cabys("producto")).toEqual({
      available: false,
      source: "Hacienda",
      items: [],
    });
  },
);
it("does not cache recipient data and never chooses an activity automatically", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
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
it("rejects invalid input before contacting Hacienda", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const service = new FiscalLookups(fetcher);
  await expect(service.cabys("ab")).rejects.toThrow();
  await expect(service.recipient("https://evil.test")).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
