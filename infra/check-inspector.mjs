import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import profile from "./openssl-inspector-profile.json" with { type: "json" };
import { inspectorProfileAllowed } from "../apps/api/src/security/inspector-policy.ts";
try {
  const binary = resolve(".local/openssl/bin/openssl");
  const attestation = JSON.parse(
    readFileSync(resolve(".local/openssl/inspector-attestation.json"), "utf8"),
  );
  const digest = createHash("sha256")
    .update(readFileSync(binary))
    .digest("hex");
  if (
    !inspectorProfileAllowed(profile.version, attestation, digest, "production")
  )
    throw Error();
  const version =
    execFileSync(binary, ["version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
      env: { PATH: "/usr/bin:/bin" },
    }).match(/^OpenSSL (\S+)/)?.[1] ?? "";
  if (!inspectorProfileAllowed(version, attestation, digest, "production"))
    throw Error();
} catch {
  throw Error(
    "Verified PKCS12 inspector unavailable. Run npm run openssl:prepare before building.",
  );
}
