"use client";

import Link from "next/link";
import { useState } from "react";
import { ExportDialog } from "@/components/ExportDialog.tsx";
import type { ChitrapxDoc } from "@chitrapx/document";
import { LOCALES, type ResolveSrc } from "@chitrapx/renderer";
import { useEditor, useEditorStore } from "../context.tsx";
import type { SaveStatus } from "../save.ts";
import { VersionsDialog } from "./VersionsDialog.tsx";

const STATUS: Record<SaveStatus, string> = {
  saved: "All changes saved", saving: "Saving", unsaved: "Unsaved changes", offline: "Offline, kept on this device",
  conflict: "Changed elsewhere", error: "Could not save",
};

export function Toolbar({ name, projectId, status, error, flush, adoptServerDoc, reportConflict, resolveSrc }: {
  name: string; projectId: string; status: SaveStatus; error?: string; flush: () => Promise<boolean>;
  adoptServerDoc: (doc: ChitrapxDoc, revision: number) => void; reportConflict: (revision: number) => void; resolveSrc: ResolveSrc;
}) {
  const store = useEditorStore();
  const [exporting, setExporting] = useState(false);
  const [history, setHistory] = useState(false);
  const doc = useEditor((s) => s.doc);
  const zoom = useEditor((s) => s.zoom);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const locale = useEditor((s) => s.locale);
  const loc = useEditor((s) => s.doc.localization);
  const codes = [loc.baseLocale, ...loc.locales.map((l) => l.code)];

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
      <Link href={`/dashboard/projects/${projectId}`} className="text-sm text-neutral-500 hover:underline">Back</Link>
      <h1 className="max-w-48 truncate font-semibold">{name}</h1>
      <div className="flex gap-1">
        <button type="button" className="btn-ghost px-2 py-1" disabled={!canUndo} onClick={() => store.getState().undo()} title="Undo (Ctrl/Cmd+Z)">Undo</button>
        <button type="button" className="btn-ghost px-2 py-1" disabled={!canRedo} onClick={() => store.getState().redo()} title="Redo (Shift+Ctrl/Cmd+Z)">Redo</button>
      </div>
      <div className="flex items-center gap-1 text-sm">
        <button type="button" className="btn-ghost px-2 py-1" aria-label="Zoom out" onClick={() => store.getState().setZoom(zoom / 1.25)}>-</button>
        <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <button type="button" className="btn-ghost px-2 py-1" aria-label="Zoom in" onClick={() => store.getState().setZoom(zoom * 1.25)}>+</button>
      </div>
      <nav className="flex flex-wrap items-center gap-1" aria-label="Languages">
        {codes.map((c) => (
          <span key={c} className="inline-flex items-center">
            <button type="button" className={c === locale ? "btn px-2 py-1 text-xs" : "btn-ghost px-2 py-1 text-xs"} onClick={() => store.getState().setLocale(c)}>{c}</button>
            {c !== loc.baseLocale && c === locale && (
              <button type="button" aria-label={`Remove ${c}`} className="px-1 text-xs text-neutral-500 hover:text-red-600" onClick={() => store.getState().apply({ type: "removeLocale", code: c })}>x</button>
            )}
          </span>
        ))}
        <select aria-label="Add a language" className="input w-auto py-1 text-xs" value="" onChange={(e) => {
          if (!e.target.value) return;
          store.getState().apply({ type: "addLocale", code: e.target.value });
          store.getState().setLocale(e.target.value);
        }}>
          <option value="">Add language</option>
          {LOCALES.filter((l) => !codes.includes(l.code)).map((l) => <option key={l.code} value={l.code}>{l.nativeName} ({l.code})</option>)}
        </select>
      </nav>
      <span className={`ml-auto text-xs ${status === "conflict" || status === "error" ? "text-red-600" : "text-neutral-500"}`} role="status" title={error || undefined}>{STATUS[status]}{status === "error" && error ? `: ${error}` : ""}</span>
      <button type="button" className="btn-ghost py-1.5" onClick={() => setHistory(true)}>History</button>
      {history && <VersionsDialog onClose={() => setHistory(false)} flush={flush} adoptServerDoc={adoptServerDoc} reportConflict={reportConflict} resolveSrc={resolveSrc} />}
      <button type="button" className="btn py-1.5" onClick={() => setExporting(true)}>Export</button>
      {exporting && (
        <ExportDialog projectId={projectId} doc={doc} onClose={() => setExporting(false)} beforeExport={flush}
          onAddSize={(target, fromGroupId) => store.getState().apply({ type: "addGroupFromTarget", fromGroupId, target, newGroupId: crypto.randomUUID() })}
          onJump={(groupId, boardIndex) => {
            const s = store.getState();
            s.setActiveGroup(groupId);
            const b = s.doc.groups.find((g) => g.id === groupId)?.boards[boardIndex];
            if (b) store.getState().setActiveBoard(b.id);
            setExporting(false);
          }} />
      )}
    </header>
  );
}
