"use client";

import { useMemo, useState } from "react";
import { CommentsPanel, type Thread } from "@/components/Comments.tsx";
import { anchorFor } from "@/components/commentsModel.ts";
import { useEditor, useEditorStore } from "../context.tsx";

/**
 * SP15: the editor's "Comments" toggle and side panel. Comments are not part of the document:
 * this only reads the editor state and moves selection with existing store actions, never `apply`.
 */
export function EditorComments({ projectId, moderate, initiallyOpen = false }: { projectId: string; moderate: boolean; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const store = useEditorStore();
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const activeBoardId = useEditor((s) => s.activeBoardId);
  const boards = useMemo(() => doc.groups.flatMap((g) => g.boards.map((b, i) => ({ id: b.id, name: b.name || `Board ${i + 1}` }))), [doc]);

  const focus = (t: Thread) => {
    const group = doc.groups.find((g) => g.boards.some((b) => b.id === t.boardId));
    if (!group) return;
    const s = store.getState();
    if (s.activeGroupId !== group.id) s.setActiveGroup(group.id);
    s.setActiveBoard(t.boardId);
    if (t.elementId) s.select([{ groupId: group.id, boardId: t.boardId, elementId: t.elementId }]);
  };

  if (!open) {
    return <button type="button" className="btn fixed bottom-4 right-4 z-30 rounded-full px-5 shadow-xl shadow-indigo-600/25" onClick={() => setOpen(true)}>Comments</button>;
  }
  return (
    <div className="fixed inset-y-0 right-0 z-30 max-w-full border-l border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
      <CommentsPanel projectId={projectId} boards={boards} anchor={anchorFor(selection, activeBoardId)} moderate={moderate} onFocus={focus} onClose={() => setOpen(false)} />
    </div>
  );
}
