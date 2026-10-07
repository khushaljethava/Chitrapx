"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ExportDialog } from "@/components/ExportDialog.tsx";
import { contentChecks, type ChitrapxDoc } from "@chitrapx/document";
import { LOCALES } from "@chitrapx/renderer";
import { useEditorAssets } from "../assets.tsx";
import { useEditor, useEditorStore } from "../context.tsx";
import type { SaveStatus } from "../save.ts";
import { VersionsDialog } from "./VersionsDialog.tsx";
import { TranslationsTable } from "./TranslationsTable.tsx";

const STATUS: Record<SaveStatus, string> = {
  saved: "All changes saved", saving: "Saving", unsaved: "Unsaved changes", offline: "Offline, kept on this device",
  conflict: "Changed elsewhere", error: "Could not save", reconnecting: "Reconnecting, edits still save",
};

export function Toolbar({ name, projectId, status, error, flush, adoptServerDoc, reportConflict, openTranslations, glossary: initialGlossary, presence, share }: {
  share?: React.ReactNode;
  name: string; projectId: string; status: SaveStatus; error?: string; flush: () => Promise<boolean>;
  adoptServerDoc: (doc: ChitrapxDoc, revision: number) => void; reportConflict: (revision: number) => void; openTranslations?: boolean; glossary: string[];
  /** SP15: who else is in the project. */
  presence?: React.ReactNode;
}) {
  const { resolveSrc, fonts, extras } = useEditorAssets();
  const store = useEditorStore();
  const [exporting, setExporting] = useState(false);
  const [history, setHistory] = useState(false);
  const [translating, setTranslating] = useState(!!openTranslations);
  // Kept here, not in the dialog, so reopening it shows the list as last saved.
  const [glossary, setGlossary] = useState(initialGlossary);
  const doc = useEditor((s) => s.doc);
  // The export covers every size, so every group's checks apply.
  const checks = useMemo(() => exporting ? contentChecks(doc, { customFamilies: fonts.map((f) => f.family), palette: extras.palette }) : [], [exporting, doc, fonts, extras.palette]);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const locale = useEditor((s) => s.locale);
  const loc = useEditor((s) => s.doc.localization);
  const codes = [loc.baseLocale, ...loc.locales.map((l) => l.code)];
  const rtl = (c: string) => !!LOCALES.find((l) => l.code === c)?.rtl;

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-neutral-200 bg-white px-3 py-1.5 dark:border-neutral-800 dark:bg-neutral-900">
      <Link href={`/dashboard/projects/${projectId}`} aria-label="Back to project" className="nav-link px-2 text-base">←</Link>
      <span className="font-display font-bold tracking-tight">Chitrapx</span>
      <span className="h-5 w-px bg-neutral-200 dark:bg-neutral-800" />
      <h1 className="max-w-48 truncate text-sm font-semibold">{name}</h1>
      <span role="status" title={error || undefined}
        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${status === "conflict" || status === "error" ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" : status === "saved" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"}`}>
        <span aria-hidden className="size-1.5 rounded-full bg-current" />{STATUS[status]}{status === "error" && error ? `: ${error}` : ""}
      </span>
      <div className="flex gap-0.5">
        <button type="button" className="nav-link px-2 disabled:opacity-40" disabled={!canUndo} onClick={() => store.getState().undo()} title="Undo (Ctrl/Cmd+Z)" aria-label="Undo">↶</button>
        <button type="button" className="nav-link px-2 disabled:opacity-40" disabled={!canRedo} onClick={() => store.getState().redo()} title="Redo (Shift+Ctrl/Cmd+Z)" aria-label="Redo">↷</button>
      </div>
      <nav className="flex flex-wrap items-center gap-1" aria-label="Languages">
        <select aria-label="Language" className="input w-auto py-1 text-xs" value={locale} onChange={(e) => store.getState().setLocale(e.target.value)}>
          {codes.map((c) => <option key={c} value={c}>{c}{rtl(c) ? " (RTL)" : ""}</option>)}
        </select>
        {locale !== loc.baseLocale && (
          <button type="button" aria-label={`Remove ${locale}`} title={`Remove ${locale}`} className="nav-link px-1.5 text-xs hover:text-red-600" onClick={() => store.getState().apply({ type: "removeLocale", code: locale })}>×</button>
        )}
        <select aria-label="Add a language" className="input w-auto py-1 text-xs" value="" onChange={(e) => {
          if (!e.target.value) return;
          store.getState().apply({ type: "addLocale", code: e.target.value });
          store.getState().setLocale(e.target.value);
        }}>
          <option value="">Add language</option>
          {LOCALES.filter((l) => !codes.includes(l.code)).map((l) => <option key={l.code} value={l.code}>{l.nativeName} ({l.code})</option>)}
        </select>
        {codes.some(rtl) && (
          <label className="flex items-center gap-1 text-xs" title="Positions mirror in Arabic, Hebrew, Persian and Urdu. Check every board in those languages before exporting.">
            <input type="checkbox" checked={!!loc.mirrorRtl} onChange={(e) => store.getState().apply({ type: "setMirrorRtl", on: e.target.checked })} />
            Mirror layout in RTL languages
          </label>
        )}
      </nav>
      {presence && <div className="ml-auto">{presence}</div>}
      {!presence && <span className="ml-auto" />}
      {share}
      <button type="button" className="btn-ghost py-1.5" disabled={!doc.groups.length} onClick={() => setTranslating(true)}>Translations</button>
      {translating && <TranslationsTable name={name} glossary={glossary} onGlossary={setGlossary} onClose={() => setTranslating(false)} />}
      <button type="button" className="btn-ghost py-1.5" onClick={() => setHistory(true)}>History</button>
      {history && <VersionsDialog onClose={() => setHistory(false)} saveStatus={status} flush={flush} adoptServerDoc={adoptServerDoc} reportConflict={reportConflict} resolveSrc={resolveSrc} extras={extras} />}
      <button type="button" className="btn py-1.5" onClick={() => setExporting(true)}>Export</button>
      {exporting && (
        <ExportDialog projectId={projectId} doc={doc} onClose={() => setExporting(false)} beforeExport={flush} checks={checks}
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

/** Floating zoom control over the canvas (Stitch editor layout). */
export function ZoomBar() {
  const store = useEditorStore();
  const zoom = useEditor((s) => s.zoom);
  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-neutral-200 bg-white/90 p-1 text-sm shadow-lg shadow-neutral-900/5 backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/90">
      <button type="button" className="nav-link rounded-full px-2.5" aria-label="Zoom out" onClick={() => store.getState().setZoom(zoom / 1.25)}>−</button>
      <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
      <button type="button" className="nav-link rounded-full px-2.5" aria-label="Zoom in" onClick={() => store.getState().setZoom(zoom * 1.25)}>+</button>
    </div>
  );
}
