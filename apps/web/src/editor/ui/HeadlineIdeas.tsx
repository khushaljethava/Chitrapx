"use client";

import { useState } from "react";
import { CATEGORY_BANKS, defaultRole, FORMULA_ROLES, FORMULAS, type FormulaRole } from "@chitrapx/document";
import { useEditor, useEditorStore } from "../context.tsx";
import { insertHeadline } from "../headlineModel.ts";

const longest = (t: string) => Math.max(...t.split("\n").map((l) => l.length));

/** Offline headline formulas by slide role and example lines by category; a click inserts into the selected text. */
export function HeadlineIdeas() {
  const store = useEditorStore();
  const boardIndex = useEditor((s) => s.doc.groups.find((g) => g.id === s.activeGroupId)?.boards.findIndex((b) => b.id === s.activeBoardId) ?? 0);
  const boardCount = useEditor((s) => s.doc.groups.find((g) => g.id === s.activeGroupId)?.boards.length ?? 1);
  const [role, setRole] = useState<FormulaRole | "auto">("auto");
  const [category, setCategory] = useState(CATEGORY_BANKS[0]!.id);
  const [notice, setNotice] = useState("");
  const shownRole = role === "auto" ? defaultRole(Math.max(0, boardIndex), boardCount) : role;
  const insert = (text: string) => {
    const s = store.getState();
    const cmd = insertHeadline(s, text);
    if (!cmd) { setNotice("Select a headline first"); return; }
    setNotice("");
    s.apply(cmd);
  };
  const Line = ({ text, hint }: { text: string; hint?: string }) => (
    <li>
      <button type="button" onClick={() => insert(text)} className="w-full rounded px-1.5 py-1 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <span className="whitespace-pre-line">{text}</span>
        <span className="ml-1 text-neutral-400">{longest(text)}/30</span>
        {hint && <span className="block whitespace-pre-line text-neutral-500">e.g. {hint}</span>}
      </button>
    </li>
  );
  return (
    <section className="space-y-2">
      <h2 className="label">Headline ideas</h2>
      <select className="input" aria-label="Slide role" value={role} onChange={(e) => setRole(e.target.value as FormulaRole | "auto")}>
        <option value="auto">For this board ({FORMULA_ROLES.find((r) => r.id === shownRole)!.name})</option>
        {FORMULA_ROLES.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      <ul className="max-h-48 space-y-0.5 overflow-y-auto">{FORMULAS.filter((x) => x.role === shownRole).map((x) => <Line key={x.id} text={x.template} hint={x.example} />)}</ul>
      <select className="input" aria-label="App category" value={category} onChange={(e) => setCategory(e.target.value)}>
        {CATEGORY_BANKS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <ul className="space-y-0.5">{CATEGORY_BANKS.find((c) => c.id === category)!.lines.map((l) => <Line key={l.id} text={l.text} />)}</ul>
      {notice && <p role="status" className="text-xs text-amber-700">{notice}</p>}
      <p className="text-xs text-neutral-500">Keep each line under 30 characters. Replace every [placeholder].</p>
    </section>
  );
}
