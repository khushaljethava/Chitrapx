"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  allLocales, exportPlan, getTarget, MAX_EXPORT_ITEMS, presetSelection, sourcesFor, storeOf, storeReadiness, suggestedSelection, TARGETS,
  type ChitrapxDoc, type ContentIssue, type ExportPreset, type ExportSelection, type Target, type TargetId,
} from "@chitrapx/document";
import { track } from "@/lib/track.ts";
import { api, ApiError } from "@/server/api.ts";
import { jobError } from "./jobText.ts";
import { useDialog } from "./useDialog.ts";

type ExportJob = { id: string; type: string; status: string; error: string | null; createdAt: string;
  input: { selection?: ExportSelection } | null; output: { files?: number; bytes?: number; issues?: number } | null };

const PLATFORM_NAME: Record<string, string> = {
  ios: "iPhone", ipad: "iPad", mac: "Mac", watch: "Apple Watch", tv: "Apple TV", vision: "Vision Pro",
  android: "Android", play: "Google Play", preview: "App Preview", social: "Social",
};
const PRESETS: Array<[ExportPreset, string]> = [["app-store", "App Store required"], ["play", "Play required"], ["everything", "Everything"]];
const BY_PLATFORM = TARGETS.reduce<Record<string, Target[]>>((acc, t) => ({ ...acc, [t.platform]: [...(acc[t.platform] ?? []), t] }), {});

