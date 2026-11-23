import { constants } from "node:fs";
import { open } from "node:fs/promises";
import {
  inspectInvoiceXml,
  XML_INPUT_LIMITS,
} from "../apps/api/src/services/xml-input";

// Local developer command; no upload endpoint or external-resource access.
const failure = (code: string) => ({
  status: "blocked",
  documentType: null,
  issues: [code],
  xsdValidation: "not_run",
  emissionEnabled: false,
});
async function inspectFile() {
  if (process.argv.length !== 3) return failure("XML_FILE_ARGUMENT_REQUIRED");
  const file = await open(
    process.argv[2],
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile()) return failure("XML_FILE_UNREADABLE");
    if (stat.size > XML_INPUT_LIMITS.bytes) return failure("XML_SIZE_EXCEEDED");
    const bytes = Buffer.alloc(XML_INPUT_LIMITS.bytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await file.read(bytes, length, bytes.length - length, null);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    return inspectInvoiceXml(bytes.subarray(0, length));
  } finally {
    await file.close();
  }
}
try {
  const result = await inspectFile();
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "blocked") process.exitCode = 1;
} catch {
  console.error(JSON.stringify(failure("XML_FILE_UNREADABLE")));
  process.exitCode = 1;
}
