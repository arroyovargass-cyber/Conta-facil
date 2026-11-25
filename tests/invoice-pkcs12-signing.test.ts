import { it, expect } from "vitest";
import { syntheticPkcs12 } from "./support/pkcs12";
import { signInvoicePkcs12 } from "../apps/api/src/security/invoice-pkcs12-signing";
import { verifyInvoiceSignature } from "../apps/api/src/security/invoice-signature";
const xml =
  '<FacturaElectronica xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica"><Total>2260</Total></FacturaElectronica>';
const base = {
  xml,
  get signedAt() {
    return new Date().toISOString();
  },
  policy: {
    url: "https://example.test/policy",
    sha256Base64: Buffer.alloc(32, 1).toString("base64"),
  },
};
it("signs in an isolated worker and returns only public certificate and signed XML", async () => {
  const pkcs12 = await syntheticPkcs12({ pin: "1234" });
  const result = await signInvoicePkcs12({ ...base, pkcs12, pin: "1234" });
  expect(verifyInvoiceSignature(result.signedXml, result.certificatePem)).toBe(
    true,
  );
  expect(Object.keys(result).sort()).toEqual(["certificatePem", "signedXml"]);
  expect(JSON.stringify(result)).not.toContain("PRIVATE KEY");
});
it("rejects wrong PIN, malformed, missing MAC and unsupported key without secret diagnostics", async () => {
  for (const options of [{}, { noMac: true }, { algorithm: "ec" as const }]) {
    const pkcs12 = await syntheticPkcs12({ pin: "1234", ...options });
    await expect(
      signInvoicePkcs12({
        ...base,
        pkcs12,
        pin: Object.keys(options).length ? "1234" : "SECRET_WRONG_PIN",
      }),
    ).rejects.toThrow("No se pudo firmar");
  }
  await expect(
    signInvoicePkcs12({ ...base, pkcs12: Buffer.from("bad"), pin: "1234" }),
  ).rejects.toThrow("No se pudo firmar");
});
it("rejects MAC tampering and a claimed time outside certificate validity", async () => {
  const original = await syntheticPkcs12({ pin: "1234" });
  const tampered = Buffer.from(original);
  tampered[tampered.length - 1] ^= 1;
  await expect(
    signInvoicePkcs12({ ...base, pkcs12: tampered, pin: "1234" }),
  ).rejects.toThrow("No se pudo firmar");
  await expect(
    signInvoicePkcs12({
      ...base,
      pkcs12: original,
      pin: "1234",
      signedAt: "2000-01-01T00:00:00Z",
    }),
  ).rejects.toThrow("No se pudo firmar");
});
it("bounds input and worker admission", async () => {
  await expect(
    signInvoicePkcs12({ ...base, pkcs12: Buffer.alloc(2097153), pin: "1234" }),
  ).rejects.toThrow();
  await expect(
    signInvoicePkcs12({
      ...base,
      xml: "a".repeat(1048577),
      pkcs12: Buffer.alloc(1),
      pin: "1234",
    }),
  ).rejects.toThrow();
  const pkcs12 = await syntheticPkcs12({ pin: "1234" });
  const results = await Promise.allSettled(
    Array.from({ length: 7 }, () =>
      signInvoicePkcs12({ ...base, pkcs12, pin: "1234" }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(6);
  expect(
    (results.find((r) => r.status === "rejected") as PromiseRejectedResult)
      .reason.statusCode,
  ).toBe(429);
});
