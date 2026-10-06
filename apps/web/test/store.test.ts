import { describe, expect, it } from "vitest";
import { hash32 } from "@chitrapx/document";
import type { ChitrapxDoc } from "@chitrapx/document";
import { applyCommand, type Command } from "@/editor/commands.ts";
import { createEditorStore } from "@/editor/store.ts";
import { el, ref, syncDoc } from "./support/syncDoc.ts";

/** The base text of element t, which every hand edit is hashed against (SP11 F3). */
const baseOf = (doc: ChitrapxDoc) => (doc.groups[0]!.boards[0]!.elements.find((e) => e.id === "t") as unknown as { content: string }).content;

const d = (): ChitrapxDoc => ({
  schemaVersion: 1, kind: "screenshots", localization: { baseLocale: "en-US", locales: [{ code: "de-DE" }] },
  groups: [{ id: "g", target: "iphone-6.9", spanElements: [], boards: [
    { id: "b1", name: "b1", position: { x: 0, y: 0 }, size: { width: 100, height: 200 }, backgroundColor: "#fff", zoom: 1,
      elements: [{ id: "t", type: "text", position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, rotation: 0, scale: 1, content: "Hi", fontSize: 10, fontFamily: "Inter", color: "#000" } as never] },
    { id: "b2", name: "b2", position: { x: 0, y: 0 }, size: { width: 100, height: 200 }, backgroundColor: "#fff", zoom: 1, elements: [] },
  ] }],
});
const text = (s: ReturnType<typeof createEditorStore>) => (s.getState().doc.groups[0]!.boards[0]!.elements[0] as unknown as { content: string }).content;

describe("editor store", () => {
  it("undo restores the exact previous document and redo reapplies it", () => {
    const s = createEditorStore({ projectId: "p", doc: d(), revision: 3 });
    const original = s.getState().doc;
    s.getState().apply({ type: "updateElement", ref: { groupId: "g", boardId: "b1", elementId: "t" }, props: { content: "Yo" } as never });
    expect(text(s)).toBe("Yo");
    expect(s.getState().dirty).toBe(true);
    s.getState().undo();
    expect(s.getState().doc).toBe(original);
    s.getState().redo();
    expect(text(s)).toBe("Yo");
  });

  it("undo of a locale override restores the override map exactly", () => {
    const s = createEditorStore({ projectId: "p", doc: d(), revision: 0 });
    const ref = { groupId: "g", boardId: "b1", elementId: "t" };
    s.getState().apply({ type: "setOverride", ref, locale: "de-DE", props: { content: "Hallo" } });
    s.getState().apply({ type: "setOverride", ref, locale: "de-DE", props: { content: "Servus" } });
    s.getState().undo();
    expect(s.getState().doc.groups[0]!.boards[0]!.localized).toEqual({ "de-DE": { t: { content: "Hallo", origin: "manual", sourceHash: hash32(baseOf(s.getState().doc)) } } });
  });

  it("a gesture is one undo step however many moves it makes", () => {
    const s = createEditorStore({ projectId: "p", doc: d(), revision: 0 });
    const ref = { groupId: "g", boardId: "b1", elementId: "t" };
    s.getState().beginGesture();
    for (let i = 0; i < 10; i++) s.getState().apply({ type: "moveElements", refs: [ref], dx: 1, dy: 0 }, { transient: true });
    s.getState().endGesture();
    expect(s.getState().doc.groups[0]!.boards[0]!.elements[0]!.position.x).toBe(10);
    s.getState().undo();
    expect(s.getState().doc.groups[0]!.boards[0]!.elements[0]!.position.x).toBe(0);
  });

  it("selection never points at removed things", () => {
    const s = createEditorStore({ projectId: "p", doc: d(), revision: 0 });
    s.getState().select([{ groupId: "g", boardId: "b1", elementId: "t" }]);
    s.getState().setActiveBoard("b1");
    s.getState().apply({ type: "deleteBoard", groupId: "g", boardId: "b1" });
    expect(s.getState().selection).toEqual([]);
    expect(s.getState().activeBoardId).toBe("b2");
  });

  it("caps history at 200 steps", () => {
    const s = createEditorStore({ projectId: "p", doc: d(), revision: 0 });
    for (let i = 0; i < 250; i++) s.getState().apply({ type: "updateBoard", groupId: "g", boardId: "b2", props: { name: `n${i}` } });
    expect(s.getState().past).toHaveLength(200);
  });
});

describe("copy variants", () => {
  it("applying a variant is one undo step", () => {
    const s = createEditorStore({ projectId: "p", doc: d(), revision: 0 });
    s.getState().apply({ type: "setTexts", texts: [{ id: "t", text: "Bold new copy" }] });
    expect(text(s)).toBe("Bold new copy");
    s.getState().undo();
    expect(text(s)).toBe("Hi");
  });
});

