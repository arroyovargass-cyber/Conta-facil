import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";
import { SignedXml } from "xml-crypto";
import { validateHaciendaResponseSchema } from "../apps/api/src/services/hacienda-response-schema";
import { verifyHaciendaResponse } from "../apps/api/src/services/hacienda-response";

it("validates full pinned MH4.4 and signature structure using a real synthetic RSA signature", async () => {
  const dir = mkdtempSync(join(tmpdir(), "synthetic-mh-schema-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(dir, "key"),
        "-out",
        join(dir, "cert"),
        "-days",
        "2",
        "-subj",
        "/CN=Synthetic MH schema test only",
      ],
      { stdio: "ignore" },
    );
    const cert = readFileSync(join(dir, "cert"), "utf8");
    const expected = {
      clave: "1".repeat(50),
      issuerIdentification: "3101000000",
      receiverIdentification: "101110111",
      total: "2260",
      tax: "260",
    };
    const unsigned = `<MensajeHacienda xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/mensajeHacienda"><Clave>${expected.clave}</Clave><NombreEmisor>Test</NombreEmisor><TipoIdentificacionEmisor>02</TipoIdentificacionEmisor><NumeroCedulaEmisor>${expected.issuerIdentification}</NumeroCedulaEmisor><NombreReceptor>Test</NombreReceptor><TipoIdentificacionReceptor>01</TipoIdentificacionReceptor><NumeroCedulaReceptor>${expected.receiverIdentification}</NumeroCedulaReceptor><Mensaje>1</Mensaje><EstadoMensaje>Aceptado</EstadoMensaje><DetalleMensaje>Synthetic test</DetalleMensaje><MontoTotalImpuesto>260</MontoTotalImpuesto><TotalFactura>2260</TotalFactura></MensajeHacienda>`;
    const signer = new SignedXml({
      privateKey: readFileSync(join(dir, "key"), "utf8"),
      publicCert: cert,
      signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
      canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
    });
    signer.addReference({
      xpath: "/*",
      isEmptyUri: true,
      transforms: [
        "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
        "http://www.w3.org/2001/10/xml-exc-c14n#",
      ],
      digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    });
    signer.computeSignature(unsigned);
    const signed = signer.getSignedXml();
    expect(
      verifyHaciendaResponse(signed, expected, [
        new X509Certificate(cert).fingerprint256,
      ]).status,
    ).toBe("accepted");
    expect(await validateHaciendaResponseSchema(signed)).toEqual({
      valid: true,
      issues: [],
    });
    for (const xml of [
      unsigned,
      signed.replaceAll("TotalFactura", "BadTotal"),
      signed.replaceAll("/mensajeHacienda", "/wrongNamespace"),
      signed.replace("<Mensaje>1</Mensaje>", "<Mensaje>2</Mensaje>"),
      signed.replace("<SignatureValue>", "<SignatureValue><BadNode/>"),
      '<!DOCTYPE x [<!ENTITY ext SYSTEM "https://evil.invalid/x">]>' + signed,
      "<?evil x?>" + signed,
      signed.replace("<TotalFactura>2260", "<TotalFactura>2260.123456"),
      signed
        .replace(
          "xmlns=",
          'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="https://evil.invalid/a https://evil.invalid/a.xsd" xmlns=',
        )
        .replaceAll("TotalFactura", "BadTotal"),
    ]) {
      expect((await validateHaciendaResponseSchema(xml)).valid).toBe(false);
    }
    expect(
      (await validateHaciendaResponseSchema(" ".repeat(1048577))).issues,
    ).toContain("XML_SIZE_EXCEEDED");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20000);
