import profile from "../../../../infra/openssl-inspector-profile.json" with { type: "json" };
export type InspectorAttestation = {
  profile_id: string;
  revision: string;
  binary_sha256: string;
  version: string;
};
export function inspectorProfileAllowed(
  version: string,
  attestation: unknown,
  digest: string,
  environment: string,
): boolean {
  if (environment === "test" && /^3\.5\.(1\d|[2-9]\d)(?:-dev)?$/.test(version))
    return true;
  if (!attestation || typeof attestation !== "object") return false;
  const a = attestation as Partial<InspectorAttestation>;
  return (
    version === profile.version &&
    a.version === version &&
    a.profile_id === profile.id &&
    a.revision === profile.revision &&
    /^[a-f0-9]{64}$/.test(digest) &&
    a.binary_sha256 === digest
  );
}
