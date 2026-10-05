import { describe, expect, it } from "vitest";
import type { ChitrapxDoc } from "@chitrapx/document";
import { insertHeadline } from "@/editor/headlineModel.ts";

const doc = { schemaVersion: 1, kind: "screenshots", localization: { baseLocale: "en-US", locales: [{ code: "de-DE" }] }, groups: [{ id: "g", target: "iphone-6.9", spanElements: [],
  boards: [{ id: "b", name: "b", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "#fff", zoom: 1, elements: [
    { id: "t", type: "text", content: "Old", fontSize: 40, color: "#000", fontFamily: "Inter", position: { x: 0, y: 0 }, size: { width: 100, height: 50 }, rotation: 0, scale: 1 },
    { id: "d", type: "device", deviceType: "iphone-15", position: { x: 0, y: 0 }, size: { width: 100, height: 200 }, rotation: 0, scale: 1 }] }] }] } as unknown as ChitrapxDoc;
const ref = (elementId: string) => ({ groupId: "g", boardId: "b", elementId });

describe("insertHeadline", () => {
  it("is one updateElement on the selected text", () => {
    expect(insertHeadline({ doc, selection: [ref("t")], locale: "en-US" }, "Every rep,\ncounted.")).toEqual({ type: "updateElement", ref: ref("t"), props: { content: "Every rep,\ncounted." } });
  });
  it("writes the language's own text in a language view", () => {
    expect(insertHeadline({ doc, selection: [ref("t")], locale: "de-DE" }, "Jede Wiederholung")).toEqual({ type: "setOverride", ref: ref("t"), locale: "de-DE", props: { content: "Jede Wiederholung" } });
  });
  it("needs exactly one text element selected", () => {
    expect(insertHeadline({ doc, selection: [], locale: "en-US" }, "x")).toBeNull();
    expect(insertHeadline({ doc, selection: [ref("d")], locale: "en-US" }, "x")).toBeNull();
    expect(insertHeadline({ doc, selection: [ref("t"), ref("d")], locale: "en-US" }, "x")).toBeNull();
  });
});
