import { and, count, desc, eq, getTableColumns } from "drizzle-orm";
import { z } from "zod";
import { db, emptyDoc, lockWorkspace, PLANS, projectKinds, schema, withTx } from "@chitrapx/db";
import { getApp } from "./apps.ts";
import type { Ctx } from "./context.ts";
import { HttpError, notFound } from "./http.ts";

const name = z.string().trim().min(1).max(120);
const createInput = z.object({ name, kind: z.enum(projectKinds) });
const updateInput = z.object({ name });

export type Project = typeof schema.projects.$inferSelect;
export type ProjectSummary = Omit<Project, "doc">;

const own = (ctx: Ctx, id: string) => and(eq(schema.projects.id, id), eq(schema.projects.workspaceId, ctx.workspaceId));
const valid = (id: string) => { if (!z.uuid().safeParse(id).success) throw notFound(); };

export async function listProjects(ctx: Ctx, appId: string): Promise<ProjectSummary[]> {
  await getApp(ctx, appId);
  const { doc: _doc, ...cols } = getTableColumns(schema.projects);
  return db.select(cols).from(schema.projects)
    .where(and(eq(schema.projects.appId, appId), eq(schema.projects.workspaceId, ctx.workspaceId)))
    .orderBy(desc(schema.projects.updatedAt));
}

export async function createProject(ctx: Ctx, appId: string, raw: unknown): Promise<Project> {
  await getApp(ctx, appId);
  return withTx(async ({ db: tx }) => {
    await lockWorkspace(tx, ctx.workspaceId);
    const [{ n }] = (await tx.select({ n: count() }).from(schema.projects).where(eq(schema.projects.workspaceId, ctx.workspaceId))) as [{ n: number }];
    if (n >= PLANS[ctx.plan].maxProjects) throw new HttpError(403, "plan_limit", `Your plan allows ${PLANS[ctx.plan].maxProjects} projects`);
    const input = createInput.parse(raw);
    const [project] = await tx.insert(schema.projects).values({
      workspaceId: ctx.workspaceId, appId, name: input.name, kind: input.kind, doc: emptyDoc(input.kind), updatedBy: ctx.userId,
    }).returning();
    return project!;
  });
}

export async function updateProject(ctx: Ctx, projectId: string, raw: unknown): Promise<Project> {
  valid(projectId);
  const input = updateInput.parse(raw);
  const [project] = await db.update(schema.projects)
    .set({ name: input.name, updatedAt: new Date(), updatedBy: ctx.userId })
    .where(own(ctx, projectId)).returning();
  if (!project) throw notFound();
  return project;
}

export async function deleteProject(ctx: Ctx, projectId: string): Promise<void> {
  valid(projectId);
  const gone = await db.delete(schema.projects).where(own(ctx, projectId)).returning({ id: schema.projects.id });
  if (!gone.length) throw notFound();
}
