const endpoint =
  "https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/";
export class TokenSessionError extends Error {
  constructor(readonly code: "AUTHENTICATION_FAILED" | "SERVICE_UNAVAILABLE") {
    super(code);
    this.name = "TokenSessionError";
  }
}
export class HaciendaTokenSession {
  private transport: typeof fetch;
  private timeout: number;
  constructor(options: {
    environment: string;
    transport?: typeof fetch;
    timeoutMs?: number;
  }) {
    if (
      options.environment !== "test" &&
      (options.transport !== undefined || options.timeoutMs !== undefined)
    )
      throw Error("Transport overrides are test-only");
    this.transport = options.transport ?? fetch;
    this.timeout = options.timeoutMs ?? 10000;
    if (
      !Number.isFinite(this.timeout) ||
      this.timeout <= 0 ||
      this.timeout > 60000
    )
      throw Error("Invalid timeout");
  }
  private async read(response: Response) {
    const reader = response.body?.getReader();
    if (!reader) return "";
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 65536) throw new TokenSessionError("SERVICE_UNAVAILABLE");
        chunks.push(value);
      }
      return new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(chunks),
      );
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  private async post(
    path: "token" | "logout",
    body: URLSearchParams,
  ): Promise<{ status: number; text: string }> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await this.transport(endpoint + path, {
            method: "POST",
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              accept: "application/json",
            },
            body,
            redirect: "error",
            signal: controller.signal,
          });
          return { status: response.status, text: await this.read(response) };
        })(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new TokenSessionError("SERVICE_UNAVAILABLE"));
          }, this.timeout);
        }),
      ]);
    } catch {
      throw new TokenSessionError("SERVICE_UNAVAILABLE");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async withAccess<T>(
    access: { username: string; password: string },
    use: (token: string) => Promise<T>,
  ): Promise<T> {
    let accessToken = "",
      refreshToken = "";
    try {
      const response = await this.post(
        "token",
        new URLSearchParams({
          grant_type: "password",
          client_id: "api-stag",
          username: access.username,
          password: access.password,
        }),
      );
      let data: unknown;
      try {
        data = JSON.parse(response.text);
      } catch {
        throw new TokenSessionError("SERVICE_UNAVAILABLE");
      }
      if (!data || typeof data !== "object")
        throw new TokenSessionError("SERVICE_UNAVAILABLE");
      const record = data as Record<string, unknown>;
      if (response.status < 200 || response.status >= 300)
        throw new TokenSessionError(
          [400, 401].includes(response.status) &&
            record.error === "invalid_grant"
            ? "AUTHENTICATION_FAILED"
            : "SERVICE_UNAVAILABLE",
        );
      const valid = (value: unknown): value is string =>
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 16384 &&
        !/\s/.test(value);
      if (!valid(record.access_token) || !valid(record.refresh_token))
        throw new TokenSessionError("SERVICE_UNAVAILABLE");
      accessToken = record.access_token;
      refreshToken = record.refresh_token;
      record.access_token = "";
      record.refresh_token = "";
      return await use(accessToken);
    } finally {
      try {
        if (refreshToken)
          await this.post(
            "logout",
            new URLSearchParams({
              client_id: "api-stag",
              refresh_token: refreshToken,
            }),
          );
      } catch {
        /* Best-effort closure must preserve the caller's result or error. */
      } finally {
        accessToken = "";
        refreshToken = "";
      }
    }
  }
}
