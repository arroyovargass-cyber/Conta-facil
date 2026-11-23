export type BootstrapInvitationConfig = {
  tokenHash: string;
  expiresAt: number;
  appOrigin: string;
  email: string;
  claim: () => Promise<boolean>;
  send: (email: string, redirectTo: string) => Promise<void>;
};
export function bootstrapInvitationHandler(config: BootstrapInvitationConfig) {
  const reply = (status: number, code: string) =>
    new Response(JSON.stringify({ code }), {
      status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return reply(405, "METHOD_NOT_ALLOWED");
    const token = request.headers.get("x-conta-bootstrap") ?? "";
    if (Date.now() >= config.expiresAt || !/^[a-f0-9]{64}$/.test(token))
      return reply(401, "UNAUTHORIZED");
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(token),
    );
    const hash = Array.from(new Uint8Array(bytes), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    let difference = hash.length ^ config.tokenHash.length;
    for (let i = 0; i < hash.length; i++)
      difference |= hash.charCodeAt(i) ^ (config.tokenHash.charCodeAt(i) || 0);
    if (difference) return reply(401, "UNAUTHORIZED");
    try {
      if (!(await config.claim())) return reply(409, "ALREADY_ATTEMPTED");
      const redirect = new URL("/invite", config.appOrigin);
      redirect.searchParams.set("invitation", token);
      await config.send(config.email, redirect.toString());
      return reply(200, "INVITATION_SENT");
    } catch {
      return reply(502, "INVITATION_SEND_FAILED_REVIEW_REQUIRED");
    }
  };
}
