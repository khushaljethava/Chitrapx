"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { migrate, type ChitrapxDoc } from "@chitrapx/document";
import { api } from "@/server/api.ts";
import { findElement } from "../commands.ts";
import { idbDel, idbGet, idbKeys, idbSet } from "../idb.ts";
import { channelName, isTabAlive, tabId, type SaveStatus } from "../save.ts";
import type { EditorState, EditorStore } from "../store.ts";
import type { Pending } from "../sync/core.ts";
import { LiveSync, type LiveStatus, type LiveView } from "../sync/engine.ts";
import { BATCH_MAX, type ItemResult, type SubmitResponse } from "../sync/log.ts";
import { diffDocs } from "../sync/patch.ts";
import { openLiveChannel, type ChannelState, type LiveChannel } from "./channel.ts";
import { colorFor, throttle, type PeerCursor, type PeerPresence, type PeerPreview, type PreviewBox } from "./presence.ts";
import { httpTransport } from "./transport.ts";

/** What live mode needs from the solo autosave (save.ts). */
export type AutosaveControl = {
  flush(): Promise<boolean>;
  adoptServerDoc(doc: ChitrapxDoc, revision: number): void;
  pause(): Promise<void>;
  resume(): void;
  discardDraft(): void;
};
export type Me = { userId: string; name: string; avatarUrl: string | null };
type LiveDraft = { clientId: string; pending: Pending[]; seq: number; at: number };

/** Back to solo once alone this long with nothing left to send. */
const LEAVE_AFTER_MS = 10_000;
const POLL_MS = 20_000;
const CURSOR_MS = 60;
const PREVIEW_MS = 80;
const CURSOR_TTL_MS = 10_000;
const PREVIEW_TTL_MS = 3_000;
const draftPrefix = (projectId: string) => `live:${projectId}:`;

function previewBoxes(s: EditorState): PreviewBox[] {
  const g = s.doc.groups.find((x) => x.id === s.activeGroupId);
  if (!g) return [];
  const w = g.boards[0]?.size.width ?? 0;
  return s.selection.flatMap((r) => {
    const el = r.groupId === g.id ? findElement(s.doc, r) : undefined;
    if (!el) return [];
    const offset = r.boardId ? Math.max(0, g.boards.findIndex((b) => b.id === r.boardId)) * w : 0;
    const scale = el.scale || 1;
    return [{ elementId: el.id, x: offset + el.position.x, y: el.position.y, w: el.size.width * scale, h: el.size.height * scale, rotation: el.rotation || 0 }];
  });
}

/**
 * Live co-editing (SP15). Solo editing is today's autosave, untouched. When presence shows another session on
 * the project, the editor switches to live mode: every local command goes to the server's command log
 * (`LiveSync`), other people's commands arrive in server order and rebase what is still pending, and undo
 * becomes per user. Alone again for 10 s with nothing pending, it switches back to solo.
 */
