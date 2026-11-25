import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X509Certificate, createHash, sign as rsaSign } from "node:crypto";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { SignedXml, ExclusiveCanonicalization } from "xml-crypto";
import {
  verifyHaciendaResponse,
  verifyOfficialApiHaciendaResponse,
  readHaciendaResponseEvidence,
} from "../apps/api/src/services/hacienda-response";
import { HaciendaReception } from "../apps/api/src/services/hacienda-reception";
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
function withSignedProperties(xml: string, extra = "") {
  const ds = "http://www.w3.org/2000/09/xmldsig#";
  const c14n = "http://www.w3.org/2001/10/xml-exc-c14n#";
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const signature = doc.getElementsByTagNameNS(ds, "Signature")[0];
  const fragment = new DOMParser().parseFromString(
    `<Object xmlns="${ds}"><x:QualifyingProperties xmlns:x="http://uri.etsi.org/01903/v1.3.2#"><x:SignedProperties Id="properties"><x:SignedSignatureProperties><x:SigningTime>2026-11-25T00:00:00Z</x:SigningTime>${extra}</x:SignedSignatureProperties></x:SignedProperties></x:QualifyingProperties></Object>`,
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
      verify(
        sign(
          unsigned
            .replace("<Mensaje>1", "<Mensaje>3")
            .replace("<EstadoMensaje>Aceptado", "<EstadoMensaje>Rechazado"),
        ),
      ).status,
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
  it("checks optional expected identification types and XML message/state agreement", () => {
    expect(
      verifyHaciendaResponse(
        signed,
        {
          ...expected,
          issuerIdentificationType: "02",
          receiverIdentificationType: "01",
        },
        [fixture.pin],
      ).status,
    ).toBe("accepted");
    for (const types of [
      { issuerIdentificationType: "01" },
      { receiverIdentificationType: "02" },
    ])
      expect(
        verifyHaciendaResponse(signed, { ...expected, ...types }, [fixture.pin])
          .status,
      ).toBe("blocked");
    expect(
      verify(
        sign(
          unsigned.replace(
            "<EstadoMensaje>Aceptado",
            "<EstadoMensaje>Rechazado",
          ),
        ),
      ).status,
    ).toBe("blocked");
  });
  it("requires a covered XAdES signing-certificate digest to bind the embedded signing certificate", () => {
    const digestProperty = (digest: string) =>
      `<x:SigningCertificate><x:Cert><x:CertDigest><DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><DigestValue>${digest}</DigestValue></x:CertDigest></x:Cert></x:SigningCertificate>`;
    const certDigest = createHash("sha256")
      .update(new X509Certificate(fixture.cert).raw)
      .digest("base64");
    expect(
      verify(withSignedProperties(signed, digestProperty(certDigest))).status,
    ).toBe("accepted");
    expect(
      verify(
        withSignedProperties(
          signed,
          digestProperty(Buffer.alloc(32).toString("base64")),
        ),
      ).status,
    ).toBe("blocked");
  });
});

