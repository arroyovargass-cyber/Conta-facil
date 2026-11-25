import { it, expect } from "vitest";
import { HaciendaReception } from "../apps/api/src/services/hacienda-reception";
const clave = "5".repeat(50);
const input = {
  clave,
  fecha: "2026-11-24T12:00:00-06:00",
  emisor: { tipoIdentificacion: "02", numeroIdentificacion: "3101123456" },
  comprobanteXml: "<Factura>ñ</Factura>",
};
const reply = (status: number, data: unknown = {}, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers });
const client = (fetcher: typeof fetch, timeoutMs = 100) =>
  new HaciendaReception({ fetcher, timeoutMs });
it("sends only documented fields and base64 UTF8 to fixed STAG endpoint with redirects forbidden", async () => {
  const c = client(async (url, init) => {
    expect(String(url)).toBe(
      "https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/recepcion",
    );
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toMatchObject({ authorization: "Bearer secret" });
    expect(JSON.parse(String(init?.body))).toEqual({
      ...input,
      comprobanteXml: Buffer.from(input.comprobanteXml).toString("base64"),
    });
    return reply(201);
  });
  expect(
    await c.submit("secret", { ...input, callbackUrl: "https://evil" } as any),
  ).toEqual({ status: "received" });
});
it("recognizes only 201 as technical receipt and never retries", async () => {
  for (const [http, status] of [
    [202, "uncertain"],
    [401, "authentication_failed"],
    [403, "authentication_failed"],
    [400, "rejected_request"],
    [503, "service_unavailable"],
  ] as const) {
    let calls = 0;
    expect(
      await client(async () => {
        calls++;
        return reply(http);
      }).submit("s", input),
    ).toEqual({ status });
    expect(calls).toBe(1);
  }
});
it("bounds retry-after and returns uncertainty for transport timeout", async () => {
  expect(
    await client(async () =>
      reply(429, {}, { "retry-after": "999999999" }),
    ).submit("s", input),
  ).toEqual({ status: "rate_limited", retryAfterSeconds: 86400 });
  expect(
    await client(
      async (_u, i) =>
        new Promise((_r, reject) =>
          i?.signal?.addEventListener("abort", () =>
            reject(new Error("secret")),
          ),
        ),
      1,
    ).submit("s", input),
  ).toEqual({ status: "uncertain" });
});
it("validates request boundaries before transport", async () => {
  let calls = 0;
  const c = client(async () => {
    calls++;
    return reply(201);
  });
  for (const bad of [
    { ...input, clave: "1" },
    {
      ...input,
      emisor: { ...input.emisor, numeroIdentificacion: "1".repeat(13) },
    },
    { ...input, comprobanteXml: "x".repeat(1024 * 1024 + 1) },
  ])
    expect(await c.submit("s", bad)).toEqual({ status: "rejected_request" });
  expect(calls).toBe(0);
});
it("queries actual state fields without promoting reported acceptance to final acceptance", async () => {
  for (const [state, status] of [
    ["recibido", "pending"],
    ["procesando", "pending"],
    ["aceptado", "reported_accepted"],
    ["rechazado", "reported_rejected"],
    ["error", "reported_error"],
  ]) {
    const xml = "<MensajeHacienda />";
    const c = client(async (url, init) => {
      expect(String(url)).toBe(
        "https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/recepcion/" +
          clave,
      );
      expect(init?.method).toBe("GET");
      return reply(200, {
        clave,
        "ind-estado": state,
        "respuesta-xml": Buffer.from(xml).toString("base64"),
      });
    });
    expect(await c.query("s", clave)).toEqual({
      status,
      reportedState: state,
      responseXml: xml,
    });
  }
});
it("rejects cross-clave, malformed base64, unsafe XML and malformed or oversized JSON", async () => {
  for (const data of [
    { clave: "6".repeat(50), "ind-estado": "aceptado" },
    { clave, "ind-estado": "aceptado", "respuesta-xml": "***" },
    {
      clave,
      "ind-estado": "aceptado",
      "respuesta-xml": Buffer.from("<!DOCTYPE x><x/>").toString("base64"),
    },
    { clave, "ind-estado": "unexpected" },
  ])
    expect(
      await client(async () => reply(200, data)).query("s", clave),
    ).toEqual({ status: "uncertain" });
  for (const body of ["bad", " ".repeat(2_800_001)])
    expect(
      await client(async () => new Response(body)).query("s", clave),
    ).toEqual({ status: "uncertain" });
  expect(await client(async () => reply(404)).query("s", clave)).toEqual({
    status: "not_found",
  });
});
it("bounds decoded responses and rejects noncanonical base64 and invalid UTF8", async () => {
  for (const encoded of [
    "Zh==",
    Buffer.from([0xff]).toString("base64"),
    Buffer.from("<x>" + "a".repeat(2 * 1024 * 1024) + "</x>").toString(
      "base64",
    ),
  ])
    expect(
      await client(async () =>
        reply(200, {
          clave,
          "ind-estado": "aceptado",
          "respuesta-xml": encoded,
        }),
      ).query("s", clave),
    ).toEqual({ status: "uncertain" });
});
it("does not infer not-found from JSON or follow redirect statuses", async () => {
  expect(
    await client(async () => reply(200, { error: 404 })).query("s", clave),
  ).toEqual({ status: "uncertain" });
  expect(
    await client(async () =>
      reply(302, {}, { location: "https://evil" }),
    ).submit("s", input),
  ).toEqual({ status: "uncertain" });
});
it("refuses production transport overrides", () => {
  const original = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    expect(() => new HaciendaReception({ fetcher: fetch })).toThrow();
    expect(() => new HaciendaReception({ timeoutMs: 1 })).toThrow();
    expect(() => new HaciendaReception()).not.toThrow();
  } finally {
    process.env.NODE_ENV = original;
  }
});
