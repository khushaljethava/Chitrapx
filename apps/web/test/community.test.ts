import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "@chitrapx/db";
import { seedTemplates } from "@chitrapx/db/seed";
import type { ChitrapxDoc } from "@chitrapx/document";
import { memoryStorage } from "@chitrapx/storage";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { createApp } from "@/server/apps.ts";
import {
  deletePost, getPost, importPost, isStaffEmail, listPosts, moderatePost, moderationQueue, publishPost, PUBLISH_PER_DAY, REPORT_HIDE_THRESHOLD, reportPost, snapshotDoc,
} from "@/server/community.ts";
import type { Ctx } from "@/server/context.ts";
import { assetUrlMap, createProject, docAssetIds, getProject, saveDoc } from "@/server/projects.ts";

// Needs migration 0013 (community tables).
const storage = memoryStorage();

async function user(): Promise<Ctx & { appId: string }> {
  const u = await createUser();
  const ctx: Ctx = { userId: u.id, workspaceId: await makeWorkspace(u.id, "pro"), plan: "pro", role: "owner" };
  const app = await createApp(ctx, { name: "App" });
  return { ...ctx, appId: app.id };
}

/** A project built from a template whose device screens show two uploaded screenshots (bytes in storage). */
async function projectWithShots(ctx: Ctx & { appId: string }) {
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    const bytes = randomBytes(64);
    const sha = randomBytes(32).toString("hex");
    await storage.put(`${ctx.workspaceId}/${sha}`, bytes, "image/png");
    const [a] = await db.insert(schema.assets).values({ workspaceId: ctx.workspaceId, appId: ctx.appId, kind: "screenshot", storagePath: `${ctx.workspaceId}/${sha}`, mime: "image/png", width: 10, height: 20, bytes: 64, sha256: sha }).returning();
    ids.push(a!.id);
  }
  const p = await createProject(ctx, ctx.appId, { name: "Mine", templateSlug: "amoura-dating" });
  return getProject(ctx, p.id);
}

const input = (projectId: string, extra: Record<string, unknown> = {}) => ({ projectId, title: "Bold dating set", description: "Five boards", category: "social", license: true, ...extra });

const setDoc = async (ctx: Ctx, projectId: string, mutate: (d: ChitrapxDoc) => void) => {
  const p = await getProject(ctx, projectId);
  const doc = structuredClone(p.doc);
  mutate(doc);
  await saveDoc(ctx, projectId, { doc, revision: p.revision });
};
const firstDevice = (d: ChitrapxDoc) => d.groups[0]!.boards[0]!.elements.find((e) => e.type === "device") as unknown as Record<string, unknown>;

beforeAll(async () => { await seedTemplates(); });

describe("community snapshot", () => {
  const base = (): ChitrapxDoc => ({
    schemaVersion: 1, kind: "screenshots", brand: { appId: "secret-app" }, localization: { baseLocale: "en-US", locales: [] },
    groups: [{ id: "g", target: "iphone-6.9", spanElements: [], boards: [{ id: "b", name: "b", position: { x: 0, y: 0 }, size: { width: 100, height: 200 }, backgroundColor: "#fff", zoom: 1,
      elements: [{ id: "i", type: "image", position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, imageSrc: "asset:a1" }] }] }],
  }) as unknown as ChitrapxDoc;
  const ok = new Map([["a1", "screenshot"]]);

  it("drops the workspace link and keeps allowed images", () => {
    const { doc, assetIds } = snapshotDoc(base(), ok);
    expect(doc.brand).toBeUndefined();
    expect(assetIds).toEqual(["a1"]);
  });
  it("refuses remote URLs, recordings and assets from elsewhere, including inside language overrides", () => {
    const remote = base();
    (remote.groups[0]!.boards[0]!.elements[0] as unknown as Record<string, unknown>).imageSrc = "https://tracker.example/p.png";
    expect(() => snapshotDoc(remote, ok)).toThrow(/remove/i);
    expect(() => snapshotDoc(base(), new Map([["a1", "recording"]]))).toThrow();
    expect(() => snapshotDoc(base(), new Map())).toThrow();
    const localized = base();
    (localized.groups[0]!.boards[0] as unknown as Record<string, unknown>).localized = { "de-DE": { i: { imageSrc: "http://169.254.169.254/x" } } };
    expect(() => snapshotDoc(localized, ok)).toThrow();
  });
});

