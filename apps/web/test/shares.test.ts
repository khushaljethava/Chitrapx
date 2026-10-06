import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db, pool, schema, type Plan } from "@chitrapx/db";
import type { ChitrapxDoc } from "@chitrapx/document";
import { memoryStorage } from "@chitrapx/storage";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { createApp } from "@/server/apps.ts";
import type { Ctx } from "@/server/context.ts";
import { assetUrlMap, createProject, getProject, saveDoc } from "@/server/projects.ts";
import { disableShare, duplicateShared, enableShare, getShare, sharedAsset, sharedView } from "@/server/shares.ts";

// Needs migration 0014.
const storage = memoryStorage();
type User = Ctx & { appId: string; email: string };

async function user(plan: Plan = "pro", withApp = true): Promise<User> {
  const u = await createUser();
  const ctx: Ctx = { userId: u.id, workspaceId: await makeWorkspace(u.id, plan), plan, role: "owner" };
  const appId = withApp ? (await createApp(ctx, { name: "App" })).id : "";
  return { ...ctx, appId, email: u.email };
}

async function shot(ctx: User): Promise<string> {
  const sha = randomBytes(32).toString("hex");
  await storage.put(`${ctx.workspaceId}/${sha}`, randomBytes(64), "image/png");
  const [a] = await db.insert(schema.assets).values({ workspaceId: ctx.workspaceId, appId: ctx.appId, kind: "screenshot", storagePath: `${ctx.workspaceId}/${sha}`, mime: "image/png", width: 10, height: 20, bytes: 64, sha256: sha }).returning();
  return a!.id;
}

const docWith = (appId: string, assetId: string): ChitrapxDoc => ({
  schemaVersion: 1, kind: "screenshots", brand: { appId }, localization: { baseLocale: "en-US", locales: [] },
  groups: [{ id: "g", target: "iphone-6.9", spanElements: [], boards: [{ id: "b1", name: "One", position: { x: 0, y: 0 }, size: { width: 100, height: 200 }, backgroundColor: "#fff", zoom: 1,
    elements: [{ id: "e1", type: "image", position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, imageSrc: `asset:${assetId}` }] }] }],
}) as unknown as ChitrapxDoc;

async function project(ctx: User, assetId: string) {
  const p = await createProject(ctx, ctx.appId, { name: "Launch set", kind: "screenshots" });
  await saveDoc(ctx, p.id, { doc: docWith(ctx.appId, assetId), revision: 0 });
  return getProject(ctx, p.id);
}

let owner: User;
let src: Awaited<ReturnType<typeof project>>;
let used: string;
let unused: string;
let otherProjectAsset: string;

beforeAll(async () => {
  owner = await user("studio");
  used = await shot(owner);
  unused = await shot(owner);
  otherProjectAsset = await shot(owner);
  src = await project(owner, used);
  await project(owner, otherProjectAsset);
});

describe("share links", () => {
  it("an anonymous view has the boards and signed URLs for this project's assets only, and nothing private", async () => {
    const share = await enableShare(owner, src.id, {});
    expect(share.slug).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(share.path).toBe(`/s/${share.slug}`);
    const view = await sharedView(share.slug);
    expect(view.name).toBe("Launch set");
    expect(view.doc.groups[0]!.boards).toHaveLength(1);
    expect(Object.keys(view.assetUrls)).toEqual([`asset:${used}`]);
    expect(view.allowDuplicate).toBe(true);
    const json = JSON.stringify(view);
    for (const secret of [owner.workspaceId, owner.userId, owner.appId, owner.email, unused, otherProjectAsset, "updatedBy", "workspace", "updated_by"]) expect(json).not.toContain(secret);
  });

  it("asset links are our signed, short-lived URLs that stream the bytes while the link is live", async () => {
    const share = await enableShare(owner, src.id, {});
    const url = new URL((await sharedView(share.slug)).assetUrls[`asset:${used}`]!, "http://x");
    expect(url.pathname).toBe(`/api/shared/${share.slug}/assets/${used}`);
    expect(Number(url.searchParams.get("exp")) - Date.now()).toBeLessThanOrEqual(60 * 60_000);
    const got = await sharedAsset(storage, share.slug, used, url);
    expect(got.contentType).toBe("image/png");
    const tampered = new URL(url);
    tampered.searchParams.set("sig", "0".repeat(64));
    await expect(sharedAsset(storage, share.slug, used, tampered)).rejects.toMatchObject({ status: 404 });
    // A signature for one asset does not open another one in the workspace.
    await expect(sharedAsset(storage, share.slug, unused, url)).rejects.toMatchObject({ status: 404 });
  });

  it("one active link per project; enabling again keeps the slug and updates options", async () => {
    const a = await enableShare(owner, src.id, {});
    const b = await enableShare(owner, src.id, { allowDuplicate: false });
    expect(b.slug).toBe(a.slug);
    expect(b.allowDuplicate).toBe(false);
    expect((await getShare(owner, src.id))?.slug).toBe(a.slug);
    await enableShare(owner, src.id, { allowDuplicate: true });
  });

  it("regenerate kills the old slug; disable kills the link on the next request", async () => {
    const old = await enableShare(owner, src.id, {});
    const fresh = await enableShare(owner, src.id, { regenerate: true });
    expect(fresh.slug).not.toBe(old.slug);
    await expect(sharedView(old.slug)).rejects.toMatchObject({ status: 404 });
    await expect(sharedView(fresh.slug)).resolves.toBeTruthy();
    await disableShare(owner, src.id);
    await expect(sharedView(fresh.slug)).rejects.toMatchObject({ status: 404 });
    expect(await getShare(owner, src.id)).toBeNull();
  });

  it("an expired link is 404; an expiry in the past is refused", async () => {
    const s = await enableShare(owner, src.id, { regenerate: true });
    await pool.query("update project_shares set expires_at = now() - interval '1 second' where slug = $1", [s.slug]);
    await expect(sharedView(s.slug)).rejects.toMatchObject({ status: 404 });
    await expect(enableShare(owner, src.id, { regenerate: true, expiresAt: "2001-01-01T00:00:00Z" })).rejects.toMatchObject({ status: 400 });
    await expect(sharedView("not a slug")).rejects.toMatchObject({ status: 404 });
  });

  it("viewers cannot create or disable links; other workspaces cannot see them", async () => {
    await expect(enableShare({ ...owner, role: "viewer" }, src.id, {})).rejects.toMatchObject({ status: 403 });
    await expect(disableShare({ ...owner, role: "viewer" }, src.id)).rejects.toMatchObject({ status: 403 });
    const stranger = await user();
    await expect(enableShare(stranger, src.id, {})).rejects.toMatchObject({ status: 404 });
  });
});

