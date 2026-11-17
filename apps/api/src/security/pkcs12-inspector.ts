import { Worker } from "node:worker_threads";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
const binary = resolve(".local/openssl/bin/openssl");
export type CertificateMetadata = {
  technical_status: "valid_local";
  identity_status: "pending";
  algorithm: "rsa";
  bits: number;
  fingerprint: string;
  valid_from: string;
  valid_until: string;
};
export async function inspectorCapability() {
  try {
    const { stdout } = await promisify(execFile)(binary, ["version"], {
      timeout: 2000,
      maxBuffer: 4096,
    });
    const version = stdout.match(/OpenSSL (3\.5\.(\d+)(?:-dev)?)/);
    return {
      available: !!version && Number(version[2]) >= 10,
      version: version?.[1] ?? "",
    };
  } catch {
    return { available: false, version: "" };
  }
}
let active = 0;
const queue: Array<() => void> = [];
export async function inspectPkcs12(
  file: Buffer,
  pin: string,
): Promise<CertificateMetadata> {
  if (
    file.length === 0 ||
    file.length > 2097152 ||
    pin.length < 1 ||
    Buffer.byteLength(pin, "utf8") > 1023 ||
    /[\0\r\n]/.test(pin)
  )
    throw new Error("Archivo o PIN no válido");
  if (active >= 2) {
    if (queue.length >= 4)
      throw Object.assign(new Error("Inspector ocupado"), { statusCode: 429 });
    await new Promise<void>((r) => queue.push(r));
  } else active++;
  try {
    if (!(await inspectorCapability()).available)
      throw new Error("Inspector criptográfico no disponible");
    return await new Promise<CertificateMetadata>((resolveResult, reject) => {
      const compiled = resolve("dist-server/pkcs12-worker.mjs");
      const worker = new Worker(
        process.env.NODE_ENV !== "production" &&
          existsSync(resolve("apps/api/src/security/pkcs12-worker.ts"))
          ? resolve("apps/api/src/security/pkcs12-worker.ts")
          : compiled,
        {
          workerData: { file, pin, binary },
          resourceLimits: { maxOldGenerationSizeMb: 64 },
        },
      );
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(new Error("No se pudo validar el archivo criptográfico"));
      }, 8000);
      const fail = () => {
        clearTimeout(timer);
        void worker.terminate();
        reject(new Error("No se pudo validar el archivo criptográfico"));
      };
      worker.once("error", fail);
      worker.once("exit", (code) => {
        if (code !== 0) fail();
      });
      worker.once("message", (message) => {
        clearTimeout(timer);
        void worker.terminate();
        if (message.error)
          reject(new Error("No se pudo validar el archivo criptográfico"));
        else resolveResult(message);
      });
    });
  } finally {
    const next = queue.shift();
    if (next) next();
    else active--;
  }
}
