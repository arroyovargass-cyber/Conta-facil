import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { auditSchemaPackage } from "../apps/api/src/services/hacienda-schema-package";

const root = Buffer.from("synthetic schema bytes");
const signature = Buffer.from("synthetic dependency bytes");
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const manifest = {
  file: "invoice.xsd",
  bytes: root.length,
  sha256: digest(root),
  status: "official-package-revision-confirmed",
  runtime_use_allowed: true,
  dependencies: [
    {
      schemaLocation: "../../signature.xsd",
      local_file: "signature.xsd",
      sha256: digest(signature),
      bytes: signature.length,
    },
  ],
};
const files = () =>
  new Map([
    ["invoice.xsd", root],
    ["signature.xsd", signature],
  ]);

it("detects changed bytes even when the filename and byte count match", () => {
  const altered = files();
  altered.set("invoice.xsd", Buffer.alloc(root.length, 65));
  expect(auditSchemaPackage(manifest, altered).issues).toContain(
    "SCHEMA_INTEGRITY_FAILED",
  );
});
it("does not resolve relative schema imports or approve missing dependencies", () => {
  const result = auditSchemaPackage(
    { ...manifest, dependencies: [{ schemaLocation: "../../signature.xsd" }] },
    files(),
  );
  expect(result.status).toBe("blocked");
  expect(result.issues).toContain("DEPENDENCY_NOT_PINNED");
});
it("rejects corrupted pinned signature schemas", () => {
  const altered = files();
  altered.set("signature.xsd", Buffer.from("modified"));
  expect(auditSchemaPackage(manifest, altered).issues).toContain(
    "DEPENDENCY_INTEGRITY_FAILED",
  );
});
it("blocks a hash-matching package until its revision and runtime use are confirmed", () => {
  const result = auditSchemaPackage(
    {
      ...manifest,
      status: "official-download-revision-unconfirmed",
      runtime_use_allowed: false,
    },
    files(),
  );
  expect(result.issues).toEqual(
    expect.arrayContaining([
      "SCHEMA_REVISION_UNCONFIRMED",
      "RUNTIME_USE_DISABLED",
    ]),
  );
  expect(result.status).toBe("blocked");
});
it("rejects paths outside the package without reading them", () => {
  const result = auditSchemaPackage(
    { ...manifest, file: "../private.xml" },
    files(),
  );
  expect(result.issues).toEqual(["MANIFEST_INVALID"]);
});
it("distinguishes package integrity from XML validation, signature and emission", () => {
  const result = auditSchemaPackage(manifest, files());
  expect(result.status).toBe("package_verified");
  expect(result.xsdValidation).toBe("not_run");
  expect(result.emissionEnabled).toBe(false);
});
it("audits every document profile, including TE, against pinned bytes", () => {
  const ticket = Buffer.from("synthetic ticket schema");
  const combined = {
    ...manifest,
    document_schemas: [
      {
        document_type: "TE",
        root: "TiqueteElectronico",
        target_namespace:
          "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/tiqueteElectronico",
        file: "ticket.xsd",
        bytes: ticket.length,
        sha256: digest(ticket),
        status: manifest.status,
        runtime_use_allowed: true,
        dependencies: manifest.dependencies,
      },
    ],
  };
  const content = files();
  content.set("ticket.xsd", ticket);
  expect(auditSchemaPackage(combined, content).status).toBe("package_verified");
  content.set("ticket.xsd", Buffer.alloc(ticket.length, 65));
  expect(auditSchemaPackage(combined, content).issues).toContain(
    "SCHEMA_INTEGRITY_FAILED",
  );
});
