let csrf = "";
let sessionVersion = 0;
const expiredListeners = new Set<() => void>();
export function setCsrf(value: string) {
  if (value !== csrf) sessionVersion++;
  csrf = value;
}
export function onSessionExpired(listener: () => void) {
  expiredListeners.add(listener);
  return () => {
    expiredListeners.delete(listener);
  };
}
const publicAuth = new Set([
  "/auth/login",
  "/auth/recover",
  "/auth/reset",
  "/auth/invitations/accept",
]);
export async function apiRequest<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const version = sessionVersion;
  const response = await fetch("/api" + path, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.method && options.method !== "GET"
        ? { "X-CSRF-Token": csrf }
        : {}),
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) {
    if (
      response.status === 401 &&
      !publicAuth.has(path.split("?")[0]) &&
      version === sessionVersion &&
      csrf
    ) {
      setCsrf("");
      for (const listener of expiredListeners) listener();
    }
    throw Object.assign(
      new Error(data.message ?? "No se pudo completar la operación."),
      { status: response.status },
    );
  }
  return data;
}
export const post = (path: string, data: unknown, method = "POST") =>
  apiRequest(path, { method, body: JSON.stringify(data) });
