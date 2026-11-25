import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { z } from "zod";

const result = z
  .object({
    valid: z.boolean(),
    issues: z.array(z.string().regex(/^[A-Z_]{1,64}$/)).max(10),
  })
  .strict();
/** Full pinned MH4.4 XSD validation in a bounded, offline worker; no authenticity claim. */
export async function validateHaciendaResponseSchema(
  xml: string,
): Promise<{ valid: boolean; issues: string[] }> {
  if (Buffer.byteLength(xml, "utf8") > 1048576)
    return { valid: false, issues: ["XML_SIZE_EXCEEDED"] };
  return new Promise((finish) => {
    const child = execFile(
      resolve(".local/xmlschema-env/bin/python"),
      ["-I", resolve("infra/hacienda-response-validator-worker.py")],
      {
        timeout: 10000,
        killSignal: "SIGKILL",
        maxBuffer: 16384,
        env: { LANG: "C.UTF-8" },
      },
      (error, stdout) => {
        if (error)
          return finish({ valid: false, issues: ["XSD_WORKER_UNAVAILABLE"] });
        try {
          finish(result.parse(JSON.parse(stdout)));
        } catch {
          finish({ valid: false, issues: ["XSD_WORKER_UNAVAILABLE"] });
        }
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(
      JSON.stringify({
        xml_base64: Buffer.from(xml, "utf8").toString("base64"),
      }),
    );
  });
}
