import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X509Certificate, createHash, sign as rsaSign } from "node:crypto";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { SignedXml, ExclusiveCanonicalization } from "xml-crypto";
import { verifyHaciendaResponse } from "../apps/api/src/services/hacienda-response";
const dir = mkdtempSync(join(tmpdir(), "synthetic-hacienda-"));
function material(name: string) {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(dir, name + ".key"),
      "-out",
      join(dir, name + ".pem"),
      "-days",
      "2",
      "-subj",
      "/CN=Synthetic Hacienda test only",
    ],
    { stdio: "ignore" },
  );
  const cert = readFileSync(join(dir, name + ".pem"), "utf8");
  return {
    cert,
    key: readFileSync(join(dir, name + ".key"), "utf8"),
    pin: new X509Certificate(cert).fingerprint256,
  };
}
const fixture = material("synthetic"),
  wrong = material("wrong");
rmSync(dir, { recursive: true });
const expected = {
  clave: "1".repeat(50),
  issuerIdentification: "3101000000",
  receiverIdentification: "101110111",
  total: "2260",
  tax: "260",
};
const ns =
  "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/mensajeHacienda";
const unsigned = `<MensajeHacienda xmlns="${ns}"><Clave>${expected.clave}</Clave><NombreEmisor>Test</NombreEmisor><TipoIdentificacionEmisor>02</TipoIdentificacionEmisor><NumeroCedulaEmisor>${expected.issuerIdentification}</NumeroCedulaEmisor><NombreReceptor>Test receptor</NombreReceptor><TipoIdentificacionReceptor>01</TipoIdentificacionReceptor><NumeroCedulaReceptor>${expected.receiverIdentification}</NumeroCedulaReceptor><Mensaje>1</Mensaje><EstadoMensaje>Aceptado</EstadoMensaje><DetalleMensaje>Prueba sintética</DetalleMensaje><MontoTotalImpuesto>260</MontoTotalImpuesto><TotalFactura>2260.00000</TotalFactura></MensajeHacienda>`;
function sign(xml = unsigned, cert = fixture.cert, properties = false) {
  const signer = new SignedXml({
    privateKey: fixture.key,
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
  if (properties)
    signer.addReference({
      xpath: "//*[@Id='props']",
      transforms: ["http://www.w3.org/2001/10/xml-exc-c14n#"],
      digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    });
  signer.computeSignature(xml);
  return signer.getSignedXml();
}
function withSignedProperties(xml: string) {
  const ds = "http://www.w3.org/2000/09/xmldsig#";
  const c14n = "http://www.w3.org/2001/10/xml-exc-c14n#";
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const signature = doc.getElementsByTagNameNS(ds, "Signature")[0];
  const fragment = new DOMParser().parseFromString(
    `<Object xmlns="${ds}"><x:QualifyingProperties xmlns:x="http://uri.etsi.org/01903/v1.3.2#"><x:SignedProperties Id="properties"><x:SignedSignatureProperties><x:SigningTime>2026-11-25T00:00:00Z</x:SigningTime></x:SignedSignatureProperties></x:SignedProperties></x:QualifyingProperties></Object>`,
    "application/xml",
  );
  signature.appendChild(doc.importNode(fragment.documentElement!, true));
  const properties = doc.getElementsByTagNameNS(
    "http://uri.etsi.org/01903/v1.3.2#",
    "SignedProperties",
  )[0];
  const canonicalize = (node: any) =>
    new ExclusiveCanonicalization().process(node, {});
  const digest = createHash("sha256")
    .update(canonicalize(properties))
    .digest("base64");
  const ref = new DOMParser().parseFromString(
    `<Reference xmlns="${ds}" URI="#properties"><Transforms><Transform Algorithm="${c14n}"/></Transforms><DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><DigestValue>${digest}</DigestValue></Reference>`,
    "application/xml",
  );
  const info = doc.getElementsByTagNameNS(ds, "SignedInfo")[0];
  info.appendChild(doc.importNode(ref.documentElement!, true));
  doc.getElementsByTagNameNS(ds, "SignatureValue")[0].textContent = rsaSign(
    "RSA-SHA256",
    Buffer.from(canonicalize(info)),
    fixture.key,
  ).toString("base64");
  return new XMLSerializer().serializeToString(doc);
}
const signed = sign();
const verify = (xml: string, value = expected, pins = [fixture.pin]) =>
  verifyHaciendaResponse(xml, value, pins);
describe("Hacienda response verification with explicit synthetic certificate pin", () => {
  it("accepts only an authentic matching accepted response", () => {
    expect(verify(signed).status).toBe("accepted");
    expect(verify(signed, { ...expected, total: "2260.00000" }).status).toBe(
      "accepted",
    );
    expect(
      verify(sign(unsigned.replace("<Mensaje>1", "<Mensaje>3"))).status,
    ).toBe("rejected");
    expect(
      verify(sign(unsigned.replace("<Mensaje>1", "<Mensaje>2"))).status,
    ).toBe("blocked");
  });
  it("verifies every reference including SignedProperties and rejects tampering", () => {
    const xml = withSignedProperties(signed);
    expect(verify(xml).status).toBe("accepted");
    expect(
      verify(xml.replace("2026-11-25T00:00:00Z", "2026-11-24T00:00:00Z"))
        .status,
    ).toBe("blocked");
  });
  it("requires independently configured trust and the correct signing key", () => {
    expect(verify(signed, expected, []).issues).toContain(
      "TRUST_NOT_CONFIGURED",
    );
    expect(verify(signed, expected, [wrong.pin]).status).toBe("blocked");
    expect(
      verify(sign(unsigned, wrong.cert), expected, [wrong.pin]).status,
    ).toBe("blocked");
    expect(verify(unsigned).status).toBe("blocked");
  });
  it("rejects tampering, external references, duplicate IDs, malformed XML and wrapping", () => {
    for (const bad of [
      signed.replace("2260.00000", "2261.00000"),
      signed.replace('URI=""', 'URI="https://evil.test"'),
      signed
        .replace("<NombreEmisor>", '<NombreEmisor Id="dup">')
        .replace("<NombreReceptor>", '<NombreReceptor Id="dup">'),
      signed.replace("<Clave>", "<Clave><Clave>"),
      '<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]>' + signed,
      "<?evil x?>" + signed,
      " ".repeat(1048577),
      `<wrapper>${signed}</wrapper>`,
      signed.replace("enveloped-signature", "xslt"),
      signed
        .replace("<Signature ", '<Signature Id="props" ')
        .replace(
          "</Signature>",
          '<Object><SignedProperties Id="props">changed</SignedProperties></Object></Signature>',
        ),
    ])
      expect(verify(bad).status).toBe("blocked");
  });
  it("matches all fiscal identifiers and amounts and requires tax when nonzero", () => {
    for (const key of [
      "clave",
      "issuerIdentification",
      "receiverIdentification",
      "total",
      "tax",
    ] as const)
      expect(verify(signed, { ...expected, [key]: "999" }).status).toBe(
        "blocked",
      );
    expect(
      verify(
        sign(
          unsigned.replace("<MontoTotalImpuesto>260</MontoTotalImpuesto>", ""),
        ),
      ).status,
    ).toBe("blocked");
    expect(
      verify(
        sign(
          unsigned.replace("<MontoTotalImpuesto>260</MontoTotalImpuesto>", ""),
        ),
        { ...expected, tax: "0" },
      ).status,
    ).toBe("accepted");
  });
});
