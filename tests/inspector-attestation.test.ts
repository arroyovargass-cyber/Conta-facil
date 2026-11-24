import { it, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import profile from "../infra/openssl-inspector-profile.json";
async function probe(attest: boolean, version = profile.version) {
  const cwd = await mkdtemp(join(tmpdir(), "conta-attestation-"));
  try {
    await mkdir(join(cwd, ".local/openssl/bin"), { recursive: true });
    const binary = join(cwd, ".local/openssl/bin/openssl");
    await writeFile(
      binary,
      '#!/bin/sh\necho executed > executed\nif [ -n "$HACIENDA_KEYRING" ]; then echo exposed > exposed; fi\nprintf "OpenSSL ' +
        version +
        ' fixture\\n"\n',
      { mode: 0o700 },
    );
    if (attest)
      await writeFile(
        join(cwd, ".local/openssl/inspector-attestation.json"),
        JSON.stringify({
          profile_id: profile.id,
          revision: profile.revision,
          version: profile.version,
          binary_sha256: createHash("sha256")
            .update(await readFile(binary))
            .digest("hex"),
        }),
      );
    await writeFile(
      join(cwd, "run.mts"),
      "import {inspectorCapability} from " +
        JSON.stringify(resolve("apps/api/src/security/pkcs12-inspector.ts")) +
        "; import {writeFileSync} from 'node:fs'; writeFileSync('result.json',JSON.stringify(await inspectorCapability()));",
    );
    await promisify(execFile)(process.execPath, [join(cwd, "run.mts")], {
      cwd,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "production",
        HACIENDA_KEYRING: "synthetic-sentinel",
      },
      timeout: 10000,
    });
    const exists = async (name: string) => {
      try {
        await access(join(cwd, name));
        return true;
      } catch {
        return false;
      }
    };
    return {
      capability: JSON.parse(await readFile(join(cwd, "result.json"), "utf8")),
      executed: await exists("executed"),
      exposed: await exists("exposed"),
    };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
it("does not execute a binary without the verified integrity record in production", async () => {
  const r = await probe(false);
  expect(r.executed).toBe(false);
  expect(r.capability.validated_profile).toBe(false);
});
it("version probing never inherits vault or session secrets", async () => {
  const r = await probe(true);
  expect(r.executed).toBe(true);
  expect(r.exposed).toBe(false);
  expect(r.capability.validated_profile).toBe(true);
});
it("rejects an unreviewed suffix instead of matching a version prefix", async () => {
  const r = await probe(true, profile.version + "-unreviewed");
  expect(r.capability.validated_profile).toBe(false);
});
