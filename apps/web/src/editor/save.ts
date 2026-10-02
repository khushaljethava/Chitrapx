"use client";

import { useEffect, useRef, useState } from "react";
import type { ChitrapxDoc } from "@chitrapx/document";
import { idbDel, idbGet, idbSet } from "./idb.ts";
import type { EditorStore } from "./store.ts";

export type SaveStatus = "saved" | "saving" | "unsaved" | "offline" | "conflict" | "error";
export type Draft = { doc: ChitrapxDoc; revision: number; at: number };
type Conflict = { serverRevision: number; source: "save" | "draft"; draft?: Draft };

const SAVE_DELAY_MS = 1500;
const RETRY_MS = 5000;
const draftKey = (projectId: string) => `project:${projectId}`;

/**
 * Saves 1.5 s after the last change, keeps every unsaved document in IndexedDB until the server
 * has it, restores a newer local draft on load, and stops on a conflict until the user chooses.
 */
export function useAutosave(store: EditorStore) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const blocked = useRef(false);

  async function save() {
    const s = store.getState();
    if (!s.dirty || inFlight.current || blocked.current) return;
    inFlight.current = true;
    setStatus("saving");
    const doc = s.doc;
    try {
      const res = await fetch(`/api/projects/${s.projectId}/doc`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ doc, revision: s.revision }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        store.getState().markSaved(body.revision, doc);
        if (!store.getState().dirty) await idbDel(draftKey(s.projectId));
        setStatus(store.getState().dirty ? "unsaved" : "saved");
      } else if (res.status === 409) {
        blocked.current = true;
        setConflict({ serverRevision: body.current, source: "save" });
        setStatus("conflict");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("offline");
      timer.current = setTimeout(save, RETRY_MS);
    } finally {
      inFlight.current = false;
      if (store.getState().dirty && !blocked.current) schedule();
    }
  }

  function schedule() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_DELAY_MS);
  }

  useEffect(() => {
    const { projectId, revision } = store.getState();
    // A draft from an earlier visit that never reached the server.
    idbGet<Draft>(draftKey(projectId)).then((draft) => {
      if (!draft) return;
      if (draft.revision === revision) {
        store.getState().replaceDoc(draft.doc, revision, true);
        setStatus("unsaved");
        schedule();
      } else {
        blocked.current = true;
        setConflict({ serverRevision: revision, source: "draft", draft });
        setStatus("conflict");
      }
    });
    const unsub = store.subscribe((s, prev) => {
      if (s.doc === prev.doc || !s.dirty) return;
      void idbSet(draftKey(s.projectId), { doc: s.doc, revision: s.revision, at: Date.now() } satisfies Draft);
      if (!blocked.current) { setStatus("unsaved"); schedule(); }
    });
    const beforeUnload = (e: BeforeUnloadEvent) => { if (store.getState().dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { unsub(); window.removeEventListener("beforeunload", beforeUnload); if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per editor mount
  }, [store]);

  /** Discard local changes and load what the server has now. */
  async function loadTheirs() {
    const { projectId } = store.getState();
    const res = await fetch(`/api/projects/${projectId}`);
    const project = await res.json();
    await idbDel(draftKey(projectId));
    store.getState().replaceDoc(project.doc, project.revision, false);
    blocked.current = false;
    setConflict(null);
    setStatus("saved");
  }

  /** Keep the local document and write it over the server's newer revision. */
  async function keepMine() {
    if (!conflict) return;
    const s = store.getState();
    s.replaceDoc(conflict.draft?.doc ?? s.doc, conflict.serverRevision, true);
    blocked.current = false;
    setConflict(null);
    await save();
  }

  return { status, conflict, loadTheirs, keepMine, saveNow: save };
}
