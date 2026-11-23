import { lstat, readdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { auditSchemaPackage } from "../apps/api/src/services/hacienda-schema-package";

// Developer-only audit. No downloads, XML parsing or schemaLocation resolution.
const directory = fileURLToPath(
  new URL("../docs/reference/hacienda/v4.4/", import.meta.url),
);
try {
  const manifest = JSON.parse(
    await readFile(join(directory, "manifest.json"), {
      encoding: "utf8",
      flag: constants.O_RDONLY | constants.O_NOFOLLOW,
    }),
  );
  const files = new Map<string, Buffer>();
  for (const name of await readdir(directory)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.xsd$/.test(name)) continue;
    const path = join(directory, name);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024)
      continue;
    files.set(
      name,
      await readFile(path, {
        flag: constants.O_RDONLY | constants.O_NOFOLLOW,
      }),
    );
  }
  const result = auditSchemaPackage(manifest, files);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "blocked") process.exitCode = 1;
} catch {
  console.error(
    JSON.stringify({
      status: "blocked",
      issues: ["PACKAGE_UNREADABLE"],
      xsdValidation: "not_run",
      emissionEnabled: false,
    }),
  );
  process.exitCode = 1;
}
