import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
try {
  const output = execFileSync(
    resolve(".local/openssl/bin/openssl"),
    ["version"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 },
  );
  const match = output.match(/^OpenSSL 3\.5\.(\d+)/);
  if (!match || Number(match[1]) < 10) throw Error();
} catch {
  throw Error(
    "Required local OpenSSL inspector unavailable. Run npm run openssl:prepare before building.",
  );
}
