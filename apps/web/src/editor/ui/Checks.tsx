"use client";

import { useMemo } from "react";
import { contentChecks, lintBoard } from "@chitrapx/document";
import { useEditorAssets } from "../assets.tsx";
import { useEditor, useEditorStore } from "../context.tsx";

/** Store-readiness issues for the active size and language; clicking one selects the element. */
export function Checks() {
  const store = useEditorStore();
  const doc = useEditor((s) => s.doc);
  const groupId = useEditor((s) => s.activeGroupId);
  const locale = useEditor((s) => s.locale);
  const group = doc.groups.find((g) => g.id === groupId);
  const { fonts, extras } = useEditorAssets();
  const issues = useMemo(() => (group?.boards ?? []).flatMap((b, i) =>
    lintBoard(b, { code: locale, base: doc.localization.baseLocale }, extras.palette).map((issue) => ({ ...issue, boardId: b.id, boardIndex: i }))),
  [group, locale, doc.localization.baseLocale, extras.palette]);
  const content = useMemo(() => contentChecks(doc, { customFamilies: fonts.map((f) => f.family), palette: extras.palette }).filter((i) => i.groupId === groupId), [doc, fonts, extras.palette, groupId]);
  const count = issues.length + content.length;

  return (
    <section className="space-y-2">
      <h2 className="label">Checks {count ? `(${count})` : ""}</h2>
      {count === 0 ? (
        <p className="text-xs text-green-700 dark:text-green-400">No issues on this size{locale !== doc.localization.baseLocale ? ` in ${locale}` : ""}.</p>
      ) : (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {content.map((i) => (
            <li key={`content:${i.code}:${i.message}`}>
              <button type="button" className="w-full rounded px-1.5 py-1 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
                onClick={() => { const b = group?.boards[i.boardIndex]; if (b) store.getState().setActiveBoard(b.id); }}>
                <span className="text-amber-600">Check</span>
                <span className="text-neutral-400"> · board {i.boardIndex + 1} · </span>
                {i.message}
              </button>
            </li>
          ))}
          {issues.map((i) => (
            <li key={`${i.boardId}:${i.elementId}:${i.code}`}>
              <button type="button" className="w-full rounded px-1.5 py-1 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
                onClick={() => { store.getState().setActiveBoard(i.boardId); store.getState().select([{ groupId, boardId: i.boardId, elementId: i.elementId }]); }}>
                <span className={i.severity === "error" ? "text-red-600" : "text-amber-600"}>{i.severity === "error" ? "Fix" : "Check"}</span>
                <span className="text-neutral-400"> · board {i.boardIndex + 1} · </span>
                {i.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