const officialExpected = {
  ...expected,
  issuerIdentificationType: "02",
  receiverIdentificationType: "01",
};
const observationContext = {
  tenantId: "tenant-one",
  credentialVersion: 3,
  environment: "production" as const,
};
async function observed(xml = signed, state = "aceptado") {
  return new HaciendaReception({
    fetcher: async () =>
      new Response(
        JSON.stringify({
          clave: expected.clave,
          "ind-estado": state,
          "respuesta-xml": Buffer.from(xml).toString("base64"),
        }),
      ),
  }).query("private-access", expected.clave, "production", observationContext);
}
describe("official API observations with explicitly synthetic test transport", () => {
  it("requires provenance plus full XSD, signature and fiscal correlation before exposing final evidence", async () => {
    const result = await observed();
    expect(
      readHaciendaResponseEvidence(result, observationContext),
    ).toBeUndefined();
    expect(
      await verifyOfficialApiHaciendaResponse(
        result,
        officialExpected,
        observationContext,
      ),
    ).toMatchObject({ status: "accepted", issues: [] });
    const evidence = readHaciendaResponseEvidence(result, observationContext);
    expect(evidence).toMatchObject({
      ...observationContext,
      method: "official_api",
      synthetic: true,
      haciendaStatus: "accepted",
      verification: "xml_signature_and_correlation",
      certificateFingerprint: fixture.pin.replace(/:/g, "").toLowerCase(),
      responseSchemaSha256:
        "b2606156042b7aa7b7f7f61945f0ff1323661b43b5a1489ad5eafad1c52fd25e",
    });
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain("private-access");
    expect(JSON.stringify(evidence)).not.toContain(
      "ministry_signer_identity_verified",
    );
    const rejected = await observed(
      sign(
        unsigned
          .replace("<Mensaje>1", "<Mensaje>3")
          .replace("<EstadoMensaje>Aceptado", "<EstadoMensaje>Rechazado"),
      ),
      "rechazado",
    );
    expect(
      (
        await verifyOfficialApiHaciendaResponse(
          rejected,
          officialExpected,
          observationContext,
        )
      ).status,
    ).toBe("rejected");
    expect(
      readHaciendaResponseEvidence(rejected, observationContext)
        ?.haciendaStatus,
    ).toBe("rejected");
  });
  it("rejects copied, deserialized or invented provenance and mismatched tenant, environment or version", async () => {
    const result = await observed();
    const forged = {
      ...result,
      evidence: {
        method: "official_api",
        ...observationContext,
        synthetic: false,
      },
    };
    for (const copy of [
      { ...result },
      JSON.parse(JSON.stringify(result)),
      forged,
    ])
      expect(
        (
          await verifyOfficialApiHaciendaResponse(
            copy,
            officialExpected,
            observationContext,
          )
        ).status,
      ).toBe("blocked");
    for (const context of [
      { ...observationContext, tenantId: "other-tenant" },
      { ...observationContext, credentialVersion: 4 },
      { ...observationContext, environment: "test" as const },
    ])
      expect(
        (
          await verifyOfficialApiHaciendaResponse(
            result,
            officialExpected,
            context,
          )
        ).status,
      ).toBe("blocked");
    expect(
      (
        await verifyOfficialApiHaciendaResponse(
          result,
          expected,
          observationContext,
        )
      ).issues,
    ).toContain("EXPECTED_IDENTIFICATION_TYPES_REQUIRED");
  });
  it("blocks every fiscal mismatch and never replaces pinned-certificate policy", async () => {
    const result = await observed();
    for (const key of [
      "clave",
      "issuerIdentification",
      "receiverIdentification",
      "issuerIdentificationType",
      "receiverIdentificationType",
      "tax",
      "total",
    ] as const)
      expect(
        (
          await verifyOfficialApiHaciendaResponse(
            result,
            { ...officialExpected, [key]: "999" },
            observationContext,
          )
        ).status,
      ).toBe("blocked");
    expect(
      verifyHaciendaResponse(signed, officialExpected, []).issues,
    ).toContain("TRUST_NOT_CONFIGURED");
  });
  it("blocks terminal JSON without matching XML and pending JSON carrying a terminal XML", async () => {
    for (const state of ["rechazado", "procesando", "error"])
      expect(
        (
          await verifyOfficialApiHaciendaResponse(
            await observed(signed, state),
            officialExpected,
            observationContext,
          )
        ).status,
      ).toBe("blocked");
    const result = await new HaciendaReception({
      fetcher: async () =>
        new Response(
          JSON.stringify({ clave: expected.clave, "ind-estado": "aceptado" }),
        ),
    }).query("s", expected.clave, "production", observationContext);
    expect(
      (
        await verifyOfficialApiHaciendaResponse(
          result,
          officialExpected,
          observationContext,
        )
      ).status,
    ).toBe("blocked");
    expect(
      readHaciendaResponseEvidence(result, observationContext),
    ).toBeUndefined();
  });
  it("requires actual valid cryptography and the complete pinned XSD despite authentic test provenance", async () => {
    for (const xml of [
      unsigned,
      sign(unsigned, wrong.cert),
      signed.replace("Prueba sintética", "Alterado"),
      sign(
        unsigned.replace("<NombreEmisor>", '<NombreEmisor unexpected="true">'),
      ),
    ]) {
      const result = await observed(xml);
      expect(
        (
          await verifyOfficialApiHaciendaResponse(
            result,
            officialExpected,
            observationContext,
          )
        ).status,
      ).toBe("blocked");
      expect(
        readHaciendaResponseEvidence(result, observationContext),
      ).toBeUndefined();
    }
  });
  it("rejects mutated bytes even when a toJSON method pretends they were unchanged", async () => {
    const result = await observed();
    const original = { ...result };
    Object.assign(result, {
      responseXml: sign(
        unsigned.replace("Prueba sintética", "Otro XML firmado"),
      ),
      toJSON: () => original,
    });
    expect(
      (
        await verifyOfficialApiHaciendaResponse(
          result,
          officialExpected,
          observationContext,
        )
      ).status,
    ).toBe("blocked");
  });
  it("cannot use synthetic provenance in a production runtime or with disabled TLS validation", async () => {
    const result = await observed();
    const runtime = process.env.NODE_ENV,
      tls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    try {
      process.env.NODE_ENV = "production";
      expect(
        (
          await verifyOfficialApiHaciendaResponse(
            result,
            officialExpected,
            observationContext,
          )
        ).status,
      ).toBe("blocked");
      process.env.NODE_ENV = "test";
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
      expect(
        (
          await verifyOfficialApiHaciendaResponse(
            result,
            officialExpected,
            observationContext,
          )
        ).status,
      ).toBe("blocked");
      expect(
        readHaciendaResponseEvidence(result, observationContext),
      ).toBeUndefined();
    } finally {
      process.env.NODE_ENV = runtime;
      if (tls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = tls;
    }
  });
});
