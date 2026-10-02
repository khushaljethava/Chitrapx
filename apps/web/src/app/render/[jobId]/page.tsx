import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema, verifyRenderSig } from "@chitrapx/db";
import { exportPlan, migrate } from "@chitrapx/document";
import { RenderSheet } from "@/components/RenderSheet.tsx";
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
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.status, "running"), eq(schema.jobs.type, "export")));
  if (!job?.projectId) notFound();
  const [project] = await db.select().from(schema.projects)
    .where(and(eq(schema.projects.id, job.projectId), eq(schema.projects.workspaceId, job.workspaceId)));
  if (!project) notFound();

  const doc = migrate(project.doc);
  const plan = exportPlan(doc, (job.input as { locales?: string[] }).locales);
  const wanted = (items ?? "").split(",").filter(Boolean).map(Number).filter((i) => Number.isInteger(i) && plan[i]);
  const assetUrls = await assetUrlMap({ userId: "", workspaceId: job.workspaceId, plan: "free" }, supabaseStorage(), doc);
  return <RenderSheet doc={doc} plan={plan} indices={wanted.length ? wanted : plan.map((_, i) => i)} assetUrls={assetUrls} />;
}
