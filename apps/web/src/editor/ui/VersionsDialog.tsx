"use client";

import { useEffect, useRef, useState } from "react";
import { migrate, type ChitrapxDoc } from "@chitrapx/document";
import { BoardView, type RenderExtras, type ResolveSrc } from "@chitrapx/renderer";
import { useDialog } from "@/components/useDialog.ts";
import { api, ApiError } from "@/server/api.ts";
import { useEditor, useEditorStore } from "../context.tsx";
import type { SaveStatus } from "../save.ts";

type Version = { id: string; revision: number; kind: "auto" | "export" | "restore" | "named"; label: string | null; createdAt: string; author: string | null };
const KIND_LABEL = { auto: "Auto-save", export: "Before export", restore: "Before restore", named: "" } as const;
const title = (v: Version) => (v.kind === "named" ? v.label ?? "Version" : KIND_LABEL[v.kind]);
function ago(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function VersionsDialog({ onClose, saveStatus, flush, adoptServerDoc, reportConflict, resolveSrc, extras }: {
  onClose: () => void; saveStatus: SaveStatus; flush: () => Promise<boolean>;
  adoptServerDoc: (doc: ChitrapxDoc, revision: number) => void; reportConflict: (revision: number) => void; resolveSrc: ResolveSrc; extras: RenderExtras;
}) {
  const store = useEditorStore();
  const projectId = useEditor((s) => s.projectId);
  const conflicted = useEditor((s) => s.locked);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [preview, setPreview] = useState<{ v: Version; doc: ChitrapxDoc } | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /** Set when a restore is blocked by a save the server keeps rejecting: offer to drop the local edits. */
  const [stuck, setStuck] = useState<Version | null>(null);
  const previewSeq = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const { onBackdrop } = useDialog(dialogRef, { onClose, canClose: !busy });

  const load = () => api<Version[]>(`/api/projects/${projectId}/versions`).then(setVersions).catch(() => setError("Could not load versions."));
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once per open

  async function open(v: Version) {
    setError("");
    const seq = ++previewSeq.current;
    try {
      const { doc } = await api<{ doc: ChitrapxDoc }>(`/api/projects/${projectId}/versions/${v.id}`);
      if (seq === previewSeq.current) setPreview({ v, doc }); // a slower, older request never replaces a newer one
    } catch { if (seq === previewSeq.current) setError("Could not open this version."); }
  }
  async function saveNamed() {
    setBusy(true); setError("");
    try {
      if (!(await flush())) { setError("Save your changes first."); return; }
      await api(`/api/projects/${projectId}/versions`, "POST", { label: name });
      setName(""); await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Could not save the version."); }
    finally { setBusy(false); }
  }
  async function restore(v: Version, discard = false) {
    setBusy(true); setError(""); setStuck(null);
    let locked = false;
    try {
      if (discard) {
        // Autosave keeps failing (e.g. a 4xx): load what the server has, dropping the unsaved edits, then restore.
        const project = await api<{ doc: unknown; revision: number }>(`/api/projects/${projectId}`);
        adoptServerDoc(migrate(project.doc), project.revision);
      } else if (!(await flush())) {
        setError("Save your changes first.");
        if (saveStatus === "error") setStuck(v);
        return;
      }
      // No edits or autosaves may slip in between the save above and adopting the restored document.
      store.getState().setLocked(true); locked = true;
      const out = await api<{ revision: number; doc: ChitrapxDoc }>(`/api/projects/${projectId}/versions/${v.id}/restore`, "POST", { revision: store.getState().revision });
      adoptServerDoc(out.doc, out.revision);
      store.getState().setLocked(false); locked = false;
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        locked = false; // reportConflict keeps the editor locked for the conflict dialog
        onClose(); reportConflict(Number(err.data?.current ?? store.getState().revision)); return;
      }
      setError(err instanceof ApiError ? err.message : "Could not restore.");
    } finally {
      if (locked) store.getState().setLocked(false);
      setBusy(false);
    }
  }

  return (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Version history" onClick={onBackdrop}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 outline-none">
      <div className="card grid w-full max-w-3xl gap-4 sm:grid-cols-[1fr_16rem]">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Version history</h2>
            <button type="button" className="btn-ghost" onClick={onClose} aria-label="Close" autoFocus>✕</button>
          </div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void saveNamed(); }}>
            <input className="input flex-1" aria-label="Version name" placeholder="Name this version" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn" disabled={busy || !name.trim()}>Save version</button>
          </form>
          {error && <p role="alert" className="error">{error}</p>}
          {stuck && (
            <button type="button" className="btn-ghost text-sm text-red-600" disabled={busy} onClick={() => restore(stuck, true)}>
              Discard unsaved changes and restore
            </button>
          )}
          {versions === null ? <p className="text-sm text-neutral-500">Loading</p> : versions.length === 0 ? <p className="text-sm text-neutral-500">No versions yet.</p> : (
            <ul className="max-h-96 divide-y divide-neutral-200 overflow-y-auto text-sm dark:divide-neutral-800">
              {versions.map((v) => (
                <li key={v.id}>
                  <button type="button" onClick={() => open(v)} className={`flex w-full justify-between gap-3 px-1 py-2 text-left ${preview?.v.id === v.id ? "bg-indigo-50 dark:bg-indigo-950" : ""}`}>
                    <span className={v.kind === "named" ? "font-medium" : ""}>{title(v)}</span>
                    <span className="text-neutral-500">{ago(v.createdAt)}{v.author ? ` · ${v.author}` : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <aside className="space-y-2">
          {preview ? (
            <>
              <div className="overflow-hidden rounded border border-neutral-200 dark:border-neutral-700">
                {preview.doc.groups[0]?.boards[0]
                  ? <BoardView doc={preview.doc} groupId={preview.doc.groups[0].id} boardIndex={0} locale={preview.doc.localization.baseLocale} scale={240 / preview.doc.groups[0].boards[0].size.width} resolveSrc={resolveSrc} extras={extras} />
                  : <p className="p-4 text-sm text-neutral-500">This version has no boards.</p>}
              </div>
              <button type="button" className="btn w-full" disabled={busy || conflicted} onClick={() => restore(preview.v)}>Restore this version</button>
              <p className="text-xs text-neutral-500">Your current design is saved as “Before restore” first.</p>
            </>
          ) : <p className="text-sm text-neutral-500">Select a version to preview it.</p>}
        </aside>
      </div>
    </div>
  );
}
