"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/server/api.ts";

type AppRow = { id: string; name: string; platformHint: string };

export function AppList({ apps, maxApps }: { apps: AppRow[]; maxApps: number }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
      <p className="text-sm text-neutral-500">{apps.length} of {maxApps} app{maxApps === 1 ? "" : "s"} on your plan</p>
      {apps.length === 0 && <p className="text-neutral-500">No apps yet. Add the app you want store screenshots for.</p>}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {apps.map((a) => (
          <li key={a.id}>
            <Link href={`/dashboard/apps/${a.id}`} className="card group flex items-center gap-4 transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-600/5">
              <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-800 font-display text-lg font-bold text-white">{a.name.slice(0, 1).toUpperCase()}</span>
              <span className="min-w-0">
                <span className="block truncate font-semibold group-hover:text-indigo-600">{a.name}</span>
                <span className="chip mt-1">{a.platformHint}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {atLimit ? (
        <p className="text-sm text-neutral-500">Your plan includes {maxApps} app{maxApps === 1 ? "" : "s"}. Upgrade to add more.</p>
      ) : (
        <form onSubmit={create} className="flex flex-col gap-3 rounded-2xl border border-dashed border-neutral-300 p-5 sm:flex-row sm:items-end dark:border-neutral-700">
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
