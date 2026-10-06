import { beforeAll, describe, expect, it } from "vitest";
import { pool, type MemberRole } from "@chitrapx/db";
import type { ChitrapxDoc } from "@chitrapx/document";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { createApp } from "@/server/apps.ts";
import { createComment, deleteComment, listComments, updateComment } from "@/server/comments.ts";
import type { Ctx } from "@/server/context.ts";
import { listNotifications, markRead, mentionHandles } from "@/server/notifications.ts";
import { createProject, getProject, saveDoc } from "@/server/projects.ts";
import { enableShare, sharedView } from "@/server/shares.ts";

// Needs migration 0014.
const board = (id: string, elementId: string) => ({ id, name: id, position: { x: 0, y: 0 }, size: { width: 100, height: 200 }, backgroundColor: "#fff", zoom: 1,
  elements: [{ id: elementId, type: "image", position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, imageSrc: "" }] });
const docOf = (boards: unknown[]): ChitrapxDoc => ({ schemaVersion: 1, kind: "screenshots", localization: { baseLocale: "en-US", locales: [] },
  groups: [{ id: "g", target: "iphone-6.9", spanElements: [], boards }] }) as unknown as ChitrapxDoc;

let owner: Ctx;
let projectId: string;
const members: Partial<Record<MemberRole, Ctx & { name: string }>> = {};

async function member(role: MemberRole, name: string): Promise<Ctx & { name: string }> {
  const u = await createUser();
  await makeWorkspace(u.id);
  await pool.query("insert into profiles (id, name) values ($1, $2)", [u.id, name]);
  await pool.query("insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)", [owner.workspaceId, u.id, role]);
  return { ...owner, userId: u.id, role, name };
}
const setDoc = async (boards: unknown[]) => {
  const p = await getProject(owner, projectId);
  await saveDoc(owner, projectId, { doc: docOf(boards), revision: p.revision });
};

beforeAll(async () => {
  const u = await createUser();
  owner = { userId: u.id, workspaceId: await makeWorkspace(u.id, "studio"), plan: "studio", role: "owner" };
  await pool.query("insert into profiles (id, name) values ($1, 'Olive Owner')", [u.id]);
  const app = await createApp(owner, { name: "App" });
  projectId = (await createProject(owner, app.id, { name: "P", kind: "screenshots" })).id;
  await setDoc([board("b1", "e1"), board("b2", "e2")]);
  members.viewer = await member("viewer", "Vera View");
  members.editor = await member("editor", "Ed Itor");
  members.admin = await member("admin", "Ada Min");
});

