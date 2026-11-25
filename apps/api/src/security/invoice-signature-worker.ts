import { parentPort, workerData } from "node:worker_threads";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  createPrivateKey,
  createPublicKey,
  X509Certificate,
} from "node:crypto";
import { inspectorCapability } from "./pkcs12-inspector.ts";
import { signInvoiceXml, verifyInvoiceSignature } from "./invoice-signature.ts";
// Parsing and signing are isolated; never emit diagnostics or private PEM.
const file = Buffer.from(workerData.pkcs12);
const pin = Buffer.from(workerData.pin + "\n");
const chunks: Buffer[] = [];
let diagnostics = Buffer.alloc(0);
async function main() {
  const capability = await inspectorCapability();
  if (!capability.available || !capability.validated_profile) throw Error();
  if (
    !file.length ||
    file.length > 2097152 ||
    Buffer.byteLength(workerData.xml) > 1048576 ||
    pin.length > 1024
  )
    throw Error();
  await new Promise<void>((done, reject) => {
    const child = spawn(
      resolve(".local/openssl/bin/openssl"),
      ["pkcs12", "-info", "-legacy", "-nodes", "-passin", "fd:3"],
      {
        stdio: ["pipe", "pipe", "pipe", "pipe"],
        env: { PATH: "/usr/bin:/bin" },
      },
    );
    let size = 0,
      failed = false;
    const timer = setTimeout(() => {
      failed = true;
      child.kill("SIGKILL");
    }, 8000);
    const collect = (part: Buffer, stderr: boolean) => {
      size += part.length;
      if (size > 8 * 1024 * 1024) {
        failed = true;
        child.kill("SIGKILL");
        return;
      }
      if (stderr) {
        if (diagnostics.length < 65536) {
          const previous = diagnostics;
          diagnostics = Buffer.concat([diagnostics, part]);
          previous.fill(0);
        }
      } else chunks.push(part);
    };
    child.stdout.on("data", (part: Buffer) => collect(part, false));
    child.stderr.on("data", (part: Buffer) => collect(part, true));
    child.once("error", () => {
      clearTimeout(timer);
      reject(Error());
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (
        failed ||
        code !== 0 ||
        !/^MAC: [a-zA-Z0-9_-]+, Iteration [1-9][0-9]*$/m.test(
          diagnostics.toString(),
        )
      )
        reject(Error());
      else done();
    });
    child.stdin.on("error", () => {});
    child.stdin.end(file);
    const pipe = child.stdio[3] as import("node:stream").Writable;
    pipe.on("error", () => {});
    pipe.end(pin);
  });
  const combined = Buffer.concat(chunks);
  try {
    const pem = combined.toString("utf8");
    const keys =
      pem.match(
        /-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/g,
      ) || [];
    const certs =
      pem.match(
        /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
      ) || [];
    if (keys.length !== 1) throw Error();
    const key = createPrivateKey(keys[0]);
    if (
      key.asymmetricKeyType !== "rsa" ||
      ![2048, 4096].includes(key.asymmetricKeyDetails?.modulusLength ?? 0)
    )
      throw Error();
    const publicDer = createPublicKey(key).export({
      type: "spki",
      format: "der",
    });
    const matching = certs
      .map((p) => new X509Certificate(p))
      .filter((c) =>
        c.publicKey.export({ type: "spki", format: "der" }).equals(publicDer),
      );
    if (matching.length !== 1) throw Error();
    const certificatePem = matching[0].toString();
    const signedXml = signInvoiceXml(workerData.xml, {
      privateKeyPem: keys[0],
      certificatePem,
      policy: workerData.policy,
      signedAt: workerData.signedAt,
    });
    if (!verifyInvoiceSignature(signedXml, certificatePem)) throw Error();
    parentPort?.postMessage({ signedXml, certificatePem });
  } finally {
    combined.fill(0);
  }
}
main()
  .catch(() => parentPort?.postMessage({ error: true }))
  .finally(() => {
    file.fill(0);
    pin.fill(0);
    for (const chunk of chunks) chunk.fill(0);
    diagnostics.fill(0);
    if (workerData.pkcs12 instanceof Uint8Array) workerData.pkcs12.fill(0);
    workerData.pin = "";
    workerData.xml = "";
    parentPort?.close();
  });
