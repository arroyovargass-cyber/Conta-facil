const endpoint =
  "https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/";
export type ProbeResult = {
  status: "success" | "authentication_failed" | "service_unavailable";
  sessionClosed: boolean;
};
export interface IdpClient {
  probe(access: { username: string; password: string }): Promise<ProbeResult>;
}
export class HaciendaIdp implements IdpClient {
  private transport: typeof fetch;
  private timeout: number;
  constructor(options: {
    environment: string;
    transport?: typeof fetch;
    timeoutMs?: number;
  }) {
    if (
      options.environment !== "test" &&
      (options.transport || options.timeoutMs !== undefined)
    )
      throw Error(
        "Las sustituciones de transporte solo se admiten en pruebas.",
      );
    this.transport = options.transport ?? fetch;
    this.timeout = options.timeoutMs ?? 10000;
  }
  private async responseBody(response: Response) {
    const reader = response.body?.getReader();
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > 65536) throw Error("Response limit");
        chunks.push(value);
      }
      return Buffer.concat(chunks).toString("utf8");
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  async probe(access: {
    username: string;
    password: string;
  }): Promise<ProbeResult> {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), this.timeout);
    const post = (path: string, body: URLSearchParams) =>
      this.transport(endpoint + path, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body,
        redirect: "error",
        signal: controller.signal,
      });
    try {
      const response = await post(
        "token",
        new URLSearchParams({
          grant_type: "password",
          client_id: "api-stag",
          username: access.username,
          password: access.password,
        }),
      );
      const data = JSON.parse(await this.responseBody(response));
      if (!response.ok)
        return {
          status:
            [400, 401].includes(response.status) &&
            data.error === "invalid_grant"
              ? "authentication_failed"
              : "service_unavailable",
          sessionClosed: false,
        };
      if (
        typeof data.access_token !== "string" ||
        !data.access_token ||
        typeof data.refresh_token !== "string" ||
        !data.refresh_token
      )
        return { status: "service_unavailable", sessionClosed: false };
      try {
        const logout = await post(
          "logout",
          new URLSearchParams({
            client_id: "api-stag",
            refresh_token: data.refresh_token,
          }),
        );
        await this.responseBody(logout);
        return { status: "success", sessionClosed: logout.ok };
      } catch {
        return { status: "success", sessionClosed: false };
      } finally {
        data.access_token = "";
        data.refresh_token = "";
      }
    } catch {
      return { status: "service_unavailable", sessionClosed: false };
    } finally {
      clearTimeout(timer);
    }
  }
}
