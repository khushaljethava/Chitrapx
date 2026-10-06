import { and, count, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { z } from "zod";
import { db, schema, type Db } from "@chitrapx/db";
import type { Ctx } from "./context.ts";

/** SP15: in-app notifications only (no email): replies in your threads and @mentions. */
const n = schema.notifications;
const c = schema.projectComments;

/** `@handle`s in a comment, lower-cased, once each. An email address is not a mention. */
export function mentionHandles(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/(^|[^\p{L}\p{N}_.@-])@([\p{L}\p{N}][\p{L}\p{N}._-]*)/gu)) {
    const h = m[2]!.toLowerCase().replace(/[._-]+$/, "");
    if (h && !out.includes(h)) out.push(h);
  }
  return out;
}

/** A member's handles: their name without spaces, and their email's local part. */
const handlesOf = (name: string | null, email: string | null) =>
  [name?.replace(/\s+/g, "").toLowerCase(), email?.split("@")[0]?.toLowerCase()].filter((h): h is string => !!h);

/** Writes the notifications for a new comment, in the caller's transaction. Never notifies the actor. */
export async function notifyComment(tx: Db, ctx: Ctx, projectId: string, comment: { id: string; body: string; rootId: string | null }): Promise<void> {
  const kinds = new Map<string, "mention" | "reply">();
  if (comment.rootId) {
    const thread = await tx.select({ authorId: c.authorId }).from(c)
      .where(and(eq(c.projectId, projectId), or(eq(c.id, comment.rootId), eq(c.parentId, comment.rootId))));
    for (const t of thread) if (t.authorId) kinds.set(t.authorId, "reply");
  }
  const handles = mentionHandles(comment.body);
  if (handles.length) {
    const people = await tx.select({ userId: schema.memberships.userId, name: schema.profiles.name, email: authUsers.email }).from(schema.memberships)
      .innerJoin(authUsers, eq(authUsers.id, schema.memberships.userId)).leftJoin(schema.profiles, eq(schema.profiles.id, schema.memberships.userId))
      .where(eq(schema.memberships.workspaceId, ctx.workspaceId));
    for (const p of people) if (handlesOf(p.name, p.email).some((h) => handles.includes(h))) kinds.set(p.userId, "mention");
  }
  kinds.delete(ctx.userId);
  if (!kinds.size) return;
  await tx.insert(n).values([...kinds].map(([userId, kind]) => ({ workspaceId: ctx.workspaceId, userId, actorId: ctx.userId, kind, projectId, commentId: comment.id })));
}

export type NotificationItem = {
  id: string; kind: "mention" | "reply"; projectId: string; projectName: string; commentId: string; threadId: string;
  actorName: string; excerpt: string; createdAt: Date; read: boolean;
};

const actor = alias(schema.profiles, "actor_profile");

/** The latest 20 for the current user in the current workspace, and how many are unread. */
export async function listNotifications(ctx: Ctx): Promise<{ items: NotificationItem[]; unread: number }> {
  const mine = and(eq(n.userId, ctx.userId), eq(n.workspaceId, ctx.workspaceId));
  const rows = await db.select({
    id: n.id, kind: n.kind, projectId: n.projectId, projectName: schema.projects.name, commentId: n.commentId, parentId: c.parentId,
    body: c.body, actorName: actor.name, actorEmail: authUsers.email, createdAt: n.createdAt, readAt: n.readAt,
  }).from(n)
    .innerJoin(c, eq(c.id, n.commentId)).innerJoin(schema.projects, eq(schema.projects.id, n.projectId))
    .leftJoin(actor, eq(actor.id, n.actorId)).leftJoin(authUsers, eq(authUsers.id, n.actorId))
    .where(mine).orderBy(desc(n.createdAt), desc(n.id)).limit(20);
  const [{ unread }] = (await db.select({ unread: count() }).from(n).where(and(mine, isNull(n.readAt)))) as [{ unread: number }];
  return {
    unread,
    items: rows.map((r) => ({
      id: r.id, kind: r.kind, projectId: r.projectId, projectName: r.projectName, commentId: r.commentId, threadId: r.parentId ?? r.commentId,
      actorName: r.actorName || r.actorEmail?.split("@")[0] || "Someone", excerpt: r.body.slice(0, 140), createdAt: r.createdAt, read: !!r.readAt,
    })),
  };
}

const readInput = z.object({ ids: z.array(z.uuid()).max(100).optional() });

/** Marks the given notifications (or all of them) read for the current user. */
export async function markRead(ctx: Ctx, raw: unknown): Promise<void> {
  const { ids } = readInput.parse(raw ?? {});
  await db.update(n).set({ readAt: new Date() }).where(and(eq(n.userId, ctx.userId), eq(n.workspaceId, ctx.workspaceId), isNull(n.readAt), ids?.length ? inArray(n.id, ids) : undefined));
}
