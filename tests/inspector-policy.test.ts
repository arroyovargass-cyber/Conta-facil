import { it, expect } from "vitest";
import { inspectorProfileAllowed } from "../apps/api/src/security/inspector-policy";
import profile from "../infra/openssl-inspector-profile.json";
const digest = "a".repeat(64);
const attestation = {
  profile_id: profile.id,
  revision: profile.revision,
  binary_sha256: digest,
  version: profile.version,
};
it("allows the exact reviewed security profile only when binary integrity matches", () => {
  expect(
    inspectorProfileAllowed(profile.version, attestation, digest, "production"),
  ).toBe(true);
  expect(
    inspectorProfileAllowed(profile.version, undefined, digest, "production"),
  ).toBe(false);
  expect(
    inspectorProfileAllowed(
      profile.version,
      { ...attestation, revision: "0".repeat(40) },
      digest,
      "production",
    ),
  ).toBe(false);
  expect(
    inspectorProfileAllowed(
      profile.version,
      attestation,
      "b".repeat(64),
      "production",
    ),
  ).toBe(false);
});
it("never admits arbitrary development versions outside synthetic tests", () => {
  expect(
    inspectorProfileAllowed("3.5.11-dev", attestation, digest, "production"),
  ).toBe(false);
  expect(inspectorProfileAllowed("3.5.10-dev", undefined, digest, "test")).toBe(
    true,
  );
  expect(
    inspectorProfileAllowed("3.5.9", undefined, digest, "production"),
  ).toBe(false);
});
