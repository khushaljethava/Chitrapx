/** Pure helpers for the comments panel (SP15). */
export type ThreadLike = { id: string; boardId: string; elementId: string | null; resolvedAt: string | Date | null; orphaned: boolean };

/** Open threads by board (in board order), orphans apart; resolved ones only when asked. */
export function groupThreads<T extends ThreadLike>(threads: T[], boardOrder: string[], showResolved: boolean) {
  const visible = threads.filter((t) => showResolved || !t.resolvedAt);
  return {
    boards: boardOrder.map((boardId) => ({ boardId, threads: visible.filter((t) => !t.orphaned && t.boardId === boardId) })).filter((b) => b.threads.length),
    orphaned: visible.filter((t) => t.orphaned),
    resolved: threads.filter((t) => t.resolvedAt).length,
    open: threads.filter((t) => !t.resolvedAt).length,
  };
}

/** Where a new thread goes: the selected board element, else the active board. */
export function anchorFor(selection: ReadonlyArray<{ groupId?: string; boardId: string | null; elementId: string }>, activeBoardId: string | null): { boardId: string; elementId: string | null } | null {
  const el = selection.find((r) => r.boardId);
  if (el?.boardId) return { boardId: el.boardId, elementId: el.elementId };
  return activeBoardId ? { boardId: activeBoardId, elementId: null } : null;
}
