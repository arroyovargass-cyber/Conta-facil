import { randomBytes, createHmac } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
if (existsSync(".env")) {
  console.log("Existing .env preserved");
  process.exit(0);
}
const secret = randomBytes(32).toString("hex");
const jwt = (role) => {
  const header = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" }),
    ).toString("base64url"),
    payload = Buffer.from(
      JSON.stringify({
        role,
        iss: "supabase",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 31536000,
      }),
    ).toString("base64url");
  return (
    header +
    "." +
    payload +
    "." +
    createHmac("sha256", secret)
      .update(header + "." + payload)
      .digest("base64url")
  );
};
writeFileSync(
  ".env",
  `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres\nSUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_ANON_KEY=${jwt("anon")}\nSUPABASE_SERVICE_KEY=${jwt("service_role")}\nLOCAL_JWT_SECRET=${secret}\nSESSION_KEY=${randomBytes(32).toString("hex")}\nAPP_ORIGIN=http://localhost:5173\nPORT=3001\n`,
  { mode: 0o600 },
);
console.log("Local .env created without printing secrets");
