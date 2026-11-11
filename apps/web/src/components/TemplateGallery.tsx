"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { passthroughSrc } from "@chitrapx/renderer";
import { track } from "@/lib/track.ts";
import { api } from "@/server/api.ts";
import type { TemplateSummary } from "@/server/templates.ts";
import { BoardThumb } from "./BoardThumb.tsx";

export function TemplateGallery({ appId, templates, categories, screenshotCount }: {
  appId: string; templates: TemplateSummary[]; categories: Record<string, string>; screenshotCount: number;
}) {
  const router = useRouter();
  const tabs = useMemo(() => Object.keys(categories).filter((c) => templates.some((t) => t.category === c)), [categories, templates]);
  const [tab, setTab] = useState(tabs[0] ?? "screenshots");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function use(t: TemplateSummary) {
    setBusy(t.slug);
    setError("");
    try {
      const p = await api<{ id: string }>(`/api/apps/${appId}/projects`, "POST", { name: t.name, templateSlug: t.slug });
      track("project_created", { source: "template" });
      router.push(`/dashboard/projects/${p.id}`);
    } catch (err) { setError((err as Error).message); setBusy(null); }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-500">
        {screenshotCount > 0
          ? `Your ${screenshotCount} screenshot${screenshotCount === 1 ? "" : "s"} will be placed into the device screens in order.`
          : "Upload screenshots on the app page first and they will be placed into the device screens automatically."}
      </p>
      <div role="tablist" className="flex flex-wrap gap-2">
        {tabs.map((c) => (
          <button key={c} role="tab" aria-selected={tab === c} onClick={() => setTab(c)}
            className={tab === c ? "btn rounded-full" : "btn-ghost rounded-full"}>{categories[c]}</button>
        ))}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.filter((t) => t.category === tab).map((t) => {
          const g = t.preview.groups[0]!;
          return (
            <li key={t.slug} className="card flex flex-col gap-4 p-4 transition duration-200 hover:border-indigo-300 dark:hover:border-indigo-800">
              <div className="flex h-56 items-center justify-center overflow-hidden rounded-xl bg-neutral-100 dark:bg-neutral-800/60">
                <BoardThumb doc={t.preview} groupId={g.id} boardIndex={0} locale={null} height={g.boards[0]!.size.width > g.boards[0]!.size.height ? 140 : 220} resolveSrc={passthroughSrc} placeholders />
              </div>
              <div className="flex-1 space-y-1">
                <h3 className="font-semibold">{t.name}</h3>
                {t.description && <p className="line-clamp-2 text-sm text-neutral-500">{t.description}</p>}
              </div>
              <button className="btn" disabled={busy !== null} onClick={() => use(t)}>{busy === t.slug ? "Creating" : "Use template"}</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
