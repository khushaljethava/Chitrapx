import { PLANS } from "@chitrapx/db";
import { AppList } from "@/components/AppList.tsx";
import { DevJobsPanel } from "@/components/DevJobsPanel.tsx";
import { MetricCard } from "@/components/ui.tsx";
import { devToolsEnabled } from "@/server/devTools.ts";
import { listApps } from "@/server/apps.ts";
import { requireContext } from "@/server/context.ts";
import { appStorage } from "@/server/storage.ts";
import { appCovers } from "@/server/uploads.ts";

export default async function Dashboard() {
  const ctx = await requireContext();
  const [apps, covers] = await Promise.all([listApps(ctx), appCovers(ctx, appStorage())]);
  const maxApps = PLANS[ctx.plan].maxApps;
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-extrabold sm:text-4xl">Your apps</h1>
          <p className="text-muted">Store screenshot sets for every app in this workspace.</p>
        </div>
        <a href={apps.length >= maxApps ? "/dashboard/billing" : "#app-name"} className="btn">{apps.length >= maxApps ? "Upgrade for more apps" : "+ New app"}</a>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <MetricCard label="Apps" value={apps.length} note={`${maxApps} on your plan`} />
        <MetricCard label="Projects" value={apps.reduce((n, a) => n + a.projectCount, 0)} note="Across all apps" />
        <MetricCard label="Exported sets" value={apps.filter((a) => a.exportStatus === "done").length} note="Latest full-set export finished" tone="success" />
      </div>
      <AppList apps={apps.map(({ id, name, platformHint, projectCount, updatedAt, exportStatus }) => ({ id, name, platformHint, projectCount, updatedAt: updatedAt.toISOString(), exportStatus, covers: covers[id] ?? [] }))} maxApps={maxApps} />
      {devToolsEnabled() && <DevJobsPanel />}
    </>
  );
}
