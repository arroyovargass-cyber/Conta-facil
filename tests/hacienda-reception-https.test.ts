import { EventEmitter } from "node:events";
import { checkServerIdentity, TLSSocket } from "node:tls";
import { Readable } from "node:stream";
import { Socket } from "node:net";
import { expect, it, vi } from "vitest";

const nativeRequest = vi.hoisted(() => vi.fn());
vi.mock("node:https", () => ({ request: nativeRequest }));
import {
  HaciendaReception,
  readHaciendaResponseObservation,
} from "../apps/api/src/services/hacienda-reception";

it("uses native HTTPS with a fresh agent, mandatory chain and hostname verification instead of global fetch", async () => {
  const replacedFetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Must not use replaceable fetch"));
  const captured: unknown[][] = [];
  nativeRequest.mockImplementation((url, options) => {
    captured.push([url, options]);
    const request = new EventEmitter() as EventEmitter & { end(): void };
    request.end = () =>
      request.emit("error", new Error("Synthetic network failure"));
    return request;
  });
  try {
    const context = {
      tenantId: "tenant-one",
      environment: "production" as const,
      credentialVersion: 3,
    };
    const result = await new HaciendaReception().query(
      "unit-token",
      "1".repeat(50),
      "production",
      context,
    );
    expect(result).toEqual({ status: "uncertain" });
    expect(readHaciendaResponseObservation(result, context)).toBeUndefined();
    expect(captured).toHaveLength(1);
    expect(String(captured[0][0])).toBe(
      "https://api.comprobanteselectronicos.go.cr/recepcion/v1/recepcion/" +
        "1".repeat(50),
    );
    expect(captured[0][1]).toMatchObject({
      agent: false,
      rejectUnauthorized: true,
      checkServerIdentity,
      servername: "api.comprobanteselectronicos.go.cr",
      method: "GET",
    });
    expect(replacedFetch).not.toHaveBeenCalled();
  } finally {
    replacedFetch.mockRestore();
  }
});

it("refuses an HTTP 200 from an unauthorized TLS socket and never mints origin evidence", async () => {
  nativeRequest.mockImplementation((_url, _options, onResponse) => {
    const request = new EventEmitter() as EventEmitter & { end(): void };
    request.end = () => {
      const response = Readable.from([
        JSON.stringify({
          clave: "1".repeat(50),
          "ind-estado": "aceptado",
          "respuesta-xml": "PHgvPg==",
        }),
      ]);
      Object.assign(response, {
        statusCode: 200,
        headers: {},
        socket: new TLSSocket(new Socket()),
      });
      onResponse(response);
    };
    return request;
  });
  const context = {
    tenantId: "tenant-one",
    environment: "production" as const,
    credentialVersion: 3,
  };
  const result = await new HaciendaReception().query(
    "unit-token",
    "1".repeat(50),
    "production",
    context,
  );
  expect(result).toEqual({ status: "uncertain" });
  expect(readHaciendaResponseObservation(result, context)).toBeUndefined();
});
