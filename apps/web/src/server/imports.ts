import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { db, PLANS, reserveAndEnqueue, schema, withTx } from "@chitrapx/db";
import { MAX_BUNDLE_BYTES } from "@chitrapx/document";
import { getApp } from "./apps.ts";
import type { Ctx } from "./context.ts";
import { HttpError } from "./http.ts";
import { assertFreeQuota } from "./jobs.ts";
import type { ObjectStorage } from "./storage.ts";
import { stagingPath } from "./uploads.ts";

/** Early, friendly check; the worker checks again under the workspace lock. */
async function assertProjectRoom(ctx: Ctx) {
  const [{ n }] = (await db.select({ n: count() }).from(schema.projects).where(eq(schema.projects.workspaceId, ctx.workspaceId))) as [{ n: number }];
  if (n >= PLANS[ctx.plan].maxProjects) throw new HttpError(403, "plan_limit", `Your plan allows ${PLANS[ctx.plan].maxProjects} projects`);
}

/** A one-time token to upload a .chitrapx file into this workspace's staging area. */
export async function signImport(ctx: Ctx, storage: ObjectStorage, appId: string, raw: unknown) {
  await getApp(ctx, appId);
  const { size } = z.object({ size: z.number().int().positive() }).parse(raw);
  if (size > MAX_BUNDLE_BYTES) throw new HttpError(413, "too_large", "Project files can be up to 500 MB");
  await assertProjectRoom(ctx);
  const uploadId = randomUUID();
  return { uploadId, ...(await storage.signUpload(stagingPath(ctx, uploadId))) };
}

/** Free: the worker checks and imports the uploaded file. */
export async function enqueueImport(ctx: Ctx, boss: PgBoss, appId: string, raw: unknown): Promise<{ jobId: string }> {
  await getApp(ctx, appId);
  const input = z.object({ uploadId: z.uuid(), name: z.string().trim().min(1).max(120) }).parse(raw);
  await assertProjectRoom(ctx);
  return withTx(async (tx) => {
    await assertFreeQuota(tx, ctx.workspaceId);
    return reserveAndEnqueue(tx, boss, { workspaceId: ctx.workspaceId, type: "project_import", input: { appId, ...input } });
  });
}
