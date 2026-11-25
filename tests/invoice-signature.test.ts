import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  openSync,
  closeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  signInvoiceXml,
  verifyInvoiceSignature,
} from "../apps/api/src/security/invoice-signature";
const dir = mkdtempSync(join(tmpdir(), "invoice-signature-"));
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    join(dir, "key.pem"),
    "-out",
    join(dir, "cert.pem"),
    "-days",
    "2",
    "-subj",
    "/CN=Synthetic test/O=Test",
  ],
  { stdio: "ignore" },
);
const material = {
  privateKeyPem: readFileSync(join(dir, "key.pem"), "utf8"),
  certificatePem: readFileSync(join(dir, "cert.pem"), "utf8"),
  signedAt: new Date().toISOString(),
  policy: {
    url: "https://example.test/policy.pdf",
    sha256Base64: Buffer.alloc(32, 1).toString("base64"),
  },
};
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    join(dir, "wrong-key.pem"),
    "-out",
    join(dir, "wrong-cert.pem"),
    "-days",
    "2",
    "-subj",
    "/CN=Wrong test",
  ],
  { stdio: "ignore" },
);
const wrongCertificate = readFileSync(join(dir, "wrong-cert.pem"), "utf8");
rmSync(dir, { recursive: true });
const xml =
  '<FacturaElectronica xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica"><Total>2260</Total></FacturaElectronica>';
describe("bounded real XAdES EPES", () => {
  it("signs and verifies a synthetic RSA certificate", () => {
    const signed = signInvoiceXml(xml, material);
    expect(verifyInvoiceSignature(signed, material.certificatePem)).toBe(true);
    expect(signed).toContain("SigningCertificate>");
  });
  it("rejects tampered document, properties, external references and duplicates", () => {
    const signed = signInvoiceXml(xml, material);
    for (const changed of [
      signed.replace("2260", "2261"),
      signed.replace(material.signedAt, "2000-01-01T00:00:00.000Z"),
      signed.replace('URI=""', 'URI="https://evil.test"'),
      signed.replace(
        "</FacturaElectronica>",
        signed.slice(
          signed.indexOf("<ds:Signature "),
          signed.indexOf("</ds:Signature>") + 15,
        ) + "</FacturaElectronica>",
      ),
    ])
      expect(verifyInvoiceSignature(changed, material.certificatePem)).toBe(
        false,
      );
  });
  it("rejects malicious and unsupported input", () => {
    for (const bad of [
      "<!DOCTYPE x>" + xml,
      "<?bad x?>" + xml,
      xml.replace("FacturaElectronica", "Other"),
      " ".repeat(1048577),
    ])
      expect(() => signInvoiceXml(bad, material)).toThrow();
  });
  it("rejects a wrong certificate and invalid signing date", () => {
    expect(
      verifyInvoiceSignature(signInvoiceXml(xml, material), wrongCertificate),
    ).toBe(false);
    expect(() =>
      signInvoiceXml(xml, { ...material, signedAt: "2000-01-01T00:00:00Z" }),
    ).toThrow();
  });
});

// Independent C14N implementation and cryptographic library: catches a self-consistent signer/verifier error.
it("passes independent lxml exclusive C14N and cryptography verification", () => {
  const signed = signInvoiceXml(xml, material);
  const independentDir = mkdtempSync(join(tmpdir(), "xades-check-"));
  const output = openSync(join(independentDir, "output"), "w");
  execFileSync(
    "/usr/bin/python3",
    [
      "-c",
      `
import sys,json,base64,hashlib
from lxml import etree
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
v=json.loads(sys.argv[1])
r=etree.fromstring(v['xml'].encode(),etree.XMLParser(resolve_entities=False,no_network=True))
ns={'ds':'http://www.w3.org/2000/09/xmldsig#','x':'http://uri.etsi.org/01903/v1.3.2#'}
sig=r.find('ds:Signature',ns);info=sig.find('ds:SignedInfo',ns)
c14n=lambda n:etree.tostring(n,method='c14n',exclusive=True,with_comments=False)
cert=x509.load_pem_x509_certificate(v['cert'].encode())
cert.public_key().verify(base64.b64decode(sig.findtext('ds:SignatureValue',namespaces=ns)),c14n(info),padding.PKCS1v15(),hashes.SHA256())
refs=info.findall('ds:Reference',ns)
props=sig.find('.//x:SignedProperties',ns)
assert base64.b64encode(hashlib.sha256(c14n(props)).digest()).decode()==refs[1].findtext('ds:DigestValue',namespaces=ns)
r.remove(sig)
assert base64.b64encode(hashlib.sha256(c14n(r)).digest()).decode()==refs[0].findtext('ds:DigestValue',namespaces=ns)
print('verified')
`,
      JSON.stringify({ xml: signed, cert: material.certificatePem }),
    ],
    { stdio: ["ignore", output, output], timeout: 10000 },
  );
  closeSync(output);
  const result = readFileSync(join(independentDir, "output"), "utf8");
  rmSync(independentDir, { recursive: true });
  expect(result.trim()).toBe("verified");
});
