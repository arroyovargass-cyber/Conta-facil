import { X509Certificate, createHash } from "node:crypto";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";
import { validateHaciendaResponseSchema } from "./hacienda-response-schema";
import {
  readHaciendaResponseObservation,
  type HaciendaResponseContext,
  type HaciendaResponseObservation,
  type QueryResult,
} from "./hacienda-reception";

const NS =
  "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/mensajeHacienda";
const DS = "http://www.w3.org/2000/09/xmldsig#";
const C14N = "http://www.w3.org/2001/10/xml-exc-c14n#";
const ENVELOPED = DS + "enveloped-signature";
const SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256";
const SHA512 = "http://www.w3.org/2001/04/xmlenc#sha512";
export type HaciendaResponseExpected = {
  clave: string;
  issuerIdentification: string;
  receiverIdentification: string;
  issuerIdentificationType?: string;
  receiverIdentificationType?: string;
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
/** Shared mathematical/coverage verifier; callers supply their separate origin/trust policy. */
function verifyResponseSignature(
  xml: string,
  expected: HaciendaResponseExpected,
  pins: readonly string[] | undefined,
): HaciendaResponseVerification {
  let fingerprint: string | undefined;
  try {
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
      (expected.issuerIdentificationType !== undefined &&
        fields.get("TipoIdentificacionEmisor") !==
          expected.issuerIdentificationType) ||
      (fields.get("NumeroCedulaReceptor") ?? "") !==
        expected.receiverIdentification ||
      (expected.receiverIdentificationType !== undefined &&
        (fields.get("TipoIdentificacionReceptor") ?? "") !==
          expected.receiverIdentificationType) ||
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
    if (pins && !pins.includes(fingerprint))
      throw new Error("UNTRUSTED_CERTIFICATE");
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
    // Incoming XAdES-XL is not forced into the outgoing EPES profile. If a signing
    // certificate binding is present, its covered digest must identify this key.
    const bindings = nodes.filter((n) =>
      ["SigningCertificate", "SigningCertificateV2"].includes(
        n.localName ?? "",
      ),
    );
    if (bindings.length > 1) throw new Error("AMBIGUOUS_SIGNING_CERTIFICATE");
    for (const binding of bindings) {
      if (
        ![
          "http://uri.etsi.org/01903/v1.3.2#",
          "http://uri.etsi.org/01903/v1.4.1#",
        ].includes(binding.namespaceURI ?? "")
      )
        throw new Error("INVALID_SIGNING_CERTIFICATE_BINDING");
      let parent = binding.parentNode;
      while (
        parent &&
        parent.nodeType === 1 &&
        (parent as typeof root).localName !== "SignedProperties"
      )
        parent = parent.parentNode;
      if (
        !parent ||
        parent.nodeType !== 1 ||
        !references.some(
          (r) => ids.get((r.getAttribute("URI") ?? "").slice(1)) === parent,
        )
      )
        throw new Error("UNSIGNED_CERTIFICATE_BINDING");
      const digest = Array.from(
        binding.getElementsByTagNameNS(binding.namespaceURI!, "CertDigest"),
      )[0];
      if (!digest) throw new Error("INVALID_SIGNING_CERTIFICATE_BINDING");
      const methods = digest.getElementsByTagNameNS(DS, "DigestMethod"),
        values = digest.getElementsByTagNameNS(DS, "DigestValue");
      if (methods.length !== 1 || values.length !== 1)
        throw new Error("INVALID_SIGNING_CERTIFICATE_BINDING");
      const algorithm = methods[0].getAttribute("Algorithm");
      if (![SHA256, SHA512].includes(algorithm ?? ""))
        throw new Error("UNSUPPORTED_DIGEST");
      if (
        (values[0].textContent ?? "").replace(/\s/g, "") !==
        createHash(algorithm === SHA256 ? "sha256" : "sha512")
          .update(cert.raw)
          .digest("base64")
      )
        throw new Error("SIGNING_CERTIFICATE_MISMATCH");
    }
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
    if (
      fields.get("EstadoMensaje") !== (code === "1" ? "Aceptado" : "Rechazado")
    )
      throw new Error("RESPONSE_STATE_MISMATCH");
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

/** Independent configured-leaf trust remains strict and does not inherit API provenance. */
export function verifyHaciendaResponse(
  xml: string,
  expected: HaciendaResponseExpected,
  trustedCertificateFingerprints: string[],
): HaciendaResponseVerification {
  const pins = trustedCertificateFingerprints.map(normalize);
  if (!pins.length || pins.some((p) => !/^[a-f0-9]{64}$/.test(p)))
    return { status: "blocked", issues: ["TRUST_NOT_CONFIGURED"] };
  return verifyResponseSignature(xml, expected, pins);
}

export type HaciendaResponseEvidence = Readonly<
  HaciendaResponseObservation & {
    verification: "xml_signature_and_correlation";
    certificateFingerprint: string;
    haciendaStatus: "accepted" | "rejected";
    responseSchemaSha256: "b2606156042b7aa7b7f7f61945f0ff1323661b43b5a1489ad5eafad1c52fd25e";
  }
>;
const verifiedResponses = new WeakMap<QueryResult, HaciendaResponseEvidence>();

/** This is a server-side observation record, not independent Ministry signer PKI. */
export function readHaciendaResponseEvidence(
  result: QueryResult,
  context: HaciendaResponseContext,
): HaciendaResponseEvidence | undefined {
  if (!readHaciendaResponseObservation(result, context)) return;
  const evidence = verifiedResponses.get(result);
  if (
    evidence?.tenantId !== context.tenantId ||
    evidence.environment !== context.environment ||
    evidence.credentialVersion !== context.credentialVersion
  )
    return;
  return evidence;
}

/** Fixed official HTTPS provenance supplies origin; the embedded key supplies only
 * mathematical XML integrity. No embedded certificate is enrolled as a trusted leaf.
 */
export async function verifyOfficialApiHaciendaResponse(
  result: QueryResult,
  expected: HaciendaResponseExpected,
  context: HaciendaResponseContext,
): Promise<HaciendaResponseVerification> {
  verifiedResponses.delete(result);
  const observation = readHaciendaResponseObservation(result, context);
  if (
    !observation ||
    !result.responseXml ||
    observation.clave !== expected.clave
  )
    return { status: "blocked", issues: ["OFFICIAL_API_PROVENANCE_REQUIRED"] };
  if (
    !/^0[1-6]$/.test(expected.issuerIdentificationType ?? "") ||
    expected.receiverIdentificationType === undefined ||
    (expected.receiverIdentification !== ""
      ? !/^0[1-6]$/.test(expected.receiverIdentificationType)
      : expected.receiverIdentificationType !== "")
  )
    return {
      status: "blocked",
      issues: ["EXPECTED_IDENTIFICATION_TYPES_REQUIRED"],
    };
  const xml = result.responseXml;
  if (
    createHash("sha256").update(xml, "utf8").digest("hex") !==
    observation.responseSha256
  )
    return { status: "blocked", issues: ["OFFICIAL_API_RESPONSE_CHANGED"] };
  const verified = verifyResponseSignature(xml, expected, undefined);
  if (verified.status === "blocked") return verified;
  if (
    (verified.status === "accepted" &&
      (result.status !== "reported_accepted" ||
        result.reportedState !== "aceptado")) ||
    (verified.status === "rejected" &&
      (result.status !== "reported_rejected" ||
        result.reportedState !== "rechazado"))
  )
    return { status: "blocked", issues: ["JSON_XML_STATE_MISMATCH"] };
  const schema = await validateHaciendaResponseSchema(xml);
  if (!schema.valid) return { status: "blocked", issues: schema.issues };
  if (
    readHaciendaResponseObservation(result, context) !== observation ||
    !verified.certificateFingerprint
  )
    return { status: "blocked", issues: ["OFFICIAL_API_RESPONSE_CHANGED"] };
  verifiedResponses.set(
    result,
    Object.freeze({
      ...observation,
      verification: "xml_signature_and_correlation" as const,
      certificateFingerprint: verified.certificateFingerprint,
      haciendaStatus: verified.status,
      responseSchemaSha256:
        "b2606156042b7aa7b7f7f61945f0ff1323661b43b5a1489ad5eafad1c52fd25e" as const,
    }),
  );
  return verified;
}
