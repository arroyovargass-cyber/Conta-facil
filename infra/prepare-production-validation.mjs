import { execFileSync } from "node:child_process";
// Render's existing build command runs npm run build. Install the pinned offline
// validation engine as a build artifact, never on a customer request/startup.
if (process.env.NODE_ENV === "production") {
  execFileSync(process.execPath, ["infra/prepare-xml-validator.mjs"], {
    stdio: "inherit",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8" },
  });
}
