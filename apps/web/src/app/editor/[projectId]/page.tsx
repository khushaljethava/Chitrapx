import { notFound } from "next/navigation";
import { Editor } from "@/editor/Editor.tsx";
import { requireContext } from "@/server/context.ts";
import { HttpError } from "@/server/http.ts";
import { assetUrlMap, getProject } from "@/server/projects.ts";
import { appStorage } from "@/server/storage.ts";
import { listAssets } from "@/server/uploads.ts";
import { listFonts } from "@/server/fonts.ts";
import { facesOf } from "@/lib/fontFaces.ts";
import { getApp } from "@/server/apps.ts";
import { brandPalette } from "@chitrapx/document";

export const metadata = { title: "Editor · Chitrapx" };

export default async function EditorPage({ params }: { params: Promise<{ projectId: string }> }) {
  const ctx = await requireContext();
  const project = await getProject(ctx, (await params).projectId).catch((e) => { if (e instanceof HttpError && e.status === 404) notFound(); throw e; });
  const storage = appStorage();
  const [docUrls, assets, fonts, app] = await Promise.all([assetUrlMap(ctx, storage, project.doc), listAssets(ctx, storage, project.appId), listFonts(ctx, storage), getApp(ctx, project.appId)]);
  // Everything the app has uploaded is pickable, so its URLs must resolve too.
  const assetUrls = {
    ...docUrls,
    ...Object.fromEntries(assets.flatMap((a) => a.kind === "recording"
      ? (a.videoUrl ? [[`asset:${a.id}`, a.videoUrl], [`asset:${a.id}#poster`, a.url]] : [])
      : [[`asset:${a.id}`, a.url]])),
  };
  return (
    <Editor
      appId={project.appId}
      project={{ id: project.id, name: project.name, doc: project.doc, revision: project.revision }}
      assets={assets.filter((a) => a.kind !== "recording" || a.videoUrl).map(({ id, url, width, height, kind }) => ({ id, url, width, height, kind }))}
      assetUrls={assetUrls}
      fonts={fonts}
      extras={{ faces: facesOf(fonts), palette: brandPalette(app.brand) }}
    />
  );
}
