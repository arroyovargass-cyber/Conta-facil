import { it, expect } from "vitest";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createApp } from "../../apps/api/src/app";
import { loadConfig } from "../../apps/api/src/config";
it("bootstraps a first administrator through the actual emailed verification link", async () => {
  const config = loadConfig(),
    app = await createApp(config),
    tag = randomBytes(6).toString("hex"),
    email = "bootstrap-" + tag + "@example.test";
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "apps/api/scripts/bootstrap.ts"],
        { stdio: ["pipe", "ignore", "pipe"] },
      );
      let err = "";
      child.stderr.on("data", (v) => (err += v));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(err)),
      );
      child.stdin.end(
        JSON.stringify({
          email,
          name: "Bootstrap test",
          legal_name: "Bootstrap " + tag,
          identification_type: "other",
          identification: tag,
        }),
      );
    });
    const mailbox = await (
      await fetch("http://127.0.0.1:54324/api/v1/messages")
    ).json();
    const summary = mailbox.messages.find((m: any) =>
      m.To.some((t: any) => t.Address === email),
    );
    expect(summary).toBeDefined();
    const message = await (
      await fetch("http://127.0.0.1:54324/api/v1/message/" + summary.ID)
    ).json();
    const href = message.HTML.match(/href="([^"]+)"/)[1].replaceAll(
      "&amp;",
      "&",
    );
    const link = new URL(href);
    expect(link.pathname).toBe("/auth/v1/verify");
    const verified = await fetch(link, { redirect: "manual" });
    expect(verified.status).toBe(303);
    const destination = new URL(verified.headers.get("location")!);
    expect(destination.pathname).toBe("/invite");
    const tokens = new URLSearchParams(destination.hash.slice(1));
    expect(tokens.get("access_token")).toBeTruthy();
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/invitations/accept",
      remoteAddress: "127.24.1." + ((parseInt(tag.slice(0, 2), 16) % 250) + 1),
      headers: { origin: config.APP_ORIGIN },
      payload: {
        token: destination.searchParams.get("invitation"),
        access_token: tokens.get("access_token"),
        country: "CR",
        type: "other",
        identification: tag,
        name: "Bootstrap administrator",
        password: randomBytes(20).toString("hex") + "aA!",
      },
    });
    expect(response.statusCode, response.body).toBe(200);
  } finally {
    await app.close();
  }
});
