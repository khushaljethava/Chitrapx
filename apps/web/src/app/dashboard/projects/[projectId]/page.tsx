import Link from "next/link";
import { notFound } from "next/navigation";
import { BundleButton } from "@/components/BundleButton.tsx";
import { ShareToCommunity } from "@/components/Community.tsx";
import { ExportPanel } from "@/components/ExportPanel.tsx";
import { ProjectAi } from "@/components/ProjectAi.tsx";
import { SocialButton } from "@/components/SocialButton.tsx";
import { VideoPanel } from "@/components/VideoPanel.tsx";
import { ProjectBoards } from "@/components/ProjectBoards.tsx";
import { SharePanel } from "@/components/SharePanel.tsx";
import { briefText } from "@chitrapx/document";
import { getApp } from "@/server/apps.ts";
import { can } from "@/server/authz.ts";
import { requireContext } from "@/server/context.ts";
import { HttpError } from "@/server/http.ts";
import { assetUrlMap, getProject } from "@/server/projects.ts";
import { renderExtras } from "@/server/renderExtras.ts";
import { getShare } from "@/server/shares.ts";
import { appStorage } from "@/server/storage.ts";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const ctx = await requireContext();
  const project = await getProject(ctx, (await params).projectId).catch((e) => { if (e instanceof HttpError && e.status === 404) notFound(); throw e; });
  const [assetUrls, extras, app, share] = await Promise.all([assetUrlMap(ctx, appStorage(), project.doc), renderExtras(ctx, appStorage(), { doc: project.doc, appId: project.appId }), getApp(ctx, project.appId), getShare(ctx, project.id)]);
  return (
    <>
      <div>
        <Link href={`/dashboard/apps/${project.appId}`} className="text-sm text-neutral-500 hover:underline">Back to app</Link>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <div className="flex gap-2">
            <BundleButton projectId={project.id} />
            <SocialButton projectId={project.id} />
            <SharePanel projectId={project.id} canShare={can(ctx, "share")} initial={share && { slug: share.slug, path: share.path, allowDuplicate: share.allowDuplicate, expiresAt: share.expiresAt?.toISOString() ?? null }} />
            <ShareToCommunity projectId={project.id} defaultTitle={project.name} />
            <Link href={`/dashboard/projects/${project.id}/preview`} className="btn-ghost">Store preview</Link>
            <Link href={`/editor/${project.id}`} className="btn">{can(ctx, "edit") ? "Open editor" : "Open (view only)"}</Link>
          </div>
        </div>
      </div>
      <ProjectAi projectId={project.id} appId={project.appId} brief={briefText(app.brief)} codes={[project.doc.localization.baseLocale, ...project.doc.localization.locales.map((l) => l.code)]} />
      <ExportPanel projectId={project.id} doc={project.doc} />
      <ProjectBoards doc={project.doc} assetUrls={assetUrls} extras={extras} />
      {project.doc.groups.length > 0 && <VideoPanel projectId={project.id} doc={project.doc} assetUrls={assetUrls} extras={extras} />}
    </>
  );
}
