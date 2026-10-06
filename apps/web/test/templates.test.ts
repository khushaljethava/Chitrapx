import { describe, expect, it } from "vitest";
import { db, schema } from "@chitrapx/db";
import { seedTemplates } from "@chitrapx/db/seed";
import type { ChitrapxDoc } from "@chitrapx/document";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { createApp } from "@/server/apps.ts";
import type { Ctx } from "@/server/context.ts";
import { assetUrlMap, createProject, getProject } from "@/server/projects.ts";
import { listTemplates } from "@/server/templates.ts";
import type { ObjectStorage } from "@/server/storage.ts";

const storage = { signedUrls: async (paths: string[]) => paths.map((p) => `signed://${p}`) } as unknown as ObjectStorage;

async function setup() {
  await seedTemplates();
  const user = await createUser();
  const ctx: Ctx = { userId: user.id, workspaceId: await makeWorkspace(user.id, "pro"), plan: "pro", role: "owner" };
  const app = await createApp(ctx, { name: "Bloom" });
  return { ctx, app };
}
async function addScreenshot(ctx: Ctx, appId: string, sha: string) {
  const [a] = await db.insert(schema.assets).values({ workspaceId: ctx.workspaceId, appId, kind: "screenshot", storagePath: `${ctx.workspaceId}/${sha}`, mime: "image/png", bytes: 1, sha256: sha }).returning();
  return a!;
}
const screens = (doc: ChitrapxDoc) => doc.groups.flatMap((g) => g.boards.flatMap((b) => b.elements.filter((e) => e.type === "device").map((e) => (e as { screenshotSrc?: string }).screenshotSrc)));

describe("templates", () => {
  it("lists every template with a light preview of its first board only", async () => {
    await seedTemplates();
    const list = await listTemplates();
    expect(list).toHaveLength(101);
    const t = list.find((x) => x.slug === "amoura-dating")!;
    expect(t.preview.groups).toHaveLength(1);
    expect(t.preview.groups[0]!.boards).toHaveLength(1);
  });

  it("creates a project from a template and fills device screens with the app's screenshots in upload order", async () => {
    const { ctx, app } = await setup();
    const a1 = await addScreenshot(ctx, app.id, "1".repeat(64));
    const a2 = await addScreenshot(ctx, app.id, "2".repeat(64));
    const p = await createProject(ctx, app.id, { name: "Launch", templateSlug: "amoura-dating" });
    const doc = (await getProject(ctx, p.id)).doc;
    expect(doc.brand).toEqual({ appId: app.id });
    expect(screens(doc).slice(0, 2)).toEqual([`asset:${a1.id}`, `asset:${a2.id}`]);
    expect(screens(doc).slice(2).every((s) => !s)).toBe(true);
  });

  it("rejects an unknown template and hides other workspaces' projects", async () => {
    const { ctx, app } = await setup();
    await expect(createProject(ctx, app.id, { name: "X", templateSlug: "nope" })).rejects.toMatchObject({ status: 400 });
    const p = await createProject(ctx, app.id, { name: "Mine", templateSlug: "amoura-dating" });
    const other = await setup();
    await expect(getProject(other.ctx, p.id)).rejects.toMatchObject({ status: 404 });
  });

  it("signs only assets that belong to the workspace, keyed by their document source", async () => {
    const { ctx, app } = await setup();
    const a1 = await addScreenshot(ctx, app.id, "3".repeat(64));
    const p = await createProject(ctx, app.id, { name: "P", templateSlug: "amoura-dating" });
    const doc = (await getProject(ctx, p.id)).doc;
    const foreign = crypto.randomUUID();
    (doc.groups[0]!.boards[1]!.elements.find((e) => e.type === "device") as { screenshotSrc?: string }).screenshotSrc = `asset:${foreign}`;
    const urls = await assetUrlMap(ctx, storage, doc);
    expect(urls).toEqual({ [`asset:${a1.id}`]: `signed://${ctx.workspaceId}/${"3".repeat(64)}` });
  });
});

describe("social images", () => {
  it("creates a social project with the first board at every social size, within plan limits", async () => {
    const { createSocialProject } = await import("@/server/projects.ts");
    const { ctx, app } = await setup();
    const p = await createProject(ctx, app.id, { name: "Launch", templateSlug: "amoura-dating" });
    const social = await createSocialProject(ctx, p.id);
    const doc = (await getProject(ctx, social.id)).doc;
    expect(doc.kind).toBe("social");
    expect(doc.groups.map((g) => g.target)).toEqual(["instagram-post", "instagram-story", "x-post", "linkedin-post", "product-hunt"]);
    expect(doc.groups.every((g) => g.boards.length === 1)).toBe(true);
    expect(doc.groups[2]!.boards[0]!.size).toEqual({ width: 1600, height: 900 });
  });
});
