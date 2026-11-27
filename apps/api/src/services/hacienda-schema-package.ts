import { createHash } from "node:crypto";
import { z } from "zod";

const filename = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const schemaManifest = z.object({
  file: filename,
  bytes: z.int().positive(),
  sha256: hash,
  status: z.string(),
  runtime_use_allowed: z.boolean(),
  dependencies: z.array(
    z.object({
      schemaLocation: z.string(),
      local_file: filename.optional(),
      sha256: hash.optional(),
      bytes: z.int().positive().optional(),
    }),
  ),
});
const packageManifest = schemaManifest.extend({
  document_schemas: z
    .array(
      schemaManifest.extend({
        document_type: z.enum(["FE", "TE"]),
        root: z.string(),
        target_namespace: z.url(),
      }),
    )
    .default([]),
});

export function auditSchemaPackage(
  manifest: unknown,
  files: ReadonlyMap<string, Buffer>,
) {
  const issues: string[] = [];
  const parsed = packageManifest.safeParse(manifest);
  if (!parsed.success) issues.push("MANIFEST_INVALID");
  else {
    const m = parsed.data;
    const matches = (name: string, bytes: number, sha256: string) => {
      const content = files.get(name);
      return (
        content !== undefined &&
        content.length === bytes &&
        createHash("sha256").update(content).digest("hex") === sha256
      );
    };
    for (const schema of [m, ...m.document_schemas]) {
      if (!matches(schema.file, schema.bytes, schema.sha256))
        issues.push("SCHEMA_INTEGRITY_FAILED");
      for (const dependency of schema.dependencies) {
        if (!dependency.local_file || !dependency.sha256 || !dependency.bytes)
          issues.push("DEPENDENCY_NOT_PINNED");
        else if (
          !matches(dependency.local_file, dependency.bytes, dependency.sha256)
        )
          issues.push("DEPENDENCY_INTEGRITY_FAILED");
      }
      if (schema.status !== "official-package-revision-confirmed")
        issues.push("SCHEMA_REVISION_UNCONFIRMED");
      if (!schema.runtime_use_allowed) issues.push("RUNTIME_USE_DISABLED");
    }
  }
  return {
    status: issues.length
      ? ("blocked" as const)
      : ("package_verified" as const),
    xsdValidation: "not_run" as const,
    emissionEnabled: false as const,
    issues: [...new Set(issues)],
  };
}