describe("community feed", () => {
  let author: Awaited<ReturnType<typeof user>>;
  let other: Awaited<ReturnType<typeof user>>;
  let postId: string;
  let projectId: string;

  beforeAll(async () => {
    author = await user();
    other = await user();
    projectId = (await projectWithShots(author)).id;
  });

  it("publishes a snapshot whose images are copied out of the author's workspace", async () => {
    const out = await publishPost(author, storage, input(projectId));
    postId = out.id;
    const [row] = await db.select().from(schema.communityPosts).where(eq(schema.communityPosts.id, postId));
    expect(row).toMatchObject({ authorId: author.userId, status: "published", importCount: 0, category: "social" });
    expect(row!.platforms).toContain("ios");
    expect((row!.doc as ChitrapxDoc).brand).toBeUndefined();
    expect(row!.assets.length).toBeGreaterThan(0);
    for (const a of row!.assets) expect(await storage.exists(`community/${postId}/${a.sha256}`)).toBe(true);

    const feed = await listPosts(other, storage, {});
    const card = feed.posts.find((p) => p.id === postId)!;
    expect(card).toMatchObject({ title: "Bold dating set", mine: false, importCount: 0 });
    expect(card.preview.groups[0]!.boards).toHaveLength(1);
    expect(Object.values(card.urls).every((u) => u.includes(`community/${postId}/`))).toBe(true);
    expect(JSON.stringify(card)).not.toContain(author.workspaceId);
  });

  it("refuses titles with markup, missing licence confirmation, and projects of another workspace", async () => {
    await expect(publishPost(author, storage, input(projectId, { title: "<b>x</b>" }))).rejects.toThrow();
    await expect(publishPost(author, storage, input(projectId, { license: false }))).rejects.toThrow();
    await expect(publishPost(other, storage, input(projectId))).rejects.toMatchObject({ status: 404 });
  });

  it("another user imports it into their own workspace; the count goes up once per user", async () => {
    const { projectId: copyId } = await importPost(other, storage, postId, { appId: other.appId });
    const copy = await getProject(other, copyId);
    expect(copy.appId).toBe(other.appId);
    expect(copy.doc.brand).toEqual({ appId: other.appId });
    const ids = docAssetIds(copy.doc);
    expect(ids.length).toBeGreaterThan(0);
    const rows = await db.select().from(schema.assets).where(eq(schema.assets.workspaceId, other.workspaceId));
    for (const id of ids) {
      const a = rows.find((r) => r.id === id)!;
      expect(a).toBeDefined();
      expect(await storage.exists(`${other.workspaceId}/${a.sha256}`)).toBe(true);
    }
    // Every image resolves inside the importer's workspace, so export never touches the author's files.
    const urls = await assetUrlMap(other, storage, copy.doc);
    expect(Object.keys(urls).sort()).toEqual(ids.map((id) => `asset:${id}`).sort());

    await importPost(other, storage, postId, { appId: other.appId });
    const [row] = await db.select({ n: schema.communityPosts.importCount }).from(schema.communityPosts).where(eq(schema.communityPosts.id, postId));
    expect(row!.n).toBe(1);
  });

  it("an author cannot report their own post; reports hide it at the threshold, after which only the author sees it", async () => {
    await expect(reportPost(author, postId, { reason: "spam" })).rejects.toMatchObject({ status: 400 });
    const reporters = await Promise.all(Array.from({ length: REPORT_HIDE_THRESHOLD }, () => user()));
    for (const [i, r] of reporters.entries()) {
      const out = await reportPost(r, postId, { reason: "spam" });
      // A second report by the same user does not count (the last reporter's post is already hidden).
      if (i < REPORT_HIDE_THRESHOLD - 1) expect((await reportPost(r, postId, { reason: "again" })).hidden).toBe(false);
      expect(out.hidden).toBe(i === REPORT_HIDE_THRESHOLD - 1);
    }
    await expect(getPost(other, storage, postId)).rejects.toMatchObject({ status: 404 });
    await expect(importPost(other, storage, postId, { appId: other.appId })).rejects.toMatchObject({ status: 404 });
    expect((await listPosts(other, storage, {})).posts.some((p) => p.id === postId)).toBe(false);
    expect((await getPost(author, storage, postId)).status).toBe("hidden");
  });

  it("staff see it in the queue and restore it; a non-staff moderator gets 404", async () => {
    await expect(moderatePost(other, false, postId, { action: "restore" })).rejects.toMatchObject({ status: 404 });
    await expect(moderationQueue(other, false)).rejects.toMatchObject({ status: 404 });
    const queue = await moderationQueue(other, true);
    expect(queue.find((q) => q.id === postId)).toMatchObject({ status: "hidden", reports: REPORT_HIDE_THRESHOLD });
    await moderatePost(other, true, postId, { action: "restore", note: "fine" });
    expect((await getPost(other, storage, postId)).status).toBe("published");
    const log = await db.select().from(schema.communityActions).where(eq(schema.communityActions.postId, postId));
    expect(log).toMatchObject([{ action: "restore", staffId: other.userId, note: "fine" }]);
  });

  it("staff removal hides it from everyone, the author included, and is logged", async () => {
    const extra = await publishPost(author, storage, input(projectId, { title: "To remove" }));
    await moderatePost(other, true, extra.id, { action: "remove" });
    await expect(getPost(author, storage, extra.id)).rejects.toMatchObject({ status: 404 });
    await expect(getPost(other, storage, extra.id)).rejects.toMatchObject({ status: 404 });
    expect(await db.select().from(schema.communityActions).where(and(eq(schema.communityActions.postId, extra.id), eq(schema.communityActions.action, "remove")))).toHaveLength(1);
  });

  it("the author deletes the post; the imported copy keeps working", async () => {
    const before = await listPosts(other, storage, {});
    const copyId = (await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.workspaceId, other.workspaceId)))[0]!.id;
    await expect(deletePost(other, storage, postId)).rejects.toMatchObject({ status: 404 });
    await deletePost(author, storage, postId);
    expect((await listPosts(other, storage, {})).posts.length).toBe(before.posts.length - 1);
    const copy = await getProject(other, copyId);
    const urls = await assetUrlMap(other, storage, copy.doc);
    expect(Object.keys(urls).length).toBe(docAssetIds(copy.doc).length);
  });

  it("the daily publish limit is a 429 that publishes nothing", async () => {
    const u = await user();
    const p = await projectWithShots(u);
    for (let i = 0; i < PUBLISH_PER_DAY; i++) await publishPost(u, storage, input(p.id, { title: `Set ${i}` }));
    await expect(publishPost(u, storage, input(p.id, { title: "One more" }))).rejects.toMatchObject({ status: 429, code: "publish_limit" });
    const mine = await db.select().from(schema.communityPosts).where(eq(schema.communityPosts.authorId, u.userId));
    expect(mine).toHaveLength(PUBLISH_PER_DAY);
  });

  it("a document pointing at a remote image cannot be published", async () => {
    const u = await user();
    const p = await projectWithShots(u);
    await setDoc(u, p.id, (d) => { firstDevice(d).screenshotSrc = "https://example.com/pixel.png"; });
    await expect(publishPost(u, storage, input(p.id))).rejects.toMatchObject({ status: 400, code: "unshareable_source" });
  });

  it("staff emails come from STAFF_EMAILS, case-insensitively", () => {
    expect(isStaffEmail("Mod@Example.com", "a@b.c, mod@example.com")).toBe(true);
    expect(isStaffEmail("x@example.com", "mod@example.com")).toBe(false);
    expect(isStaffEmail("", "")).toBe(false);
    expect(isStaffEmail(undefined, undefined)).toBe(false);
  });
});
