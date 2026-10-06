import { and, asc, eq, type SQL } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";
import { z } from "zod";
import { db, schema, withTx } from "@chitrapx/db";
import { migrate, type ChitrapxDoc } from "@chitrapx/document";
import { authorize, can } from "./authz.ts";
import type { Ctx } from "./context.ts";
import { HttpError, notFound } from "./http.ts";
import { notifyComment } from "./notifications.ts";

/**
 * SP15 comments: threads pinned to a board (optionally an element and a point in percent).
 * Stored apart from the document, so they never reach exports, renders, versions, share links or copies.
 */
const c = schema.projectComments;
const MAX_BODY = 2000;
const body = z.string().trim().min(1, "Write something first").max(MAX_BODY, `Comments are limited to ${MAX_BODY} characters`);
const pct = z.number().min(0).max(100);
const createInput = z.union([
  z.object({ parentId: z.uuid(), body }),
  z.object({ boardId: z.string().min(1).max(200), elementId: z.string().min(1).max(200).nullish(), xPct: pct.nullish(), yPct: pct.nullish(), body }),
]);
const updateInput = z.union([z.object({ body }), z.object({ resolved: z.boolean() })]);

export type CommentView = {
  id: string; boardId: string; elementId: string | null; parentId: string | null; xPct: number | null; yPct: number | null; body: string;
  author: { id: string; name: string } | null; mine: boolean; createdAt: Date; editedAt: Date | null; resolvedAt: Date | null; resolvedBy: string | null;
};
export type Thread = CommentView & { orphaned: boolean; replies: CommentView[] };

const valid = (id: string) => { if (!z.uuid().safeParse(id).success) throw notFound(); };

async function projectDoc(ctx: Ctx, projectId: string): Promise<ChitrapxDoc> {
  valid(projectId);
  const [p] = await db.select({ doc: schema.projects.doc }).from(schema.projects).where(and(eq(schema.projects.id, projectId), eq(schema.projects.workspaceId, ctx.workspaceId)));
  if (!p) throw notFound();
  return migrate(p.doc);
}

/** Board id → the element ids on it, for anchoring and orphan checks. */
function anchors(doc: ChitrapxDoc): Map<string, Set<string>> {
  return new Map(doc.groups.flatMap((g) => g.boards.map((b) => [b.id, new Set(b.elements.map((e) => e.id))] as const)));
}

async function views(ctx: Ctx, where: SQL | undefined): Promise<CommentView[]> {
  const rows = await db.select({ c, name: schema.profiles.name, email: authUsers.email }).from(c)
    .leftJoin(schema.profiles, eq(schema.profiles.id, c.authorId)).leftJoin(authUsers, eq(authUsers.id, c.authorId))
    .where(and(eq(c.workspaceId, ctx.workspaceId), where)).orderBy(asc(c.createdAt), asc(c.id));
  return rows.map(({ c: r, name, email }) => ({
    id: r.id, boardId: r.boardId, elementId: r.elementId, parentId: r.parentId, xPct: r.xPct, yPct: r.yPct, body: r.body,
    author: r.authorId ? { id: r.authorId, name: name || email?.split("@")[0] || "Someone" } : null, mine: r.authorId === ctx.userId,
    createdAt: r.createdAt, editedAt: r.editedAt, resolvedAt: r.resolvedAt, resolvedBy: r.resolvedBy,
  }));
}

async function one(ctx: Ctx, projectId: string, commentId: string): Promise<CommentView> {
  valid(commentId);
  const [v] = await views(ctx, and(eq(c.projectId, projectId), eq(c.id, commentId)));
  if (!v) throw notFound();
  return v;
}

/** Every thread on the project, oldest first, with replies and an orphan flag (board or element gone). */
export async function listComments(ctx: Ctx, projectId: string): Promise<Thread[]> {
  const boards = anchors(await projectDoc(ctx, projectId));
  const all = await views(ctx, eq(c.projectId, projectId));
  return all.filter((v) => !v.parentId).map((root) => ({
    ...root,
    orphaned: !boards.has(root.boardId) || (!!root.elementId && !boards.get(root.boardId)!.has(root.elementId)),
    replies: all.filter((r) => r.parentId === root.id),
  }));
}

/** Starts a thread on a board (or element), or replies to one. Every role may comment. */
export async function createComment(ctx: Ctx, projectId: string, raw: unknown): Promise<CommentView> {
  authorize(ctx, "comment");
  const doc = await projectDoc(ctx, projectId);
  const input = createInput.parse(raw);
  let values: typeof c.$inferInsert;
  let rootId: string | null = null;
  if ("parentId" in input) {
    const parent = await one(ctx, projectId, input.parentId);
    rootId = parent.parentId ?? parent.id;
    const root = parent.parentId ? await one(ctx, projectId, rootId) : parent;
    values = { workspaceId: ctx.workspaceId, projectId, parentId: rootId, boardId: root.boardId, body: input.body, authorId: ctx.userId };
  } else {
    const elements = anchors(doc).get(input.boardId);
    if (!elements) throw new HttpError(400, "unknown_board", "That board no longer exists.");
    if (input.elementId && !elements.has(input.elementId)) throw new HttpError(400, "unknown_element", "That element is not on this board.");
    values = { workspaceId: ctx.workspaceId, projectId, boardId: input.boardId, elementId: input.elementId ?? null, xPct: input.xPct ?? null, yPct: input.yPct ?? null, body: input.body, authorId: ctx.userId };
  }
  const id = await withTx(async ({ db: tx }) => {
    const [row] = await tx.insert(c).values(values).returning({ id: c.id });
    await notifyComment(tx, ctx, projectId, { id: row!.id, body: values.body, rootId });
    return row!.id;
  });
  return one(ctx, projectId, id);
}

/** `{ body }`: the author edits (marked edited). `{ resolved }`: anyone resolves or reopens a thread. */
export async function updateComment(ctx: Ctx, projectId: string, commentId: string, raw: unknown): Promise<CommentView> {
  authorize(ctx, "comment");
  await projectDoc(ctx, projectId);
  const current = await one(ctx, projectId, commentId);
  const input = updateInput.parse(raw);
  if ("body" in input) {
    if (!current.mine) throw new HttpError(403, "not_author", "Only the author can edit a comment.");
    await db.update(c).set({ body: input.body, editedAt: new Date() }).where(eq(c.id, commentId));
  } else {
    if (current.parentId) throw new HttpError(400, "not_a_thread", "Resolve the thread, not a reply.");
    await db.update(c).set(input.resolved ? { resolvedAt: new Date(), resolvedBy: ctx.userId } : { resolvedAt: null, resolvedBy: null }).where(eq(c.id, commentId));
  }
  return one(ctx, projectId, commentId);
}

/** The author, an admin or the owner deletes. A thread's replies go with it. */
export async function deleteComment(ctx: Ctx, projectId: string, commentId: string): Promise<void> {
  authorize(ctx, "comment");
  await projectDoc(ctx, projectId);
  const current = await one(ctx, projectId, commentId);
  if (!current.mine && !can(ctx, "members")) throw new HttpError(403, "not_author", "Only the author, an admin or the owner can delete a comment.");
  await db.delete(c).where(eq(c.id, commentId));
}
