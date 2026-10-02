import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, schema } from "@chitrapx/db";
import { seedTemplates } from "@chitrapx/db/seed";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { createApp } from "@/server/apps.ts";
import type { Ctx } from "@/server/context.ts";
import { createProject, getProject, saveDoc } from "@/server/projects.ts";

async function setup() {
  await seedTemplates();
  const user = await createUser();
  const ctx: Ctx = { userId: user.id, workspaceId: await makeWorkspace(user.id, "pro"), plan: "pro" };
  const app = await createApp(ctx, { name: "A" });
  const project = await createProject(ctx, app.id, { name: "P", templateSlug: "amoura-dating" });
  return { ctx, project };
}
const status = (p: Promise<unknown>) => p.then(() => 200, (e: { status?: number; name?: string }) => e.status ?? (e.name === "ZodError" ? 400 : 500));

describe("saveDoc", () => {
  it("saves on the current revision and increments it", async () => {
    const { ctx, project } = await setup();
    const { doc } = await getProject(ctx, project.id);
    doc.groups[0]!.boards[0]!.name = "Renamed";
    expect(await saveDoc(ctx, project.id, { doc, revision: 0 })).toEqual({ revision: 1 });
    const saved = await getProject(ctx, project.id);
    expect(saved.revision).toBe(1);
    expect(saved.doc.groups[0]!.boards[0]!.name).toBe("Renamed");
  });

  it("rejects a stale revision with 409 and the current revision, leaving the doc unchanged", async () => {
    const { ctx, project } = await setup();
    const { doc } = await getProject(ctx, project.id);
    await saveDoc(ctx, project.id, { doc, revision: 0 });
    doc.groups[0]!.boards[0]!.name = "Lost update";
    await expect(saveDoc(ctx, project.id, { doc, revision: 0 })).rejects.toMatchObject({ status: 409, code: "conflict", current: 1 });
    expect((await getProject(ctx, project.id)).doc.groups[0]!.boards[0]!.name).not.toBe("Lost update");
  });

  it("rejects invalid and oversized documents and other workspaces' projects", async () => {
    const { ctx, project } = await setup();
    expect(await status(saveDoc(ctx, project.id, { doc: { schemaVersion: 1, kind: "screenshots", groups: [{ id: "g", target: "nope", boards: [] }] }, revision: 0 }))).toBe(400);
    const { doc } = await getProject(ctx, project.id);
    const huge = { ...doc, groups: [{ ...doc.groups[0]!, boards: [{ ...doc.groups[0]!.boards[0]!, name: "x".repeat(6 * 1024 * 1024) }] }] };
    expect(await status(saveDoc(ctx, project.id, { doc: huge, revision: 0 }))).toBe(413);
    const other = await setup();
    expect(await status(saveDoc(other.ctx, project.id, { doc, revision: 0 }))).toBe(404);
    expect((await getProject(ctx, project.id)).revision).toBe(0);
  });

  it("copies every 20th revision into project versions", async () => {
    const { ctx, project } = await setup();
    let { doc, revision } = await getProject(ctx, project.id);
    for (let i = 0; i < 20; i++) ({ revision } = await saveDoc(ctx, project.id, { doc, revision }));
    const rows = await db.select().from(schema.projectVersions).where(eq(schema.projectVersions.projectId, project.id));
    expect(rows.map((r) => r.revision)).toEqual([20]);
    void sql;
  });
});
