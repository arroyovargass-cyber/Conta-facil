import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
// Official openssl/openssl security snapshot. This is NOT a stable release.
const revision = "84dda7853c130429210b37bee9e5b62366ca8bce";
const source = resolve(".local/openssl-src"),
  prefix = resolve(".local/openssl");
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
mkdirSync(source, { recursive: true, mode: 0o700 });
if (!existsSync(resolve(source, ".git"))) run("git", ["init"], source);
run(
  "git",
  ["fetch", "--depth=1", "https://github.com/openssl/openssl.git", revision],
  source,
);
run("git", ["checkout", "--detach", revision], source);
const actual = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: source,
  encoding: "utf8",
}).trim();
if (actual !== revision) throw Error("OpenSSL source revision mismatch");
run(
  "./Configure",
  [
    `--prefix=${prefix}`,
    `--openssldir=${prefix}/ssl`,
    "no-shared",
    "no-tests",
    "no-docs",
    "no-module",
    "enable-legacy",
  ],
  source,
);
run("make", ["-j2", "build_sw"], source);
run("make", ["install_sw"], source);
const version = execFileSync(resolve(prefix, "bin/openssl"), ["version"], {
  encoding: "utf8",
});
if (!version.startsWith("OpenSSL 3.5.10-dev "))
  throw Error("Unexpected OpenSSL version");
console.log(
  "Pinned OpenSSL development security snapshot prepared; production validation remains required.",
);
