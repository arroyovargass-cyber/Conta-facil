import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import profile from "./openssl-inspector-profile.json" with { type: "json" };
import { resolve } from "node:path";
// Official openssl/openssl security snapshot. This is NOT a stable release.
const revision = profile.revision;
const source = resolve(".local/openssl-src"),
  prefix = resolve(".local/openssl");
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
// These two fixed directories contain only disposable source/build/install artifacts.
// Never attest a binary linked from cached objects or generated build inputs.
rmSync(source, { recursive: true, force: true });
rmSync(prefix, { recursive: true, force: true });
mkdirSync(source, { recursive: true, mode: 0o700 });
run("git", ["init"], source);
run("git", ["fetch", "--depth=512", profile.repository, revision], source);
run("git", ["checkout", "--detach", revision], source);
const actual = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: source,
  encoding: "utf8",
}).trim();
if (actual !== revision) throw Error("OpenSSL source revision mismatch");
for (const fix of Object.values(profile.security_fixes))
  run("git", ["merge-base", "--is-ancestor", fix, revision], source);
const dirty = execFileSync("git", ["diff", "--name-only", revision], {
  cwd: source,
  encoding: "utf8",
});
if (dirty.trim()) throw Error("OpenSSL tracked source was modified");
run(
  "./Configure",
  [
    `--prefix=${prefix}`,
    `--openssldir=${prefix}/ssl`,
    "no-shared",
    "no-tests",
    "no-docs",
    "no-module",
    "enable-legacy",
  ],
  source,
);
run("make", ["-j2", "build_sw"], source);
run("make", ["install_sw"], source);
const version = execFileSync(resolve(prefix, "bin/openssl"), ["version"], {
  encoding: "utf8",
  env: { PATH: "/usr/bin:/bin" },
});
if (!version.startsWith("OpenSSL " + profile.version + " "))
  throw Error("Unexpected OpenSSL version");
const binary_sha256 = createHash("sha256")
  .update(readFileSync(resolve(prefix, "bin/openssl")))
  .digest("hex");
writeFileSync(
  resolve(prefix, "inspector-attestation.json"),
  JSON.stringify({
    profile_id: profile.id,
    revision,
    version: profile.version,
    binary_sha256,
  }) + "\n",
  { mode: 0o600 },
);
console.log(
  "Official pinned PKCS12 profile prepared; source patches and binary integrity recorded. This remains a security snapshot, not a stable release or fiscal certification.",
);
