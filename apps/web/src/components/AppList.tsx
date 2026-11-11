"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/server/api.ts";
import type { ExportStatus } from "@/server/apps.ts";

type AppRow = { id: string; name: string; platformHint: string; projectCount: number; updatedAt: string; exportStatus: ExportStatus; covers: string[] };

const PLATFORMS = [["all", "All"], ["ios", "iOS"], ["android", "Android"]] as const;

/** Real state only: whether the app has projects and how its latest full-set export went. */
function status(a: AppRow): [string, string] {
  if (a.exportStatus === "done") return ["Exported", "pill-success"];
  if (a.exportStatus === "queued" || a.exportStatus === "running") return ["Exporting", "pill-primary"];
  if (a.exportStatus === "failed") return ["Export failed", "pill-danger"];
  if (a.projectCount > 0) return ["In progress", "pill-warn"];
  return ["Not started", "pill bg-ink/5 text-muted"];
}

export function AppList({ apps, maxApps }: { apps: AppRow[]; maxApps: number }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number][0]>("all");
  const q = query.trim().toLowerCase();
  // "both" apps ship on either store, so they match iOS and Android alike.
  const shown = apps.filter((a) => a.name.toLowerCase().includes(q) && (platform === "all" || a.platformHint === platform || a.platformHint === "both"));
  const atLimit = apps.length >= maxApps;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const app = await api<{ id: string }>("/api/apps", "POST", { name });
      router.push(`/dashboard/apps/${app.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {apps.length === 0 && <p className="card border-dashed py-10 text-center text-muted">No apps yet. Add the app you want store screenshots for.</p>}
      {apps.length > 1 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input type="search" aria-label="Filter apps" placeholder="Filter apps…" className="input sm:max-w-xs" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div role="group" aria-label="Platform" className="segmented self-start">
            {PLATFORMS.map(([value, label]) => (
              <button key={value} type="button" aria-pressed={platform === value} onClick={() => setPlatform(value)}
                >
                {label}{value === "all" && ` (${apps.length})`}
              </button>
            ))}
          </div>
        </div>
      )}
      {apps.length > 0 && shown.length === 0 && <p className="text-sm text-muted">No apps match.</p>}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((a) => {
          const [label, tone] = status(a);
          return (
          <li key={a.id}>
            <Link href={`/dashboard/apps/${a.id}`} className="card group flex h-full flex-col gap-4 transition hover:border-primary/40">
              <span className="flex items-center gap-4">
                <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary-tint font-display text-lg font-bold text-on-primary-tint">{a.name.slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold group-hover:text-primary">{a.name}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    <span className="chip">{a.platformHint}</span>
                    <span>Edited {a.updatedAt.slice(0, 10)}</span>
                  </span>
                </span>
              </span>
              {/* The app's own uploaded screenshots; an empty strip says there is nothing uploaded yet. */}
              <span aria-hidden className="grid grid-cols-4 gap-2 rounded-xl bg-canvas p-2">
                {[0, 1, 2, 3].map((i) => a.covers[i]
                  ? <img key={i} src={a.covers[i]} alt="" loading="lazy" className="aspect-[9/19] w-full rounded-lg object-cover object-top" />
                  : <span key={i} className="aspect-[9/19] rounded-lg border border-dashed border-ink/15" />)}
              </span>
              <span className="mt-auto flex items-center justify-between border-t border-line pt-3 text-xs text-muted">
                <span>{a.projectCount} project{a.projectCount === 1 ? "" : "s"}{a.covers.length ? "" : " · No screenshots yet"}</span>
                <span className={tone}><span aria-hidden className="size-1.5 rounded-full bg-current" />{label}</span>
              </span>
            </Link>
          </li>
          );
        })}
      </ul>
      {atLimit ? (
        <p className="text-sm text-muted">Your plan includes {maxApps} app{maxApps === 1 ? "" : "s"}. Upgrade to add more.</p>
      ) : (
        <form onSubmit={create} className="flex flex-col gap-3 scroll-mt-24 rounded-card border border-dashed border-ink/15 p-5 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="label" htmlFor="app-name">New app name</label>
            <input id="app-name" className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button className="btn" disabled={busy}>Add app</button>
        </form>
      )}
      {error && <p role="alert" className="error">{error}</p>}
    </div>
  );
}
