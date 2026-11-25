import { SaxesParser } from "saxes";
import { createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { checkServerIdentity, TLSSocket } from "node:tls";
import type { HaciendaEnvironment } from "../../../../packages/domain/src/hacienda-environment";
import { haciendaProfile } from "./hacienda-environments";
type Identity = { tipoIdentificacion: string; numeroIdentificacion: string };
export type ReceptionInput = {
  clave: string;
  fecha: string;
  emisor: Identity;
  receptor?: Identity;
  comprobanteXml: string;
};
type Failure =
  | "authentication_failed"
  | "rate_limited"
  | "service_unavailable"
  | "uncertain";
export type SubmissionResult = {
  status: Failure | "received" | "rejected_request";
  retryAfterSeconds?: number;
};
export type QueryResult = {
  status:
    | Failure
    | "pending"
    | "reported_accepted"
    | "reported_rejected"
    | "reported_error"
    | "not_found";
  responseXml?: string;
  reportedState?: string;
  retryAfterSeconds?: number;
};
export type HaciendaResponseContext = {
  tenantId: string;
  credentialVersion: number;
  environment: HaciendaEnvironment;
};
export type HaciendaResponseObservation = Readonly<{
  method: "official_api";
  tenantId: string;
  credentialVersion: number;
  environment: HaciendaEnvironment;
  profile: HaciendaEnvironment;
  clave: string;
  responseSha256: string;
  rawJsonSha256: string;
  observedAt: string;
  endpoint: string;
  httpStatus: 200;
  policyVersion: "official-api-v1";
  synthetic: boolean;
}>;
const observations = new WeakMap<
  QueryResult,
  {
    snapshot: string;
    evidence: HaciendaResponseObservation;
  }
>();
const hash = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
function querySnapshot(result: QueryResult): string {
  // Never invoke a caller-added toJSON/getter when testing a capability's bytes.
  const fields = [
    "status",
    "reportedState",
    "responseXml",
    "retryAfterSeconds",
  ] as const;
  const values = fields.map((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(result, name);
    if (descriptor && !("value" in descriptor))
      throw Error("Changed response field");
    const value: unknown = descriptor?.value;
    if (
      value !== undefined &&
      typeof value !== (name === "retryAfterSeconds" ? "number" : "string")
    )
      throw Error("Changed response field");
    return value ?? null;
  });
  return JSON.stringify(values);
}
function validContext(
  context: Omit<HaciendaResponseContext, "environment"> | undefined,
): context is Omit<HaciendaResponseContext, "environment"> {
  return (
    !!context &&
    typeof context.tenantId === "string" &&
    context.tenantId.length > 0 &&
    context.tenantId.length <= 128 &&
    Number.isSafeInteger(context.credentialVersion) &&
    context.credentialVersion > 0
  );
}
/** Read-only capability lookup. Serialized fields or copies cannot create an observation. */
export function readHaciendaResponseObservation(
  result: QueryResult,
  context: HaciendaResponseContext,
): HaciendaResponseObservation | undefined {
  const record = observations.get(result);
  if (
    !record ||
    !validContext(context) ||
    record.evidence.tenantId !== context.tenantId ||
    record.evidence.environment !== context.environment ||
    record.evidence.credentialVersion !== context.credentialVersion ||
    (record.evidence.synthetic && process.env.NODE_ENV !== "test") ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
  )
    return;
  try {
    if (record.snapshot !== querySnapshot(result)) return;
    return record.evidence;
  } catch {
    return;
  }
}
function safeXml(bytes: Buffer) {
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error("Unsafe XML");
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0,
    count = 0;
  parser.on("error", () => {
    throw Error("Malformed XML");
  });
  parser.on("doctype", () => {
    throw Error("Unsafe XML");
  });
  parser.on("processinginstruction", () => {
    throw Error("Unsafe XML");
  });
  parser.on("xmldecl", (d) => {
    if (d.encoding && d.encoding.toUpperCase() !== "UTF-8")
      throw Error("Encoding");
  });
  parser.on("opentag", (t) => {
    if (
      ++depth > 64 ||
      ++count > 20000 ||
      Object.keys(t.attributes).length > 64
    )
      throw Error("Structure");
  });
  parser.on("closetag", () => {
    depth--;
  });
  parser.write(xml).close();
  return xml;
}
export class HaciendaReception {
  #fetcher: typeof fetch | undefined;
  #timeoutMs: number;
  constructor(options: { fetcher?: typeof fetch; timeoutMs?: number } = {}) {
    if (
      process.env.NODE_ENV !== "test" &&
      (options.fetcher !== undefined || options.timeoutMs !== undefined)
    )
      throw Error("Transport overrides are test-only");
    this.#fetcher = options.fetcher;
    this.#timeoutMs = options.timeoutMs ?? 10000;
    if (
      !Number.isFinite(this.#timeoutMs) ||
      this.#timeoutMs <= 0 ||
      this.#timeoutMs > 60000
    )
      throw Error("Invalid timeout");
  }
  private async body(response: Response) {
    const reader = response.body?.getReader();
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2800000) throw Error("Response size");
        chunks.push(value);
      }
      return new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(chunks),
      );
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  async #directRequest(
    url: URL,
    init: RequestInit,
    signal: AbortSignal,
  ): Promise<{ response: Response; text: string }> {
    return new Promise((resolve, reject) => {
      const request = httpsRequest(
        url,
        {
          method: init.method,
          headers: init.headers as Record<string, string>,
          signal,
          // Do not inherit a replaceable global fetch dispatcher or HTTPS agent.
          agent: false,
          rejectUnauthorized: true,
          checkServerIdentity,
          servername: url.hostname,
        },
        (response) => {
          void (async () => {
            try {
              const socket = response.socket;
              if (
                !(socket instanceof TLSSocket) ||
                !socket.authorized ||
                checkServerIdentity(url.hostname, socket.getPeerCertificate())
              )
                throw Error("Unverified HTTPS peer");
              const chunks: Buffer[] = [];
              let size = 0;
              for await (const chunk of response) {
                const bytes = Buffer.from(chunk);
                size += bytes.length;
                if (size > 2800000) throw Error("Response size");
                chunks.push(bytes);
              }
              const headers = new Headers();
              for (const [name, value] of Object.entries(response.headers))
                if (value !== undefined)
                  headers.set(
                    name,
                    Array.isArray(value) ? value.join(", ") : value,
                  );
              resolve({
                response: new Response(null, {
                  status: response.statusCode,
                  headers,
                }),
                text: new TextDecoder("utf-8", { fatal: true }).decode(
                  Buffer.concat(chunks),
                ),
              });
            } catch (error) {
              response.destroy();
              reject(error);
            }
          })();
        },
      );
      request.on("error", reject);
      request.end(init.body === undefined ? undefined : String(init.body));
    });
  }
  async #request(
    token: string,
    path: string,
    environment: HaciendaEnvironment,
    body?: unknown,
  ): Promise<{ response: Response; text: string } | null> {
    const profile = haciendaProfile(environment);
    if (!token || /[\r\n]/.test(token)) return null;
    if (
      process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
      (this.#fetcher && process.env.NODE_ENV !== "test")
    )
      return null;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const url = new URL(profile.receptionBase + "recepcion" + path);
          const init: RequestInit = {
            method: body === undefined ? "GET" : "POST",
            headers: {
              authorization: "Bearer " + token,
              accept: "application/json",
              ...(body === undefined
                ? {}
                : { "content-type": "application/json" }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            redirect: "error",
            signal: controller.signal,
          };
          if (!this.#fetcher)
            return this.#directRequest(url, init, controller.signal);
          const response = await this.#fetcher(url.href, init);
          return { response, text: await this.body(response) };
        })(),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve(null);
          }, this.#timeoutMs);
        }),
      ]);
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private failure(
    response: Response,
  ): { status: Failure; retryAfterSeconds?: number } | undefined {
    if ([401, 403].includes(response.status))
      return { status: "authentication_failed" };
    if (response.status === 429) {
      const raw = response.headers.get("retry-after");
      const seconds =
        raw && /^\d+$/.test(raw)
          ? Number(raw)
          : raw
            ? Math.ceil((Date.parse(raw) - Date.now()) / 1000)
            : NaN;
      return {
        status: "rate_limited",
        ...(Number.isFinite(seconds) && seconds >= 0
          ? { retryAfterSeconds: Math.min(seconds, 86400) }
          : {}),
      };
    }
    if (response.status >= 500) return { status: "service_unavailable" };
  }
  async submit(
    token: string,
    input: ReceptionInput,
    environment: HaciendaEnvironment = "test",
  ): Promise<SubmissionResult> {
    const identity = (i: Identity) =>
      i &&
      /^\d{2}$/.test(i.tipoIdentificacion) &&
      /^\d{1,12}$/.test(i.numeroIdentificacion);
    if (
      !/^\d{50}$/.test(input.clave) ||
      !identity(input.emisor) ||
      (input.receptor && !identity(input.receptor)) ||
      typeof input.fecha !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        input.fecha,
      ) ||
      !Number.isFinite(Date.parse(input.fecha)) ||
      typeof input.comprobanteXml !== "string" ||
      Buffer.byteLength(input.comprobanteXml) > 1024 * 1024
    )
      return { status: "rejected_request" };
    try {
      safeXml(Buffer.from(input.comprobanteXml));
    } catch {
      return { status: "rejected_request" };
    }
    const pick = (i: Identity) => ({
      tipoIdentificacion: i.tipoIdentificacion,
      numeroIdentificacion: i.numeroIdentificacion,
    });
    const result = await this.#request(token, "", environment, {
      clave: input.clave,
      fecha: input.fecha,
      emisor: pick(input.emisor),
      ...(input.receptor ? { receptor: pick(input.receptor) } : {}),
      comprobanteXml: Buffer.from(input.comprobanteXml).toString("base64"),
    });
    if (!result) return { status: "uncertain" };
    const { response } = result;
    return (
      this.failure(response) ?? {
        status:
          response.status === 201
            ? "received"
            : response.status >= 400 && response.status < 500
              ? "rejected_request"
              : "uncertain",
      }
    );
  }
  async query(
    token: string,
    clave: string,
    environment: HaciendaEnvironment = "test",
    context?: Omit<HaciendaResponseContext, "environment">,
  ): Promise<QueryResult> {
    if (!/^\d{50}$/.test(clave)) return { status: "uncertain" };
    const binding = validContext(context)
      ? {
          tenantId: context.tenantId,
          credentialVersion: context.credentialVersion,
        }
      : undefined;
    const result = await this.#request(token, "/" + clave, environment);
    if (!result) return { status: "uncertain" };
    const { response, text } = result;
    const failure = this.failure(response);
    if (failure) return failure;
    if (response.status === 404) return { status: "not_found" };
    if (response.status !== 200) return { status: "uncertain" };
    try {
      const data = JSON.parse(text);
      if (!data || data.clave !== clave) throw Error("Clave");
      const states: Record<string, QueryResult["status"]> = {
        recibido: "pending",
        procesando: "pending",
        aceptado: "reported_accepted",
        rechazado: "reported_rejected",
        error: "reported_error",
      };
      const reportedState = data["ind-estado"];
      if (
        typeof reportedState !== "string" ||
        !Object.hasOwn(states, reportedState)
      )
        throw Error("State");
      let responseXml: string | undefined;
      if (data["respuesta-xml"] !== undefined) {
        const encoded = data["respuesta-xml"];
        if (
          typeof encoded !== "string" ||
          encoded.length > 2796204 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
            encoded,
          )
        )
          throw Error("Base64");
        const bytes = Buffer.from(encoded, "base64");
        if (
          bytes.length > 2 * 1024 * 1024 ||
          bytes.toString("base64") !== encoded
        )
          throw Error("Base64");
        responseXml = safeXml(bytes);
      }
      const query: QueryResult = {
        status: states[reportedState],
        reportedState,
        ...(responseXml === undefined ? {} : { responseXml }),
      };
      if (
        responseXml !== undefined &&
        binding &&
        process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0" &&
        (!this.#fetcher || process.env.NODE_ENV === "test")
      ) {
        const evidence = Object.freeze({
          method: "official_api" as const,
          tenantId: binding.tenantId,
          credentialVersion: binding.credentialVersion,
          environment,
          profile: environment,
          clave,
          responseSha256: hash(responseXml),
          rawJsonSha256: hash(text),
          observedAt: new Date().toISOString(),
          endpoint:
            haciendaProfile(environment).receptionBase + "recepcion/" + clave,
          httpStatus: 200 as const,
          policyVersion: "official-api-v1" as const,
          synthetic: this.#fetcher !== undefined,
        });
        observations.set(query, { evidence, snapshot: querySnapshot(query) });
      }
      return query;
    } catch {
      return { status: "uncertain" };
    }
  }
}
