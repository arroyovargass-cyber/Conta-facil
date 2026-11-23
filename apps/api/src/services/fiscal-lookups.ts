import { z } from "zod";

export const cabysSearchInput = z.string().trim().min(3).max(100);
export const recipientIdentificationInput = z.string().regex(/^\d{9,12}$/);
const cabysItem = z.object({
  codigo: z.string().regex(/^\d{13}$/),
  descripcion: z.string().trim().min(1).max(3000),
  impuesto: z.number().finite().min(0).max(100).optional(),
});
const cabysArray = z.array(cabysItem).max(100);
const cabysSource = z.union([cabysArray, z.object({ cabys: cabysArray })]);
const identitySource = z.object({
  nombre: z.string().trim().min(1).max(500),
  tipoIdentificacion: z
    .string()
    .regex(/^\d{2}$/)
    .optional(),
  actividades: z
    .array(
      z.object({
        codigo: z.string().regex(/^\d{1,10}$/),
        descripcion: z.string().trim().min(1).max(1000),
      }),
    )
    .max(100)
    .optional(),
});
export type CabysResult = {
  available: boolean;
  source: "Hacienda";
  items: { code: string; description: string; tax_rate?: number }[];
};
export type RecipientLookupResult = {
  available: boolean;
  recipient?: {
    name: string;
    identification: string;
    identification_type?: string;
  };
  activities?: { code: string; description: string }[];
};

/** Public CABYS entries alone are cached. Identity responses never enter this cache. */
export class FiscalLookups {
  private readonly cache = new Map<
    string,
    { expires: number; result: CabysResult }
  >();
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  private async request(
    path: "/fe/cabys" | "/fe/ae",
    params: URLSearchParams,
  ): Promise<unknown> {
    const url = new URL(path, "https://api.hacienda.go.cr");
    url.search = params.toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await this.fetcher(url, {
        redirect: "error",
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (
        !response.ok ||
        response.redirected ||
        (response.url && new URL(response.url).origin !== url.origin)
      )
        throw new Error("Unavailable");
      if (Number(response.headers.get("content-length")) > 512 * 1024)
        throw new Error("Too large");
      if (!response.body) throw new Error("Unavailable");
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 512 * 1024) throw new Error("Too large");
        chunks.push(part.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } finally {
      clearTimeout(timer);
      if (reader) await reader.cancel().catch(() => {});
      controller.abort();
    }
  }

  async cabys(search: string): Promise<CabysResult> {
    const value = cabysSearchInput.parse(search);
    const cached = this.cache.get(value);
    if (cached && cached.expires > Date.now())
      return structuredClone(cached.result);
    this.cache.delete(value);
    try {
      const params = /^\d{13}$/.test(value)
        ? new URLSearchParams({ codigo: value })
        : new URLSearchParams({ q: value, top: "10" });
      const parsed = cabysSource.parse(await this.request("/fe/cabys", params));
      const rows = Array.isArray(parsed) ? parsed : parsed.cabys;
      const result: CabysResult = {
        available: true,
        source: "Hacienda",
        items: rows.slice(0, 10).map((row) => ({
          code: row.codigo,
          description: row.descripcion,
          ...(row.impuesto === undefined ? {} : { tax_rate: row.impuesto }),
        })),
      };
      if (this.cache.size >= 100)
        this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(value, {
        expires: Date.now() + 300_000,
        result: structuredClone(result),
      });
      return result;
    } catch {
      return { available: false, source: "Hacienda", items: [] };
    }
  }

  async recipient(identification: string): Promise<RecipientLookupResult> {
    const value = recipientIdentificationInput.parse(identification);
    try {
      const parsed = identitySource.parse(
        await this.request(
          "/fe/ae",
          new URLSearchParams({ identificacion: value }),
        ),
      );
      return {
        available: true,
        recipient: {
          name: parsed.nombre,
          identification: value,
          ...(parsed.tipoIdentificacion
            ? { identification_type: parsed.tipoIdentificacion }
            : {}),
        },
        activities:
          parsed.actividades?.map((a) => ({
            code: a.codigo,
            description: a.descripcion,
          })) ?? [],
      };
    } catch {
      return { available: false };
    }
  }
}
