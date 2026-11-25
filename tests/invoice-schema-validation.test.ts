import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { xmlFixture } from "./support/invoice-fixture";
import { generateInvoiceXml } from "../apps/api/src/services/invoice-xml";
import {
  signInvoiceXml,
  verifyInvoiceSignature,
} from "../apps/api/src/security/invoice-signature";
import { validateSignedInvoiceXml } from "../apps/api/src/services/invoice-schema-validation";
it("validates complete official FE plus real synthetic RSA XAdES and rejects malformed structure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "schema-signature-"));
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
        "/CN=Synthetic",
      ],
      { stdio: "ignore" },
    );
    const certificatePem = readFileSync(join(dir, "cert"), "utf8");
    const unsigned = generateInvoiceXml(xmlFixture());
    const signed = signInvoiceXml(unsigned, {
      privateKeyPem: readFileSync(join(dir, "key"), "utf8"),
      certificatePem,
      signedAt: new Date().toISOString(),
      policy: {
        url: "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/Resoluci%C3%B3n_General_sobre_disposiciones_t%C3%A9cnicas_comprobantes_electr%C3%B3nicos_para_efectos_tributarios.pdf",
        sha256Base64: "DWxin1xWOeI8OuWQXazh4VjLWAaCLAA954em7DMh0h8=",
      },
    });
    expect(verifyInvoiceSignature(signed, certificatePem)).toBe(true);
    expect(await validateSignedInvoiceXml(signed)).toEqual({
      valid: true,
      issues: [],
    });
    for (const xml of [
      unsigned,
      signed.replaceAll("TotalComprobante", "BadTotal"),
      signed.replaceAll("FacturaElectronica", "WrongRoot"),
      '<!DOCTYPE x [<!ENTITY ext SYSTEM "https://evil.invalid/x">]>' + signed,
      signed
        .replace(
          "xmlns=",
          'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="https://evil.invalid/a https://evil.invalid/a.xsd" xmlns=',
        )
        .replaceAll("TotalComprobante", "BadTotal"),
    ])
      expect((await validateSignedInvoiceXml(xml)).valid).toBe(false);
    expect(
      (await validateSignedInvoiceXml(" ".repeat(1048577))).issues,
    ).toContain("XML_SIZE_EXCEEDED");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20000);
