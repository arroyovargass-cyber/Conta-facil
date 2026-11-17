import { parentPort, workerData } from "node:worker_threads";
import { spawn } from "node:child_process";
import {
  X509Certificate,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  randomBytes,
} from "node:crypto";
// Untrusted parser output remains in this disposable worker and is never logged.
const child = spawn(
  workerData.binary,
  ["pkcs12", "-info", "-legacy", "-nodes", "-passin", "fd:3"],
  { stdio: ["pipe", "pipe", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin" } },
);
const chunks: Buffer[] = [];
let size = 0;
let failed = false;
child.stdout.on("data", (part: Buffer) => {
  size += part.length;
  if (size > 8 * 1024 * 1024) {
    failed = true;
    child.kill("SIGKILL");
  } else chunks.push(part);
});
let diagnostics = "";
child.stderr.on("data", (part: Buffer) => {
  size += part.length;
  if (size > 8 * 1024 * 1024) {
    failed = true;
    child.kill("SIGKILL");
  } else if (diagnostics.length < 65536) diagnostics += part.toString("utf8");
});
child.on("error", () => parentPort?.postMessage({ error: true }));
const timer = setTimeout(() => {
  failed = true;
  child.kill("SIGKILL");
}, 7000);
child.on("close", (code) => {
  clearTimeout(timer);
  try {
    if (
      failed ||
      code !== 0 ||
      !/^MAC: [a-zA-Z0-9_-]+, Iteration [1-9][0-9]*$/m.test(diagnostics)
    )
      throw Error();
    const pem = Buffer.concat(chunks).toString("utf8");
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
    const bits = key.asymmetricKeyDetails?.modulusLength;
    if (key.asymmetricKeyType !== "rsa" || ![2048, 4096].includes(bits || 0))
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
    const cert = matching[0];
    const now = Date.now();
    if (Date.parse(cert.validFrom) > now || Date.parse(cert.validTo) <= now)
      throw Error();
    const challenge = randomBytes(32);
    if (
      !verify(
        "sha256",
        challenge,
        cert.publicKey,
        sign("sha256", challenge, key),
      )
    )
      throw Error();
    parentPort?.postMessage({
      technical_status: "valid_local",
      identity_status: "pending",
      algorithm: "rsa",
      bits,
      fingerprint: cert.fingerprint256.replaceAll(":", "").toLowerCase(),
      valid_from: new Date(cert.validFrom).toISOString(),
      valid_until: new Date(cert.validTo).toISOString(),
    });
  } catch {
    parentPort?.postMessage({ error: true });
  } finally {
    for (const b of chunks) b.fill(0);
    parentPort?.close();
  }
});
child.stdin.on("error", () => {});
child.stdin.end(Buffer.from(workerData.file));
const pinPipe = child.stdio[3] as import("node:stream").Writable;
pinPipe.on("error", () => {});
pinPipe.end(workerData.pin + "\n");