export function ExportDialog({ projectId, doc, onClose, beforeExport, onAddSize, onJump, checks }: {
  projectId: string; doc: ChitrapxDoc; onClose: () => void;
  /** Editor: save before the server renders the saved document. */
  beforeExport?: () => Promise<boolean>;
  /** Editor: turn a derived size into an editable group. */
  onAddSize?: (target: TargetId, fromGroupId: string) => void;
  /** Editor: open the board an issue points at. */
  onJump?: (groupId: string, boardIndex: number) => void;
  /** Content checks (missing fonts, unset brand colours, placeholders) shown before exporting. */
  checks?: ContentIssue[];
}) {
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [selection, setSelection] = useState<ExportSelection | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<"app-store" | "play" | null>(null);
  const [posting, setPosting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const { onBackdrop } = useDialog(dialogRef, { onClose, canClose: !posting });
  const load = useCallback(async () => (await api<ExportJob[]>(`/api/projects/${projectId}/export`)).filter((j) => j.type === "export"), [projectId]);
  const docRef = useRef(doc);
  docRef.current = doc;
  const active = jobs.some((j) => j.status === "queued" || j.status === "running");

  useEffect(() => {
    // Runs once per dialog open: later doc changes must not reset the user's ticks.
    const doc = docRef.current;
    load().then((js) => {
      setJobs(js);
      const last = js.find((j) => j.input?.selection)?.input?.selection;
      const known = allLocales(doc);
      // A language removed since the last export is dropped; nothing left falls back to the suggestion.
      const reuse = last && { ...last, board: undefined, locales: last.locales.filter((l) => known.includes(l)) };
      setSelection(reuse?.locales.length ? reuse : suggestedSelection(doc));
    }).catch(() => setSelection(suggestedSelection(doc)));
  }, [load]);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => load().then(setJobs).catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [active, load]);

  const plan = useMemo(() => (selection ? exportPlan(doc, selection) : []), [doc, selection]);
  const issues = useMemo(() => storeReadiness(plan, doc), [plan, doc]);
  const hasSocial = doc.groups.some((g) => getTarget(g.target)?.platform === "social");

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const shell = (body: React.ReactNode) => (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Export" onClick={onBackdrop}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral-950/40 p-4 outline-none backdrop-blur-sm sm:py-10">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2 className="text-lg font-semibold">Export</h2>
          <button type="button" className="btn-ghost size-9 rounded-full p-0 text-neutral-500" onClick={onClose} disabled={posting} aria-label="Close">✕</button>
        </div>
        <div className="space-y-5 px-5 py-5">{body}</div>
      </div>
    </div>
  );
  if (!selection) return shell(<p className="text-sm text-neutral-500">Loading</p>);

  const tooMany = plan.length > MAX_EXPORT_ITEMS;
  const stores = (["app-store", "play"] as const).filter((s) => issues.some((i) => i.store === s)
    || plan.some((i) => storeOf(getTarget(i.targetId)!.platform) === s));

  async function start() {
    setError("");
    setPosting(true);
    try {
      if (beforeExport && !(await beforeExport())) { setError("Save your changes first."); return; }
      await api(`/api/projects/${projectId}/export`, "POST", { kind: "zip", selection });
      track("export_started", { kind: "zip" });
      setJobs(await load());
    } catch (err) { setError(err instanceof ApiError ? err.message : "Something went wrong."); }
    finally { setPosting(false); }
  }

  return shell(
    <>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map(([p, label]) => (
            <button key={p} type="button" className="btn-ghost rounded-full px-3 py-1.5 text-xs" onClick={() => setSelection(presetSelection(doc, p))}>{label}</button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {Object.entries(BY_PLATFORM).filter(([p]) => p !== "social" || hasSocial).map(([platform, targets]) => (
            <fieldset key={platform} className="space-y-1.5 rounded-2xl border border-neutral-200 p-3 dark:border-neutral-800">
              <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{PLATFORM_NAME[platform]}</legend>
              {targets.map((t) => {
                const src = sourcesFor(doc, t.id as TargetId);
                const from = src.groups[0];
                const tag = !from ? "No boards" : !src.derived ? "Designed"
                  : src.letterboxed ? "Letterboxed" : `Auto from ${getTarget(from.target)!.label}`;
                return (
                  <label key={t.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-1 py-0.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
                    <input type="checkbox" disabled={!from} checked={selection.targets.includes(t.id as TargetId)}
                      onChange={() => setSelection({ ...selection, targets: toggle(selection.targets, t.id as TargetId) })} />
                    <span className="min-w-0 flex-1">{t.label} <span className="text-xs tabular-nums text-neutral-400">{t.width}×{t.height}</span></span>
                    <span className={`text-xs ${src.letterboxed ? "text-amber-600" : "text-neutral-500"}`}>{tag}</span>
                    {src.letterboxed && onAddSize && from && (
                      <button type="button" className="text-xs text-indigo-600 hover:underline" onClick={() => onAddSize(t.id as TargetId, from.id)}>Add as editable size</button>
                    )}
                  </label>
                );
              })}
            </fieldset>
          ))}
        </div>

        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Languages</legend>
          {allLocales(doc).map((l) => (
            <label key={l} className="flex items-center gap-1.5 rounded-full border border-neutral-200 px-2.5 py-1 text-sm dark:border-neutral-800">
              <input type="checkbox" checked={selection.locales.includes(l)} onChange={() => setSelection({ ...selection, locales: toggle(selection.locales, l) })} />{l}
            </label>
          ))}
        </fieldset>

        {checks && checks.length > 0 && (
          <section className="space-y-1 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/40">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">Before you export</h3>
            <ul className="space-y-0.5">{checks.map((c, k) => <li key={k}><span className="font-medium text-amber-700 dark:text-amber-400">Check</span> {c.message}</li>)}</ul>
          </section>
        )}

        <section className="space-y-2">
          {stores.map((s) => {
            const mine = issues.filter((i) => i.store === s);
            const errors = mine.filter((i) => i.severity === "error").length;
            return (
              <div key={s}>
                <button type="button" className="text-sm font-medium hover:text-indigo-600 dark:hover:text-indigo-400" onClick={() => setOpen(open === s ? null : s)} aria-expanded={open === s}>
                  {s === "app-store" ? "App Store" : "Google Play"}: {mine.length === 0 ? "✓ ready" : `${errors} to fix, ${mine.length - errors} to check`}
                </button>
                {open === s && (
                  <ul className="mt-1.5 space-y-1 border-l-2 border-neutral-200 pl-3 text-xs dark:border-neutral-800">
                    {mine.map((i, k) => (
                      <li key={k}>
                        <button type="button" disabled={!onJump || i.groupId === undefined} className="text-left disabled:cursor-default"
                          onClick={() => i.groupId !== undefined && onJump?.(i.groupId, i.boardIndex ?? 0)}>
                          <span className={i.severity === "error" ? "text-red-600" : "text-amber-600"}>{i.severity === "error" ? "Fix" : "Check"}</span> {i.message}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </section>

        <div className="flex flex-col gap-3 border-t border-neutral-200 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-neutral-800">
          <p className={`text-sm ${tooMany ? "text-red-600" : "text-neutral-500"}`}>
            {plan.length} PNGs{tooMany ? `. One export can hold up to ${MAX_EXPORT_ITEMS}.` : ""}
          </p>
          <button className="btn" onClick={start} disabled={posting || active || plan.length === 0 || tooMany}>{active ? "Exporting" : "Export ZIP (1 credit)"}</button>
        </div>
        {error && <p role="alert" className="error">{error}</p>}

        {jobs.length > 0 && (
          <ul className="divide-y divide-neutral-200 rounded-2xl border border-neutral-200 px-3 text-sm dark:divide-neutral-800 dark:border-neutral-800">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5">
                <span className="text-neutral-500">{new Date(j.createdAt).toLocaleString()}</span>
                {j.status === "done" ? (
                  <a className="font-medium text-indigo-600 hover:underline" href={`/api/jobs/${j.id}/download`}>
                    Download {j.output?.files} PNGs ({((j.output?.bytes ?? 0) / 1024 / 1024).toFixed(1)} MB){j.output?.issues ? ` · ${j.output.issues} issues` : ""}
                  </a>
                ) : j.status === "failed" ? (
                  <span className="text-red-600" title={j.error ?? ""}>{jobError(j.error)}</span>
                ) : (
                  <span className="chip">{j.status === "queued" ? "Waiting" : "Rendering"}</span>
                )}
              </li>
            ))}
          </ul>
        )}
    </>,
  );
}
