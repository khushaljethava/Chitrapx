import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, pool, schema } from "@chitrapx/db";
import { migrate, type ChitrapxDoc } from "@chitrapx/document";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { applyCommand, type Command } from "@/editor/commands.ts";
import { createApp } from "@/server/apps.ts";
import { canSendCommands, commandsSince, submitCommands } from "@/server/commands.ts";
import type { Ctx } from "@/server/context.ts";
import { createProject, getProject, saveDoc } from "@/server/projects.ts";
import { syncDoc } from "./support/syncDoc.ts";

/**
 * Needs migration 0015 (project_commands): run against a throwaway local Postgres, see the SP15 plan.
 */
async function setup() {
  const user = await createUser();
  const ctx: Ctx = { userId: user.id, workspaceId: await makeWorkspace(user.id, "pro"), plan: "pro" };
  const app = await createApp(ctx, { name: "A" });
  const project = await createProject(ctx, app.id, { name: "P", kind: "screenshots" });
  // A blank project has no boards yet: start from the small fixture document, still at revision 0.
  const doc = syncDoc();
  await db.update(schema.projects).set({ doc }).where(eq(schema.projects.id, project.id));
  return { ctx, projectId: project.id, initial: doc, groupId: "g", boardId: "b1" };
}
const text = (id: string) => ({ id, type: "text", position: { x: 0, y: 0 }, size: { width: 50, height: 20 }, rotation: 0, scale: 1, content: id, fontSize: 12, fontFamily: "Inter", color: "#000000" }) as never;
const status = (p: Promise<unknown>) => p.then(() => 200, (e: { status?: number; name?: string }) => e.status ?? (e.name === "ZodError" ? 400 : 500));
const clientId = () => crypto.randomUUID();

describe("submitCommands", () => {
  it("applies, logs and broadcasts only after commit", async () => {
    const { ctx, projectId, groupId, boardId } = await setup();
    const c = clientId();
    let seenInBroadcast = -1;
    const out = await submitCommands(ctx, projectId, {
      clientId: c, after: 0,
      commands: [
        { clientSeq: 1, command: { type: "addElement", groupId, boardId, element: text("e1") } },
        { clientSeq: 2, command: { type: "moveElements", refs: [{ groupId, boardId, elementId: "e1" }], dx: 7, dy: 0 } },
      ],
    }, {
      onCommitted: async (_id, head, entries) => {
        // A separate connection already sees the rows: the transaction committed before the broadcast.
        const r = await pool.query("select count(*)::int as n from project_commands where project_id = $1", [projectId]);
        seenInBroadcast = r.rows[0].n;
        expect(head).toBe(2);
        expect(entries.map((e) => e.seq)).toEqual([1, 2]);
      },
    });
    expect(out.results).toEqual([{ clientSeq: 1, seq: 1 }, { clientSeq: 2, seq: 2 }]);
    expect("entries" in out && out.entries.map((e) => e.clientSeq)).toEqual([1, 2]);
    expect(seenInBroadcast).toBe(2);
    const p = await getProject(ctx, projectId);
    expect(p.revision).toBe(2);
    expect(p.doc.groups[0]!.boards[0]!.elements.find((e) => e.id === "e1")!.position.x).toBe(7);
  });

  it("is idempotent: resubmitting the same commands applies them once", async () => {
    const { ctx, projectId, groupId, boardId } = await setup();
    const body = { clientId: clientId(), after: 0, commands: [
      { clientSeq: 1, command: { type: "addElement", groupId, boardId, element: text("e1") } },
      { clientSeq: 2, command: { type: "moveElements", refs: [{ groupId, boardId, elementId: "e1" }], dx: 5, dy: 0 } },
    ] };
    await submitCommands(ctx, projectId, body);
    const again = await submitCommands(ctx, projectId, body);
    expect(again.results).toEqual([{ clientSeq: 1, duplicate: true }, { clientSeq: 2, duplicate: true }]);
    const p = await getProject(ctx, projectId);
    expect(p.revision).toBe(2);
    expect(p.doc.groups[0]!.boards[0]!.elements.find((e) => e.id === "e1")!.position.x).toBe(5);
  });

  it("refuses an invalid or unsafe command without logging it, and applies the rest", async () => {
    const { ctx, projectId, groupId, boardId } = await setup();
    const out = await submitCommands(ctx, projectId, { clientId: clientId(), after: 0, commands: [
      { clientSeq: 1, command: { type: "addElement", groupId, boardId, element: text("e1") } },
      { clientSeq: 2, command: { type: "updateElement", ref: { groupId, boardId, elementId: "e1" }, props: { size: { width: -1, height: 1 } } } },
      { clientSeq: 3, command: JSON.parse(`{"type":"updateElement","ref":{"groupId":"${groupId}","boardId":"${boardId}","elementId":"e1"},"props":{"__proto__":{"x":1}}}`) },
      { clientSeq: 4, command: { type: "setMirrorRtl", on: true } },
    ] });
    expect(out.results.map((r) => (r.error ? "error" : r.seq))).toEqual([1, "error", "error", 2]);
    const rows = await db.select().from(schema.projectCommands).where(eq(schema.projectCommands.projectId, projectId)).orderBy(asc(schema.projectCommands.seq));
    expect(rows.map((r) => r.clientSeq)).toEqual([1, 4]);
  });

  it("writes a version when the head crosses a multiple of 100", async () => {
    const { ctx, projectId } = await setup();
    const commands = Array.from({ length: 100 }, (_, i) => ({ clientSeq: i + 1, command: { type: "setMirrorRtl", on: i % 2 === 0 } }));
    await submitCommands(ctx, projectId, { clientId: clientId(), after: 0, commands });
    const versions = await db.select().from(schema.projectVersions).where(eq(schema.projectVersions.projectId, projectId));
    expect(versions.map((v) => v.revision)).toEqual([100]);
  });

  it("another workspace gets 404; a malformed body is 400", async () => {
    const { projectId } = await setup();
    const other = await setup();
    const body = { clientId: clientId(), after: 0, commands: [{ clientSeq: 1, command: { type: "setMirrorRtl", on: true } }] };
    expect(await status(submitCommands(other.ctx, projectId, body))).toBe(404);
    expect(await status(commandsSince(other.ctx, projectId, "0", body.clientId))).toBe(404);
    expect(await status(submitCommands(other.ctx, other.projectId, { ...body, clientId: "nope" }))).toBe(400);
    expect(await status(submitCommands(other.ctx, other.projectId, { ...body, commands: [] }))).toBe(400);
  });

  it("canSendCommands is the one gate for who may edit (true until roles land)", async () => {
    const { ctx } = await setup();
    expect(canSendCommands(ctx)).toBe(true);
  });
});

