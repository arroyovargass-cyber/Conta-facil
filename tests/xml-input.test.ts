import { expect, it } from "vitest";
import {
  inspectInvoiceXml,
  XML_INPUT_LIMITS,
} from "../apps/api/src/services/xml-input";

const namespace =
  "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica";
const xml = (content = "") =>
  `<FacturaElectronica xmlns="${namespace}">${content}</FacturaElectronica>`;
const inspect = (value: string) => inspectInvoiceXml(Buffer.from(value));

it("recognizes well-formed namespaced XML without claiming XSD validation or fiscal acceptance", () => {
  const result = inspect(
    `<?xml version="1.0" encoding="UTF-8"?><f:FacturaElectronica xmlns:f="${namespace}"><f:Nombre>Privado &amp; Asociados</f:Nombre></f:FacturaElectronica>`,
  );
  expect(result).toEqual({
    status: "well_formed",
    documentType: "factura_electronica",
    issues: [],
    xsdValidation: "not_run",
    emissionEnabled: false,
  });
  expect(JSON.stringify(result)).not.toContain("Privado");
});
it.each([
  '<!DOCTYPE FacturaElectronica SYSTEM "file:///etc/passwd">',
  '<!DOCTYPE FacturaElectronica [<!ENTITY ext SYSTEM "https://example.test/private">]>',
  '<!DOCTYPE FacturaElectronica [<!ENTITY a "AAAAAAAA"><!ENTITY b "&a;&a;&a;&a;">]>',
])(
  "rejects DTDs before entity expansion or external resolution",
  (declaration) => {
    expect(inspect(declaration + xml()).issues).toContain("XML_DTD_FORBIDDEN");
  },
);
it("does not mistake harmless comments or escaped text for a DTD", () => {
  expect(
    inspect(xml("<!-- <!DOCTYPE is a comment --> <Nombre>&lt;!ENTITY</Nombre>"))
      .status,
  ).toBe("well_formed");
});
it.each([
  xml("<Unclosed>"),
  xml() + xml(),
  xml("&unknown;"),
  xml('<Line id="a" id="b"/>'),
])("rejects malformed XML with a safe diagnostic", (value) => {
  const result = inspect(value);
  expect(result.status).toBe("blocked");
  expect(result.issues).toContain("XML_MALFORMED");
  expect(result.documentType).toBeNull();
});
it("rejects a lookalike root in the wrong namespace", () => {
  expect(
    inspect('<FacturaElectronica xmlns="https://example.test/fake"/>').issues,
  ).toContain("XML_DOCUMENT_UNSUPPORTED");
});
it("rejects processing instructions without loading their target", () => {
  expect(
    inspect('<?xml-stylesheet href="https://example.test/private"?>' + xml())
      .issues,
  ).toContain("XML_PROCESSING_INSTRUCTION_FORBIDDEN");
});
it("rejects invalid UTF-8 and unsupported declared encodings", () => {
  expect(inspectInvoiceXml(Buffer.from([0xff, 0xfe, 0x00])).issues).toContain(
    "XML_ENCODING_UNSUPPORTED",
  );
  expect(
    inspect('<?xml version="1.0" encoding="ISO-8859-1"?>' + xml()).issues,
  ).toContain("XML_ENCODING_UNSUPPORTED");
});
it("rejects XML 1.1 rather than silently treating it as XML 1.0", () => {
  expect(inspect('<?xml version="1.1"?>' + xml()).issues).toContain(
    "XML_VERSION_UNSUPPORTED",
  );
});
it("bounds bytes, nesting, element count and attribute count", () => {
  expect(
    inspectInvoiceXml(Buffer.alloc(XML_INPUT_LIMITS.bytes + 1)).issues,
  ).toContain("XML_SIZE_EXCEEDED");
  expect(
    inspect(
      xml(
        "<n>".repeat(XML_INPUT_LIMITS.depth) +
          "</n>".repeat(XML_INPUT_LIMITS.depth),
      ),
    ).issues,
  ).toContain("XML_STRUCTURE_LIMIT_EXCEEDED");
  expect(
    inspect(xml("<n/>".repeat(XML_INPUT_LIMITS.elements))).issues,
  ).toContain("XML_STRUCTURE_LIMIT_EXCEEDED");
  expect(
    inspect(
      xml(
        "<n " +
          Array.from(
            { length: XML_INPUT_LIMITS.attributes + 1 },
            (_, i) => `a${i}="x"`,
          ).join(" ") +
          "/>",
      ),
    ).issues,
  ).toContain("XML_STRUCTURE_LIMIT_EXCEEDED");
});
