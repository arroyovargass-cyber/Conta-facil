import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { syntheticPkcs12 } from "./support/pkcs12";
async function dumpSynthetic() {
  const bytes = await syntheticPkcs12({ pin: "1234" });
  return new Promise<string>((ok, fail) => {
    const p = spawn(
      resolve(".local/openssl/bin/openssl"),
      ["pkcs12", "-nodes", "-legacy", "-passin", "fd:3"],
      { stdio: ["pipe", "pipe", "ignore", "pipe"] },
    );
    const chunks: Buffer[] = [];
    p.stdout!.on("data", (b) => chunks.push(b));
    p.on("error", fail);
    p.on("close", (code) =>
      code === 0
        ? ok(Buffer.concat(chunks).toString())
        : fail(Error("Synthetic dump failed")),
    );
    p.stdin!.end(bytes);
    (p.stdio[3] as import("node:stream").Writable).end("1234\n");
  });
}
// Test-only fake CLI lives in a disposable cwd. The application binary is never replaced.
async function workerFixture(command: string, pem = "") {
  const directory = await mkdtemp(join(tmpdir(), "conta-worker-bound-"));
  try {
    await mkdir(join(directory, ".local/openssl/bin"), { recursive: true });
    await mkdir(join(directory, "apps/api/src/security"), { recursive: true });
    await symlink(
      resolve("apps/api/src/security/pkcs12-worker.ts"),
      join(directory, "apps/api/src/security/pkcs12-worker.ts"),
    );
    await writeFile(
      join(directory, ".local/openssl/bin/openssl"),
      '#!/bin/sh\nif [ "$1" = version ]; then printf "OpenSSL 3.5.10 test fixture\\n"; exit 0; fi\nprintf "MAC: sha256, Iteration 2048\\n" >&2\n' +
        command +
        "\n",
      { mode: 0o700 },
    );
    await writeFile(join(directory, "dump.pem"), pem, { mode: 0o600 });
    const source = JSON.stringify(
      resolve("apps/api/src/security/pkcs12-inspector.ts"),
    );
    await writeFile(
      join(directory, "runner.mts"),
      `import {inspectPkcs12} from ${source};try {await inspectPkcs12(Buffer.from('fixture'), '1234');console.log('unexpected success');process.exitCode=1;}catch {console.log('rejected');}`,
    );
    const result = await promisify(execFile)(
      process.execPath,
      [join(directory, "runner.mts")],
      {
        cwd: directory,
        env: { NODE_ENV: "test", PATH: process.env.PATH },
        timeout: 12000,
        maxBuffer: 16384,
      },
    );
    expect(result.stdout.trim()).toBe("rejected");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
it("rejects multiple private keys and key/certificate mismatch in disposable worker output", async () => {
  const a = await dumpSynthetic(),
    b = await dumpSynthetic();
  const privateKey = (pem: string) =>
    pem.match(
      /-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/,
    )![0];
  const cert = (pem: string) =>
    pem.match(
      /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/,
    )![0];
  await workerFixture(
    "exec cat dump.pem",
    privateKey(a) + "\n" + privateKey(b) + "\n" + cert(a) + "\n" + cert(b),
  );
  await workerFixture("exec cat dump.pem", privateKey(a) + "\n" + cert(b));
});
it("kills a stalled parser and rejects excessive parser output", async () => {
  const started = Date.now();
  await workerFixture("exec sleep 20");
  expect(Date.now() - started).toBeLessThan(10500);
  await workerFixture("exec head -c 9437184 /dev/zero");
});
