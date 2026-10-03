import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db, exportSource, schema, verifyRenderSig } from "@chitrapx/db";
import { exportPlan, migrate, VIDEO_FORMAT_IDS, type VideoFormat } from "@chitrapx/document";
import { RenderSheet } from "@/components/RenderSheet.tsx";
import { VideoSheet } from "@/components/VideoSheet.tsx";
import { assetUrlMap } from "@/server/projects.ts";
import { supabaseStorage } from "@/server/storage.ts";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

/**
 * Headless-only page the export worker screenshots. Requires a fresh HMAC for this job and the
 * job to be running; anything else is a plain 404 that reveals nothing.
 */
export default async function RenderPage({ params, searchParams }: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ exp?: string; sig?: string; items?: string }>;
}) {
  const { jobId } = await params;
  const { exp, sig, items } = await searchParams;
  if (!verifyRenderSig(jobId, exp, sig)) notFound();
  const [job] = await db.select().from(schema.jobs)
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.status, "running"), inArray(schema.jobs.type, ["export", "export_single", "video"])));
  if (!job?.projectId) notFound();
  if (job.type === "video") {
    const [project] = await db.select().from(schema.projects)
      .where(and(eq(schema.projects.id, job.projectId), eq(schema.projects.workspaceId, job.workspaceId)));
    if (!project) notFound();
    const doc = migrate(project.doc);
    const input = job.input as { groupId?: string; locale?: string; format?: string; secondsPerBoard?: number };
    const group = doc.groups.find((g) => g.id === input.groupId);
    const format = VIDEO_FORMAT_IDS.includes(input.format as VideoFormat) ? (input.format as VideoFormat) : null;
    if (!group || !format) notFound();
    const jobCtx = { userId: "", workspaceId: job.workspaceId, plan: "free" as const };
    // A recording that is not converted is missing here, so a paid render fails and refunds instead of omitting it.
    const urls = await assetUrlMap(jobCtx, supabaseStorage(), doc);
    return <VideoSheet doc={doc} groupId={group.id} locale={input.locale ?? doc.localization.baseLocale} format={format} secondsPerBoard={input.secondsPerBoard ?? 3} assetUrls={urls} />;
  }
  const src = await exportSource(job);
  if (!src) notFound();
  const plan = exportPlan(src.doc, src.selection);
  const wanted = (items ?? "").split(",").filter(Boolean).map(Number).filter((i) => Number.isInteger(i) && plan[i]);
  const jobCtx = { userId: "", workspaceId: job.workspaceId, plan: "free" as const };
  const assetUrls = await assetUrlMap(jobCtx, supabaseStorage(), src.doc);
  return <RenderSheet doc={src.doc} plan={plan} indices={wanted.length ? wanted : plan.map((_, i) => i)} assetUrls={assetUrls} />;
}