export function useLiveSync(store: EditorStore, autosave: AutosaveControl, me: Me | null, canEdit: boolean) {
  const projectId = store.getState().projectId;
  const [sessionId] = useState(() => crypto.randomUUID());
  const [mode, setMode] = useState<"solo" | "live">("solo");
  const [channelState, setChannelState] = useState<ChannelState>("connecting");
  const [peers, setPeers] = useState<PeerPresence[]>([]);
  const [cursorMap, setCursors] = useState<Record<string, PeerCursor>>({});
  const [previewMap, setPreviews] = useState<Record<string, PeerPreview>>({});
  const [liveStatus, setLiveStatus] = useState<LiveStatus>({ state: "saved" });
  const [notice, setNotice] = useState("");

  const engine = useRef<LiveSync | null>(null);
  const channel = useRef<LiveChannel | null>(null);
  const auto = useRef(autosave);
  const connected = useRef(false);
  const peerCount = useRef(0);
  const entering = useRef(false);
  const aloneSince = useRef<number | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { auto.current = autosave; });
  useEffect(() => { connected.current = channelState === "live"; }, [channelState]);
  useEffect(() => { peerCount.current = peers.length; }, [peers]);

  const draftKey = useCallback(() => `${draftPrefix(projectId)}${tabId()}`, [projectId]);

  const persistDraft = useCallback((sync: LiveSync, pending: Pending[], seq: number) => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      if (pending.length) void idbSet(draftKey(), { clientId: sync.clientId, pending, seq, at: Date.now() } satisfies LiveDraft);
      else void idbDel(draftKey());
    }, 300);
  }, [draftKey]);

  const onRejected = useCallback((results: ItemResult[]) => {
    const why = results[0]?.error ? ` (${results[0].error})` : "";
    setNotice(`${results.length === 1 ? "An edit" : `${results.length} edits`} could not be applied${why}.`);
  }, []);

  /** Hands the editor to the command log. Unsaved solo edits travel as one forced patch from the last saved document. */
  const enterLive = useCallback(async () => {
    // A conflict dialog or a doc job is open: the caller tries again later.
    if (entering.current || engine.current || store.getState().locked) return;
    entering.current = true;
    try {
      await auto.current.pause();
      let s = store.getState();
      if (s.locked) { auto.current.resume(); return; }
      if (s.dirty && !s.savedDoc) {
        // A restored draft whose base is unknown: save it the solo way first.
        auto.current.resume();
        if (!(await auto.current.flush())) return;
        await auto.current.pause();
        s = store.getState();
        if (s.locked || (s.dirty && !s.savedDoc)) { auto.current.resume(); return; }
      }
      // No await from here to setSink: every command the user applies from now on reaches the engine.
      const base = s.dirty ? s.savedDoc! : s.doc;
      const ops = s.dirty ? diffDocs(base, s.doc) : [];
      const sync: LiveSync = new LiveSync({
        clientId: crypto.randomUUID(), doc: base, seq: s.revision, transport: httpTransport(projectId),
        onView: (v: LiveView) => {
          const st = store.getState();
          st.remoteDoc(v.changed ? v.doc : st.doc, { revision: v.seq, dirty: v.dirty });
        },
        onStatus: setLiveStatus,
        onRejected,
        onPending: (pending, seq) => persistDraft(sync, pending, seq),
      });
      if (ops.length) sync.local({ type: "patch", ops, force: true }, { after: s.doc });
      engine.current = sync;
      store.getState().setSink({ local: (cmd, o) => sync.local(cmd, o), gestureEnd: () => sync.gestureEnd() });
      auto.current.discardDraft();
      aloneSince.current = null;
      setLiveStatus(sync.status);
      setMode("live");
      void sync.catchUp();
    } finally {
      entering.current = false;
    }
  }, [store, projectId, onRejected, persistDraft]);

  const leaveLive = useCallback(() => {
    const sync = engine.current;
    if (!sync) return;
    sync.stop();
    engine.current = null;
    const st = store.getState();
    st.setSink(null);
    st.markSaved(sync.seq, st.doc);
    void idbDel(draftKey());
    auto.current.resume();
    setMode("solo");
  }, [store, draftKey]);

  // The project's channels: document events from the server, presence and cursors between members.
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    const ch = openLiveChannel(projectId, sessionId, {
      doc: (e) => engine.current?.receive(e),
      peers: setPeers,
      cursor: (c) => setCursors((m) => ({ ...m, [c.clientId]: c })),
      preview: (p) => setPreviews((m) => ({ ...m, [p.clientId]: p })),
      poke: () => void engine.current?.catchUp(),
      state: (state) => { setChannelState(state); if (state === "live") void engine.current?.catchUp(); },
    });
    channel.current = ch;
    return () => { ch.close(); channel.current = null; };
  }, [projectId, sessionId]);

  // Someone else is here: go live (retrying while a conflict dialog or a doc job holds the editor).
  useEffect(() => {
    if (!(peers.length && channelState === "live" && mode === "solo")) return;
    void enterLive();
    const retry = setInterval(() => void enterLive(), 3000);
    return () => clearInterval(retry);
  }, [peers.length, channelState, mode, enterLive]);

  // Live housekeeping: leave when alone, poll as a safety net, expire stale cursors and previews.
  useEffect(() => {
    if (mode !== "live") return;
    const tick = setInterval(() => {
      const now = Date.now();
      setCursors((m) => Object.fromEntries(Object.entries(m).filter(([, c]) => now - c.at < CURSOR_TTL_MS)));
      setPreviews((m) => Object.fromEntries(Object.entries(m).filter(([, p]) => now - p.at < PREVIEW_TTL_MS)));
      const sync = engine.current;
      if (!sync || !connected.current) return;
      if (peerCount.current > 0) { aloneSince.current = null; return; }
      aloneSince.current ??= now;
      const st = store.getState();
      if (now - aloneSince.current >= LEAVE_AFTER_MS && !sync.dirty && !st.gestureBase && !st.locked) leaveLive();
    }, 2000);
    const poll = setInterval(() => void engine.current?.catchUp(), POLL_MS);
    const online = () => void engine.current?.flush();
    const visible = () => { if (document.visibilityState === "visible") void engine.current?.catchUp(); };
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [mode, store, leaveLive]);

  // Presence: who I am and what I have selected.
  useEffect(() => {
    if (!me) return;
    const color = colorFor(me.userId);
    const publish = throttle(() => {
      const s = store.getState();
      channel.current?.track({
        clientId: sessionId, userId: me.userId, name: me.name, avatarUrl: me.avatarUrl, color, canEdit,
        groupId: s.activeGroupId, boardId: s.activeBoardId,
        selection: s.selection.filter((r) => r.groupId === s.activeGroupId).map((r) => r.elementId),
      });
    }, 200);
    publish();
    const unsub = store.subscribe((s, prev) => {
      if (s.selection !== prev.selection || s.activeGroupId !== prev.activeGroupId || s.activeBoardId !== prev.activeBoardId) publish();
    });
    return () => { unsub(); publish.cancel(); };
  }, [store, me, canEdit, sessionId]);

  // Drag previews: the dragged boxes, throttled, cleared when the gesture ends. The command itself is sent at the end.
  useEffect(() => {
    const send = throttle((s: EditorState) => channel.current?.sendPreview({ groupId: s.activeGroupId, boxes: previewBoxes(s) }), PREVIEW_MS);
    const unsub = store.subscribe((s, prev) => {
      if (!peerCount.current) return;
      if (s.gestureBase && s.doc !== prev.doc) send(s);
      else if (!s.gestureBase && prev.gestureBase) { send.cancel(); channel.current?.sendPreview({ groupId: s.activeGroupId, boxes: [] }); }
    });
    return () => { unsub(); send.cancel(); };
  }, [store]);

  // Commands a closed or reloaded tab never got to send: submit them (idempotent), then load the result.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const keys = await idbKeys(draftPrefix(projectId));
      if (!keys.length) return;
      const bc = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(channelName(projectId));
      let applied = 0, refused = 0;
      for (const k of keys) {
        if (k !== draftKey() && (!bc || (await isTabAlive(bc, k.slice(draftPrefix(projectId).length))))) continue;
        const d = await idbGet<LiveDraft>(k);
        if (!d?.pending?.length || !d.clientId) { await idbDel(k); continue; }
        try {
          for (let i = 0; i < d.pending.length; i += BATCH_MAX) {
            const res = await api<SubmitResponse>(`/api/projects/${projectId}/commands`, "POST",
              { clientId: d.clientId, after: store.getState().revision, commands: d.pending.slice(i, i + BATCH_MAX) });
            applied += res.results.filter((r) => r.seq !== undefined).length;
            refused += res.results.filter((r) => r.error).length;
          }
          await idbDel(k);
        } catch { /* offline or refused: keep the draft for the next load */ }
      }
      bc?.close();
      if (cancelled || !(applied || refused)) return;
      const st = store.getState();
      if (engine.current) void engine.current.catchUp();
      else if (!st.dirty && !st.locked) {
        const project = await api<{ doc: unknown; revision: number }>(`/api/projects/${projectId}`);
        auto.current.adoptServerDoc(migrate(project.doc), project.revision);
      }
      setNotice(`Recovered ${applied} unsaved ${applied === 1 ? "edit" : "edits"}${refused ? `; ${refused} could not be applied` : ""}.`);
    })();
    return () => { cancelled = true; };
  }, [store, projectId, draftKey]);

  useEffect(() => () => { engine.current?.stop(); if (draftTimer.current) clearTimeout(draftTimer.current); }, []);

  /** Saves everything now (solo: the whole document; live: the outbox). */
  const flush = useCallback(() => (engine.current ? engine.current.flush() : auto.current.flush()), []);
  /** The server's document is now current (doc job, restore). Live peers are told to catch up. */
  const adoptServerDoc = useCallback((doc: ChitrapxDoc, revision: number) => {
    const sync = engine.current;
    if (!sync) { auto.current.adoptServerDoc(doc, revision); return; }
    sync.reset(doc, revision);
    store.getState().replaceDoc(doc, revision, false);
    channel.current?.poke();
  }, [store]);
  /** A solo save hit 409 while Realtime is up: someone else is editing, so hand the unsaved changes to live mode. */
  const onConflict = useCallback(() => {
    // Without a known saved base (a restored draft) the usual conflict choice stays.
    if (!connected.current || engine.current || !store.getState().savedDoc) return false;
    void enterLive();
    return true;
  }, [store, enterLive]);

  const sendCursor = useMemo(() => throttle((groupId: string, x: number, y: number) => {
    if (peerCount.current) channel.current?.sendCursor({ groupId, x, y });
  }, CURSOR_MS), []);

  const status: SaveStatus | null = mode !== "live" ? null
    : liveStatus.state === "stopped" || liveStatus.state === "error" ? "error"
      : liveStatus.state === "offline" ? "offline"
        : channelState === "down" ? "reconnecting" : liveStatus.state;
  const present = useMemo(() => new Set(peers.map((p) => p.clientId)), [peers]);
  const cursors = useMemo(() => Object.values(cursorMap).filter((c) => present.has(c.clientId)), [cursorMap, present]);
  const previews = useMemo(() => Object.values(previewMap).filter((p) => present.has(p.clientId) && p.boxes.length), [previewMap, present]);

  return {
    mode, status, error: liveStatus.message ?? "", notice, dismissNotice: () => setNotice(""),
    peers, cursors, previews, sendCursor, flush, adoptServerDoc, onConflict,
  };
}
