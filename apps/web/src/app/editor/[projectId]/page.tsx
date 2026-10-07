import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectBoards } from "@/components/ProjectBoards.tsx";
import { SharePanel } from "@/components/SharePanel.tsx";
import { getShare } from "@/server/shares.ts";
import { ViewerComments } from "@/components/Comments.tsx";
import { NoticePage } from "@/components/Notice.tsx";
import { AccessRemoved, AccessWatcher } from "@/components/Workspaces.tsx";
import { Editor } from "@/editor/Editor.tsx";
import { EditorComments } from "@/editor/ui/CommentsPanel.tsx";
import { can } from "@/server/authz.ts";
import { canSendCommands } from "@/server/commands.ts";
import { currentUser, requireContext } from "@/server/context.ts";
import { renderExtras } from "@/server/renderExtras.ts";
import { HttpError } from "@/server/http.ts";
import { assetUrlMap, getProject } from "@/server/projects.ts";
import { appStorage } from "@/server/storage.ts";
import { listAssets } from "@/server/uploads.ts";
import { listFonts } from "@/server/fonts.ts";
import { facesOf } from "@/lib/fontFaces.ts";
import { getApp } from "@/server/apps.ts";
import { brandPalette } from "@chitrapx/document";

export const metadata = { title: "Editor · Chitrapx" };

export default async function EditorPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ translations?: string; comments?: string }> }) {
  const ctx = await requireContext().catch((e) => { if (e instanceof HttpError && e.code === "access_removed") return null; throw e; });
  if (!ctx) return <NoticePage><AccessRemoved /></NoticePage>;
  const project = await getProject(ctx, (await params).projectId).catch((e) => { if (e instanceof HttpError && e.status === 404) notFound(); throw e; });
  const storage = appStorage();
  const search = await searchParams;
  // SP15: viewers get a read-only view (no editor state, nothing to autosave).
  if (!can(ctx, "edit")) {
    const [assetUrls, extras] = await Promise.all([assetUrlMap(ctx, storage, project.doc), renderExtras(ctx, storage, { doc: project.doc, appId: project.appId })]);
    return (
      <div className="min-h-screen">
        {/* Same bar as the editor Toolbar, minus the editing tools (Stitch view-only design). */}
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-neutral-200 bg-white/80 px-3 py-1.5 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/80">
          <Link href={`/dashboard/projects/${project.id}`} aria-label="Back to project" className="nav-link px-2 text-base">←</Link>
          <span className="font-display font-bold tracking-tight">Chitrapx</span>
          <span className="h-5 w-px bg-neutral-200 dark:bg-neutral-800" />
          <h1 className="min-w-0 max-w-64 truncate text-sm font-semibold">{project.name}</h1>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            <svg aria-hidden viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
            View only · you can comment
          </span>
        </header>
        <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[1fr_20rem]">
          <ProjectBoards doc={project.doc} assetUrls={assetUrls} extras={extras} />
          <aside className="card h-fit lg:sticky lg:top-16">
            <ViewerComments projectId={project.id} moderate={false} boards={project.doc.groups.flatMap((g) => g.boards.map((b, i) => ({ id: b.id, name: b.name || `Board ${i + 1}` })))} />
          </aside>
        </main>
        <AccessWatcher />
      </div>
    );
  }
  const [docUrls, assets, fonts, app, user, share] = await Promise.all([assetUrlMap(ctx, storage, project.doc), listAssets(ctx, storage, project.appId), listFonts(ctx, storage), getApp(ctx, project.appId), currentUser(), getShare(ctx, project.id)]);
  // SP15 presence: the name others see next to this editor's cursor.
  const meta = (user?.user_metadata ?? {}) as { full_name?: string; name?: string; avatar_url?: string };
  const me = { userId: ctx.userId, name: meta.full_name || meta.name || user?.email || "Someone", avatarUrl: meta.avatar_url ?? null };
  // Everything the app has uploaded is pickable, so its URLs must resolve too.
  const assetUrls = {
    ...docUrls,
    ...Object.fromEntries(assets.flatMap((a) => a.kind === "recording"
      ? (a.videoUrl ? [[`asset:${a.id}`, a.videoUrl], [`asset:${a.id}#poster`, a.url]] : [])
      : [[`asset:${a.id}`, a.url]])),
  };
  return (
    <>
    <Editor
      appId={project.appId}
      project={{ id: project.id, name: project.name, doc: project.doc, revision: project.revision }}
      assets={assets.filter((a) => a.kind !== "recording" || a.videoUrl).map(({ id, url, width, height, kind }) => ({ id, url, width, height, kind }))}
      assetUrls={assetUrls}
      fonts={fonts}
      extras={{ faces: facesOf(fonts), palette: brandPalette(app.brand) }}
      openTranslations={search.translations === "1"}
      glossary={app.glossary}
      me={me}
      canEdit={canSendCommands(ctx)}
      share={<SharePanel key="share" projectId={project.id} canShare={can(ctx, "share")} initial={share && { slug: share.slug, path: share.path, allowDuplicate: share.allowDuplicate, expiresAt: share.expiresAt?.toISOString() ?? null }} />}
    >
      <EditorComments projectId={project.id} moderate={can(ctx, "members")} initiallyOpen={search.comments === "1"} />
    </Editor>
    <AccessWatcher />
    </>
  );
}
