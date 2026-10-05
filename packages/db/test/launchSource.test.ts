import { describe, expect, it } from "vitest";
import { mockupDoc } from "@chitrapx/document";
import { launchSource } from "../src/exportSource.ts";

describe("launchSource (SP12)", () => {
  const { doc, selection } = mockupDoc([{ src: "asset:00000000-0000-4000-8000-000000000000" }], { deviceType: "iphone-15" });

  it("reads the in-memory document of a mockup or collage job", () => {
    expect(launchSource({ type: "mockup", input: { doc, selection } })).toEqual({ doc, selection });
    expect(launchSource({ type: "collage", input: { doc, selection, assetIds: [] } })).toEqual({ doc, selection });
  });

  it("ignores every other job type, missing documents and invalid ones", () => {
    expect(launchSource({ type: "export", input: { doc, selection } })).toBeNull();
    expect(launchSource({ type: "collage", input: { assetIds: [] } })).toBeNull();
    const evil = structuredClone(doc);
    (evil.groups[0]!.boards[0] as { backgroundColor: string }).backgroundColor = "red; background:url(http://169.254.169.254/)";
    expect(launchSource({ type: "mockup", input: { doc: evil, selection } })).toBeNull();
    expect(launchSource({ type: "mockup", input: { doc, selection: { targets: [], locales: [] } } })).toBeNull();
  });
});
