import Link from "next/link";
import { notFound } from "next/navigation";
import { PLANS } from "@chitrapx/db";
import { BrandForm } from "@/components/BrandForm.tsx";
import { DeleteAppButton } from "@/components/DeleteAppButton.tsx";
import { ImportProjectButton } from "@/components/ImportProjectButton.tsx";
import { ProjectList } from "@/components/ProjectList.tsx";
import { getApp } from "@/server/apps.ts";
import { requireContext } from "@/server/context.ts";
import { HttpError } from "@/server/http.ts";
import { listProjects } from "@/server/projects.ts";
import { supabaseStorage } from "@/server/storage.ts";
import { listAssets } from "@/server/uploads.ts";
import { UploadGrid } from "@/components/UploadGrid.tsx";
import { AiDesignCard } from "@/components/AiDesignCard.tsx";

export default async function AppPage({ params }: { params: Promise<{ appId: string }> }) {
  const ctx = await requireContext();
  const { appId } = await params;
  const app = await getApp(ctx, appId).catch((e) => { if (e instanceof HttpError && e.status === 404) notFound(); throw e; });
  const [projects, assets] = await Promise.all([listProjects(ctx, app.id), listAssets(ctx, supabaseStorage(), app.id)]);
  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard" className="text-sm text-neutral-500 hover:underline">Apps</Link>
          <h1 className="text-2xl font-semibold">{app.name}</h1>
        </div>
        <div className="flex items-center gap-3">
          <ImportProjectButton appId={app.id} />
          <DeleteAppButton appId={app.id} />
        </div>
      </div>
      <AiDesignCard appId={app.id} screenshotCount={assets.filter((a) => a.kind === "screenshot").length} />
      <ProjectList appId={app.id} projects={projects.map(({ id, name, kind, updatedAt }) => ({ id, name, kind, updatedAt: updatedAt.toISOString() }))} maxProjects={PLANS[ctx.plan].maxProjects} />
      <UploadGrid appId={app.id} logoAssetId={app.brand.logoAssetId} assets={assets.filter((a) => a.kind !== "recording").map(({ id, url, width, height }) => ({ id, url, width, height }))} />
      <UploadGrid appId={app.id} kind="recording" assets={assets.filter((a) => a.kind === "recording").map(({ id, url, width, height, meta }) => ({ id, url, width, height, pending: !meta?.ready && !meta?.error, error: meta?.error }))} />
      <BrandForm app={{ id: app.id, name: app.name, description: app.description, platformHint: app.platformHint, brand: app.brand }} />
    </>
  );
}
