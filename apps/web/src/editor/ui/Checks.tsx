"use client";

import { useMemo } from "react";
import { lintBoard } from "@chitrapx/document";
import { useEditor, useEditorStore } from "../context.tsx";

/** Store-readiness issues for the active size and language; clicking one selects the element. */
export function Checks() {
  const store = useEditorStore();
  const doc = useEditor((s) => s.doc);
  const groupId = useEditor((s) => s.activeGroupId);
  const locale = useEditor((s) => s.locale);
  const group = doc.groups.find((g) => g.id === groupId);
  const issues = useMemo(() => (group?.boards ?? []).flatMap((b, i) =>
    lintBoard(b, { code: locale, base: doc.localization.baseLocale }).map((issue) => ({ ...issue, boardId: b.id, boardIndex: i }))),
  [group, locale, doc.localization.baseLocale]);

  return (
    <section className="space-y-2">
      <h2 className="label">Checks {issues.length ? `(${issues.length})` : ""}</h2>
      {issues.length === 0 ? (
        <p className="text-xs text-green-700 dark:text-green-400">No issues on this size{locale !== doc.localization.baseLocale ? ` in ${locale}` : ""}.</p>
      ) : (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
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
