"use client";

import { useMemo, useRef, useState } from "react";
import { ImportError, lengthWarning, planCsvImport, planJsonImport, toCsv, toJson, type CellState, type ImportPlan } from "@chitrapx/document";
import { LOCALES } from "@chitrapx/renderer";
import { useEditor, useEditorStore } from "../context.tsx";
import { api } from "@/server/api.ts";
import { useEditorAssets } from "../assets.tsx";
import { useDocJob } from "../docJobs.tsx";
import { tableModel } from "../translationsModel.ts";

const CELL_CLASS: Record<CellState, string> = {
  untranslated: "border-amber-400 bg-amber-50 dark:bg-amber-950",
  "stale-auto": "border-orange-500 bg-orange-50 dark:bg-orange-950",
  "stale-manual": "border-orange-500 bg-orange-50 dark:bg-orange-950",
  auto: "border-neutral-300 dark:border-neutral-700",
  manual: "border-indigo-300 dark:border-indigo-800",
};
const CELL_TITLE: Record<CellState, string> = {
  untranslated: "Not translated: the base text shows in this language",
  "stale-auto": "The source changed since this was machine translated",
  "stale-manual": "The source changed since this was written",
  auto: "Machine translated",
  manual: "Written by hand: AI translation keeps it",
};
const IMPORT_ERRORS = {
  no_id_column: "This CSV has no id column. Export a CSV first and edit that.",
  not_json: "This is not a translations file. It should look like { \"de-DE\": { \"<id>\": \"text\" } }.",
} as const;

const localeInfo = (code: string) => {
  const def = LOCALES.find((l) => l.code === code);
  return { name: def?.nativeName ?? code, rtl: !!def?.rtl };
};

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

