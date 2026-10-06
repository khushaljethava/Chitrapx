"use client";

import { useEffect, useRef, useState } from "react";
import { migrate, type ChitrapxDoc } from "@chitrapx/document";
import { idbDel, idbGet, idbKeys, idbSet } from "./idb.ts";
import type { EditorStore } from "./store.ts";

export type SaveStatus = "saved" | "saving" | "unsaved" | "offline" | "conflict" | "error" | "reconnecting";
export type Draft = { doc: ChitrapxDoc; revision: number; at: number };
type Conflict = { serverRevision: number; source: "save" | "draft"; draft?: Draft; draftKey?: string };

const SAVE_DELAY_MS = 1500;
const RETRY_MS = 5000;
const DRAFT_DELAY_MS = 300;

/** Each tab keeps its own draft, so tabs never restore or erase each other's unsaved work. */
export function tabId(): string {
  try {
    let id = sessionStorage.getItem("chitrapx-tab");
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem("chitrapx-tab", id); }
    return id;
  } catch { return crypto.randomUUID(); }
}
const prefix = (projectId: string) => `project:${projectId}:`;
/** The tabs-of-this-project channel; every open editor answers pings for its own tab id. */
export const channelName = (projectId: string) => `chitrapx:${projectId}`;

/** Asks open tabs whether `tab` is still alive; a draft from a dead tab is offered back to the user. */
export function isTabAlive(channel: BroadcastChannel, tab: string): Promise<boolean> {
  return new Promise((resolve) => {
    const onMsg = (e: MessageEvent) => { if (e.data?.type === "alive" && e.data.tab === tab) { channel.removeEventListener("message", onMsg); resolve(true); } };
    channel.addEventListener("message", onMsg);
    channel.postMessage({ type: "ping", tab });
    setTimeout(() => { channel.removeEventListener("message", onMsg); resolve(false); }, 400);
  });
}

/**
 * Saves 1.5 s after the last change. Unsaved documents live in IndexedDB (per tab) until the server
 * has them. A document the server rejects is not retried until it changes; network failures retry
 * every 5 s. A conflict locks the editor until the user chooses.
 *
 * Live co-editing (SP15) pauses all of this while edits go to the server as commands, and may take over a
 * 409 (`onConflict` returns true) by handing the unsaved changes to live mode instead of showing the dialog.
 */
