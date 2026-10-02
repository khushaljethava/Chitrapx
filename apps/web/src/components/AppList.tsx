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
      {apps.length === 0 && <p className="text-neutral-500">No apps yet. Add the app you want store screenshots for.</p>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {apps.map((a) => (
          <li key={a.id}>
            <Link href={`/dashboard/apps/${a.id}`} className="card block hover:border-indigo-400">
              <span className="font-medium">{a.name}</span>
              <span className="ml-2 text-xs uppercase text-neutral-500">{a.platformHint}</span>
            </Link>
          </li>
        ))}
      </ul>
      {atLimit ? (
        <p className="text-sm text-neutral-500">Your plan includes {maxApps} app{maxApps === 1 ? "" : "s"}. Upgrade to add more.</p>
      ) : (
        <form onSubmit={create} className="card flex flex-col gap-3 sm:flex-row sm:items-end">
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
