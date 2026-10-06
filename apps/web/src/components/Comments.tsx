"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/server/api.ts";
import { groupThreads } from "./commentsModel.ts";

/** SP15 comments UI. Polls while open (Realtime from 15.3 can replace the poll). */
const POLL_MS = 1500;

type View = {
  id: string; boardId: string; elementId: string | null; parentId: string | null; body: string; mine: boolean;
  author: { id: string; name: string } | null; createdAt: string; editedAt: string | null; resolvedAt: string | null;
};
export type Thread = View & { orphaned: boolean; replies: View[] };
type Anchor = { boardId: string; elementId: string | null };

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

/**
 * The panel: threads by board, a composer for the current anchor, replies, resolve, edit, delete.
 * `onFocus` jumps the canvas to a thread's board and element (editor only).
 */
export function CommentsPanel({ projectId, boards, anchor, moderate, onFocus, onClose }: {
  projectId: string;
  boards: Array<{ id: string; name: string }>;
  anchor: Anchor | null;
  moderate: boolean;
  onFocus?: (t: Thread) => void;
  onClose?: () => void;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const res = await api<{ threads: Thread[] }>(`/api/projects/${projectId}/comments`).catch(() => null);
    if (res) setThreads(res.threads);
  }, [projectId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    try { await fn(); await load(); } catch (e) { setError(e instanceof ApiError ? e.message : "Something went wrong"); }
  };
  const names = useMemo(() => new Map(boards.map((b) => [b.id, b.name])), [boards]);
  const grouped = groupThreads(threads, boards.map((b) => b.id), showResolved);

  return (
    <aside aria-label="Comments" className="flex h-full w-80 flex-col border-l border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <h2 className="text-sm font-medium">Comments · {grouped.open} open</h2>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Resolved ({grouped.resolved})</label>
          {onClose && <button type="button" className="text-sm" aria-label="Close comments" onClick={onClose}>×</button>}
        </div>
      </div>
      <form className="space-y-2 border-b border-neutral-200 p-3 dark:border-neutral-800" onSubmit={(e) => {
        e.preventDefault();
        if (!anchor || !draft.trim()) return;
        void run(async () => { await api(`/api/projects/${projectId}/comments`, "POST", { ...anchor, body: draft }); setDraft(""); });
      }}>
        <p className="text-xs text-neutral-500">{anchor ? `On ${names.get(anchor.boardId) ?? "this board"}${anchor.elementId ? ", selected element" : ""}` : "Pick a board to comment on"}</p>
        <textarea aria-label="New comment" className="input h-16" maxLength={2000} placeholder="Comment, or @name someone" value={draft} disabled={!anchor} onChange={(e) => setDraft(e.target.value)} />
        <button className="btn w-full" disabled={!anchor || !draft.trim()}>Comment</button>
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      </form>
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {grouped.boards.map((b) => (
          <section key={b.boardId} className="space-y-2">
            <h3 className="text-xs font-medium text-neutral-500">{names.get(b.boardId) ?? "Board"}</h3>
            {b.threads.map((t, i) => <ThreadCard key={t.id} n={i + 1} t={t} projectId={projectId} moderate={moderate} run={run} onFocus={onFocus} />)}
          </section>
        ))}
        {grouped.orphaned.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-medium text-amber-600">Orphaned (board or element deleted)</h3>
            {grouped.orphaned.map((t, i) => <ThreadCard key={t.id} n={i + 1} t={t} projectId={projectId} moderate={moderate} run={run} />)}
          </section>
        )}
        {!threads.length && <p className="text-sm text-neutral-500">No comments yet.</p>}
      </div>
    </aside>
  );
}

