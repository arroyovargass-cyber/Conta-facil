import { readFileSync, writeFileSync, statSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
const filename = ".env";
const text = readFileSync(filename, "utf8");
const values = Object.fromEntries(
  text
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^(['"])(.*)\1$/, "$2")];
    }),
);
for (const key of ["SUPABASE_URL", "APP_ORIGIN"]) {
  const u = new URL(values[key]);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))
    throw Error("Local vault keys require localhost configuration");
}
const hasRing = !!values.HACIENDA_KEYRING,
  hasActive = !!values.HACIENDA_ACTIVE_KEY_ID;
if (hasRing !== hasActive)
  throw Error(
    "Partial vault configuration; resolve it without replacing existing keys",
  );
if (hasRing) {
  console.log("Existing vault configuration preserved.");
} else {
  const key = randomBytes(32).toString("hex");
  writeFileSync(
    filename,
    text +
      `\nHACIENDA_ACTIVE_KEY_ID=local-v1\nHACIENDA_KEYRING='${JSON.stringify({ "local-v1": key })}'\n`,
    { mode: 0o600 },
  );
  chmodSync(filename, statSync(filename).mode & 0o600);
  console.log("Local vault key created; no secret was printed.");
}
