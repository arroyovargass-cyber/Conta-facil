import { createHash } from "node:crypto";
import { it, expect } from "vitest";
import { bootstrapInvitationHandler } from "../infra/operations/bootstrap-invitation";
const token = "a".repeat(64);
const tokenHash = createHash("sha256").update(token).digest("hex");
const request = (t = token) =>
  new Request("https://example.test", {
    method: "POST",
    headers: { "x-conta-bootstrap": t },
  });
it("does not claim or send for invalid or expired capabilities", async () => {
  let claims = 0;
  const config = {
    tokenHash,
    expiresAt: Date.now() + 60000,
    appOrigin: "https://app.example.test",
    email: "owner@example.test",
    claim: async () => {
      claims++;
      return true;
    },
    send: async () => {
      throw Error("Must not send");
    },
  };
  expect(
    (await bootstrapInvitationHandler(config)(request("b".repeat(64)))).status,
  ).toBe(401);
  expect(
    (await bootstrapInvitationHandler({ ...config, expiresAt: 0 })(request()))
      .status,
  ).toBe(401);
  expect(claims).toBe(0);
});
it("sends only after a successful persistent claim and uses the fixed recipient and application", async () => {
  let attempted = false;
  const sent: { email: string; redirect: string }[] = [];
  const handler = bootstrapInvitationHandler({
    tokenHash,
    expiresAt: Date.now() + 60000,
    appOrigin: "https://app.example.test",
    email: "owner@example.test",
    claim: async () => {
      if (attempted) return false;
      attempted = true;
      return true;
    },
    send: async (email, redirect) => {
      sent.push({ email, redirect });
    },
  });
  expect((await handler(request())).status).toBe(200);
  expect((await handler(request())).status).toBe(409);
  expect(sent).toEqual([
    {
      email: "owner@example.test",
      redirect: "https://app.example.test/invite?invitation=" + token,
    },
  ]);
});
it("does not leak provider errors or tokens and does not repeat an uncertain send", async () => {
  let attempted = false;
  const handler = bootstrapInvitationHandler({
    tokenHash,
    expiresAt: Date.now() + 60000,
    appOrigin: "https://app.example.test",
    email: "owner@example.test",
    claim: async () => {
      if (attempted) return false;
      attempted = true;
      return true;
    },
    send: async () => {
      throw Error("SECRET_PROVIDER_DETAIL " + token);
    },
  });
  const failed = await handler(request());
  expect(failed.status).toBe(502);
  expect(await failed.text()).not.toContain("SECRET_PROVIDER_DETAIL");
  expect((await handler(request())).status).toBe(409);
});