function ThreadCard({ n, t, projectId, moderate, run, onFocus }: { n: number; t: Thread; projectId: string; moderate: boolean; run: (fn: () => Promise<unknown>) => Promise<void>; onFocus?: (t: Thread) => void }) {
  const [reply, setReply] = useState("");
  const base = `/api/projects/${projectId}/comments`;
  return (
    <div className={`space-y-2 rounded-lg border p-2 text-sm ${t.resolvedAt ? "border-neutral-200 opacity-60 dark:border-neutral-800" : "border-neutral-300 dark:border-neutral-700"}`}>
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => onFocus?.(t)} disabled={!onFocus || t.orphaned}>
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-xs text-white">{n}</span>
        <span className="text-xs text-neutral-500">{t.elementId ? "Element" : "Board"}{t.resolvedAt ? " · resolved" : ""}</span>
      </button>
      {[t, ...t.replies].map((c) => <CommentLine key={c.id} c={c} base={base} moderate={moderate} run={run} />)}
      <div className="flex gap-1">
        <input aria-label="Reply" className="input py-1 text-xs" placeholder="Reply" maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && reply.trim()) void run(async () => { await api(base, "POST", { parentId: t.id, body: reply }); setReply(""); }); }} />
        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => void run(() => api(`${base}/${t.id}`, "PATCH", { resolved: !t.resolvedAt }))}>{t.resolvedAt ? "Reopen" : "Resolve"}</button>
      </div>
    </div>
  );
}

function CommentLine({ c, base, moderate, run }: { c: View; base: string; moderate: boolean; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className={c.parentId ? "ml-4" : ""}>
      <p className="text-xs text-neutral-500">{c.author?.name ?? "Someone"} · {when(c.createdAt)}{c.editedAt ? " · edited" : ""}</p>
      {editing === null ? <p className="whitespace-pre-wrap break-words">{c.body}</p> : (
        <textarea aria-label="Edit comment" className="input h-14 text-xs" maxLength={2000} value={editing} onChange={(e) => setEditing(e.target.value)} />
      )}
      <div className="flex gap-2 text-xs text-neutral-500">
        {c.mine && editing === null && <button type="button" onClick={() => setEditing(c.body)}>Edit</button>}
        {editing !== null && <button type="button" onClick={() => void run(async () => { await api(`${base}/${c.id}`, "PATCH", { body: editing }); setEditing(null); })}>Save</button>}
        {editing !== null && <button type="button" onClick={() => setEditing(null)}>Cancel</button>}
        {(c.mine || moderate) && <button type="button" className="text-red-600" onClick={() => confirm("Delete this comment?") && void run(() => api(`${base}/${c.id}`, "DELETE"))}>Delete</button>}
      </div>
    </div>
  );
}

/** Read-only project pages (viewers): pick the board to comment on. */
export function ViewerComments({ projectId, boards, moderate }: { projectId: string; boards: Array<{ id: string; name: string }>; moderate: boolean }) {
  const [boardId, setBoardId] = useState(boards[0]?.id ?? "");
  return (
    <div className="space-y-2">
      <label className="label" htmlFor="comment-board">Comment on</label>
      <select id="comment-board" className="input" value={boardId} onChange={(e) => setBoardId(e.target.value)}>
        {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <div className="h-[70vh]"><CommentsPanel projectId={projectId} boards={boards} anchor={boardId ? { boardId, elementId: null } : null} moderate={moderate} /></div>
    </div>
  );
}

type Note = { id: string; kind: "mention" | "reply"; projectId: string; projectName: string; threadId: string; actorName: string; excerpt: string; createdAt: string; read: boolean };

/** Dashboard header bell: replies and @mentions, in-app only. Opening it marks them read. */
export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ items: Note[]; unread: number }>({ items: [], unread: 0 });
  const load = useCallback(() => api<{ items: Note[]; unread: number }>("/api/notifications").then(setData, () => {}), []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
    return () => clearInterval(timer);
  }, [load]);
  return (
    <div className="relative">
      <button type="button" className="text-sm hover:underline" aria-expanded={open} onClick={() => {
        setOpen(!open);
        if (!open && data.unread) void api("/api/notifications", "POST", {}).then(() => setData((d) => ({ ...d, unread: 0 })), () => {});
      }}>Notifications{data.unread ? ` (${data.unread})` : ""}</button>
      {open && (
        <div className="card absolute right-0 z-20 mt-2 w-80 space-y-2 p-3 shadow-lg">
          {!data.items.length && <p className="text-sm text-neutral-500">Nothing yet.</p>}
          {data.items.map((n) => (
            <Link key={n.id} href={`/editor/${n.projectId}?comments=1`} className={`block rounded-lg p-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${n.read ? "" : "font-medium"}`}>
              <span className="block text-xs text-neutral-500">{n.actorName} {n.kind === "mention" ? "mentioned you" : "replied"} · {n.projectName}</span>
              {n.excerpt}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
