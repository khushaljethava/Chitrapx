import { notFound } from "next/navigation";
import { Editor } from "@/editor/Editor.tsx";
import { requireContext } from "@/server/context.ts";
import { HttpError } from "@/server/http.ts";
import { assetUrlMap, getProject } from "@/server/projects.ts";
import { supabaseStorage } from "@/server/storage.ts";
import { listAssets } from "@/server/uploads.ts";

export const metadata = { title: "Editor · Chitrapx" };

export default async function EditorPage({ params }: { params: Promise<{ projectId: string }> }) {
  const ctx = await requireContext();
  const project = await getProject(ctx, (await params).projectId).catch((e) => { if (e instanceof HttpError && e.status === 404) notFound(); throw e; });
  const storage = supabaseStorage();
  const [docUrls, assets] = await Promise.all([assetUrlMap(ctx, storage, project.doc), listAssets(ctx, storage, project.appId)]);
  // Everything the app has uploaded is pickable, so its URLs must resolve too.
  const assetUrls = { ...docUrls, ...Object.fromEntries(assets.map((a) => [`asset:${a.id}`, a.url])) };
  return (
    <Editor
      project={{ id: project.id, name: project.name, doc: project.doc, revision: project.revision }}
      assets={assets.map(({ id, url, width, height }) => ({ id, url, width, height }))}
      assetUrls={assetUrls}
    />
  );
}
