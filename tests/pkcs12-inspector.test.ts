import { it, expect } from "vitest";
import {
  inspectPkcs12,
  inspectorCapability,
} from "../apps/api/src/security/pkcs12-inspector";
import { syntheticPkcs12 } from "./support/pkcs12";
it("opens synthetic current and legacy containers and exposes only public metadata", async () => {
  for (const [pin, bits, legacy] of [
    ["1234", 2048, true],
    [" LlavéDePrueba!2026 ", 4096, false],
  ] as const) {
    const bytes = await syntheticPkcs12({ pin, bits, legacy });
    const info = await inspectPkcs12(bytes, pin);
    expect(info).toMatchObject({
      technical_status: "valid_local",
      identity_status: "pending",
      algorithm: "rsa",
      bits,
    });
    expect(info.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(info)).not.toContain(pin);
    expect(JSON.stringify(info)).not.toContain("PRIVATE KEY");
  }
});
it("rejects wrong PIN, oversized input and malformed material without leaking secrets", async () => {
  const bytes = await syntheticPkcs12({ pin: "1234" });
  for (const action of [
    () => inspectPkcs12(bytes, "WRONG-PIN-SECRET"),
    () => inspectPkcs12(Buffer.alloc(2097153), "1234"),
    () => inspectPkcs12(Buffer.from("not-pkcs12"), "1234"),
    () => inspectPkcs12(bytes, "1234\nignored"),
  ]) {
    try {
      await action();
      throw new Error("unexpected success");
    } catch (e: any) {
      expect(e.message).not.toContain("WRONG-PIN-SECRET");
      expect(e.message).not.toContain("PRIVATE KEY");
      expect(e.message).not.toBe("unexpected success");
    }
  }
});
it("requires a patched inspector before processing arbitrary files", async () => {
  const c = await inspectorCapability();
  expect(c.available).toBe(true);
  expect(c.version).toMatch(/^3\.5\./);
});

it("rejects a container without a private key and unsupported EC keys", async () => {
  for (const options of [
    { certificateOnly: true },
    { algorithm: "ec" as const },
  ]) {
    const file = await syntheticPkcs12({ pin: "1234", ...options });
    await expect(inspectPkcs12(file, "1234")).rejects.toThrow(
      "No se pudo validar",
    );
  }
});
it("bounds parser admission to two workers and four queued requests", async () => {
  const file = await syntheticPkcs12({ pin: "1234" });
  const results = await Promise.allSettled(
    Array.from({ length: 7 }, () => inspectPkcs12(file, "1234")),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(6);
  const busy = results.find(
    (r) => r.status === "rejected",
  ) as PromiseRejectedResult;
  expect(busy.reason.statusCode).toBe(429);
});

it("rejects containers without MAC integrity and PINs exceeding OpenSSL byte capacity", async () => {
  const file = await syntheticPkcs12({ pin: "1234", noMac: true });
  await expect(inspectPkcs12(file, "1234")).rejects.toThrow();
  const ordinary = await syntheticPkcs12({ pin: "1234" });
  await expect(inspectPkcs12(ordinary, "a".repeat(1024))).rejects.toThrow(
    "Archivo o PIN",
  );
  await expect(inspectPkcs12(ordinary, "é".repeat(512))).rejects.toThrow(
    "Archivo o PIN",
  );
});
it("rejects expired, future and ambiguous matching certificates in real synthetic PKCS12 files", async () => {
  for (const options of [
    { validity: "expired" as const },
    { validity: "future" as const },
    { duplicateCertificate: true },
  ]) {
    const bytes = await syntheticPkcs12({ pin: "1234", ...options });
    await expect(inspectPkcs12(bytes, "1234")).rejects.toThrow(
      "No se pudo validar",
    );
  }
});
