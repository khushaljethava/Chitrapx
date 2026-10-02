import { PLANS } from "@chitrapx/db";
import { AppList } from "@/components/AppList.tsx";
import { listApps } from "@/server/apps.ts";
import { requireContext } from "@/server/context.ts";

export default async function Dashboard() {
  const ctx = await requireContext();
  const apps = await listApps(ctx);
  return (
    <>
      <h1 className="text-2xl font-semibold">Your apps</h1>
      <AppList apps={apps.map(({ id, name, platformHint }) => ({ id, name, platformHint }))} maxApps={PLANS[ctx.plan].maxApps} />
    </>
  );
}
