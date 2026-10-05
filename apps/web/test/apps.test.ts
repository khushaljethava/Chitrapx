import { describe, expect, it } from "vitest";
import { db, emptyDoc, schema } from "@chitrapx/db";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { createApp, deleteApp, getApp, updateApp } from "@/server/apps.ts";
import { createProject, deleteProject, listProjects, updateProject } from "@/server/projects.ts";
import type { Ctx } from "@/server/context.ts";

async function ctxFor(plan: Ctx["plan"] = "free"): Promise<Ctx> {
  const user = await createUser();
  return { userId: user.id, workspaceId: await makeWorkspace(user.id, plan), plan };
}
const status = (p: Promise<unknown>) => p.then(() => 200, (e: { status?: number; name?: string }) => e.status ?? (e.name === "ZodError" ? 400 : 500));

describe("apps", () => {
  it("free plan allows one app, the second is a 403 plan_limit", async () => {
    const ctx = await ctxFor("free");
    const app = await createApp(ctx, { name: "Bloom" });
    expect(app).toMatchObject({ name: "Bloom", platformHint: "both", brand: {} });
    await expect(createApp(ctx, { name: "Two" })).rejects.toMatchObject({ status: 403, code: "plan_limit" });
  });

  it("validates brand colours and trims names", async () => {
    const ctx = await ctxFor("pro");
    expect(await status(createApp(ctx, { name: "X", brand: { primaryColor: "red" } }))).toBe(400);
    expect(await status(createApp(ctx, { name: "   " }))).toBe(400);
    const app = await createApp(ctx, { name: "  Y  ", brand: { primaryColor: "#112233" } });
    expect(app).toMatchObject({ name: "Y", brand: { primaryColor: "#112233" } });
  });

  it("another workspace's app is a 404 for update, delete and project creation", async () => {
    const owner = await ctxFor();
    const intruder = await ctxFor();
    const app = await createApp(owner, { name: "Mine" });
    expect(await status(updateApp(intruder, app.id, { name: "pwned" }))).toBe(404);
    expect(await status(deleteApp(intruder, app.id))).toBe(404);
    expect(await status(createProject(intruder, app.id, { name: "P", kind: "screenshots" }))).toBe(404);
    expect(await status(listProjects(intruder, app.id))).toBe(404);
  });

  it("rejects a logo asset from another workspace", async () => {
    const ctx = await ctxFor();
    const app = await createApp(ctx, { name: "A" });
    expect(await status(updateApp(ctx, app.id, { brand: { logoAssetId: crypto.randomUUID() } }))).toBe(400);
  });
  it("rejects a competitor reference image as the logo (SP11 final review)", async () => {
    const ctx = await ctxFor();
    const app = await createApp(ctx, { name: "A" });
    const sha = crypto.randomUUID().replace(/-/g, "").padEnd(64, "0");
    const asset = (kind: "reference" | "image") => db.insert(schema.assets).values({ workspaceId: ctx.workspaceId, appId: app.id, kind,
      storagePath: `${ctx.workspaceId}/${kind}-${sha}`, mime: "image/png", bytes: 1, sha256: `${kind[0]}${sha.slice(1)}` }).returning().then((r) => r[0]!);
    const ref = await asset("reference");
    await expect(updateApp(ctx, app.id, { brand: { logoAssetId: ref.id } })).rejects.toMatchObject({ status: 400, code: "unknown_logo_asset" });
    const img = await asset("image");
    expect((await updateApp(ctx, app.id, { brand: { logoAssetId: img.id } })).brand.logoAssetId).toBe(img.id);
  });
  it("brand font names follow the document's fontFamily rule", async () => {
    const ctx = await ctxFor("pro");
    expect(await status(createApp(ctx, { name: "F", brand: { headingFont: 'Evil"; }' } }))).toBe(400);
    expect(await status(createApp(ctx, { name: "G", brand: { headingFont: "Pacifico (custom)" } }))).toBe(200);
  });
  it("validates the palette: hex only, known tokens, each once, at most six", async () => {
    const ctx = await ctxFor("pro");
    const app = await createApp(ctx, { name: "P" });
    const ok = [{ token: "primary", color: "#112233" }, { token: "accent", color: "#445566" }];
    expect((await updateApp(ctx, app.id, { brand: { palette: ok } })).brand.palette).toEqual(ok);
    expect(await status(updateApp(ctx, app.id, { brand: { palette: [{ token: "primary", color: "red" }] } }))).toBe(400);
    expect(await status(updateApp(ctx, app.id, { brand: { palette: [{ token: "pink", color: "#112233" }] } }))).toBe(400);
    expect(await status(updateApp(ctx, app.id, { brand: { palette: [{ token: "text", color: "#111111" }, { token: "text", color: "#222222" }] } }))).toBe(400);
  });
});

