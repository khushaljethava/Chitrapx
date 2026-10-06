import { migrate, type ChitrapxDoc } from "@chitrapx/document";
import type { Ref } from "@/editor/commands.ts";

const text = (id: string, x: number, content = id) => ({
  id, type: "text", position: { x, y: 10 }, size: { width: 40, height: 20 }, rotation: 0, scale: 1,
  content, fontSize: 10, fontFamily: "Inter", color: "#000000",
});
const board = (id: string, elements: unknown[]) => ({
  id, name: id, position: { x: 0, y: 0 }, size: { width: 300, height: 600 }, backgroundColor: "#ffffff", zoom: 1, elements,
});

/** A small valid document: one group, boards b1 (elements t1, t2, t3) and b2 (element u1). */
export function syncDoc(): ChitrapxDoc {
  return migrate({
    schemaVersion: 1, kind: "screenshots", localization: { baseLocale: "en-US", locales: [{ code: "de-DE" }] },
    groups: [{ id: "g", target: "iphone-6.9", spanElements: [], boards: [
      board("b1", [text("t1", 0), text("t2", 50), text("t3", 100)]),
      board("b2", [text("u1", 0)]),
    ] }],
  });
}

export const ref = (elementId: string, boardId = "b1"): Ref => ({ groupId: "g", boardId, elementId });
export const el = (doc: ChitrapxDoc, elementId: string, boardId = "b1") =>
  doc.groups[0]!.boards.find((b) => b.id === boardId)?.elements.find((e) => e.id === elementId) as
    (ChitrapxDoc["groups"][number]["boards"][number]["elements"][number] & { content?: string; color?: string }) | undefined;
export const ids = (doc: ChitrapxDoc, boardId = "b1") => doc.groups[0]!.boards.find((b) => b.id === boardId)?.elements.map((e) => e.id) ?? [];
export const newText = (id: string, x = 0) => text(id, x) as never;
/** JSON form: drops undefined keys so documents built different ways compare by content. */
export const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
