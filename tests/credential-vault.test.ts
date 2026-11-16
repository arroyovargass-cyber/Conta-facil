import { it, expect } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import {
  encryptCredential,
  decryptCredential,
  parseKeyring,
  type VaultContext,
} from "../apps/api/src/security/credential-vault";
const key = randomBytes(32),
  keys = { active: "v1", keys: { v1: key } },
  context: VaultContext = {
    tenantId: randomUUID(),
    environment: "test",
    version: 1,
    kind: "api_access",
  };
it("authenticates encrypted secrets and context with a random IV", () => {
  const plain = Buffer.from("private-password-Ñ!"),
    a = encryptCredential(plain, context, keys),
    b = encryptCredential(plain, context, keys);
  expect(a.blob.equals(b.blob)).toBe(false);
  expect(a.blob.includes(plain)).toBe(false);
  expect(decryptCredential(a, context, keys)).toEqual(plain);
  for (const replacement of [
    { tenantId: randomUUID() },
    { version: 2 },
    { kind: "pkcs12" },
    { environment: "production" },
  ])
    expect(() =>
      decryptCredential(
        a,
        { ...context, ...replacement } as VaultContext,
        keys,
      ),
    ).toThrow();
  const corrupt = { ...a, blob: Buffer.from(a.blob) };
  corrupt.blob[20] ^= 1;
  expect(() => decryptCredential(corrupt, context, keys)).toThrow();
});
it("supports old key versions without reusing the session key", () => {
  const a = encryptCredential(Buffer.from("old"), context, keys),
    rotated = { active: "v2", keys: { v1: key, v2: randomBytes(32) } };
  expect(decryptCredential(a, context, rotated).toString()).toBe("old");
  expect(encryptCredential(Buffer.from("new"), context, rotated).keyId).toBe(
    "v2",
  );
  expect(() =>
    parseKeyring(
      JSON.stringify({ v1: key.toString("hex") }),
      "v1",
      key.toString("hex"),
    ),
  ).toThrow();
  expect(() =>
    parseKeyring(JSON.stringify({ v1: "bad" }), "v1", "different"),
  ).toThrow();
  expect(() => parseKeyring("{}", "missing", "different")).toThrow();
  expect(parseKeyring(undefined, undefined, "session")).toBeUndefined();
  expect(() => parseKeyring("{}", undefined, "session")).toThrow();
});
it("restores a serialized ciphertext backup using a separately supplied versioned keyring", () => {
  const original = encryptCredential(
    Buffer.from("SYNTHETIC-RESTORE-ONLY"),
    context,
    keys,
  );
  const backup = JSON.parse(
    JSON.stringify({
      key_id: original.keyId,
      ciphertext_base64: original.blob.toString("base64"),
      context,
    }),
  );
  const secretKeyring = JSON.stringify({
    v1: key.toString("hex"),
    v2: randomBytes(32).toString("hex"),
  });
  const restoredKeys = parseKeyring(
    secretKeyring,
    "v2",
    randomBytes(32).toString("hex"),
  )!;
  const restored = {
    keyId: backup.key_id,
    blob: Buffer.from(backup.ciphertext_base64, "base64"),
  };
  expect(
    decryptCredential(restored, backup.context, restoredKeys).toString(),
  ).toBe("SYNTHETIC-RESTORE-ONLY");
  expect(JSON.stringify(backup)).not.toContain(key.toString("hex"));
  expect(() =>
    decryptCredential(restored, backup.context, {
      active: "v2",
      keys: { v2: restoredKeys.keys.v2 },
    }),
  ).toThrow();
});
