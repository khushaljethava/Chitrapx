"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChitrapxDoc } from "@chitrapx/document";
import type { ResolveSrc } from "@chitrapx/renderer";
import { track } from "@/lib/track.ts";
import { api, ApiError } from "@/server/api.ts";
import { BoardThumb } from "./BoardThumb.tsx";
import { useDialog } from "./useDialog.ts";

/** Community feed UI (SP16): browse, preview, use, report and share project snapshots. */

export const CATEGORY_LABEL: Record<string, string> = {
  productivity: "Productivity", games: "Games", finance: "Finance", health: "Health", education: "Education",
  travel: "Travel", social: "Social", shopping: "Shopping", utilities: "Utilities", other: "Other",
};
const PLATFORM_LABEL: Record<string, string> = { ios: "iPhone", ipad: "iPad", android: "Android", play: "Google Play", mac: "Mac", watch: "Watch", social: "Social" };

export type Card = {
  id: string; title: string; description: string; category: string; platforms: string[]; importCount: number;
  createdAt: string | Date; status: "published" | "hidden" | "removed"; mine: boolean; preview: ChitrapxDoc; urls: Record<string, string>;
};
type AppOption = { id: string; name: string };

const resolver = (urls: Record<string, string>): ResolveSrc => (src) => urls[src] ?? (/^(data:|blob:)/.test(src) ? src : null);

function Preview({ doc, urls, height }: { doc: ChitrapxDoc; urls: Record<string, string>; height: number }) {
  const g = doc.groups[0];
  const b = g?.boards[0];
  if (!g || !b) return <div className="flex items-center justify-center text-sm text-neutral-500" style={{ height }}>No boards</div>;
  return <BoardThumb doc={doc} groupId={g.id} boardIndex={0} locale={null} height={b.size.width > b.size.height ? Math.round(height * 0.6) : height} resolveSrc={resolver(urls)} />;
}

