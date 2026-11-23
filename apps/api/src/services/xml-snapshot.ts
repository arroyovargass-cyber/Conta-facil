import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { z } from "zod";
import { inspectInvoiceXml } from "./xml-input";

const workerResult = z
  .object({
    status: z.enum([
      "blocked",
      "technical_error",
      "snapshot_matches",
      "snapshot_invalid",
    ]),
    issues: z.array(z.string().regex(/^[A-Z_]{1,64}$/)).max(10),
    revisionConfirmed: z.literal(false),
    signatureVerification: z.literal("not_run"),
    haciendaStatus: z.literal("not_sent"),
    emissionEnabled: z.literal(false),
    xsdValidation: z.enum(["not_run", "downloaded_snapshot_only"]),
    errorCount: z.number().int().min(0).max(10).optional(),
    errorsTruncated: z.boolean().optional(),
  })
  .strict();
const failure = () => ({
  status: "technical_error" as const,
  issues: ["XSD_WORKER_UNAVAILABLE"],
  revisionConfirmed: false as const,
  signatureVerification: "not_run" as const,
  haciendaStatus: "not_sent" as const,
  emissionEnabled: false as const,
  xsdValidation: "not_run" as const,
});

// Explicit diagnostic API only. Not connected to document issuance or HTTP.
export async function validateInvoiceXmlSnapshot(bytes: Buffer) {
  const input = inspectInvoiceXml(bytes);
  if (input.status === "blocked")
    return {
      ...input,
      revisionConfirmed: false as const,
      signatureVerification: "not_run" as const,
      haciendaStatus: "not_sent" as const,
    };
  return new Promise<z.infer<typeof workerResult>>((finish) => {
    const child = execFile(
      resolve(".local/xmlschema-env/bin/python"),
      ["-I", resolve("infra/xml-validator-worker.py")],
      {
        timeout: 8000,
        killSignal: "SIGKILL",
        maxBuffer: 16384,
        env: { LANG: "C.UTF-8" },
      },
      (error, stdout) => {
        if (error) return finish(failure());
        try {
          finish(workerResult.parse(JSON.parse(stdout)));
        } catch {
          finish(failure());
        }
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(JSON.stringify({ xml_base64: bytes.toString("base64") }));
  });
}
