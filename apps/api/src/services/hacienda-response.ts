import { X509Certificate } from "node:crypto";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";

const NS =
  "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/mensajeHacienda";
const DS = "http://www.w3.org/2000/09/xmldsig#";
const C14N = "http://www.w3.org/2001/10/xml-exc-c14n#";
const ENVELOPED = DS + "enveloped-signature";
const SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256";
const SHA512 = "http://www.w3.org/2001/04/xmlenc#sha512";
type Expected = {
  clave: string;
  issuerIdentification: string;
  receiverIdentification: string;
  total: string;
  tax: string;
};
export type HaciendaResponseVerification = {
  status: "accepted" | "rejected" | "blocked";
  issues: string[];
  certificateFingerprint?: string;
};
const normalize = (s: string) => s.replace(/:/g, "").toLowerCase();
function amount(s: string): bigint {
  if (
    !/^\d{1,18}(?:\.\d{1,5})?$/.test(s) ||
    s.replace(/\D/g, "").replace(/^0+/, "").length > 18
  )
    throw new Error("INVALID_AMOUNT");
  const [whole, fraction = ""] = s.split(".");
  return BigInt(whole) * 100000n + BigInt(fraction.padEnd(5, "0"));
}
/** Strict bounded structure and independent XMLDSig verification; not full XSD validation.
 * Trust pins must be provisioned through an official channel before activation.
 * No embedded certificate is trusted unless its SHA256 fingerprint is explicitly pinned.
 */