/** Picks one of the user's apps and copies the post into it as a new project. */
export function UseTemplate({ postId, apps }: { postId: string; apps: AppOption[] }) {
  const router = useRouter();
  const [appId, setAppId] = useState(apps[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!apps.length) return <p className="text-sm text-neutral-500"><Link href="/dashboard" className="text-indigo-600 hover:underline">Create an app</Link> first to use this template.</p>;
  async function go() {
    setBusy(true); setError("");
    try {
      const { projectId } = await api<{ projectId: string }>(`/api/community/${postId}/import`, "POST", { appId });
      track("community_imported");
      track("project_created", { source: "community" });
      router.push(`/dashboard/projects/${projectId}`);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        {apps.length > 1 && (
          <select className="input w-auto" aria-label="Add to app" value={appId} onChange={(e) => setAppId(e.target.value)}>
            {apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        <button type="button" className="btn flex-1" disabled={busy || !appId} onClick={go}>{busy ? "Copying" : "Use template"}</button>
      </div>
      {error && <p role="alert" className="error text-xs">{error}</p>}
    </div>
  );
}

export function CommunityFeed({ initial, apps }: { initial: { posts: Card[]; hasMore: boolean }; apps: AppOption[] }) {
  const [filters, setFilters] = useState({ platform: "", category: "", sort: "new" });
  const [page, setPage] = useState(0);
  const [data, setData] = useState(initial);
  const [error, setError] = useState("");
  const first = useRef(true);

  const load = useCallback(async (f: typeof filters, pg: number) => {
    const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), page: String(pg) });
    try { setData(await api<{ posts: Card[]; hasMore: boolean }>(`/api/community?${q}`)); setError(""); }
    catch { setError("Could not load the feed. Try again."); }
  }, []);
  useEffect(() => {
    if (first.current) { first.current = false; return; } // the server already rendered page 0 with no filters
    void load(filters, page);
  }, [filters, page, load]);
  const set = (k: keyof typeof filters, v: string) => { setFilters({ ...filters, [k]: v }); setPage(0); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <select className="input w-auto" aria-label="Platform" value={filters.platform} onChange={(e) => set("platform", e.target.value)}>
          <option value="">All platforms</option>
          {Object.entries(PLATFORM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input w-auto" aria-label="Category" value={filters.category} onChange={(e) => set("category", e.target.value)}>
          <option value="">All categories</option>
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input w-auto" aria-label="Sort" value={filters.sort} onChange={(e) => set("sort", e.target.value)}>
          <option value="new">Newest</option>
          <option value="popular">Most used</option>
        </select>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {data.posts.length === 0 ? <p className="text-neutral-500">Nothing shared here yet. Share one of your projects from its page.</p> : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.posts.map((c) => (
            <li key={c.id} className="card flex flex-col gap-3">
              <Link href={`/dashboard/community/${c.id}`} className="flex h-56 items-center justify-center" aria-label={`Open ${c.title}`}>
                <Preview doc={c.preview} urls={c.urls} height={220} />
              </Link>
              <div className="flex-1 space-y-1">
                <h3 className="font-medium"><Link href={`/dashboard/community/${c.id}`} className="hover:underline">{c.title}</Link></h3>
                {c.description && <p className="line-clamp-2 text-sm text-neutral-500">{c.description}</p>}
                <p className="text-xs text-neutral-500">
                  {CATEGORY_LABEL[c.category] ?? c.category} · {c.platforms.map((x) => PLATFORM_LABEL[x] ?? x).join(", ")} · used {c.importCount} {c.importCount === 1 ? "time" : "times"}
                  {c.mine && " · Yours"}{c.status === "hidden" && " · Hidden while under review"}
                </p>
              </div>
              <UseTemplate postId={c.id} apps={apps} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-between">
        <button type="button" className="btn-ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
        <button type="button" className="btn-ghost" disabled={!data.hasMore} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

/** One post: every board of its first size, plus use, report or delete. */
export function CommunityPostView({ post, apps }: { post: Card & { doc: ChitrapxDoc }; apps: AppOption[] }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const g = post.doc.groups[0];
  const resolveSrc = resolver(post.urls);

  async function report() {
    setError(""); setNote("");
    try { await api(`/api/community/${post.id}/report`, "POST", { reason }); setReason(""); setNote("Thanks. Staff will review this post."); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Could not send the report."); }
  }
  async function remove() {
    if (!window.confirm("Delete this post? Projects others already made from it are not affected.")) return;
    try { await api(`/api/community/${post.id}`, "DELETE"); router.push("/dashboard/community"); }
    catch (err) { setError((err as Error).message); }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{post.title}</h1>
          {post.description && <p className="max-w-2xl text-neutral-600 dark:text-neutral-400">{post.description}</p>}
          <p className="text-sm text-neutral-500">{CATEGORY_LABEL[post.category] ?? post.category} · used {post.importCount} {post.importCount === 1 ? "time" : "times"}{post.status === "hidden" && " · Hidden while staff review reports"}</p>
        </div>
        <div className="w-64"><UseTemplate postId={post.id} apps={apps} /></div>
      </div>
      {g && (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {g.boards.map((b, i) => (
            <BoardThumb key={b.id} doc={post.doc} groupId={g.id} boardIndex={i} locale={null} height={b.size.width > b.size.height ? 200 : 360} resolveSrc={resolveSrc} />
          ))}
        </div>
      )}
      {error && <p role="alert" className="error">{error}</p>}
      {post.mine ? (
        <button type="button" className="btn-danger" onClick={remove}>Delete post</button>
      ) : (
        <form className="flex max-w-xl gap-2" onSubmit={(e) => { e.preventDefault(); void report(); }}>
          <input className="input flex-1" aria-label="Why report this post?" placeholder="Report: what is wrong with this post?" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn-ghost" disabled={!reason.trim()}>Report</button>
        </form>
      )}
      {note && <p role="status" className="text-sm text-neutral-600">{note}</p>}
    </div>
  );
}

type QueueItem = { id: string; title: string; status: string; reports: number; reasons: string[] };

/** Staff review: restore or remove reported and hidden posts. */
export function ModerationQueue({ items }: { items: QueueItem[] }) {
  const [list, setList] = useState(items);
  const [error, setError] = useState("");
  async function act(id: string, action: "restore" | "remove") {
    setError("");
    try { await api(`/api/community/${id}/moderate`, "POST", { action }); setList((l) => l.filter((x) => x.id !== id)); }
    catch (err) { setError((err as Error).message); }
  }
  if (!list.length) return <p className="text-neutral-500">Nothing to review.</p>;
  return (
    <div className="space-y-2">
      {error && <p role="alert" className="error">{error}</p>}
      <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {list.map((q) => (
          <li key={q.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="flex-1">
              <Link href={`/dashboard/community/${q.id}`} className="font-medium hover:underline">{q.title}</Link>
              <p className="text-xs text-neutral-500">{q.status} · {q.reports} {q.reports === 1 ? "report" : "reports"}{q.reasons.length ? `: ${q.reasons.join(" · ")}` : ""}</p>
            </div>
            <button type="button" className="btn-ghost" onClick={() => act(q.id, "restore")}>Restore</button>
            <button type="button" className="btn-danger" onClick={() => act(q.id, "remove")}>Remove</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Project page: share a snapshot of this project to the community feed. */
export function ShareToCommunity({ projectId, defaultTitle }: { projectId: string; defaultTitle: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>Share to community</button>
      {open && <ShareDialog projectId={projectId} defaultTitle={defaultTitle} onClose={() => setOpen(false)} onDone={(id) => router.push(`/dashboard/community/${id}`)} />}
    </>
  );
}

function ShareDialog({ projectId, defaultTitle, onClose, onDone }: { projectId: string; defaultTitle: string; onClose: () => void; onDone: (id: string) => void }) {
  const [form, setForm] = useState({ title: defaultTitle.slice(0, 80), description: "", category: "other", license: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const { onBackdrop } = useDialog(ref, { onClose, canClose: !busy });
  async function share() {
    setBusy(true); setError("");
    try {
      const { id } = await api<{ id: string }>("/api/community", "POST", { projectId, ...form });
      track("community_published");
      onDone(id);
    } catch (err) { setError(err instanceof ApiError ? err.message : "Could not share."); setBusy(false); }
  }
  return (
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Share to community" onClick={onBackdrop}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 outline-none">
      <form className="card w-full max-w-lg space-y-3" onSubmit={(e) => { e.preventDefault(); void share(); }}>
        <h2 className="text-lg font-semibold">Share to community</h2>
        <p className="text-sm text-neutral-500">Others can browse a copy of this project as it is now and start their own project from it. Your later edits are not shared. Uploaded fonts and screen recordings cannot be shared.</p>
        <label className="block"><span className="label">Title</span>
          <input className="input" required minLength={3} maxLength={80} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label className="block"><span className="label">Description</span>
          <textarea className="input" maxLength={500} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <label className="block"><span className="label">Category</span>
          <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={form.license} onChange={(e) => setForm({ ...form, license: e.target.checked })} />
          <span>I own everything in this project (screenshots, images and text) or have the right to share it, and I allow others to use it as a starting point for their own screenshots.</span>
        </label>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" disabled={busy || !form.license || form.title.trim().length < 3}>{busy ? "Sharing" : "Share"}</button>
        </div>
      </form>
    </div>
  );
}
