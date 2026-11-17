import { createHmac } from "node:crypto";
export function csrfForSession(cookie: string, key: string): string {
  return createHmac("sha256", Buffer.from(key, "hex"))
    .update("conta-facil:csrf:" + cookie)
    .digest("hex");
}
