import { TransportError, type SyncTransport } from "../sync/engine.ts";

/** The command log over HTTP (`/api/projects/:id/commands`). Realtime only accelerates; this is the source of truth. */
export function httpTransport(projectId: string): SyncTransport {
  const base = `/api/projects/${projectId}/commands`;
  async function call<T>(url: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try { res = await fetch(url, init); } catch (err) { throw new TransportError(null, err instanceof Error ? err.message : "offline"); }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new TransportError(res.status, body.message ?? body.error ?? `HTTP ${res.status}`);
    return body as T;
  }
  return {
    submit: (body) => call(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    fetchSince: (after, clientId) => call(`${base}?${new URLSearchParams({ after: String(after), clientId })}`),
  };
}
