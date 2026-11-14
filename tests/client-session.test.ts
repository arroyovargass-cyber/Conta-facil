import { afterEach, it, expect, vi } from "vitest";
import {
  apiRequest,
  setCsrf,
  onSessionExpired,
} from "../apps/web/src/api/client";
afterEach(() => {
  vi.unstubAllGlobals();
  setCsrf("");
});
it("notifies the app and clears CSRF when a protected request loses its session", async () => {
  let notified = 0;
  const stop = onSessionExpired(() => notified++);
  setCsrf("old");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Sesión vencida" }), {
        status: 401,
      }),
    ),
  );
  await expect(apiRequest("/companies")).rejects.toMatchObject({ status: 401 });
  expect(notified).toBe(1);
  stop();
});
it("does not sign out the app for a rejected login", async () => {
  let notified = 0;
  const stop = onSessionExpired(() => notified++);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Credenciales incorrectas" }), {
        status: 401,
      }),
    ),
  );
  await expect(
    apiRequest("/auth/login", { method: "POST" }),
  ).rejects.toMatchObject({ status: 401 });
  expect(notified).toBe(0);
  stop();
});
it("discards a stale unauthorized response after a new login establishes a different session", async () => {
  let notified = 0;
  const stop = onSessionExpired(() => notified++);
  let finish!: (response: Response) => void;
  setCsrf("old");
  vi.stubGlobal("fetch", () => new Promise<Response>((r) => (finish = r)));
  const pending = apiRequest("/companies");
  setCsrf("new");
  finish(
    new Response(JSON.stringify({ message: "Old expired request" }), {
      status: 401,
    }),
  );
  await expect(pending).rejects.toMatchObject({ status: 401 });
  expect(notified).toBe(0);
  stop();
});
