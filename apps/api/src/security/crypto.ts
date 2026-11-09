import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
export const randomToken = () => randomBytes(32).toString("hex");
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function seal(data: unknown, key: string) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const body = Buffer.concat([
    c.update(JSON.stringify(data), "utf8"),
    c.final(),
  ]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}
export function unseal<T>(value: string, key: string): T {
  const b = Buffer.from(value, "base64"),
    c = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(key, "hex"),
      b.subarray(0, 12),
    );
  c.setAuthTag(b.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([c.update(b.subarray(28)), c.final()]).toString("utf8"),
  );
}
