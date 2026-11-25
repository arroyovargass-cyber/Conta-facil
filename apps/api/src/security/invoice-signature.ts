import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  X509Certificate,
} from "node:crypto";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { ExclusiveCanonicalization } from "xml-crypto";

const DS = "http://www.w3.org/2000/09/xmldsig#";
const XA = "http://uri.etsi.org/01903/v1.3.2#";
const C14N = "http://www.w3.org/2001/10/xml-exc-c14n#";
const SHA = "http://www.w3.org/2001/04/xmlenc#sha256";
const RSA = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const NS =
  "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica";
export interface InvoiceSigningMaterial {
  privateKeyPem: string;
  certificatePem: string;
  policy: { url: string; sha256Base64: string };
  signedAt: string;
}
const hash = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("base64");
const escape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/>/g, "&gt;");
function parse(xml: string) {
  if (
    Buffer.byteLength(xml) > 1048576 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    /<\?(?!xml\s)/i.test(xml)
  )
    throw new Error("Unsupported invoice XML");
  const doc = new DOMParser({
    onError: (level, message) => {
      throw new Error(`Invalid XML: ${level}: ${message}`);
    },
  }).parseFromString(xml, "application/xml");
  if (
    !doc.documentElement ||
    doc.documentElement.localName !== "FacturaElectronica" ||
    doc.documentElement.namespaceURI !== NS
  )
    throw new Error("Unsupported invoice root");
  return doc;
}
function canon(node: any): string {
  return new ExclusiveCanonicalization().process(node, {});
}
function certificate(pem: string, signedAt: string) {
  const cert = new X509Certificate(pem),
    when = Date.parse(signedAt);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(signedAt) ||
    !Number.isFinite(when) ||
    when < Date.parse(cert.validFrom) ||
    when > Date.parse(cert.validTo)
  )
    throw new Error("Signing time outside certificate validity");
  if (
    cert.publicKey.asymmetricKeyType !== "rsa" ||
    ![2048, 4096].includes(
      cert.publicKey.asymmetricKeyDetails?.modulusLength ?? 0,
    )
  )
    throw new Error("Unsupported signing key");
  return cert;
}
function profile(
  doc: ReturnType<typeof parse>,
  cert: X509Certificate,
  signedAt: string,
  policy: InvoiceSigningMaterial["policy"],
) {
  if (
    !/^https:\/\//.test(policy.url) ||
    !/^[A-Za-z0-9+/]{43}=$/.test(policy.sha256Base64) ||
    Buffer.from(policy.sha256Base64, "base64").length !== 32
  )
    throw new Error("Invalid signature policy");
  const digest = (value: string) =>
    `<ds:DigestMethod Algorithm="${SHA}"/><ds:DigestValue>${value}</ds:DigestValue>`;
  const properties = `<xades:SignedProperties xmlns:xades="${XA}" Id="SignedProperties"><xades:SignedSignatureProperties><xades:SigningTime>${escape(signedAt)}</xades:SigningTime><xades:SigningCertificate><xades:Cert><xades:CertDigest>${digest(hash(cert.raw))}</xades:CertDigest><xades:IssuerSerial><ds:X509IssuerName>${escape(cert.issuer.split("\n").reverse().join(","))}</ds:X509IssuerName><ds:X509SerialNumber>${BigInt("0x" + cert.serialNumber).toString()}</ds:X509SerialNumber></xades:IssuerSerial></xades:Cert></xades:SigningCertificate><xades:SignaturePolicyIdentifier><xades:SignaturePolicyId><xades:SigPolicyId><xades:Identifier>${escape(policy.url)}</xades:Identifier></xades:SigPolicyId><xades:SigPolicyHash>${digest(policy.sha256Base64)}</xades:SigPolicyHash></xades:SignaturePolicyId></xades:SignaturePolicyIdentifier></xades:SignedSignatureProperties></xades:SignedProperties>`;
  // Parse the bounded signature as a fragment with an explicit namespace context.
  const fragment = new DOMParser().parseFromString(
    `<ds:Signature xmlns:ds="${DS}" Id="InvoiceSignature"><ds:SignedInfo><ds:CanonicalizationMethod Algorithm="${C14N}"/><ds:SignatureMethod Algorithm="${RSA}"/><ds:Reference URI=""><ds:Transforms><ds:Transform Algorithm="${DS}enveloped-signature"/><ds:Transform Algorithm="${C14N}"/></ds:Transforms>${digest(hash(canon(doc.documentElement)))}</ds:Reference><ds:Reference Type="http://uri.etsi.org/01903#SignedProperties" URI="#SignedProperties"><ds:Transforms><ds:Transform Algorithm="${C14N}"/></ds:Transforms>${digest("PROPERTIES_DIGEST")}</ds:Reference></ds:SignedInfo><ds:SignatureValue/><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${cert.raw.toString("base64")}</ds:X509Certificate></ds:X509Data></ds:KeyInfo><ds:Object><xades:QualifyingProperties xmlns:xades="${XA}" Target="#InvoiceSignature">${properties}</xades:QualifyingProperties></ds:Object></ds:Signature>`,
    "application/xml",
  ).documentElement;
  const imported = doc.importNode(fragment!, true) as NonNullable<
    typeof fragment
  >;
  doc.documentElement!.appendChild(imported);
  const props = imported.getElementsByTagNameNS(XA, "SignedProperties")[0];
  imported.getElementsByTagNameNS(DS, "DigestValue")[1].textContent = hash(
    canon(props),
  );
  return imported;
}
/** Bounded FE 4.4 EPES profile. Does not validate fiscal schema, trust chain or issuer identity. */
export function signInvoiceXml(
  xml: string,
  material: InvoiceSigningMaterial,
): string {
  const doc = parse(xml);
  if (doc.getElementsByTagNameNS(DS, "Signature").length)
    throw new Error("Invoice already signed");
  for (const node of Array.from(doc.getElementsByTagName("*")))
    for (const name of ["Id", "ID", "id", "xml:id"])
      if (
        ["SignedProperties", "InvoiceSignature"].includes(
          node.getAttribute(name) ?? "",
        )
      )
        throw new Error("Reserved signature identifier");
  const cert = certificate(material.certificatePem, material.signedAt),
    key = createPrivateKey(material.privateKeyPem);
  if (
    !createPublicKey(key)
      .export({ type: "spki", format: "der" })
      .equals(cert.publicKey.export({ type: "spki", format: "der" }))
  )
    throw new Error("Certificate and key mismatch");
  const signature = profile(doc, cert, material.signedAt, material.policy);
  signature.getElementsByTagNameNS(DS, "SignatureValue")[0].textContent = sign(
    "RSA-SHA256",
    Buffer.from(canon(signature.getElementsByTagNameNS(DS, "SignedInfo")[0])),
    key,
  ).toString("base64");
  return new XMLSerializer().serializeToString(doc);
}
export function verifyInvoiceSignature(
  xml: string,
  expectedCertificatePem: string,
): boolean {
  try {
    const doc = parse(xml),
      signatures = doc.getElementsByTagNameNS(DS, "Signature");
    if (signatures.length !== 1) return false;
    const ids = new Set<string>();
    for (const node of Array.from(doc.getElementsByTagName("*")))
      for (const name of ["Id", "ID", "id", "xml:id"]) {
        const value = node.getAttribute(name);
        if (value) {
          if (ids.has(value)) return false;
          ids.add(value);
        }
      }
    const signature = signatures[0];
    if (signature.parentNode !== doc.documentElement) return false;
    const single = (namespace: string, name: string) => {
      const nodes = signature.getElementsByTagNameNS(namespace, name);
      if (nodes.length !== 1) throw new Error("Ambiguous signature");
      return nodes[0].textContent ?? "";
    };
    const signedAt = single(XA, "SigningTime"),
      cert = certificate(expectedCertificatePem, signedAt);
    const policy = {
      url: single(XA, "Identifier"),
      sha256Base64: (() => {
        const node = signature.getElementsByTagNameNS(XA, "SigPolicyHash");
        if (node.length !== 1) throw new Error("Missing policy");
        return (
          node[0].getElementsByTagNameNS(DS, "DigestValue")[0]?.textContent ??
          ""
        );
      })(),
    };
    const signatureValue = single(DS, "SignatureValue"),
      info = signature.getElementsByTagNameNS(DS, "SignedInfo")[0];
    const actual = canon(signature),
      signedInfo = canon(info);
    doc.documentElement!.removeChild(signature);
    const expected = profile(doc, cert, signedAt, policy);
    expected.getElementsByTagNameNS(DS, "SignatureValue")[0].textContent =
      signatureValue;
    return (
      actual === canon(expected) &&
      verify(
        "RSA-SHA256",
        Buffer.from(signedInfo),
        cert.publicKey,
        Buffer.from(signatureValue, "base64"),
      )
    );
  } catch {
    return false;
  }
}
