import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stockSrc, stockUrl, type ArtboardState, type StockPhoto } from "../src/index.ts";
import { fitBox, restoreBoard } from "../scripts/restore-stock.ts";

const root = join(import.meta.dirname, "../../..");
const photos = JSON.parse(readFileSync(join(root, "packages/assets/stock.json"), "utf8")) as StockPhoto[];

describe("stock sources", () => {
  it("map plain file names to /stock and refuse anything path-like", () => {
    expect(stockUrl(stockSrc("calora-kettlebell.png"))).toBe("/stock/calora-kettlebell.png");
    expect(stockUrl("asset:abc")).toBeNull();
    for (const bad of ["stock:../secret.png", "stock:a/b.png", "stock:x.svg", "stock:", "stock:X.png"]) expect(stockUrl(bad), bad).toBeNull();
    expect(() => stockSrc("../x.png")).toThrow();
  });
});

describe("restoreBoard", () => {
  const el = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "text", position: { x: 0, y: 0 }, size: { width: 1, height: 1 }, ...extra });
  const img = (id: string, src: string) => el(id, { type: "image", imageSrc: src, mediaId: "m" });
  const board = (elements: unknown[]) => ({ id: "b", name: "b", position: { x: 0, y: 0 }, size: { width: 9, height: 9 }, backgroundColor: "#fff", zoom: 1, elements }) as unknown as ArtboardState;
  const photo = { file: "plant.png", width: 1, height: 1 } as StockPhoto;
  const lookup = (src: string) => (src.endsWith("/osg-plant.png") ? photo : undefined);

  it("puts replaced images back in their stacking order, once, and leaves unreplaced ones out", () => {
    const osg = board([img("i0", "/data/projects/osg-plant.png"), el("a"), img("i1", "/data/projects/osg-plant.png"), img("i2", "/data/projects/other.png"), el("b")]);
    const ours = board([el("a"), el("b")]);
    expect(restoreBoard(ours, osg, lookup)).toBe(2);
    expect(ours.elements.map((e) => e.id)).toEqual(["i0", "a", "i1", "b"]);
    const restored = ours.elements[2] as unknown as { imageSrc: string; mediaId?: string };
    expect(restored.imageSrc).toBe("stock:plant.png");
    expect(restored.mediaId).toBeUndefined();
    expect(restoreBoard(ours, osg, lookup)).toBe(0); // re-running adds nothing
  });
});

describe("fitBox", () => {
  it("takes the photo's proportions, keeps the area and the bottom-centre point", () => {
    const el = { position: { x: 100, y: 1000 }, size: { width: 400, height: 800 } } as never;
    const box = fitBox(el, { width: 2, height: 1 });
    expect(box.size).toEqual({ width: 800, height: 400 });
    expect(box.position).toEqual({ x: -100, y: 1400 });
    expect(fitBox(el, { width: 1, height: 2 })).toEqual({ size: { width: 400, height: 800 }, position: { x: 100, y: 1000 } });
  });
});

describe("stock provenance", () => {
  it("every photo has a full record", () => {
    expect(new Set(photos.map((p) => p.file)).size).toBe(photos.length);
    for (const p of photos) {
      expect(() => stockSrc(p.file), p.file).not.toThrow();
      expect(p.retrieved, p.file).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const k of ["sourceId", "sourceUrl", "photographer", "license", "licenseUrl", "processing"] as const) expect(p[k], `${p.file} ${k}`).toBeTruthy();
      expect(p.replaces.length, p.file).toBeGreaterThan(0);
      expect(p.width > 0 && p.height > 0, p.file).toBe(true);
    }
  });

  it("every stock photo a template uses is recorded and shipped", () => {
    const dir = join(root, "packages/assets/templates");
    const known = new Set(photos.map((p) => p.file));
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json") && !x.startsWith("_"))) {
      for (const [, file] of readFileSync(join(dir, f), "utf8").matchAll(/"stock:([^"]+)"/g)) {
        expect(known.has(file!), `${f}: ${file} has no row in stock.json`).toBe(true);
        expect(existsSync(join(root, "apps/web/public/stock", file!)), `${f}: ${file} missing from apps/web/public/stock`).toBe(true);
      }
    }
  });
});
