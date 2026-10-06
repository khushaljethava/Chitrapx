"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/browser.ts";
import type { LiveEvent } from "../sync/engine.ts";
import type { LogEntry } from "../sync/log.ts";
import { parseCursor, parsePreview, peersFrom, type PeerCursor, type PeerPresence, type PeerPreview, type PreviewBox } from "./presence.ts";

export type ChannelState = "connecting" | "live" | "down";
export type LiveChannel = {
  track(me: PeerPresence): void;
  sendCursor(c: { groupId: string; x: number; y: number }): void;
  sendPreview(p: { groupId: string; boxes: PreviewBox[] }): void;
  /** Tells peers to catch up (after a doc job rewrote the document). Carries no data. */
  poke(): void;
  close(): void;
};

/**
 * The project's two private Realtime channels (SP15). `project:<id>` only ever carries events the server
 * sent with the service role (clients have no insert policy there); `project-live:<id>` carries presence,
 * cursors and drag previews between members. Both require membership (migration 0015's policies).
 */
export function openLiveChannel(projectId: string, clientId: string, on: {
  doc(e: LiveEvent): void;
  peers(peers: PeerPresence[]): void;
  cursor(c: PeerCursor): void;
  preview(p: PeerPreview): void;
  poke(): void;
  state(s: ChannelState): void;
}): LiveChannel {
  const supabase = createClient();
  let closed = false;
  let me: PeerPresence | null = null;
  const joined = { doc: false, live: false };
  const report = () => on.state(joined.doc && joined.live ? "live" : "down");

  const doc: RealtimeChannel = supabase.channel(`project:${projectId}`, { config: { private: true } })
    .on("broadcast", { event: "commands" }, ({ payload }) => {
      const entries = (payload as { entries?: unknown })?.entries;
      if (Array.isArray(entries)) on.doc({ type: "commands", entries: entries as LogEntry[] });
    })
    .on("broadcast", { event: "head" }, ({ payload }) => {
      const head = (payload as { head?: unknown })?.head;
      if (typeof head === "number") on.doc({ type: "head", head });
    });

  const live: RealtimeChannel = supabase.channel(`project-live:${projectId}`, {
    config: { private: true, presence: { key: clientId }, broadcast: { self: false } },
  })
    .on("presence", { event: "sync" }, () => on.peers(peersFrom(live.presenceState() as Record<string, unknown[]>, clientId)))
    .on("broadcast", { event: "cursor" }, ({ payload }) => { const c = parseCursor(payload); if (c && c.clientId !== clientId) on.cursor(c); })
    .on("broadcast", { event: "preview" }, ({ payload }) => { const p = parsePreview(payload); if (p && p.clientId !== clientId) on.preview(p); })
    .on("broadcast", { event: "poke" }, () => on.poke());

  const watch = (key: keyof typeof joined) => (status: string) => {
    if (closed) return;
    joined[key] = status === "SUBSCRIBED";
    if (key === "live" && joined.live && me) void live.track(me);
    report();
  };

  on.state("connecting");
  void (async () => {
    // Private channels authorise with the user's JWT (Realtime checks realtime.messages policies on join).
    await supabase.realtime.setAuth().catch(() => {});
    if (closed) return;
    doc.subscribe(watch("doc"));
    live.subscribe(watch("live"));
  })();

  const send = (event: string, payload: Record<string, unknown>) => {
    if (closed || !joined.live) return;
    void live.send({ type: "broadcast", event, payload: { ...payload, clientId } });
  };

  return {
    track(next) { me = next; if (joined.live && !closed) void live.track(next); },
    sendCursor: (c) => send("cursor", c),
    sendPreview: (p) => send("preview", p),
    poke: () => send("poke", {}),
    close() {
      closed = true;
      void supabase.removeChannel(doc);
      void supabase.removeChannel(live);
    },
  };
}
