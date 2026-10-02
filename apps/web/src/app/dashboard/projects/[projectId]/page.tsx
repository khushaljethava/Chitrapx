import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectBoards } from "@/components/ProjectBoards.tsx";
import { requireContext } from "@/server/context.ts";
import { HttpError } from "@/server/http.ts";
import { assetUrlMap, getProject } from "@/server/projects.ts";
import { supabaseStorage } from "@/server/storage.ts";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const ctx = await requireContext();
  const project = await getProject(ctx, (await params).projectId).catch((e) => { if (e instanceof HttpError && e.status === 404) notFound(); throw e; });
  const assetUrls = await assetUrlMap(ctx, supabaseStorage(), project.doc);
  return (
    <>
      <div>
        <Link href={`/dashboard/apps/${project.appId}`} className="text-sm text-neutral-500 hover:underline">Back to app</Link>
        <h1 className="text-2xl font-semibold">{project.name}</h1>
      </div>
      <ProjectBoards doc={project.doc} assetUrls={assetUrls} />
    </>
  );
}
