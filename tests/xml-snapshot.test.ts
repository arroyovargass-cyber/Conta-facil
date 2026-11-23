import { expect, it } from "vitest";
import { validateInvoiceXmlSnapshot } from "../apps/api/src/services/xml-snapshot";

const ns =
  "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica";
it("validates invoice structure against the downloaded XSD in an isolated worker", async () => {
  const result = await validateInvoiceXmlSnapshot(
    Buffer.from(`<FacturaElectronica xmlns="${ns}"/>`),
  );
  expect(result.status).toBe("snapshot_invalid");
  expect(result.issues).toContain("XSD_STRUCTURE_INVALID");
  expect(result.revisionConfirmed).toBe(false);
  expect(result.emissionEnabled).toBe(false);
  expect(result.signatureVerification).toBe("not_run");
});
it("rejects unsafe XML before invoking schema validation", async () => {
  const result = await validateInvoiceXmlSnapshot(
    Buffer.from('<!DOCTYPE x SYSTEM "file:///private-secret"><x/>'),
  );
  expect(result.status).toBe("blocked");
  expect(result.issues).toContain("XML_DTD_FORBIDDEN");
  expect(result.xsdValidation).toBe("not_run");
  expect(JSON.stringify(result)).not.toContain("private-secret");
});
it("ignores user-supplied schema locations and never returns XML values", async () => {
  const result = await validateInvoiceXmlSnapshot(
    Buffer.from(
      `<FacturaElectronica xmlns="${ns}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${ns} https://example.invalid/private"><Clave>private-marker</Clave></FacturaElectronica>`,
    ),
  );
  expect(result.status).toBe("snapshot_invalid");
  expect(JSON.stringify(result)).not.toContain("private-marker");
  expect(JSON.stringify(result)).not.toContain("example.invalid");
});
