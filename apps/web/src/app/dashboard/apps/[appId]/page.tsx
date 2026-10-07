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
import { appStorage } from "@/server/storage.ts";
import { listAssets, listReferences } from "@/server/uploads.ts";
import { listFonts } from "@/server/fonts.ts";
import { UploadGrid } from "@/components/UploadGrid.tsx";
import { AiDesignCard } from "@/components/AiDesignCard.tsx";
import { ReferenceBoard } from "@/components/ReferenceBoard.tsx";

const SECTIONS = [["overview", "Overview"], ["projects", "Projects"], ["uploads", "Screenshots"], ["references", "References"], ["brand", "Brand"]] as const;

export default async function AppPage({ params }: { params: Promise<{ appId: string }> }) {
  const ctx = await requireContext();
  const { appId } = await params;
  const app = await getApp(ctx, appId).catch((e) => { if (e instanceof HttpError && e.status === 404) notFound(); throw e; });
  const [projects, assets, fonts, references] = await Promise.all([listProjects(ctx, app.id), listAssets(ctx, appStorage(), app.id), listFonts(ctx, appStorage()), listReferences(ctx, appStorage(), app.id)]);
  return (
    <>
      <div className="space-y-4">
        <nav aria-label="Breadcrumb" className="text-sm text-neutral-500">
          <Link href="/dashboard" className="hover:text-neutral-900 dark:hover:text-neutral-100">Apps</Link>
          <span className="mx-1.5">/</span><span className="text-neutral-900 dark:text-neutral-100">{app.name}</span>
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span aria-hidden className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-800 font-display text-2xl font-bold text-white">{app.name.slice(0, 1).toUpperCase()}</span>
            <div>
              <h1 className="text-3xl font-bold">{app.name}</h1>
              <span className="chip mt-1">{app.platformHint}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/dashboard/apps/${app.id}/launch-assets`} className="btn-ghost">Launch assets</Link>
            <ImportProjectButton appId={app.id} />
            <DeleteAppButton appId={app.id} />
          </div>
        </div>
      </div>
      {/* ponytail: plain anchor links, no scroll-spy; add one if people lose their place */}
      <nav aria-label="Sections" className="sticky top-[53px] z-20 -mx-4 flex gap-1 overflow-x-auto border-b border-neutral-200 bg-neutral-50/90 px-4 py-2 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
        {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`} className="nav-link whitespace-nowrap rounded-full">{label}</a>)}
      </nav>
      <div id="overview" className="scroll-mt-32">
        <AiDesignCard appId={app.id} screenshotCount={assets.filter((a) => a.kind === "screenshot").length} brief={app.brief} />
      </div>
      <div id="projects" className="scroll-mt-32">
        <ProjectList appId={app.id} projects={projects.map(({ id, name, kind, updatedAt }) => ({ id, name, kind, updatedAt: updatedAt.toISOString() }))} maxProjects={PLANS[ctx.plan].maxProjects} />
      </div>
      <div id="uploads" className="scroll-mt-32 space-y-8">
        <UploadGrid appId={app.id} logoAssetId={app.brand.logoAssetId} assets={assets.filter((a) => a.kind !== "recording").map(({ id, url, width, height }) => ({ id, url, width, height }))} />
        <UploadGrid appId={app.id} kind="recording" assets={assets.filter((a) => a.kind === "recording").map(({ id, url, width, height, meta }) => ({ id, url, width, height, pending: !meta?.ready && !meta?.error, error: meta?.error }))} />
      </div>
      <div id="references" className="scroll-mt-32">
        <ReferenceBoard appId={app.id} rows={references.map(({ id, url, insight }) => ({ id, url, insight }))} summary={app.brief.competitor ?? ""} />
      </div>
      <div id="brand" className="scroll-mt-32">
        <BrandForm app={{ id: app.id, name: app.name, description: app.description, platformHint: app.platformHint, brand: app.brand }} fonts={fonts}
          screenshots={assets.filter((a) => a.kind === "screenshot" && a.url).map((a) => a.url)} />
      </div>
    </>
  );
}