describe("duplicate into my workspace", () => {
  it("copies the doc and its images into the visitor's workspace; the copy is independent", async () => {
    const share = await enableShare(owner, src.id, { regenerate: true });
    const visitor = await user("pro");
    const { projectId } = await duplicateShared(visitor, storage, share.slug, { appId: visitor.appId });
    const copy = await getProject(visitor, projectId);
    expect(copy.workspaceId).toBe(visitor.workspaceId);
    expect(copy.revision).toBe(0);
    expect(copy.name).toBe("Launch set (copy)");
    const el = copy.doc.groups[0]!.boards[0]!.elements[0] as unknown as { imageSrc: string };
    const newId = el.imageSrc.slice("asset:".length);
    expect(newId).not.toBe(used);
    expect(copy.doc.brand).toEqual({ appId: visitor.appId });
    // Same document apart from re-pointed images and the app link.
    const strip = (d: ChitrapxDoc, id: string) => JSON.stringify({ ...d, brand: null }).replaceAll(id, "X");
    expect(strip(copy.doc, newId)).toBe(strip(src.doc, used));
    // Its images resolve in the visitor's workspace.
    const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, newId));
    expect(asset!.workspaceId).toBe(visitor.workspaceId);
    expect(await storage.exists(`${visitor.workspaceId}/${asset!.sha256}`)).toBe(true);
    expect(Object.keys(await assetUrlMap(visitor, storage, copy.doc))).toEqual([`asset:${newId}`]);
    // Editing the copy leaves the original alone; the copy has no link.
    await saveDoc(visitor, projectId, { doc: { ...copy.doc, groups: [] }, revision: 0 });
    expect((await getProject(owner, src.id)).doc.groups).toHaveLength(1);
    expect(await getShare(visitor, projectId)).toBeNull();
  });

  it("a free user at 3 projects gets the plan limit", async () => {
    const share = await enableShare(owner, src.id, {});
    const free = await user("free");
    await pool.query("insert into projects (workspace_id, app_id, name, kind, doc) select $1, $2, 'p', 'screenshots', '{}' from generate_series(1, 3)", [free.workspaceId, free.appId]);
    await expect(duplicateShared(free, storage, share.slug, {})).rejects.toMatchObject({ status: 403, code: "plan_limit" });
  });

  it("respects allow_duplicate, needs an app, and needs edit rights", async () => {
    const share = await enableShare(owner, src.id, { allowDuplicate: false });
    const visitor = await user("pro");
    await expect(duplicateShared(visitor, storage, share.slug, {})).rejects.toMatchObject({ status: 403, code: "duplicate_disabled" });
    await enableShare(owner, src.id, { allowDuplicate: true });
    const appless = await user("pro", false);
    await expect(duplicateShared(appless, storage, share.slug, {})).rejects.toMatchObject({ status: 400, code: "no_app" });
    await expect(duplicateShared({ ...visitor, role: "viewer" }, storage, share.slug, {})).rejects.toMatchObject({ status: 403 });
    // Without an appId the visitor's first app is used.
    const { projectId } = await duplicateShared(visitor, storage, share.slug, {});
    expect((await getProject(visitor, projectId)).appId).toBe(visitor.appId);
  });
});
