import Link from "next/link";
import { notFound } from "next/navigation";
import { StorePreview } from "@/components/StorePreview.tsx";
import { getApp } from "@/server/apps.ts";
import { requireContext } from "@/server/context.ts";
import { HttpError } from "@/server/http.ts";
import { assetUrlMap, getProject } from "@/server/projects.ts";
import { appStorage } from "@/server/storage.ts";

export default async function PreviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const ctx = await requireContext();
  const project = await getProject(ctx, (await params).projectId).catch((e) => { if (e instanceof HttpError && e.status === 404) notFound(); throw e; });
  const [app, assetUrls] = await Promise.all([getApp(ctx, project.appId), assetUrlMap(ctx, appStorage(), project.doc)]);
  const subtitle = (app.description.split(/(?<=[.!?])\s/)[0] ?? "").slice(0, 80) || "Your app subtitle";
  return (
    <>
      <div>
        <Link href={`/dashboard/projects/${project.id}`} className="text-sm text-neutral-500 hover:underline">Back to project</Link>
        <h1 className="text-2xl font-semibold">Store preview</h1>
        <p className="text-sm text-neutral-500">How {project.name} looks to shoppers. Store layouts are approximations.</p>
      </div>
      <StorePreview doc={project.doc} assetUrls={assetUrls} app={{ name: app.name, subtitle }} />
    </>
  );
}
