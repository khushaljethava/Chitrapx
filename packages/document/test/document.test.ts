import { describe, expect, it } from "vitest";
import { emptyDoc, fillScreenshots, migrate, retarget, targetForSize } from "../src/index.ts";
import { board, device, doc, group, text } from "./fixtures.ts";

describe("migrate", () => {
  it("upgrades a Foundation-era empty doc that lacks baseLocale", () => {
    expect(migrate({ schemaVersion: 1, kind: "screenshots", groups: [], localization: { locales: [] } }).localization.baseLocale).toBe("en-US");
    expect(migrate(emptyDoc("video"))).toEqual(emptyDoc("video"));
  });
  it("rejects unknown targets and malformed elements", () => {
    expect(() => migrate({ ...emptyDoc("screenshots"), groups: [{ id: "g", target: "nokia-3310", boards: [] }] })).toThrow();
    expect(() => migrate(doc([group([board("b", [{ id: "x", type: "text" } as never])])]))).toThrow();
  });
});

describe("targetForSize", () => {
  it("matches exact sizes, else the closest aspect ratio", () => {
    expect(targetForSize(1290, 2796).id).toBe("iphone-6.9");
    expect(targetForSize(1024, 500).id).toBe("play-feature");
    expect(targetForSize(1000, 1000).platform).toBeDefined();
  });
});

describe("retarget", () => {
  it("fits 6.9 to 6.5 inches: elements stay inside and keep relative layout", () => {
    const g = group([board("b1", [text("t", 245, 200), device("d", 345, "")])]);
    const out = retarget(g, "iphone-6.5");
    const b = out.boards[0]!;
    expect(b.size).toEqual({ width: 1242, height: 2688 });
    for (const el of b.elements) {
      expect(el.position.x).toBeGreaterThanOrEqual(0);
      expect(el.position.y).toBeGreaterThanOrEqual(0);
      expect(el.position.x + el.size.width).toBeLessThanOrEqual(1242 + 1);
      expect(el.position.y + el.size.height).toBeLessThanOrEqual(2688 + 1);
    }
    const [t, d] = b.elements as unknown as [{ position: { x: number; y: number } }, { position: { x: number; y: number } }];
    const s = 2688 / 2796;
    expect(Math.abs(d.position.x - t.position.x - 100 * s)).toBeLessThan(1);
    expect(Math.abs(d.position.y - t.position.y - 200 * s)).toBeLessThan(1);
    expect((b.elements[0] as unknown as { fontSize: number }).fontSize).toBeCloseTo(120 * s);
  });

  it("keeps span elements on the same board seam", () => {
    const g = group([board("b1", []), board("b2", [])], [device("span", 1290 - 300)]);
    const out = retarget(g, "iphone-6.5");
    const el = out.spanElements[0]!;
    expect(el.position.x).toBeLessThan(1242);
    expect(el.position.x + el.size.width).toBeGreaterThan(1242);
  });
});

describe("fillScreenshots", () => {
  const src = (d: ReturnType<typeof fillScreenshots>, b: number, e: number) =>
    (d.groups[0]!.boards[b]!.elements[e] as unknown as { screenshotSrc: string }).screenshotSrc;

  it("fills empty screens left to right, board by board, and stops when screenshots run out", () => {
    const d = doc([group([board("b1", [device("right", 700), device("left", 100)]), board("b2", [device("only", 300)])])]);
    const out = fillScreenshots(d, ["a1", "a2"]);
    expect(src(out, 0, 1)).toBe("asset:a1");
    expect(src(out, 0, 0)).toBe("asset:a2");
    expect(src(out, 1, 0)).toBe("");
  });

  it("leaves screens that already show something and ignores extra screenshots", () => {
    const d = doc([group([board("b1", [device("set", 100, "asset:keep"), device("empty", 700)])])]);
    const out = fillScreenshots(d, ["n1", "n2", "n3"]);
    expect(src(out, 0, 0)).toBe("asset:keep");
    expect(src(out, 0, 1)).toBe("asset:n1");
    expect(d.groups[0]!.boards[0]!.elements[1]).not.toHaveProperty("screenshotSrc", "asset:n1");
  });
});
