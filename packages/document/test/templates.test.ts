import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate } from "../src/index.ts";
import { isThirdPartySrc, stripBoard } from "../scripts/import-osg.ts";

const dir = join(import.meta.dirname, "../../assets/templates");
const files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_"));

describe("imported templates", () => {
  it("all 101 OSG templates are present and valid documents", () => {
    expect(files).toHaveLength(101);
    for (const f of files) {
      const t = JSON.parse(readFileSync(join(dir, f), "utf8"));
      expect(() => migrate(t.doc), f).not.toThrow();
      expect(t.doc.groups.length, f).toBeGreaterThan(0);
    }
  });

  it("none references an OSG artwork file or inlined image bytes", () => {
    for (const f of files) {
      const text = readFileSync(join(dir, f), "utf8");
      expect(text, f).not.toMatch(/"\/(data|elements)\//);
      expect(text, f).not.toMatch(/data:image\//);
    }
  });
});

describe("stripBoard", () => {
  it("empties screens, drops artwork images and background pictures, keeps everything else", () => {
    const report = { slug: "x", droppedImages: 0, droppedBackgrounds: 0, clearedScreens: 0 };
    const board = {
      id: "b", name: "b", position: { x: 15, y: 15 }, size: { width: 100, height: 100 }, backgroundColor: "#fff", zoom: 1,
      backgroundImage: "/data/projects/bg.png", backgroundImageFit: "cover",
      elements: [
        { id: "d", type: "device", screenshotSrc: "/data/projects/s.png", position: { x: 0, y: 0 }, size: { width: 1, height: 1 } },
        { id: "i", type: "image", imageSrc: "/elements/images/hand.png", position: { x: 0, y: 0 }, size: { width: 1, height: 1 } },
        { id: "t", type: "text", content: "Hi", position: { x: 0, y: 0 }, size: { width: 1, height: 1 } },
      ],
      localized: { "de-DE": { d: { screenshotSrc: "/data/projects/s-de.png" }, t: { content: "Hallo" } } },
    } as never;
    const out = stripBoard(board, report) as unknown as Record<string, any>;
    expect(out.elements.map((e: { id: string }) => e.id)).toEqual(["d", "t"]);
    expect(out.elements[0].screenshotSrc).toBeUndefined();
    expect(out.backgroundImage).toBeUndefined();
    expect(out.position).toEqual({ x: 0, y: 0 });
    expect(out.localized["de-DE"]).toEqual({ d: {}, t: { content: "Hallo" } });
    expect(report).toMatchObject({ droppedImages: 1, droppedBackgrounds: 1, clearedScreens: 1 });
    expect(isThirdPartySrc("https://cdn.example.com/x.png")).toBe(false);
  });
});
