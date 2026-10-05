"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { track } from "@/lib/track.ts";
import { api } from "@/server/api.ts";

type Row = { id: string; name: string; kind: string; updatedAt: string };
const KINDS = [["screenshots", "Store screenshots"], ["video", "Preview video"], ["social", "Social images"]] as const;

export function ProjectList({ appId, projects, maxProjects }: { appId: string; projects: Row[]; maxProjects: number }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>("screenshots");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    try { await fn(); router.refresh(); } catch (err) { setError((err as Error).message); }
  };

  return (
    <section className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Projects</h2>
        {projects.length < maxProjects && <Link href={`/dashboard/apps/${appId}/templates`} className="btn">Start from a template</Link>}
      </div>
      {projects.length === 0 && <p className="text-sm text-neutral-500">No projects yet.</p>}
      <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {projects.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-2">
            {editing === p.id ? (
              <form className="flex flex-1 gap-2" onSubmit={(e) => {
                e.preventDefault();
                const value = new FormData(e.currentTarget).get("name");
                run(() => api(`/api/projects/${p.id}`, "PATCH", { name: value })).then(() => setEditing(null));
              }}>
                <input name="name" aria-label="Project name" defaultValue={p.name} className="input" autoFocus maxLength={120} />
                <button className="btn-ghost">Save</button>
              </form>
            ) : (
              <div className="flex flex-1 items-center gap-2">
                <Link href={`/dashboard/projects/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                <span className="text-xs text-neutral-500">{KINDS.find(([k]) => k === p.kind)?.[1]}</span>
                <button className="text-xs text-neutral-500 hover:underline" onClick={() => setEditing(p.id)}>Rename</button>
              </div>
            )}
            <button className="btn-danger" onBlur={() => setArmed(null)} onClick={() =>
              armed === p.id ? run(() => api(`/api/projects/${p.id}`, "DELETE")) : setArmed(p.id)}>
              {armed === p.id ? "Confirm" : "Delete"}
            </button>
          </li>
        ))}
      </ul>
      {projects.length < maxProjects ? (
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => {
          e.preventDefault();
          run(() => api(`/api/apps/${appId}/projects`, "POST", { name, kind }).then(() => { track("project_created", { source: "blank" }); })).then(() => setName(""));
        }}>
          <div className="flex-1">
            <label className="label" htmlFor="project-name">Or a blank project</label>
            <input id="project-name" className="input" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="project-kind">Type</label>
            <select id="project-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
          <button className="btn">Create</button>
        </form>
      ) : (
        <p className="text-sm text-neutral-500">Your plan includes {maxProjects} projects. Upgrade to add more.</p>
      )}
      {error && <p role="alert" className="error">{error}</p>}
    </section>
  );
}
