import { PLANS } from "@chitrapx/db";
import { AppList } from "@/components/AppList.tsx";
import { DevJobsPanel } from "@/components/DevJobsPanel.tsx";
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
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold">Your apps</h1>
        <span className="chip normal-case tracking-normal">{apps.length} of {maxApps} app{maxApps === 1 ? "" : "s"} on your plan</span>
      </div>
      <AppList apps={apps.map(({ id, name, platformHint, projectCount, updatedAt, exportStatus }) => ({ id, name, platformHint, projectCount, updatedAt: updatedAt.toISOString(), exportStatus, covers: covers[id] ?? [] }))} maxApps={maxApps} />
      {devToolsEnabled() && <DevJobsPanel />}
    </>
  );
}
