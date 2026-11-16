import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
export async function syntheticPkcs12({
  pin,
  bits = 2048,
  legacy = false,
  certificateOnly = false,
  noMac = false,
  algorithm = "rsa",
}: {
  pin: string;
  bits?: number;
  legacy?: boolean;
  certificateOnly?: boolean;
  noMac?: boolean;
  algorithm?: "rsa" | "ec";
}) {
  const directory = await mkdtemp(join(tmpdir(), "conta-synthetic-"));
  const binary = resolve(".local/openssl/bin/openssl");
  const run = (args: string[], secret?: string) =>
    new Promise<void>((ok, fail) => {
      const p = spawn(binary, args, {
        stdio: ["ignore", "ignore", "ignore", "pipe"],
      });
      p.on("error", fail);
      p.on("close", (c) =>
        c === 0 ? ok() : fail(Error("Synthetic fixture generation failed")),
      );
      if (secret !== undefined)
        (p.stdio[3] as import("node:stream").Writable).end(secret + "\n");
    });
  try {
    await run([
      "req",
      "-config",
      "/dev/null",
      "-x509",
      "-newkey",
      algorithm === "rsa" ? `rsa:${bits}` : "ec",
      ...(algorithm === "ec" ? ["-pkeyopt", "ec_paramgen_curve:P-256"] : []),
      "-nodes",
      "-keyout",
      join(directory, "key"),
      "-out",
      join(directory, "cert"),
      "-days",
      "1",
      "-subj",
      "/CN=SYNTHETIC TEST ONLY",
    ]);
    await run(
      [
        "pkcs12",
        "-export",
        ...(noMac ? ["-nomac"] : []),
        ...(legacy ? ["-legacy"] : []),
        ...(certificateOnly ? ["-nokeys"] : ["-inkey", join(directory, "key")]),
        "-in",
        join(directory, "cert"),
        "-out",
        join(directory, "fixture"),
        "-passout",
        "fd:3",
      ],
      pin,
    );
    return await readFile(join(directory, "fixture"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