describe("comments", () => {
  it("a viewer starts a thread on an element; replies nest under the root, even replies to replies", async () => {
    const root = await createComment(members.viewer!, projectId, { boardId: "b2", elementId: "e2", xPct: 25, yPct: 75.5, body: "  Make this bigger  " });
    expect(root).toMatchObject({ boardId: "b2", elementId: "e2", xPct: 25, yPct: 75.5, body: "Make this bigger", mine: true });
    const reply = await createComment(members.editor!, projectId, { parentId: root.id, body: "On it" });
    const nested = await createComment(members.admin!, projectId, { parentId: reply.id, body: "Thanks" });
    expect(nested.parentId).toBe(root.id);
    const threads = await listComments(members.editor!, projectId);
    const t = threads.find((x) => x.id === root.id)!;
    expect(t.orphaned).toBe(false);
    expect(t.author?.name).toBe("Vera View");
    expect(t.replies.map((r) => r.body)).toEqual(["On it", "Thanks"]);
    expect(t.replies.every((r) => r.boardId === "b2")).toBe(true);
  });

  it("resolve and reopen; only the author edits (and it shows as edited)", async () => {
    const c = await createComment(members.editor!, projectId, { boardId: "b1", body: "Typo in headline" });
    const resolved = await updateComment(members.viewer!, projectId, c.id, { resolved: true });
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
    expect(resolved.resolvedBy).toBe(members.viewer!.userId);
    expect((await updateComment(members.viewer!, projectId, c.id, { resolved: false })).resolvedAt).toBeNull();
    await expect(updateComment(members.admin!, projectId, c.id, { body: "x" })).rejects.toMatchObject({ status: 403 });
    const edited = await updateComment(members.editor!, projectId, c.id, { body: "Typo in the headline" });
    expect(edited.editedAt).toBeInstanceOf(Date);
    const reply = await createComment(members.viewer!, projectId, { parentId: c.id, body: "r" });
    await expect(updateComment(members.viewer!, projectId, reply.id, { resolved: true })).rejects.toMatchObject({ status: 400 });
  });

  it("the author or an admin deletes; a non-author editor cannot", async () => {
    const c = await createComment(members.viewer!, projectId, { boardId: "b1", body: "delete me" });
    await expect(deleteComment(members.editor!, projectId, c.id)).rejects.toMatchObject({ status: 403 });
    await deleteComment(members.admin!, projectId, c.id);
    const mine = await createComment(members.editor!, projectId, { boardId: "b1", body: "mine" });
    await createComment(members.viewer!, projectId, { parentId: mine.id, body: "reply goes too" });
    await deleteComment(members.editor!, projectId, mine.id);
    const ids = (await listComments(owner, projectId)).flatMap((t) => [t.id, ...t.replies.map((r) => r.id)]);
    expect(ids).not.toContain(mine.id);
  });

  it("refuses unknown boards and elements, empty and over-long bodies", async () => {
    await expect(createComment(members.viewer!, projectId, { boardId: "nope", body: "x" })).rejects.toMatchObject({ status: 400, code: "unknown_board" });
    await expect(createComment(members.viewer!, projectId, { boardId: "b1", elementId: "e2", body: "x" })).rejects.toMatchObject({ status: 400 });
    await expect(createComment(members.viewer!, projectId, { boardId: "b1", body: "   " })).rejects.toMatchObject({ name: "ZodError" });
    await expect(createComment(members.viewer!, projectId, { boardId: "b1", body: "x".repeat(2001) })).rejects.toMatchObject({ name: "ZodError" });
  });

  it("someone outside the workspace cannot read or write comments", async () => {
    const u = await createUser();
    const stranger: Ctx = { userId: u.id, workspaceId: await makeWorkspace(u.id), plan: "free", role: "owner" };
    await expect(listComments(stranger, projectId)).rejects.toMatchObject({ status: 404 });
    await expect(createComment(stranger, projectId, { boardId: "b1", body: "x" })).rejects.toMatchObject({ status: 404 });
  });

  it("deleting the element, then the board, keeps the thread and flags it orphaned", async () => {
    await setDoc([board("b1", "e1"), board("b3", "e3")]);
    const onEl = await createComment(members.viewer!, projectId, { boardId: "b3", elementId: "e3", body: "el" });
    const onBoard = await createComment(members.viewer!, projectId, { boardId: "b3", body: "board" });
    await setDoc([board("b1", "e1"), { ...board("b3", "e3"), elements: [] }]);
    let threads = await listComments(owner, projectId);
    expect(threads.find((t) => t.id === onEl.id)!.orphaned).toBe(true);
    expect(threads.find((t) => t.id === onBoard.id)!.orphaned).toBe(false);
    await setDoc([board("b1", "e1")]);
    threads = await listComments(owner, projectId);
    expect(threads.find((t) => t.id === onBoard.id)!.orphaned).toBe(true);
  });

  it("comments never appear in the document or the share preview", async () => {
    await createComment(members.viewer!, projectId, { boardId: "b1", body: "SECRET-COMMENT-TEXT" });
    expect(JSON.stringify((await getProject(owner, projectId)).doc)).not.toContain("SECRET-COMMENT-TEXT");
    const share = await enableShare(owner, projectId, {});
    expect(JSON.stringify(await sharedView(share.slug))).not.toContain("SECRET-COMMENT-TEXT");
  });
});

describe("in-app notifications", () => {
  it("finds @handles by name without spaces or email local part", () => {
    expect(mentionHandles("Hey @AdaMin and @ed.itor, also email@x.com is not one; @AdaMin again")).toEqual(["adamin", "ed.itor"]);
  });

  it("a reply notifies the thread's author and earlier repliers, never the actor", async () => {
    const root = await createComment(members.viewer!, projectId, { boardId: "b1", body: "Root" });
    await createComment(members.editor!, projectId, { parentId: root.id, body: "First reply" });
    await createComment(members.admin!, projectId, { parentId: root.id, body: "Second reply" });
    const viewerItems = (await listNotifications(members.viewer!)).items.filter((n) => n.threadId === root.id);
    expect(viewerItems.map((n) => [n.kind, n.actorName])).toEqual([["reply", "Ada Min"], ["reply", "Ed Itor"]]);
    expect((await listNotifications(members.editor!)).items.filter((n) => n.threadId === root.id).map((n) => n.actorName)).toEqual(["Ada Min"]);
    expect((await listNotifications(members.admin!)).items.filter((n) => n.threadId === root.id)).toEqual([]);
  });

  it("an @mention notifies that member once; markRead clears the count", async () => {
    const c = await createComment(members.viewer!, projectId, { boardId: "b1", body: "@AdaMin can you check? cc @AdaMin @VeraView" });
    const mine = await listNotifications(members.admin!);
    const hit = mine.items.filter((n) => n.commentId === c.id);
    expect(hit.map((n) => n.kind)).toEqual(["mention"]);
    expect(hit[0]!.excerpt).toContain("can you check");
    expect((await listNotifications(members.viewer!)).items.filter((n) => n.commentId === c.id)).toEqual([]);
    expect(mine.unread).toBeGreaterThan(0);
    await markRead(members.admin!, {});
    expect((await listNotifications(members.admin!)).unread).toBe(0);
  });
});