describe("projects", () => {
  it("creates with an empty doc at revision 0; the 4th on free is a 403", async () => {
    const ctx = await ctxFor("free");
    const app = await createApp(ctx, { name: "A" });
    const p = await createProject(ctx, app.id, { name: "Launch", kind: "screenshots" });
    expect(p).toMatchObject({ revision: 0, doc: emptyDoc("screenshots"), kind: "screenshots" });
    await createProject(ctx, app.id, { name: "2", kind: "video" });
    await createProject(ctx, app.id, { name: "3", kind: "social" });
    await expect(createProject(ctx, app.id, { name: "4", kind: "screenshots" })).rejects.toMatchObject({ status: 403 });
    expect(await listProjects(ctx, app.id)).toHaveLength(3);
  });

  it("renames and deletes only within the workspace", async () => {
    const ctx = await ctxFor();
    const other = await ctxFor();
    const app = await createApp(ctx, { name: "A" });
    const p = await createProject(ctx, app.id, { name: "Old", kind: "screenshots" });
    expect(await status(updateProject(other, p.id, { name: "x" }))).toBe(404);
    expect(await status(deleteProject(other, p.id))).toBe(404);
    expect(await updateProject(ctx, p.id, { name: "New" })).toMatchObject({ name: "New" });
    await deleteProject(ctx, p.id);
    expect(await listProjects(ctx, app.id)).toHaveLength(0);
  });
});

describe("app brief and glossary (SP11)", () => {
  it("merges the brief field by field and keeps fields that were not sent", async () => {
    const ctx = await ctxFor("pro");
    const app = await createApp(ctx, { name: "B" });
    expect(app).toMatchObject({ brief: {}, glossary: [] });
    await updateApp(ctx, app.id, { brief: { text: "  Busy parents  ", tone: "calm" } });
    const next = await updateApp(ctx, app.id, { brief: { keywords: ["Meal plan", "meal plan", "groceries"] } });
    expect(next.brief).toEqual({ text: "Busy parents", tone: "calm", keywords: ["Meal plan", "groceries"] });
  });

  it("rejects a brief over 2000 characters with a message and stores nothing", async () => {
    const ctx = await ctxFor("pro");
    const app = await createApp(ctx, { name: "L" });
    await expect(updateApp(ctx, app.id, { brief: { text: "x".repeat(2001) } }))
      .rejects.toMatchObject({ issues: [expect.objectContaining({ message: "Keep the brief under 2000 characters" })] });
    expect((await getApp(ctx, app.id)).brief).toEqual({});
  });

  it("replaces the glossary and validates its terms", async () => {
    const ctx = await ctxFor("pro");
    const app = await createApp(ctx, { name: "G" });
    expect((await updateApp(ctx, app.id, { glossary: ["Bloom", "bloom", "Pour-over Pro"] })).glossary).toEqual(["Bloom", "Pour-over Pro"]);
    expect((await updateApp(ctx, app.id, { glossary: [] })).glossary).toEqual([]);
    expect(await status(updateApp(ctx, app.id, { glossary: ["x".repeat(61)] }))).toBe(400);
  });
});