export function verifyHaciendaResponse(
  xml: string,
  expected: Expected,
  trustedCertificateFingerprints: string[],
): HaciendaResponseVerification {
  let fingerprint: string | undefined;
  try {
    const pins = trustedCertificateFingerprints.map(normalize);
    if (!pins.length || pins.some((p) => !/^[a-f0-9]{64}$/.test(p)))
      throw new Error("TRUST_NOT_CONFIGURED");
    if (
      Buffer.byteLength(xml, "utf8") > 1048576 ||
      /<!DOCTYPE|<!ENTITY/i.test(xml) ||
      /<\?(?!xml\s)/i.test(xml)
    )
      throw new Error("UNSAFE_XML");
    const doc = new DOMParser({
      onError: () => {
        throw new Error("MALFORMED_XML");
      },
    }).parseFromString(xml, "application/xml");
    const root = doc.documentElement;
    if (
      !root ||
      root.localName !== "MensajeHacienda" ||
      root.namespaceURI !== NS
    )
      throw new Error("INVALID_RESPONSE_ROOT");
    if (
      Array.from(root.childNodes).some(
        (n) =>
          (n.nodeType === 3 || n.nodeType === 4) &&
          /\S/.test(n.textContent ?? ""),
      )
    )
      throw new Error("INVALID_RESPONSE_STRUCTURE");
    const nodes = Array.from(doc.getElementsByTagName("*"));
    const ids = new Map<string, typeof root>();
    for (const node of nodes) {
      for (const attr of Array.from(node.attributes)) {
        if (["Id", "ID", "id"].includes(attr.localName ?? "")) {
          if (!attr.value || ids.has(attr.value))
            throw new Error("DUPLICATE_XML_ID");
          ids.set(attr.value, node);
        }
      }
      if (node !== root && node.localName === "MensajeHacienda")
        throw new Error("WRAPPED_RESPONSE");
    }
    const signatures = doc.getElementsByTagNameNS(DS, "Signature");
    if (signatures.length !== 1 || signatures[0].parentNode !== root)
      throw new Error("INVALID_SIGNATURE_LOCATION");
    const signature = signatures[0];
    const children = Array.from(root.childNodes).filter(
      (n) => n.nodeType === 1,
    ) as (typeof root)[];
    const order = [
      "Clave",
      "NombreEmisor",
      "TipoIdentificacionEmisor",
      "NumeroCedulaEmisor",
      "NombreReceptor",
      "TipoIdentificacionReceptor",
      "NumeroCedulaReceptor",
      "Mensaje",
      "EstadoMensaje",
      "DetalleMensaje",
      "MontoTotalImpuesto",
      "TotalFactura",
      "Signature",
    ];
    let previous = -1;
    const fields = new Map<string, string>();
    for (const child of children) {
      const index = order.indexOf(child.localName ?? "");
      if (
        index <= previous ||
        index < 0 ||
        child.namespaceURI !== (child === signature ? DS : NS)
      )
        throw new Error("INVALID_RESPONSE_STRUCTURE");
      previous = index;
      if (child !== signature) {
        if (Array.from(child.childNodes).some((n) => n.nodeType === 1))
          throw new Error("INVALID_RESPONSE_FIELD");
        fields.set(child.localName!, child.textContent ?? "");
      }
    }
    for (const name of [
      "Clave",
      "NombreEmisor",
      "TipoIdentificacionEmisor",
      "NumeroCedulaEmisor",
      "Mensaje",
      "EstadoMensaje",
      "DetalleMensaje",
      "TotalFactura",
    ])
      if (!fields.has(name)) throw new Error("MISSING_RESPONSE_FIELD");
    if (
      !/^[a-zA-Z0-9]{50}$/.test(fields.get("Clave")!) ||
      !/^0[1-6]$/.test(fields.get("TipoIdentificacionEmisor")!) ||
      (fields.has("TipoIdentificacionReceptor") &&
        !/^0[1-6]$/.test(fields.get("TipoIdentificacionReceptor")!))
    )
      throw new Error("INVALID_RESPONSE_FIELD");
    for (const [name, limit] of [
      ["NombreEmisor", 100],
      ["NombreReceptor", 100],
      ["NumeroCedulaEmisor", 20],
      ["NumeroCedulaReceptor", 20],
      ["EstadoMensaje", 9],
    ] as const)
      if ((fields.get(name)?.length ?? 0) > limit)
        throw new Error("INVALID_RESPONSE_FIELD");
    if (
      fields.get("Clave") !== expected.clave ||
      fields.get("NumeroCedulaEmisor") !== expected.issuerIdentification ||
      (fields.get("NumeroCedulaReceptor") ?? "") !==
        expected.receiverIdentification ||
      amount(fields.get("TotalFactura")!) !== amount(expected.total) ||
      (fields.has("MontoTotalImpuesto")
        ? amount(fields.get("MontoTotalImpuesto")!)
        : 0n) !== amount(expected.tax)
    )
      throw new Error("RESPONSE_DOCUMENT_MISMATCH");
    const infos = signature.getElementsByTagNameNS(DS, "SignedInfo");
    if (infos.length !== 1 || infos[0].parentNode !== signature)
      throw new Error("INVALID_SIGNED_INFO");
    const info = infos[0];
    for (const [name, algorithms] of [
      ["CanonicalizationMethod", [C14N]],
      [
        "SignatureMethod",
        [
          "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
          "http://www.w3.org/2001/04/xmldsig-more#rsa-sha512",
        ],
      ],
    ] as const) {
      const list = info.getElementsByTagNameNS(DS, name);
      if (
        list.length !== 1 ||
        !algorithms.some((a) => a === list[0].getAttribute("Algorithm"))
      )
        throw new Error("UNSUPPORTED_SIGNATURE_ALGORITHM");
    }
    const references = Array.from(info.getElementsByTagNameNS(DS, "Reference"));
    if (!references.length || references.length > 16)
      throw new Error("INVALID_REFERENCES");
    let coversRoot = false;
    for (const reference of references) {
      if (reference.parentNode !== info) throw new Error("INVALID_REFERENCE");
      const uri = reference.getAttribute("URI");
      const target: typeof root | undefined =
        uri === ""
          ? root
          : uri?.startsWith("#")
            ? ids.get(uri.slice(1))
            : undefined;
      if (!target) throw new Error("NONLOCAL_OR_MISSING_REFERENCE");
      const transforms = Array.from(
        reference.getElementsByTagNameNS(DS, "Transform"),
      );
      if (
        transforms.some(
          (t) => ![ENVELOPED, C14N].includes(t.getAttribute("Algorithm") ?? ""),
        )
      )
        throw new Error("UNSUPPORTED_TRANSFORM");
      const digest = reference.getElementsByTagNameNS(DS, "DigestMethod");
      if (
        digest.length !== 1 ||
        ![SHA256, SHA512].includes(digest[0].getAttribute("Algorithm") ?? "")
      )
        throw new Error("UNSUPPORTED_DIGEST");
      if (target === root) {
        if (
          coversRoot ||
          !transforms.some((t) => t.getAttribute("Algorithm") === ENVELOPED)
        )
          throw new Error("INVALID_ROOT_REFERENCE");
        coversRoot = true;
      }
    }
    if (!coversRoot) throw new Error("ROOT_NOT_SIGNED");
    // Any XAdES SignedProperties present must themselves be covered by SignedInfo.
    for (const node of nodes.filter((n) => n.localName === "SignedProperties"))
      if (
        !references.some(
          (r) => ids.get((r.getAttribute("URI") ?? "").slice(1)) === node,
        )
      )
        throw new Error("UNSIGNED_PROPERTIES");
    const certs = signature.getElementsByTagNameNS(DS, "X509Certificate");
    if (certs.length !== 1) throw new Error("AMBIGUOUS_CERTIFICATE");
    const base64 = (certs[0].textContent ?? "").replace(/\s/g, "");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
      throw new Error("INVALID_CERTIFICATE");
    const cert = new X509Certificate(Buffer.from(base64, "base64"));
    fingerprint = normalize(cert.fingerprint256);
    if (!pins.includes(fingerprint)) throw new Error("UNTRUSTED_CERTIFICATE");
    if (
      cert.publicKey.asymmetricKeyType !== "rsa" ||
      ![2048, 4096].includes(
        cert.publicKey.asymmetricKeyDetails?.modulusLength ?? 0,
      )
    )
      throw new Error("UNSUPPORTED_CERTIFICATE_KEY");
    if (
      Date.now() < Date.parse(cert.validFrom) ||
      Date.now() > Date.parse(cert.validTo)
    )
      throw new Error("CERTIFICATE_OUTSIDE_VALIDITY");
    const verifier = new SignedXml({
      publicCert: cert.toString(),
      getCertFromKeyInfo: () => null,
    });
    verifier.loadSignature(new XMLSerializer().serializeToString(signature));
    if (!verifier.checkSignature(xml))
      throw new Error("INVALID_CRYPTOGRAPHIC_SIGNATURE");
    const code = fields.get("Mensaje");
    if (code !== "1" && code !== "3")
      throw new Error("UNKNOWN_HACIENDA_MESSAGE");
    return {
      status: code === "1" ? "accepted" : "rejected",
      issues: [],
      certificateFingerprint: fingerprint,
    };
  } catch (error) {
    return {
      status: "blocked",
      issues: [error instanceof Error ? error.message : "INVALID_RESPONSE"],
      ...(fingerprint ? { certificateFingerprint: fingerprint } : {}),
    };
  }
}