describe("live co-editing (SP15)", () => {
  type Sent = { cmd: Command; transient: boolean };
  const live = () => {
    const s = createEditorStore({ projectId: "p", doc: syncDoc(), revision: 0 });
    const sent: Sent[] = [];
    let ends = 0;
    s.getState().setSink({ local: (cmd, o) => sent.push({ cmd, transient: o.transient }), gestureEnd: () => { ends++; } });
    /** Someone else's command, as the sync engine delivers it. */
    const remote = (cmd: Command) => s.getState().remoteDoc(applyCommand(s.getState().doc, cmd), { revision: s.getState().revision + 1, dirty: true });
    return { s, sent, remote, ends: () => ends };
  };
  const color = (c: string, id = "t1"): Command => ({ type: "updateElement", ref: ref(id), props: { color: c } as never });

  it("undo reverts only this user's last change; a later edit by someone else survives", () => {
    const { s, sent, remote } = live();
    s.getState().apply(color("#ff0000"));
    remote({ type: "updateElement", ref: ref("t2"), props: { content: "theirs" } as never });
    s.getState().undo();
    expect(el(s.getState().doc, "t1")!.color).toBe("#000000");
    expect(el(s.getState().doc, "t2")!.content).toBe("theirs");
    expect(sent.map((x) => x.cmd.type)).toEqual(["updateElement", "patch"]);
  });

  it("undo leaves a property alone once someone else changed it after us", () => {
    const { s, remote } = live();
    s.getState().apply(color("#ff0000"));
    remote(color("#00ff00"));
    s.getState().undo();
    expect(el(s.getState().doc, "t1")!.color).toBe("#00ff00");
    expect(s.getState().past).toHaveLength(0);
  });

  it("redo re-applies the change over remote edits", () => {
    const { s, remote, sent } = live();
    s.getState().apply(color("#ff0000"));
    s.getState().undo();
    remote({ type: "moveElements", refs: [ref("t3")], dx: 9, dy: 0 });
    s.getState().redo();
    expect(el(s.getState().doc, "t1")!.color).toBe("#ff0000");
    expect(el(s.getState().doc, "t3")!.position.x).toBe(109);
    expect(sent.at(-1)!.cmd.type).toBe("patch");
  });

  it("a gesture interrupted by a remote edit undoes only the gesture", () => {
    const { s, remote, sent, ends } = live();
    s.getState().beginGesture();
    s.getState().apply({ type: "moveElements", refs: [ref("t1")], dx: 5, dy: 0 }, { transient: true });
    remote(color("#00ff00", "t2"));
    s.getState().apply({ type: "moveElements", refs: [ref("t1")], dx: 5, dy: 0 }, { transient: true });
    s.getState().endGesture();
    expect(ends()).toBe(1);
    expect(sent.every((x) => x.transient)).toBe(true);
    expect(el(s.getState().doc, "t1")!.position.x).toBe(10);
    s.getState().undo();
    expect(el(s.getState().doc, "t1")!.position.x).toBe(0);
    expect(el(s.getState().doc, "t2")!.color).toBe("#00ff00");
  });

  it("remote documents keep history, selection rules and the revision", () => {
    const { s, remote } = live();
    s.getState().apply(color("#ff0000"));
    s.getState().select([ref("t3")]);
    remote({ type: "deleteElements", refs: [ref("t3")] });
    expect(s.getState().past).toHaveLength(1);
    expect(s.getState().selection).toEqual([]);
    expect(s.getState().revision).toBe(1);
  });

  it("keeps the last saved document for the hand-over to live mode", () => {
    const s = createEditorStore({ projectId: "p", doc: syncDoc(), revision: 0 });
    const first = s.getState().doc;
    expect(s.getState().savedDoc).toBe(first);
    s.getState().apply(color("#ff0000"));
    expect(s.getState().savedDoc).toBe(first);
    const now = s.getState().doc;
    s.getState().markSaved(1, now);
    expect(s.getState().savedDoc).toBe(now);
    s.getState().replaceDoc(syncDoc(), 2, true);
    expect(s.getState().savedDoc).toBeNull();
    s.getState().replaceDoc(first, 3, false);
    expect(s.getState().savedDoc).toBe(first);
  });

  it("solo undo after live edits still reverts by patch when the document moved on", () => {
    const s = createEditorStore({ projectId: "p", doc: syncDoc(), revision: 0 });
    s.getState().apply(color("#ff0000"));
    s.getState().remoteDoc(applyCommand(s.getState().doc, color("#00ff00", "t2")), { revision: 1, dirty: false });
    s.getState().undo();
    expect(el(s.getState().doc, "t1")!.color).toBe("#000000");
    expect(el(s.getState().doc, "t2")!.color).toBe("#00ff00");
  });
});
