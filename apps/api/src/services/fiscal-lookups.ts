import { z } from "zod";
import { economicActivityCode } from "../../../../packages/domain/src/economic-activity";

export const cabysSearchInput = z.string().trim().min(3).max(100);
export const recipientIdentificationInput = z.string().regex(/^\d{9,12}$/);
const cabysItem = z.object({
  codigo: z.string().regex(/^\d{13}$/),
  descripcion: z.string().trim().min(1).max(3000),
  impuesto: z.number().finite().min(0).max(100).optional(),
  categorias: z.array(z.string().trim().min(1).max(1000)).max(10).optional(),
});
const cabysArray = z.array(cabysItem).max(100);
const cabysSource = z.union([cabysArray, z.object({ cabys: cabysArray })]);
const sourceStatus = z.string().max(300);
const identitySource = z.object({
  nombre: z.string().trim().min(1).max(500),
  tipoIdentificacion: z
    .string()
    .regex(/^\d{2}$/)
    .optional(),
  regimen: z
    .object({
      codigo: z.union([z.number().int(), z.string().max(30)]).optional(),
      descripcion: sourceStatus.optional(),
    })
    .optional(),
  situacion: z
    .object({
      estado: sourceStatus.optional(),
      moroso: sourceStatus.optional(),
      omiso: sourceStatus.optional(),
      administracionTributaria: sourceStatus.optional(),
      mensaje: z.string().max(1000).optional(),
    })
    .optional(),
  actividades: z
    .array(
      z.object({
        codigo: economicActivityCode,
        descripcion: z.string().trim().min(1).max(1000),
        estado: sourceStatus.optional(),
        tipo: sourceStatus.optional(),
      }),
    )
    .max(100)
    .optional(),
});
export type FiscalLookupFailureReason =
  | "invalid_parameter"
  | "not_found"
  | "rate_limited"
  | "invalid_response"
  | "unavailable";
class FiscalLookupError extends Error {
  constructor(readonly reason: FiscalLookupFailureReason) {
    super(reason);
  }
}
const failureReason = (error: unknown): FiscalLookupFailureReason =>
  error instanceof FiscalLookupError
    ? error.reason
    : error instanceof z.ZodError || error instanceof SyntaxError
      ? "invalid_response"
      : "unavailable";
export type CabysResult = {
  available: boolean;
  source: "Hacienda";
  items: {
    code: string;
    description: string;
    tax_rate?: number;
    categories?: string[];
  }[];
  reason?: FiscalLookupFailureReason;
};
export type FiscalLookupActivity = {
  code: string;
  description: string;
  state?: string;
  type?: string;
  active?: boolean;
};
export type RecipientLookupResult = {
  available: boolean;
  source: "Hacienda";
  source_url: "https://api.hacienda.go.cr/fe/ae";
  queried_at?: string;
  reason?: FiscalLookupFailureReason;
  recipient?: {
    name: string;
    identification: string;
    identification_type?: string;
  };
  activities?: FiscalLookupActivity[];
  regime?: { code?: number | string; description?: string };
  situation?: {
    state?: string;
    delinquent?: string;
    missing_returns?: string;
    tax_administration?: string;
    message?: string;
  };
};

/** Public CABYS entries alone are cached. Identity responses never enter this cache. */
export class FiscalLookups {
  private readonly cache = new Map<
    string,
    { expires: number; result: CabysResult }
  >();
  private nextRequestAt = 0;
  constructor(private readonly fetcher?: typeof fetch) {}

  private async request(
    path: "/fe/cabys" | "/fe/ae",
    params: URLSearchParams,
  ): Promise<unknown> {
    // Keep requests below the official average rate, including bulk CABYS checks.
    if (!this.fetcher) {
      const now = Date.now(),
        slot = Math.max(now, this.nextRequestAt);
      this.nextRequestAt = slot + 110;
      if (slot > now)
        await new Promise((resolve) => setTimeout(resolve, slot - now));
    }
    const url = new URL(path, "https://api.hacienda.go.cr");
    url.search = params.toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await (this.fetcher ?? fetch)(url, {
        redirect: "error",
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (
        response.redirected ||
        (response.url && new URL(response.url).origin !== url.origin)
      )
        throw new FiscalLookupError("unavailable");
      if (!response.ok)
        throw new FiscalLookupError(
          response.status === 400
            ? "invalid_parameter"
            : response.status === 404
              ? "not_found"
              : response.status === 429
                ? "rate_limited"
                : "unavailable",
        );
      if (Number(response.headers.get("content-length")) > 512 * 1024)
        throw new FiscalLookupError("invalid_response");
      if (!response.body) throw new FiscalLookupError("invalid_response");
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 512 * 1024) throw new FiscalLookupError("invalid_response");
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
          ...(row.categorias === undefined
            ? {}
            : { categories: row.categorias }),
        })),
      };
      if (this.cache.size >= 100)
        this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(value, {
        expires: Date.now() + 300_000,
        result: structuredClone(result),
      });
      return result;
    } catch (error) {
      return {
        available: false,
        source: "Hacienda",
        items: [],
        reason: failureReason(error),
      };
    }
  }

  async recipient(identification: string): Promise<RecipientLookupResult> {
    const value = recipientIdentificationInput.parse(identification);
    const source = {
      source: "Hacienda",
      source_url: "https://api.hacienda.go.cr/fe/ae",
    } as const;
    try {
      const parsed = identitySource.parse(
        await this.request(
          "/fe/ae",
          new URLSearchParams({ identificacion: value }),
        ),
      );
      return {
        available: true,
        ...source,
        queried_at: new Date().toISOString(),
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
            ...(a.estado === undefined ? {} : { state: a.estado }),
            ...(a.tipo === undefined ? {} : { type: a.tipo }),
            ...(a.estado === "A" || a.estado === "I"
              ? { active: a.estado === "A" }
              : {}),
          })) ?? [],
        ...(parsed.regimen
          ? {
              regime: {
                ...(parsed.regimen.codigo === undefined
                  ? {}
                  : { code: parsed.regimen.codigo }),
                ...(parsed.regimen.descripcion === undefined
                  ? {}
                  : { description: parsed.regimen.descripcion }),
              },
            }
          : {}),
        ...(parsed.situacion
          ? {
              situation: {
                ...(parsed.situacion.estado === undefined
                  ? {}
                  : { state: parsed.situacion.estado }),
                ...(parsed.situacion.moroso === undefined
                  ? {}
                  : { delinquent: parsed.situacion.moroso }),
                ...(parsed.situacion.omiso === undefined
                  ? {}
                  : { missing_returns: parsed.situacion.omiso }),
                ...(parsed.situacion.administracionTributaria === undefined
                  ? {}
                  : {
                      tax_administration:
                        parsed.situacion.administracionTributaria,
                    }),
                ...(parsed.situacion.mensaje === undefined
                  ? {}
                  : { message: parsed.situacion.mensaje }),
              },
            }
          : {}),
      };
    } catch (error) {
      return { available: false, ...source, reason: failureReason(error) };
    }
  }
}
// Only public CABYS results are cached; identification responses remain uncached.
export const fiscalLookups = new FiscalLookups();