/** Machine translation into chosen languages from the base or any other column. 2 credits per language that comes back. */
function AiTranslate() {
  const run = useDocJob();
  const projectId = useEditor((s) => s.projectId);
  const loc = useEditor((s) => s.doc.localization);
  const locked = useEditor((s) => s.locked);
  const [source, setSource] = useState(loc.baseLocale);
  const [targets, setTargets] = useState<string[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const options = loc.locales.map((l) => l.code).filter((c) => c !== source);
  const chosen = targets.filter((t) => options.includes(t));

  async function translate() {
    setBusy(true);
    setMessage("");
    try {
      const job = await run(() => api<{ jobId: string }>(`/api/projects/${projectId}/translate`, "POST",
        { locales: chosen, sourceLocale: source, ...(overwrite && { overwriteManual: true }) }));
      const out = job.output as { locales?: string[]; skipped?: string[] } | null;
      setMessage(`Translated ${out?.locales?.join(", ") || "nothing"}.${out?.skipped?.length ? ` Not translated, not charged: ${out.skipped.join(", ")}.` : ""}`);
      setTargets([]);
    } catch (err) { setMessage((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <section className="flex flex-wrap items-end gap-3 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800" aria-label="AI translation">
      <div>
        <label className="label" htmlFor="tr-source">Translate from</label>
        <select id="tr-source" className="input py-1 text-xs" value={source} onChange={(e) => setSource(e.target.value)}>
          {[loc.baseLocale, ...loc.locales.map((l) => l.code)].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="label">Into</legend>
        {options.map((c) => (
          <label key={c} className="flex items-center gap-1">
            <input type="checkbox" checked={chosen.includes(c)} onChange={(e) => setTargets((t) => (e.target.checked ? [...t, c] : t.filter((x) => x !== c)))} /> {c}
          </label>
        ))}
      </fieldset>
      <label className="flex items-center gap-1" title="Off: cells written by hand are kept">
        <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> Overwrite hand-written translations
      </label>
      <button type="button" className="btn px-2 py-1" disabled={!chosen.length || busy || locked} onClick={translate}>
        {busy ? "Translating" : `Translate (${chosen.length * 2} credits)`}
      </button>
      {message && <p role="status" className="w-full">{message}</p>}
    </section>
  );
}

/** Terms AI translation keeps exactly as written; saved on the app. The list lives in the toolbar so it survives reopening. */
function Glossary({ terms, setTerms }: { terms: string[]; setTerms: (terms: string[]) => void }) {
  const { appId } = useEditorAssets();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  async function save(next: string[]) {
    setError("");
    try { setTerms((await api<{ glossary: string[] }>(`/api/apps/${appId}`, "PATCH", { glossary: next })).glossary); }
    catch (err) { setError((err as Error).message); }
  }
  return (
    <section className="flex flex-wrap items-center gap-1 text-xs" aria-label="Glossary">
      <span className="label">Do not translate:</span>
      {terms.map((t) => (
        <span key={t} className="inline-flex items-center rounded bg-neutral-100 px-1.5 dark:bg-neutral-800">
          {t}<button type="button" aria-label={`Remove ${t}`} className="ml-1 text-neutral-500 hover:text-red-600" onClick={() => save(terms.filter((x) => x !== t))}>x</button>
        </span>
      ))}
      <input className="input w-36 py-0.5 text-xs" placeholder="Add a term" value={draft} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { void save([...terms, draft.trim()]); setDraft(""); } }} />
      <span className="text-neutral-500">The app name is always kept.</span>
      {error && <span role="alert" className="error">{error}</span>}
    </section>
  );
}

/** Every text in every language. Cell edits and imports are one undo step each; autosave stores them. */
export function TranslationsTable({ name, glossary, onGlossary, onClose }: { name: string; glossary: string[]; onGlossary: (terms: string[]) => void; onClose: () => void }) {
  const store = useEditorStore();
  const doc = useEditor((s) => s.doc);
  const locked = useEditor((s) => s.locked);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const model = useMemo(() => tableModel(doc, localeInfo, onlyMissing ? "missing" : "all"), [doc, onlyMissing]);
  const write = (locale: string, id: string, text: string) =>
    store.getState().apply({ type: "setTranslations", writes: [{ locale, id, text }] });

  async function pick(f: File) {
    setError("");
    setPlan(null);
    try {
      const text = await f.text();
      const doc = store.getState().doc;
      setPlan(/\.json$/i.test(f.name) ? planJsonImport(doc, text) : planCsvImport(doc, text));
    } catch (err) {
      setError(err instanceof ImportError ? IMPORT_ERRORS[err.code] : "Could not read this file.");
    } finally {
      if (file.current) file.current.value = "";
    }
  }

  function applyPlan() {
    if (plan?.changes.length) store.getState().apply({ type: "setTranslations", writes: plan.changes });
    setPlan(null);
  }

  const added = plan?.changes.filter((c) => c.kind === "added").length ?? 0;
  return (
    <div role="dialog" aria-modal="true" aria-label="Translations" className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col gap-3 overflow-hidden rounded-lg bg-white p-4 shadow-xl dark:bg-neutral-900">
        <header className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-semibold">Translations</h2>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> Only missing or stale
          </label>
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => download(`${name}-translations.csv`, toCsv(doc), "text/csv;charset=utf-8")}>Export CSV</button>
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => download(`${name}-translations.json`, toJson(doc), "application/json")}>Export JSON</button>
          <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={locked} onClick={() => file.current?.click()}>Import CSV or JSON</button>
          <input ref={file} type="file" accept=".csv,.json,text/csv,application/json" hidden onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
          <button type="button" className="btn px-2 py-1 text-xs" onClick={onClose}>Done</button>
        </header>
        <AiTranslate />
        <Glossary terms={glossary} setTerms={onGlossary} />

        {error && <p role="alert" className="error text-xs">{error}</p>}
        {plan && (
          <section className="space-y-2 rounded-md border border-indigo-200 p-3 text-xs dark:border-indigo-900" aria-label="Import preview">
            <p>
              {added} added, {plan.changes.length - added} changed, {plan.unchanged} unchanged.
              {plan.unknownIds.length > 0 && <> Not in this project (skipped): {plan.unknownIds.join(", ")}.</>}
              {plan.unknownLocales.length > 0 && <> Languages not in this project (skipped): {plan.unknownLocales.join(", ")}.</>}
            </p>
            {plan.changes.length > 0 && (
              <ul className="max-h-40 overflow-auto">
                {plan.changes.map((c) => (
                  <li key={`${c.locale}:${c.id}`}><b>{c.label}</b> ({c.locale}): <s className="text-neutral-500">{c.from || "empty"}</s> → <span dir="auto">{c.text}</span></li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <button type="button" className="btn px-2 py-1" disabled={!plan.changes.length || locked} onClick={applyPlan}>Apply {plan.changes.length} changes</button>
              <button type="button" className="btn-ghost px-2 py-1" onClick={() => setPlan(null)}>Cancel</button>
            </div>
          </section>
        )}

        {model.columns.length === 0 ? (
          <p className="text-sm text-neutral-500">Add a language in the toolbar to start translating.</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-white dark:bg-neutral-900">
                <tr>
                  <th className="p-1 text-left">Text</th>
                  <th className="p-1 text-left">{model.base.name} <span className="text-neutral-500">({model.base.code})</span></th>
                  {model.columns.map((c) => (
                    <th key={c.code} className="p-1 text-left">
                      {c.name} <span className="text-neutral-500">({c.code})</span>
                      {c.rtl && <span className="ml-1 rounded bg-neutral-200 px-1 text-[9px] font-semibold dark:bg-neutral-700" title="Right-to-left">RTL</span>}
                      <div className="font-normal text-neutral-500">{c.translated}/{c.total}{c.stale ? `, ${c.stale} stale` : ""}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {model.sections.map((s) => [
                  <tr key={s.boardId}><td colSpan={model.columns.length + 2} className="bg-neutral-100 p-1 font-semibold dark:bg-neutral-800">{s.board}</td></tr>,
                  ...s.rows.map(({ row, cells }) => (
                    <tr key={row.id} className="align-top">
                      <td className="w-32 p-1 text-neutral-600 dark:text-neutral-400">{row.label}</td>
                      <td className="w-56 whitespace-pre-wrap p-1" dir="auto">{row.base}</td>
                      {model.columns.map((c) => {
                        const cell = cells[c.code]!;
                        const warning = lengthWarning(row, cell.text);
                        return (
                          <td key={c.code} className="min-w-48 p-1">
                            <textarea key={`${row.id}:${c.code}:${cell.text}`} dir="auto" rows={2} defaultValue={cell.text} disabled={locked}
                              aria-label={`${row.label} in ${c.code}`} title={CELL_TITLE[cell.state]} placeholder={row.base}
                              className={`input w-full resize-y border px-1 py-0.5 text-xs ${CELL_CLASS[cell.state]}`}
                              onBlur={(e) => e.target.value !== cell.text && write(c.code, row.id, e.target.value)} />
                            {warning && <p className="text-[10px] text-amber-700 dark:text-amber-300">{warning}</p>}
                          </td>
                        );
                      })}
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