describe("commandsSince", () => {
  it("returns entries, then a snapshot once a whole-document save left a hole; commands continue on the new head", async () => {
    const { ctx, projectId, groupId, boardId } = await setup();
    const c = clientId();
    await submitCommands(ctx, projectId, { clientId: c, after: 0, commands: [{ clientSeq: 1, command: { type: "addElement", groupId, boardId, element: text("e1") } }] });
    const since = await commandsSince(ctx, projectId, "0", c);
    expect("entries" in since && since.entries).toHaveLength(1);

    const p = await getProject(ctx, projectId);
    p.doc.groups[0]!.boards[0]!.name = "Saved whole";
    const { revision } = await saveDoc(ctx, projectId, { doc: p.doc, revision: p.revision });
    expect(revision).toBe(2);
    const snap = await commandsSince(ctx, projectId, "1", c);
    expect("snapshot" in snap && snap.snapshot.lastClientSeq).toBe(1);
    expect("snapshot" in snap && snap.snapshot.doc.groups[0]!.boards[0]!.name).toBe("Saved whole");
    expect(snap.head).toBe(2);

    const out = await submitCommands(ctx, projectId, { clientId: c, after: 2, commands: [{ clientSeq: 2, command: { type: "setMirrorRtl", on: true } }] });
    expect(out.results).toEqual([{ clientSeq: 2, seq: 3 }]);
    expect("entries" in out && out.entries.map((e) => e.seq)).toEqual([3]);
    expect(await status(commandsSince(ctx, projectId, "-1", c))).toBe(400);
  });

  it("the stored document equals the fold of the log (two clients interleaved)", async () => {
    const { ctx, projectId, initial, groupId, boardId } = await setup();
    const [a, b] = [clientId(), clientId()];
    const ref = (elementId: string) => ({ groupId, boardId, elementId });
    const send = (c: string, seq: number, command: Command) => submitCommands(ctx, projectId, { clientId: c, after: 0, commands: [{ clientSeq: seq, command }] });
    await send(a, 1, { type: "addElement", groupId, boardId, element: text("x") });
    await send(b, 1, { type: "addElement", groupId, boardId, element: text("y") });
    await send(a, 2, { type: "moveElements", refs: [ref("y")], dx: 3, dy: 1 });
    await send(b, 2, { type: "deleteElements", refs: [ref("x")] });
    await send(a, 3, { type: "updateElement", ref: ref("x"), props: { color: "#ff0000" } as never });
    await send(b, 3, { type: "reorderElement", ref: ref("y"), to: "back" });
    const rows = await db.select().from(schema.projectCommands).where(eq(schema.projectCommands.projectId, projectId)).orderBy(asc(schema.projectCommands.seq));
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    const folded = rows.reduce<ChitrapxDoc>((d, r) => migrate(applyCommand(d, r.command as Command)), initial);
    expect((await getProject(ctx, projectId)).doc).toEqual(folded);
  });
});
