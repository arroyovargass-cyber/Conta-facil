import { it, expect } from "vitest";
import { randomInt } from "node:crypto";
import { createApp } from "../../apps/api/src/app";
import { loadConfig } from "../../apps/api/src/config";
it("shares one account limit across equivalent identification formats and application instances", async () => {
  const a = await createApp(loadConfig()),
    b = await createApp(loadConfig()),
    id = "9" + randomInt(10000000, 99999999).toString();
  try {
    for (let i = 0; i < 9; i++) {
      const identification =
        i % 3 === 0
          ? id
          : i % 3 === 1
            ? id.slice(0, 3) + "-" + id.slice(3)
            : id.slice(0, 3) + " " + id.slice(3);
      const r = await (i % 2 ? a : b).inject({
        method: "POST",
        url: "/api/auth/login",
        remoteAddress: "127.22.1." + (i + 1),
        headers: { origin: loadConfig().APP_ORIGIN },
        payload: {
          country: "CR",
          type: "national",
          identification,
          password: "WrongPassword123!",
        },
      });
      expect(r.statusCode).toBe(i === 8 ? 429 : 401);
    }
  } finally {
    await a.close();
    await b.close();
  }
});
