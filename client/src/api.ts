export interface TmuxSession {
  name: string;
  created: number;
  attached: boolean;
  windows: number;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request to ${url} failed with ${res.status}`);
  }
  return res.json();
}

export const api = {
  checkSession: () => request<{ authenticated: boolean }>("/api/session-check"),
  login: (password: string) =>
    request<{ ok: true }>("/api/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => request<{ ok: true }>("/api/logout", { method: "POST" }),
  listSessions: () => request<{ sessions: TmuxSession[] }>("/api/sessions"),
  createSession: (name?: string) =>
    request<{ ok: true; name: string }>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  renameSession: (name: string, newName: string) =>
    request<{ ok: true }>(`/api/sessions/${encodeURIComponent(name)}`, {
      method: "PATCH",
      body: JSON.stringify({ newName }),
    }),
  killSession: (name: string) =>
    request<{ ok: true }>(`/api/sessions/${encodeURIComponent(name)}`, { method: "DELETE" }),
};

export function terminalSocketUrl(name: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/terminal/${encodeURIComponent(name)}`;
}

export function sessionsSocketUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/sessions`;
}
