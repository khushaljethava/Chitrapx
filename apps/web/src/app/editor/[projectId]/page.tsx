import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectBoards } from "@/components/ProjectBoards.tsx";
import { ViewerComments } from "@/components/Comments.tsx";
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
  if (!ctx) return <AccessRemoved />;
  const project = await getProject(ctx, (await params).projectId).catch((e) => { if (e instanceof HttpError && e.status === 404) notFound(); throw e; });
  const storage = appStorage();
  const search = await searchParams;
  // SP15: viewers get a read-only view (no editor state, nothing to autosave).
  if (!can(ctx, "edit")) {
    const [assetUrls, extras] = await Promise.all([assetUrlMap(ctx, storage, project.doc), renderExtras(ctx, storage, { doc: project.doc, appId: project.appId })]);
    return (
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Link href={`/dashboard/projects/${project.id}`} className="text-sm text-neutral-500 hover:underline">Back to project</Link>
            <h1 className="text-2xl font-semibold">{project.name}</h1>
          </div>
          <span className="rounded-full bg-neutral-100 px-3 py-1 text-sm text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">View only · you can comment</span>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <ProjectBoards doc={project.doc} assetUrls={assetUrls} extras={extras} />
          <ViewerComments projectId={project.id} moderate={false} boards={project.doc.groups.flatMap((g) => g.boards.map((b, i) => ({ id: b.id, name: b.name || `Board ${i + 1}` })))} />
        </div>
        <AccessWatcher />
      </main>
    );
  }
  const [docUrls, assets, fonts, app, user] = await Promise.all([assetUrlMap(ctx, storage, project.doc), listAssets(ctx, storage, project.appId), listFonts(ctx, storage), getApp(ctx, project.appId), currentUser()]);
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
    >
      <EditorComments projectId={project.id} moderate={can(ctx, "members")} initiallyOpen={search.comments === "1"} />
    </Editor>
    <AccessWatcher />
    </>
  );
}
