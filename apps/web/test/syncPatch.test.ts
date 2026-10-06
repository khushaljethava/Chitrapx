import { describe, expect, it } from "vitest";
import { applyCommand } from "@/editor/commands.ts";
import { applyPatch, diffDocs, invertOps, squashOps, type PatchOp } from "@/editor/sync/patch.ts";
import { el, ids, newText, plain, ref, syncDoc } from "./support/syncDoc.ts";

const edits = {
  property: (d = syncDoc()) => applyCommand(d, { type: "updateElement", ref: ref("t1"), props: { color: "#ff0000", position: { x: 5, y: 6 } } as never }),
  insert: (d = syncDoc()) => applyCommand(d, { type: "addElement", groupId: "g", boardId: "b1", element: newText("n1") }),
  remove: (d = syncDoc()) => applyCommand(d, { type: "deleteElements", refs: [ref("t1"), ref("t2")] }),
  reorder: (d = syncDoc()) => applyCommand(d, { type: "reorderElement", ref: ref("t1"), to: "front" }),
  board: (d = syncDoc()) => applyCommand(d, { type: "moveBoard", groupId: "g", boardId: "b2", toIndex: 0 }),
  locale: (d = syncDoc()) => applyCommand(d, { type: "addLocale", code: "fr-FR" }),
  override: (d = syncDoc()) => applyCommand(d, { type: "setOverride", ref: ref("t1"), locale: "de-DE", props: { content: "Hallo" } }),
};

describe("diffDocs and applyPatch", () => {
  for (const [name, edit] of Object.entries(edits)) {
    it(`round trips a ${name} edit, and its inverse restores the original`, () => {
      const a = syncDoc();
      const b = edit(a);
      const ops = diffDocs(a, b);
      expect(ops.length).toBeGreaterThan(0);
      expect(plain(applyPatch(a, ops))).toEqual(plain(b));
      expect(plain(applyPatch(b, invertOps(ops)))).toEqual(plain(a));
    });
  }

  it("is empty for identical documents and keeps unchanged subtrees by identity", () => {
    const a = syncDoc();
    expect(diffDocs(a, a)).toEqual([]);
    const b = edits.property(a);
    const out = applyPatch(a, diffDocs(a, b));
    expect(out.groups[0]!.boards[1]).toBe(a.groups[0]!.boards[1]);
    expect(el(out, "t2")).toBe(el(a, "t2"));
  });

  it("addresses elements by id, so an op still lands after someone else inserted before it", () => {
    const a = syncDoc();
    const ops = diffDocs(a, edits.property(a));
    const other = applyCommand(a, { type: "addElement", groupId: "g", boardId: "b1", element: newText("x0") });
    const moved = applyCommand(other, { type: "reorderElement", ref: ref("x0"), to: "back" });
    const out = applyPatch(moved, ops);
    expect(el(out, "t1")!.color).toBe("#ff0000");
    expect(ids(out)).toEqual(["x0", "t1", "t2", "t3"]);
  });

  it("skips a conditional op once someone else changed that property", () => {
    const a = syncDoc();
    const mine = applyCommand(a, { type: "updateElement", ref: ref("t1"), props: { color: "#111111" } as never });
    const undo = invertOps(diffDocs(a, mine));
    const theirs = applyCommand(mine, { type: "updateElement", ref: ref("t1"), props: { color: "#222222" } as never });
    expect(el(applyPatch(theirs, undo), "t1")!.color).toBe("#222222");
    expect(el(applyPatch(theirs, undo, { force: true }), "t1")!.color).toBe("#000000");
  });

  it("never resurrects a deleted element", () => {
    const a = syncDoc();
    const ops = diffDocs(a, edits.property(a));
    const gone = applyCommand(a, { type: "deleteElements", refs: [ref("t1")] });
    expect(applyPatch(gone, ops)).toBe(gone);
    expect(applyPatch(gone, ops, { force: true })).toEqual(gone);
  });

  it("re-inserts removed elements at their old places", () => {
    const a = syncDoc();
    const b = applyCommand(a, { type: "deleteElements", refs: [ref("t1"), ref("t2")] });
    expect(ids(applyPatch(b, invertOps(diffDocs(a, b))))).toEqual(["t1", "t2", "t3"]);
  });

  it("an undone insert is removed only while it is still as inserted", () => {
    const a = syncDoc();
    const b = edits.insert(a);
    const undo = invertOps(diffDocs(a, b));
    expect(ids(applyPatch(b, undo))).toEqual(["t1", "t2", "t3"]);
    const edited = applyCommand(b, { type: "updateElement", ref: ref("n1"), props: { color: "#00ff00" } as never });
    expect(ids(applyPatch(edited, undo))).toContain("n1");
  });

  it("a reorder op permutes only the items it knows, among their own slots", () => {
    const a = syncDoc();
    const ops = diffDocs(a, edits.reorder(a));
    const plus = applyCommand(a, { type: "addElement", groupId: "g", boardId: "b1", element: newText("z") });
    expect(ids(applyPatch(plus, ops))).toEqual(["t2", "t3", "t1", "z"]);
  });

  it("refuses unsafe paths", () => {
    const bad: PatchOp[] = [{ k: "set", path: ["groups", { id: "g" }, "__proto__"], new: { polluted: true } }];
    expect(() => applyPatch(syncDoc(), bad, { force: true })).toThrow(/unsafe/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("squashOps", () => {
  it("merges repeated edits of one property into one op from the first old value to the last new one", () => {
    const a = syncDoc();
    let d = a;
    const ops: PatchOp[] = [];
    for (const c of ["H", "He", "Hel"]) {
      const next = applyCommand(d, { type: "updateElement", ref: ref("t1"), props: { content: c } as never });
      ops.push(...diffDocs(d, next));
      d = next;
    }
    const squashed = squashOps(ops);
    expect(squashed).toHaveLength(1);
    expect(squashed[0]).toMatchObject({ old: "t1", new: "Hel" });
    expect(plain(applyPatch(d, invertOps(squashed)))).toEqual(plain(a));
  });

  it("leaves overlapping paths alone", () => {
    const ops: PatchOp[] = [
      { k: "set", path: ["a", "b"], old: 1, new: 2 },
      { k: "set", path: ["a"], old: { b: 2 }, new: { b: 3 } },
    ];
    expect(squashOps(ops)).toEqual(ops);
  });
});
