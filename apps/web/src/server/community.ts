import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gt, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, lockWorkspace, PLANS, schema, withTx, type CommunityAsset } from "@chitrapx/db";
import { assetIdFromSrc, getTarget, MAX_DOC_BYTES, migrate, type ChitrapxDoc } from "@chitrapx/document";
import { getApp } from "./apps.ts";
import type { Ctx } from "./context.ts";
import { HttpError, notFound } from "./http.ts";
import type { ObjectStorage } from "./storage.ts";

/** Community template feed (SP16). Posts are snapshots; every query goes through `visibleTo`. */
export const PUBLISH_PER_DAY = 5;
export const REPORTS_PER_DAY = 20;
export const REPORT_HIDE_THRESHOLD = 3;
export const MAX_POST_ASSETS = 20;
export const MAX_POST_ASSET_BYTES = 40 * 1024 * 1024;
export const PAGE_SIZE = 24;
export const COMMUNITY_CATEGORIES = ["productivity", "games", "finance", "health", "education", "travel", "social", "shopping", "utilities", "other"] as const;

const p = schema.communityPosts;
const DAY_MS = 24 * 60 * 60 * 1000;
const SHAREABLE = new Set(["screenshot", "image"]);
const plain = (max: number, min = 0) => z.string().trim().min(min).max(max).refine((s) => !/[<>]/.test(s), { message: "Plain text only" });
const publishInput = z.object({
  projectId: z.uuid(),
  title: plain(80, 3),
  description: plain(500).default(""),
  category: z.enum(COMMUNITY_CATEGORIES),
  license: z.literal(true, { message: "Confirm you own or may share everything in this project" }),
});
const listInput = z.object({
  platform: z.string().max(20).optional(),
  category: z.enum(COMMUNITY_CATEGORIES).optional(),
  sort: z.enum(["new", "popular"]).default("new"),
  page: z.coerce.number().int().min(0).max(1000).default(0),
});

export type PostStatus = "published" | "hidden" | "removed";
export type PostCard = {
  id: string; title: string; description: string; category: string; platforms: string[]; kind: string;
  importCount: number; createdAt: Date; status: PostStatus; mine: boolean;
  /** The first board of the first group, enough for a card. */
  preview: ChitrapxDoc;
  /** Signed URLs for the preview's images, keyed by document source. */
  urls: Record<string, string>;
};

export const isStaffEmail = (email: string | undefined | null, list = process.env.STAFF_EMAILS): boolean =>
  !!email && (list ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).includes(email.trim().toLowerCase());

/** The one visibility rule: published to all, hidden to its author and staff, removed to nobody. */
function visibleTo(ctx: Ctx, staff = false): SQL {
  if (staff) return inArray(p.status, ["published", "hidden"]);
  return or(eq(p.status, "published"), and(eq(p.status, "hidden"), eq(p.authorId, ctx.userId)))!;
}

const SRC_KEY = (k: string) => k.endsWith("Src") || k === "backgroundImage";

/** Calls `fn` for every image source in the document, overrides included; `fn` may return a replacement. */
export function mapSources(doc: unknown, fn: (src: string) => string): unknown {
  if (Array.isArray(doc)) return doc.map((v) => mapSources(v, fn));
  if (!doc || typeof doc !== "object") return doc;
  return Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, typeof v === "string" && SRC_KEY(k) && v !== "" ? fn(v) : mapSources(v, fn)]));
}

const unshareable = (what: string) => new HttpError(400, "unshareable_source", `This project uses ${what}. Remove it, or replace it with an uploaded image, before sharing.`);

/**
 * The shareable copy of a document: no workspace link (`brand`), and every image source either an
 * inline image or one of `allowed` (asset id to kind, from the author's workspace) of a shareable
 * kind. Anything else (a remote URL, a recording, another workspace's file) is refused.
 */
