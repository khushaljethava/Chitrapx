import { describe, expect, it } from "vitest";
import { anchorFor, groupThreads, type ThreadLike } from "@/components/commentsModel.ts";

const t = (id: string, boardId: string, extra: Partial<ThreadLike> = {}): ThreadLike => ({ id, boardId, elementId: null, resolvedAt: null, orphaned: false, ...extra });

describe("groupThreads", () => {
  const threads = [t("1", "b2"), t("2", "b1"), t("3", "b1", { resolvedAt: "2026-10-06" }), t("4", "gone", { orphaned: true }), t("5", "b2", { orphaned: true, elementId: "e" })];

  it("groups open threads by board in board order, orphans apart, resolved hidden by default", () => {
    const g = groupThreads(threads, ["b1", "b2"], false);
    expect(g.boards.map((b) => [b.boardId, b.threads.map((x) => x.id)])).toEqual([["b1", ["2"]], ["b2", ["1"]]]);
    expect(g.orphaned.map((x) => x.id)).toEqual(["4", "5"]);
    expect(g.resolved).toBe(1);
    expect(g.open).toBe(4);
  });

  it("shows resolved threads when asked", () => {
    expect(groupThreads(threads, ["b1", "b2"], true).boards[0]!.threads.map((x) => x.id)).toEqual(["2", "3"]);
  });
});

describe("anchorFor", () => {
  it("anchors to the selected element on a board, else the active board, else nothing", () => {
    expect(anchorFor([{ groupId: "g", boardId: "b1", elementId: "e1" }], "b2")).toEqual({ boardId: "b1", elementId: "e1" });
    expect(anchorFor([{ groupId: "g", boardId: null, elementId: "span" }], "b2")).toEqual({ boardId: "b2", elementId: null });
    expect(anchorFor([], null)).toBeNull();
  });
});
