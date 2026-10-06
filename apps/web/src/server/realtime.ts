import type { LogEntry } from "@/editor/sync/log.ts";
import { SUPABASE_URL } from "@/lib/supabase/env.ts";

/**
 * Server-side Supabase Realtime broadcast (SP15). Document events go to the private `project:<id>` topic,
 * which only the service role can publish to (migration 0015 gives clients no insert policy there), so a
 * client can never forge a document change. Peers treat every event as a hint and confirm over HTTP.
 */
export type Broadcaster = (topic: string, event: string, payload: unknown) => Promise<void>;

export const docTopic = (projectId: string) => `project:${projectId}`;
export const liveTopic = (projectId: string) => `project-live:${projectId}`;
/** Larger command payloads are announced by head only; peers fetch them. */
export const MAX_BROADCAST_BYTES = 100_000;

/** The Realtime REST broadcast endpoint. Never throws: a lost broadcast only delays peers until they catch up. */
export function restBroadcaster(opts: { url: string; key: string; fetch?: typeof fetch; timeoutMs?: number }): Broadcaster {
  const doFetch = opts.fetch ?? fetch;
  return async (topic, event, payload) => {
    try {
      const res = await doFetch(`${opts.url}/realtime/v1/api/broadcast`, {
        method: "POST",
        headers: { apikey: opts.key, authorization: `Bearer ${opts.key}`, "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ topic, event, payload, private: true }] }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 3000),
      });
      if (!res.ok) console.warn(`realtime broadcast ${topic} ${event}: HTTP ${res.status}`);
    } catch (err) {
      console.warn(`realtime broadcast ${topic} ${event}: ${err instanceof Error ? err.message : err}`);
    }
  };
}

/** The app's broadcaster: the service-role key, server side only. A no-op when Supabase is not configured. */
export const broadcast: Broadcaster = (topic, event, payload) => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !SUPABASE_URL) return Promise.resolve();
  return restBroadcaster({ url: SUPABASE_URL, key })(topic, event, payload);
};

/** New log entries, after commit. */
export function broadcastEntries(projectId: string, head: number, entries: LogEntry[], send: Broadcaster = broadcast): Promise<void> {
  const payload = { entries };
  if (Buffer.byteLength(JSON.stringify(payload)) > MAX_BROADCAST_BYTES) return send(docTopic(projectId), "head", { head });
  return send(docTopic(projectId), "commands", payload);
}

/** A whole-document write (solo save, restore): peers catch up and take a snapshot. */
export function broadcastHead(projectId: string, head: number, send: Broadcaster = broadcast): Promise<void> {
  return send(docTopic(projectId), "head", { head });
}