export function useAutosave(store: EditorStore, opts?: { onConflict?: (serverRevision: number) => boolean }) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const paused = useRef(false);
  const onConflict = useRef(opts?.onConflict);
  useEffect(() => { onConflict.current = opts?.onConflict; });
  const rejected = useRef<ChitrapxDoc | null>(null);
  const tab = useRef("");
  const key = () => `${prefix(store.getState().projectId)}${tab.current}`;

  function block(c: Conflict) {
    store.getState().setLocked(true);
    setConflict(c);
    setStatus("conflict");
  }

  function writeDraft() {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      const s = store.getState();
      if (s.dirty && !s.locked) void idbSet(key(), { doc: s.doc, revision: s.revision, at: Date.now() } satisfies Draft);
    }, DRAFT_DELAY_MS);
  }

  function schedule(ms = SAVE_DELAY_MS) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, ms);
  }

  async function save() {
    const s = store.getState();
    if (paused.current || !s.dirty || inFlight.current || s.locked || s.doc === rejected.current) return;
    inFlight.current = true;
    setStatus("saving");
    const doc = s.doc;
    let next: number | null = SAVE_DELAY_MS;
    try {
      const res = await fetch(`/api/projects/${s.projectId}/doc`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ doc, revision: s.revision }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        store.getState().markSaved(body.revision, doc);
        setError("");
        if (store.getState().dirty) writeDraft(); // keep the draft's revision current
        else await idbDel(key());
        setStatus(store.getState().dirty ? "unsaved" : "saved");
      } else if (res.status === 409) {
        next = null;
        if (onConflict.current?.(body.current)) setStatus("saving"); // live co-editing takes the unsaved changes
        else block({ serverRevision: body.current, source: "save" });
      } else if (res.status >= 400 && res.status < 500) {
        // The server will reject this exact document again: wait for the next change.
        next = null;
        rejected.current = doc;
        const issue = body.issues?.[0];
        setError(issue ? `${issue.path?.join(".")}: ${issue.message}` : body.message ?? body.error ?? "rejected");
        setStatus("error");
      } else {
        next = RETRY_MS;
        setStatus("error");
      }
    } catch {
      next = RETRY_MS;
      setStatus("offline");
    } finally {
      inFlight.current = false;
      if (next !== null && !paused.current && store.getState().dirty && !store.getState().locked) schedule(next);
    }
  }

  useEffect(() => {
    tab.current = tabId();
    const { projectId, revision } = store.getState();
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(channelName(projectId));
    channel?.addEventListener("message", (e) => { if (e.data?.type === "ping" && e.data.tab === tab.current) channel.postMessage({ type: "alive", tab: tab.current }); });

    (async () => {
      // This tab's own draft (a reload) restores directly when it is based on the current revision.
      const own = await idbGet<Draft>(key());
      if (own) {
        if (own.revision === revision) { store.getState().replaceDoc(own.doc, revision, true); setStatus("unsaved"); schedule(); }
        else block({ serverRevision: revision, source: "draft", draft: own, draftKey: key() });
        return;
      }
      // A draft left by a tab that is no longer open (closed with unsaved work, or crashed).
      for (const k of await idbKeys(prefix(projectId))) {
        if (k === key() || !channel || (await isTabAlive(channel, k.slice(prefix(projectId).length)))) continue;
        const orphan = await idbGet<Draft>(k);
        if (orphan) { block({ serverRevision: revision, source: "draft", draft: orphan, draftKey: k }); return; }
      }
    })();

    const unsub = store.subscribe((s, prev) => {
      if (paused.current || s.doc === prev.doc || !s.dirty || s.locked) return;
      writeDraft();
      if (s.doc !== rejected.current) { setStatus("unsaved"); schedule(); }
    });
    const beforeUnload = (e: BeforeUnloadEvent) => { if (store.getState().dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      unsub();
      channel?.close();
      window.removeEventListener("beforeunload", beforeUnload);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per editor mount
  }, [store]);

  function resolve(draftKey?: string) {
    if (draftKey) void idbDel(draftKey);
    store.getState().setLocked(false);
    setConflict(null);
  }

  /** Discard local changes and load what the server has now. */
  async function loadTheirs() {
    const res = await fetch(`/api/projects/${store.getState().projectId}`);
    if (!res.ok) { setError("Could not load the saved version. Try again."); return; }
    const project = await res.json();
    const doc = migrate(project.doc);
    resolve(conflict?.draftKey ?? key());
    store.getState().replaceDoc(doc, project.revision, false);
    setStatus("saved");
  }

  /** Keep the local document and write it over the server's newer revision. */
  async function keepMine() {
    if (!conflict) return;
    const s = store.getState();
    const doc = conflict.draft?.doc ?? s.doc;
    resolve(conflict.draftKey);
    s.replaceDoc(doc, conflict.serverRevision, true);
    rejected.current = null;
    await save();
  }

  /** Saves now. True once the server has the current document; false when it cannot (offline, rejected, conflict). */
  async function flush(): Promise<boolean> {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    for (let i = 0; inFlight.current && i < 150; i++) await new Promise((r) => setTimeout(r, 100));
    if (inFlight.current) return false;
    await save();
    return !store.getState().dirty;
  }

  /** The server's document is now current (e.g. after a restore): load it as saved and drop this tab's draft. */
  function adoptServerDoc(doc: ChitrapxDoc, revision: number) {
    store.getState().replaceDoc(doc, revision, false);
    void idbDel(key());
    setStatus("saved");
  }
  /** Another writer moved the project on: show the usual conflict choice. */
  function reportConflict(serverRevision: number) { block({ serverRevision, source: "save" }); }

  /** Live co-editing takes over: no more whole-document saves. Resolves once no save is in flight. */
  async function pause(): Promise<void> {
    paused.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    while (inFlight.current) await new Promise((r) => setTimeout(r, 50));
  }
  /** Back to solo saving (the store's revision and saved document are current). */
  function resume() {
    paused.current = false;
    rejected.current = null;
    if (store.getState().locked) return; // a conflict dialog keeps its status
    setStatus(store.getState().dirty ? "unsaved" : "saved");
    if (store.getState().dirty) schedule();
  }
  /** Live mode now holds the unsaved changes (as commands): this tab's whole-document draft is obsolete. */
  function discardDraft() { void idbDel(key()); }

  return { status, error, conflict, loadTheirs, keepMine, flush, adoptServerDoc, reportConflict, pause, resume, discardDraft };
}
