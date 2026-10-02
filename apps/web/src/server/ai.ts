import { and, count, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { db, reserveAndEnqueue, schema, withTx } from "@chitrapx/db";
import { LOCALE_CODE } from "@chitrapx/document";
import { getApp } from "./apps.ts";
import type { Ctx } from "./context.ts";
import { badRequest } from "./http.ts";
import { createProject, deleteProject, getProject } from "./projects.ts";

const designInput = z.object({ brief: z.string().trim().max(2000).optional() });
const translateInput = z.object({ locales: z.array(z.string().regex(LOCALE_CODE)).min(1).max(20) });

const enqueue = (ctx: Ctx, boss: PgBoss, projectId: string, type: "ai_design" | "ai_translate" | "ai_copy", input: unknown) =>
  withTx((tx) => reserveAndEnqueue(tx, boss, { workspaceId: ctx.workspaceId, projectId, type, input }));

/** Creates the project the design lands in, then queues the job. No credits, no leftover empty project. */
export async function startAiDesign(ctx: Ctx, boss: PgBoss, appId: string, raw: unknown) {
  const app = await getApp(ctx, appId);
  const { brief } = designInput.parse(raw ?? {});
  const [{ n }] = (await db.select({ n: count() }).from(schema.assets).where(and(
    eq(schema.assets.workspaceId, ctx.workspaceId), eq(schema.assets.appId, app.id), eq(schema.assets.kind, "screenshot"),
  ))) as [{ n: number }];
  if (!n) throw badRequest("no_screenshots");
  const project = await createProject(ctx, app.id, { name: "AI design", kind: "screenshots" });
  try {
    const { jobId } = await enqueue(ctx, boss, project.id, "ai_design", { appId: app.id, brief });
    return { projectId: project.id, jobId };
  } catch (err) {
    await deleteProject(ctx, project.id);
    throw err;
  }
}

export async function startTranslate(ctx: Ctx, boss: PgBoss, projectId: string, raw: unknown) {
  const project = await getProject(ctx, projectId);
  const { locales } = translateInput.parse(raw ?? {});
  if (locales.includes(project.doc.localization.baseLocale)) throw badRequest("base_locale");
  if (!project.doc.groups.length) throw badRequest("project_is_empty");
  return enqueue(ctx, boss, project.id, "ai_translate", { locales: [...new Set(locales)] });
}

export async function startCopyVariants(ctx: Ctx, boss: PgBoss, projectId: string) {
  const project = await getProject(ctx, projectId);
  if (!project.doc.groups.length) throw badRequest("project_is_empty");
  return enqueue(ctx, boss, project.id, "ai_copy", {});
}
