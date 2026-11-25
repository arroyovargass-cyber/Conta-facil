import { Worker } from "node:worker_threads";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { inspectorCapability } from "./pkcs12-inspector.ts";
import { verifyInvoiceSignature } from "./invoice-signature.ts";
export interface InvoicePkcs12Input {
  xml: string;
  pkcs12: Buffer;
  pin: string;
  signedAt: string;
  policy: { url: string; sha256Base64: string };
}
let active = 0;
const queue: Array<() => void> = [];
const failure = () => new Error("No se pudo firmar el comprobante");
/** Private keys remain in a disposable worker. V8 string copies cannot be reliably erased. */
export async function signInvoicePkcs12(
  input: InvoicePkcs12Input,
): Promise<{ signedXml: string; certificatePem: string }> {
  if (
    !input.pkcs12.length ||
    input.pkcs12.length > 2097152 ||
    Buffer.byteLength(input.xml) > 1048576 ||
    !input.pin.length ||
    Buffer.byteLength(input.pin) > 1023 ||
    /[\0\r\n]/.test(input.pin)
  )
    throw failure();
  if (active >= 2) {
    if (queue.length >= 4) throw Object.assign(failure(), { statusCode: 429 });
    await new Promise<void>((r) => queue.push(r));
  } else active++;
  const bytes = Buffer.from(input.pkcs12);
  try {
    const capability = await inspectorCapability();
    if (!capability.available || !capability.validated_profile) throw failure();
    return await new Promise((resolveResult, reject) => {
      const source = resolve(
        "apps/api/src/security/invoice-signature-worker.ts",
      );
      const worker = new Worker(
        process.env.NODE_ENV !== "production" && existsSync(source)
          ? source
          : resolve("dist-server/invoice-signature-worker.mjs"),
        {
          workerData: { ...input, pkcs12: bytes },
          env: {
            PATH: "/usr/bin:/bin",
            NODE_ENV:
              process.env.NODE_ENV === "production"
                ? "production"
                : "development",
          },
          execArgv: [],
          resourceLimits: { maxOldGenerationSizeMb: 64 },
        },
      );
      let settled = false;
      const finish = (result?: {
        signedXml: string;
        certificatePem: string;
      }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        if (result) resolveResult(result);
        else reject(failure());
      };
      const timer = setTimeout(() => finish(), 10000);
      worker.once("error", () => finish());
      worker.once("exit", () => finish());
      worker.once("message", (message: unknown) => {
        if (!message || typeof message !== "object") {
          finish();
          return;
        }
        const m = message as Record<string, unknown>;
        if (
          typeof m.signedXml !== "string" ||
          typeof m.certificatePem !== "string" ||
          Buffer.byteLength(m.signedXml) > 1048576 ||
          m.certificatePem.length > 32768 ||
          !verifyInvoiceSignature(m.signedXml, m.certificatePem)
        ) {
          finish();
          return;
        }
        finish({ signedXml: m.signedXml, certificatePem: m.certificatePem });
      });
    });
  } finally {
    bytes.fill(0);
    const next = queue.shift();
    if (next) next();
    else active--;
  }
}
