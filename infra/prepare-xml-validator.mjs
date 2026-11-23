import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

execFileSync("python3", ["-m", "venv", ".local/xmlschema-env"], {
  stdio: "inherit",
});
execFileSync(
  resolve(".local/xmlschema-env/bin/python"),
  [
    "-m",
    "pip",
    "install",
    "--require-hashes",
    "--only-binary=:all:",
    "--cache-dir",
    resolve(".local/pip-cache"),
    "-r",
    "infra/xml-validator-requirements.txt",
  ],
  { stdio: "inherit" },
);