export function snapshotDoc(doc: ChitrapxDoc, allowed: Map<string, string>): { doc: ChitrapxDoc; assetIds: string[] } {
  const ids = new Set<string>();
  const mapped = mapSources(doc, (src) => {
    if (/^data:image\//i.test(src)) return src;
    const id = assetIdFromSrc(src);
    if (!id) throw unshareable("an image from another website");
    const kind = allowed.get(id);
    if (!kind) throw unshareable("a file that is not in this workspace");
    if (!SHAREABLE.has(kind)) throw unshareable(kind === "recording" ? "a screen recording" : `a ${kind} file`);
    ids.add(id);
    return src;
  }) as ChitrapxDoc;
  const { brand: _brand, ...rest } = mapped;
  return { doc: migrate(rest), assetIds: [...ids] };
}

const communityPath = (postId: string, sha: string) => `community/${postId}/${sha}`;
const platformsOf = (doc: ChitrapxDoc) => [...new Set(doc.groups.map((g) => getTarget(g.target)?.platform).filter((x): x is NonNullable<typeof x> => !!x))];

/** Shares a snapshot of one of the user's projects. Images are copied so the post never depends on the author's files. */
export async function publishPost(ctx: Ctx, storage: ObjectStorage, raw: unknown): Promise<{ id: string }> {
  const input = publishInput.parse(raw);
  const [project] = await db.select().from(schema.projects).where(and(eq(schema.projects.id, input.projectId), eq(schema.projects.workspaceId, ctx.workspaceId)));
  if (!project) throw notFound();
  const doc = migrate(project.doc);
  const refs = [...new Set(JSON.stringify(doc).match(/asset:[0-9a-f-]{36}/g) ?? [])].map((s) => s.slice("asset:".length));
  const rows = refs.length ? await db.select().from(schema.assets).where(and(eq(schema.assets.workspaceId, ctx.workspaceId), inArray(schema.assets.id, refs))) : [];
  const snap = snapshotDoc(doc, new Map(rows.map((r) => [r.id, r.kind])));
  if (Buffer.byteLength(JSON.stringify(snap.doc)) > MAX_DOC_BYTES) throw new HttpError(413, "too_large", "This project is too large to share");
  const used = rows.filter((r) => snap.assetIds.includes(r.id));
  if (used.length > MAX_POST_ASSETS) throw new HttpError(400, "too_many_assets", `A shared project can use up to ${MAX_POST_ASSETS} images`);
  if (used.reduce((n, r) => n + r.bytes, 0) > MAX_POST_ASSET_BYTES) throw new HttpError(413, "too_large", "The images in this project are too large to share");
  const assets: CommunityAsset[] = used.map((r) => ({ id: r.id, sha256: r.sha256, mime: r.mime, kind: r.kind as CommunityAsset["kind"], width: r.width, height: r.height, bytes: r.bytes }));

  const id = randomUUID();
  return withTx(async ({ db: tx }) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`community:${ctx.userId}`}))`);
    const [{ n }] = (await tx.select({ n: count() }).from(p).where(and(eq(p.authorId, ctx.userId), gt(p.createdAt, new Date(Date.now() - DAY_MS))))) as [{ n: number }];
    if (n >= PUBLISH_PER_DAY) throw new HttpError(429, "publish_limit", `You can share up to ${PUBLISH_PER_DAY} projects a day. Try again tomorrow.`);
    const copied: string[] = [];
    try {
      for (const a of new Map(assets.map((a) => [a.sha256, a])).values()) {
        await storage.put(communityPath(id, a.sha256), await storage.download(`${ctx.workspaceId}/${a.sha256}`), a.mime);
        copied.push(communityPath(id, a.sha256));
      }
      await tx.insert(p).values({
        id, authorId: ctx.userId, workspaceId: ctx.workspaceId, sourceProjectId: project.id, title: input.title, description: input.description,
        category: input.category, platforms: platformsOf(snap.doc), kind: project.kind, doc: snap.doc, assets, licenseAcceptedAt: new Date(),
      });
    } catch (err) {
      await Promise.all(copied.map((path) => storage.remove(path).catch(() => {})));
      throw err;
    }
    return { id };
  });
}

/** Signed URLs for a post's images, keyed by the `asset:<id>` sources its document uses. */
async function postUrls(storage: ObjectStorage, postId: string, assets: CommunityAsset[], only?: Set<string>): Promise<Record<string, string>> {
  const list = only ? assets.filter((a) => only.has(a.id)) : assets;
  if (!list.length) return {};
  const urls = await storage.signedUrls(list.map((a) => communityPath(postId, a.sha256)));
  return Object.fromEntries(list.map((a, i) => [`asset:${a.id}`, urls[i]!]));
}

function firstBoard(doc: ChitrapxDoc): ChitrapxDoc {
  const g = doc.groups[0];
  return g ? { ...doc, groups: [{ ...g, boards: g.boards.slice(0, 1), spanElements: [] }] } : doc;
}

const cardOf = async (ctx: Ctx, storage: ObjectStorage, row: typeof p.$inferSelect): Promise<PostCard> => {
  const preview = firstBoard(migrate(row.doc));
  const used = new Set((JSON.stringify(preview).match(/asset:[0-9a-f-]{36}/g) ?? []).map((s) => s.slice("asset:".length)));
  return {
    id: row.id, title: row.title, description: row.description, category: row.category, platforms: row.platforms, kind: row.kind,
    importCount: row.importCount, createdAt: row.createdAt, status: row.status, mine: row.authorId === ctx.userId,
    preview, urls: await postUrls(storage, row.id, row.assets, used),
  };
};

export async function listPosts(ctx: Ctx, storage: ObjectStorage, raw: unknown): Promise<{ posts: PostCard[]; hasMore: boolean }> {
  const q = listInput.parse(raw ?? {});
  const where = and(visibleTo(ctx), q.platform ? sql`${q.platform} = any(${p.platforms})` : undefined, q.category ? eq(p.category, q.category) : undefined);
  const order = q.sort === "popular" ? [desc(p.importCount), desc(p.createdAt)] : [desc(p.createdAt), desc(p.id)];
  const rows = await db.select().from(p).where(where).orderBy(...order).limit(PAGE_SIZE + 1).offset(q.page * PAGE_SIZE);
  // A snapshot that no longer validates is left out of the feed rather than failing the whole page.
  const cards = await Promise.all(rows.slice(0, PAGE_SIZE).map((r) => cardOf(ctx, storage, r).catch(() => null)));
  return { posts: cards.filter((c): c is PostCard => c !== null), hasMore: rows.length > PAGE_SIZE };
}

async function visiblePost(ctx: Ctx, postId: string, staff = false) {
  if (!z.uuid().safeParse(postId).success) throw notFound();
  const [row] = await db.select().from(p).where(and(eq(p.id, postId), visibleTo(ctx, staff)));
  if (!row) throw notFound();
  return row;
}

/** One post with its full document. Hidden posts are 404 except to their author and staff; removed ones to everyone. */
export async function getPost(ctx: Ctx, storage: ObjectStorage, postId: string, staff = false) {
  const row = await visiblePost(ctx, postId, staff);
  const card = await cardOf(ctx, storage, row);
  return { ...card, doc: migrate(row.doc), urls: await postUrls(storage, row.id, row.assets) };
}

const importInput = z.object({ appId: z.uuid() });

/**
 * Copies a post into a new project of the user's app. Its images are copied into the user's own
 * workspace and re-linked, so the copy never references the author's files. Counts once per user.
 */
export async function importPost(ctx: Ctx, storage: ObjectStorage, postId: string, raw: unknown): Promise<{ projectId: string }> {
  const { appId } = importInput.parse(raw);
  const post = await visiblePost(ctx, postId);
  await getApp(ctx, appId);
  const [{ n }] = (await db.select({ n: count() }).from(schema.projects).where(eq(schema.projects.workspaceId, ctx.workspaceId))) as [{ n: number }];
  if (n >= PLANS[ctx.plan].maxProjects) throw new HttpError(403, "plan_limit", `Your plan allows ${PLANS[ctx.plan].maxProjects} projects`);

  const relink = new Map<string, string>();
  for (const a of post.assets) {
    const path = `${ctx.workspaceId}/${a.sha256}`;
    if (!(await storage.exists(path))) await storage.put(path, await storage.download(communityPath(post.id, a.sha256)), a.mime);
    await db.insert(schema.assets).values({ workspaceId: ctx.workspaceId, appId, kind: a.kind, storagePath: path, mime: a.mime, width: a.width, height: a.height, bytes: a.bytes, sha256: a.sha256 })
      .onConflictDoNothing();
    const [mine] = await db.select({ id: schema.assets.id }).from(schema.assets)
      .where(and(eq(schema.assets.workspaceId, ctx.workspaceId), eq(schema.assets.appId, appId), eq(schema.assets.sha256, a.sha256), ne(schema.assets.kind, "reference")));
    if (!mine) throw new HttpError(409, "asset_conflict", "One of this template's images is already on this app's competitor board");
    relink.set(a.id, mine.id);
  }
  const doc = mapSources(migrate(post.doc), (src) => {
    const id = assetIdFromSrc(src);
    return id && relink.has(id) ? src.replace(id, relink.get(id)!) : src;
  }) as ChitrapxDoc;

  return withTx(async ({ db: tx }) => {
    await lockWorkspace(tx, ctx.workspaceId);
    const [{ n: now }] = (await tx.select({ n: count() }).from(schema.projects).where(eq(schema.projects.workspaceId, ctx.workspaceId))) as [{ n: number }];
    if (now >= PLANS[ctx.plan].maxProjects) throw new HttpError(403, "plan_limit", `Your plan allows ${PLANS[ctx.plan].maxProjects} projects`);
    const [project] = await tx.insert(schema.projects).values({
      workspaceId: ctx.workspaceId, appId, name: post.title, kind: post.kind, doc: migrate({ ...doc, brand: { appId } }), updatedBy: ctx.userId,
    }).returning({ id: schema.projects.id });
    if (post.authorId !== ctx.userId) {
      const first = await tx.insert(schema.communityImports).values({ postId: post.id, userId: ctx.userId }).onConflictDoNothing().returning();
      if (first.length) await tx.update(p).set({ importCount: sql`${p.importCount} + 1` }).where(eq(p.id, post.id));
    }
    return { projectId: project!.id };
  });
}

/** The author deletes their post and its copied images. Imported copies are untouched. */
export async function deletePost(ctx: Ctx, storage: ObjectStorage, postId: string): Promise<void> {
  if (!z.uuid().safeParse(postId).success) throw notFound();
  const [row] = await db.delete(p).where(and(eq(p.id, postId), eq(p.authorId, ctx.userId), ne(p.status, "removed"))).returning();
  if (!row) throw notFound();
  await Promise.all(row.assets.map((a) => storage.remove(communityPath(row.id, a.sha256)).catch(() => {})));
}

const reportInput = z.object({ reason: plain(500, 1) });

/** One report per user per post. At REPORT_HIDE_THRESHOLD reports the post is hidden for staff review. */
export async function reportPost(ctx: Ctx, postId: string, raw: unknown): Promise<{ hidden: boolean }> {
  const { reason } = reportInput.parse(raw);
  const post = await visiblePost(ctx, postId);
  if (post.authorId === ctx.userId) throw new HttpError(400, "own_post", "You cannot report your own post");
  const r = schema.communityReports;
  return withTx(async ({ db: tx }) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`community-post:${post.id}`}))`);
    const [{ n: mine }] = (await tx.select({ n: count() }).from(r).where(and(eq(r.reporterId, ctx.userId), gt(r.createdAt, new Date(Date.now() - DAY_MS))))) as [{ n: number }];
    if (mine >= REPORTS_PER_DAY) throw new HttpError(429, "report_limit", "You have sent a lot of reports today. Try again tomorrow.");
    await tx.insert(r).values({ postId: post.id, reporterId: ctx.userId, reason }).onConflictDoNothing();
    const [{ n }] = (await tx.select({ n: count() }).from(r).where(eq(r.postId, post.id))) as [{ n: number }];
    if (n < REPORT_HIDE_THRESHOLD) return { hidden: false };
    const hid = await tx.update(p).set({ status: "hidden", updatedAt: new Date() }).where(and(eq(p.id, post.id), eq(p.status, "published"))).returning({ id: p.id });
    return { hidden: hid.length > 0 };
  });
}

