import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { describe, expect, it } from "vitest";
import { db, schema } from "@chitrapx/db";
import { seedTemplates } from "@chitrapx/db/seed";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { createApp } from "@/server/apps.ts";
import type { Ctx } from "@/server/context.ts";
import { createProject, getProject, saveDoc } from "@/server/projects.ts";
import { readJsonLimited } from "@/server/http.ts";
import { getVersion, listVersions, NAMED_VERSIONS_MAX, pruneVersions, restoreVersion, saveNamedVersion, VERSIONS_KEPT } from "@/server/versions.ts";

async function setup() {
  await seedTemplates();
  const user = await createUser();
  const ctx: Ctx = { userId: user.id, workspaceId: await makeWorkspace(user.id), plan: "pro" };
  const app = await createApp(ctx, { name: "A" });
  const p = await createProject(ctx, app.id, { name: "T", templateSlug: "amoura-dating" });
  return { ctx, p: await getProject(ctx, p.id) };
}

describe("versions", () => {
  it("named save, list without doc, and preview", async () => {
    const { ctx, p } = await setup();
    const v = await saveNamedVersion(ctx, p.id, { label: "  Launch set  " });
    expect(v).toMatchObject({ kind: "named", label: "Launch set", revision: p.revision });
    const list = await listVersions(ctx, p.id);
    expect(list[0]).toMatchObject({ id: v.id, kind: "named" });
    expect("doc" in list[0]!).toBe(false);
    expect((await getVersion(ctx, p.id, v.id)).doc.groups.length).toBe(p.doc.groups.length);
    await expect(saveNamedVersion(ctx, p.id, { label: "" })).rejects.toBeInstanceOf(ZodError);
  });

  it("restore snapshots the current doc, writes the version as a new revision, and 409s when stale", async () => {
    const { ctx, p } = await setup();
    const v = await saveNamedVersion(ctx, p.id, { label: "Before edit" });
    const edited = { ...p.doc, groups: p.doc.groups.slice(0, 1).map((g) => ({ ...g, boards: g.boards.slice(0, 1) })) };
    const { revision } = await saveDoc(ctx, p.id, { doc: edited, revision: p.revision });
    await expect(restoreVersion(ctx, p.id, v.id, { revision: revision - 1 })).rejects.toMatchObject({ status: 409 });
    expect((await listVersions(ctx, p.id)).filter((x) => x.kind === "restore")).toEqual([]);
    const out = await restoreVersion(ctx, p.id, v.id, { revision });
    expect(out.revision).toBe(revision + 1);
    expect(out.doc.groups[0]!.boards.length).toBe(p.doc.groups[0]!.boards.length);
    const before = (await listVersions(ctx, p.id)).find((x) => x.kind === "restore")!;
    expect(before).toMatchObject({ label: "Before restore", revision });
    expect((await getProject(ctx, p.id)).revision).toBe(revision + 1);
  });

  it("another workspace cannot see or restore versions", async () => {
    const { ctx, p } = await setup();
    const v = await saveNamedVersion(ctx, p.id, { label: "Mine" });
    const other = await setup();
    await expect(getVersion(other.ctx, p.id, v.id)).rejects.toMatchObject({ status: 404 });
    await expect(listVersions(other.ctx, p.id)).rejects.toMatchObject({ status: 404 });
    await expect(restoreVersion(other.ctx, p.id, v.id, { revision: p.revision })).rejects.toMatchObject({ status: 404 });
  });

  it("prunes automatic versions beyond 50, keeps named ones and ones a running export reads", async () => {
    const { ctx, p } = await setup();
    const named = await saveNamedVersion(ctx, p.id, { label: "Keep" });
    const rows = await db.insert(schema.projectVersions).values(Array.from({ length: VERSIONS_KEPT + 5 }, (_, i) => ({
      workspaceId: ctx.workspaceId, projectId: p.id, revision: i, doc: p.doc, kind: "auto" as const, createdAt: new Date(Date.now() - (100 - i) * 60_000),
    }))).returning({ id: schema.projectVersions.id });
    const oldest = rows[0]!.id;
    await db.insert(schema.jobs).values({ workspaceId: ctx.workspaceId, projectId: p.id, type: "export", status: "running", creditsReserved: 1, input: { versionId: oldest } });
    await pruneVersions(db, ctx.workspaceId, p.id);
    const left = await db.select({ id: schema.projectVersions.id, kind: schema.projectVersions.kind }).from(schema.projectVersions).where(eq(schema.projectVersions.projectId, p.id));
    expect(left.filter((x) => x.kind !== "named")).toHaveLength(VERSIONS_KEPT + 1); // newest 50 + the one a running job reads
    expect(left.some((x) => x.id === named.id)).toBe(true);
    expect(left.some((x) => x.id === oldest)).toBe(true);
  });

  it("caps named versions per project (SP16)", async () => {
    const { ctx, p } = await setup();
    await db.insert(schema.projectVersions).values(Array.from({ length: NAMED_VERSIONS_MAX }, (_, i) => ({
      workspaceId: ctx.workspaceId, projectId: p.id, revision: p.revision, doc: p.doc, kind: "named" as const, label: `N${i}`,
    })));
    await expect(saveNamedVersion(ctx, p.id, { label: "One too many" })).rejects.toMatchObject({ status: 409, code: "named_limit" });
    const named = (await listVersions(ctx, p.id)).filter((v) => v.kind === "named");
    expect(named).toHaveLength(NAMED_VERSIONS_MAX);
  });

  it("an old named version stays in the list however many automatic versions follow (SP16)", async () => {
    const { ctx, p } = await setup();
    const old = await saveNamedVersion(ctx, p.id, { label: "Launch" });
    await db.insert(schema.projectVersions).values(Array.from({ length: 120 }, (_, i) => ({
      workspaceId: ctx.workspaceId, projectId: p.id, revision: i, doc: p.doc, kind: "auto" as const, createdAt: new Date(Date.now() + (i + 1) * 1000),
    })));
    const list = await listVersions(ctx, p.id);
    expect(list.some((v) => v.id === old.id)).toBe(true);
    expect(list.filter((v) => v.kind !== "named")).toHaveLength(100);
    // Newest first overall.
    expect(list.map((v) => +new Date(v.createdAt))).toEqual([...list.map((v) => +new Date(v.createdAt))].sort((a, b) => b - a));
  });

  it("an oversized versions request body says so, not that the project is too large (SP9)", async () => {
    const req = new Request("http://x", { method: "POST", body: "x".repeat(5000) });
    await expect(readJsonLimited(req, 4096, "Request too large")).rejects.toMatchObject({ status: 413, message: "Request too large" });
  });
});
