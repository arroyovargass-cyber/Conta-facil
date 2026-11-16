import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
export type VaultContext = {
  tenantId: string;
  environment: "test";
  version: number;
  kind: "api_access" | "pkcs12";
};
export type Keyring = { active: string; keys: Record<string, Buffer> };
export type VaultEnvelope = { keyId: string; blob: Buffer };
export function parseKeyring(
  raw: string | undefined,
  active: string | undefined,
  sessionKey: string,
): Keyring | undefined {
  if (raw === undefined && active === undefined) return;
  try {
    if (!raw || !active || !/^[a-zA-Z0-9_-]{1,40}$/.test(active)) throw 0;
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw 0;
    const keys: Record<string, Buffer> = Object.create(null);
    for (const [id, value] of Object.entries(parsed)) {
      if (
        !/^[a-zA-Z0-9_-]{1,40}$/.test(id) ||
        typeof value !== "string" ||
        !/^[a-f0-9]{64}$/i.test(value)
      )
        throw 0;
      const bytes = Buffer.from(value, "hex");
      if (bytes.equals(Buffer.from(sessionKey, "hex"))) throw 0;
      keys[id] = bytes;
    }
    if (!keys[active] || Object.keys(keys).length > 10) throw 0;
    return { active, keys };
  } catch {
    throw new Error("Configuración de bóveda inválida.");
  }
}
function aad(c: VaultContext) {
  return Buffer.from(
    JSON.stringify([
      "conta-facil:hacienda:v1",
      c.tenantId,
      c.environment,
      c.version,
      c.kind,
    ]),
  );
}
export function encryptCredential(
  payload: Buffer,
  c: VaultContext,
  keyring: Keyring,
): VaultEnvelope {
  const key = keyring.keys[keyring.active];
  if (key?.length !== 32) throw new Error("Bóveda no disponible.");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(c));
  const body = Buffer.concat([cipher.update(payload), cipher.final()]);
  return {
    keyId: keyring.active,
    blob: Buffer.concat([iv, cipher.getAuthTag(), body]),
  };
}
export function decryptCredential(
  e: VaultEnvelope,
  c: VaultContext,
  keyring: Keyring,
): Buffer {
  try {
    const key = keyring.keys[e.keyId];
    if (key?.length !== 32 || e.blob.length < 28) throw 0;
    const d = createDecipheriv("aes-256-gcm", key, e.blob.subarray(0, 12));
    d.setAAD(aad(c));
    d.setAuthTag(e.blob.subarray(12, 28));
    return Buffer.concat([d.update(e.blob.subarray(28)), d.final()]);
  } catch {
    throw new Error("No se pudo abrir la versión protegida.");
  }
}