export type QueueItem = { id: string; title: string; status: PostStatus; createdAt: Date; reports: number; reasons: string[] };

/** Staff: hidden posts and published posts with reports, most reported first. */
export async function moderationQueue(_ctx: Ctx, staff: boolean): Promise<QueueItem[]> {
  if (!staff) throw notFound();
  const r = schema.communityReports;
  const rows = await db.select({ id: p.id, title: p.title, status: p.status, createdAt: p.createdAt, reports: count(r.id), reasons: sql<string[]>`coalesce(array_agg(${r.reason}) filter (where ${r.reason} is not null), '{}')` })
    .from(p).leftJoin(r, eq(r.postId, p.id))
    .where(inArray(p.status, ["published", "hidden"]))
    .groupBy(p.id)
    .having(sql`${p.status} = 'hidden' or count(${r.id}) > 0`)
    .orderBy(desc(count(r.id)), desc(p.createdAt)).limit(100);
  return rows.map((x) => ({ ...x, reasons: x.reasons.slice(0, 5) }));
}

const moderateInput = z.object({ action: z.enum(["restore", "remove"]), note: plain(500).default("") });

/** Staff: restore (published again, reports cleared) or remove (gone for everyone). Logged either way. */
export async function moderatePost(ctx: Ctx, staff: boolean, postId: string, raw: unknown): Promise<{ status: PostStatus }> {
  if (!staff) throw notFound();
  const { action, note } = moderateInput.parse(raw);
  const post = await visiblePost(ctx, postId, true);
  return withTx(async ({ db: tx }) => {
    const status: PostStatus = action === "restore" ? "published" : "removed";
    await tx.update(p).set({ status, updatedAt: new Date() }).where(eq(p.id, post.id));
    if (action === "restore") await tx.delete(schema.communityReports).where(eq(schema.communityReports.postId, post.id));
    await tx.insert(schema.communityActions).values({ postId: post.id, staffId: ctx.userId, action, note });
    return { status };
  });
}
