import { SaxesParser } from "saxes";

// Application intake limits, not limits imposed by Hacienda.
export const XML_INPUT_LIMITS = Object.freeze({
  bytes: 2 * 1024 * 1024,
  depth: 64,
  elements: 20_000,
  attributes: 64,
});
const INVOICE_NAMESPACE =
  "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica";

class XmlInputFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

// This only checks secure well-formedness and identifies the supported root.
// It does not validate an XSD, a signature, receiver ownership or tax treatment.
export function inspectInvoiceXml(bytes: Buffer) {
  const blocked = (code: string) => ({
    status: "blocked" as const,
    documentType: null,
    issues: [code],
    xsdValidation: "not_run" as const,
    emissionEnabled: false as const,
  });
  if (bytes.length > XML_INPUT_LIMITS.bytes)
    return blocked("XML_SIZE_EXCEEDED");
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return blocked("XML_ENCODING_UNSUPPORTED");
  }
  const fail = (code: string): never => {
    throw new XmlInputFailure(code);
  };
  let depth = 0,
    elements = 0,
    attributes = 0;
  const parser = new SaxesParser({ xmlns: true, defaultXMLVersion: "1.0" });
  parser.on("error", () => fail("XML_MALFORMED"));
  parser.on("doctype", () => fail("XML_DTD_FORBIDDEN"));
  parser.on("processinginstruction", () =>
    fail("XML_PROCESSING_INSTRUCTION_FORBIDDEN"),
  );
  parser.on("xmldecl", (declaration) => {
    if (declaration.version !== "1.0") fail("XML_VERSION_UNSUPPORTED");
    if (declaration.encoding && declaration.encoding.toUpperCase() !== "UTF-8")
      fail("XML_ENCODING_UNSUPPORTED");
  });
  parser.on("opentagstart", () => {
    attributes = 0;
    if (
      ++depth > XML_INPUT_LIMITS.depth ||
      ++elements > XML_INPUT_LIMITS.elements
    )
      fail("XML_STRUCTURE_LIMIT_EXCEEDED");
  });
  parser.on("attribute", () => {
    if (++attributes > XML_INPUT_LIMITS.attributes)
      fail("XML_STRUCTURE_LIMIT_EXCEEDED");
  });
  parser.on("opentag", (tag) => {
    if (
      elements === 1 &&
      (tag.local !== "FacturaElectronica" || tag.uri !== INVOICE_NAMESPACE)
    )
      fail("XML_DOCUMENT_UNSUPPORTED");
  });
  parser.on("closetag", () => {
    depth--;
  });
  try {
    parser.write(source).close();
  } catch (error) {
    return blocked(
      error instanceof XmlInputFailure ? error.code : "XML_MALFORMED",
    );
  }
  return {
    status: "well_formed" as const,
    documentType: "factura_electronica" as const,
    issues: [] as string[],
    xsdValidation: "not_run" as const,
    emissionEnabled: false as const,
  };
}
