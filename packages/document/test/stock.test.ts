import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stockSrc, stockUrl, type ArtboardState, type StockPhoto } from "../src/index.ts";
import { alignScreen, fitBox, restoreBoard } from "../scripts/restore-stock.ts";

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

  it("reshapes only contained images that run off the bottom of the board", () => {
    const wide = { file: "wide.png", width: 2, height: 1 } as StockPhoto;
    const at = (y: number, objectFit = "contain") => ({ ...img("i", "/data/projects/x.png"), objectFit, position: { x: 0, y }, size: { width: 4, height: 4 } });
    const mid = board([]), edge = board([]), cover = board([]);
    restoreBoard(mid, board([at(2)]), () => wide);            // 2 + 4 < 9: stays as placed
    restoreBoard(edge, board([at(6)]), () => wide);           // 6 + 4 >= 9: reshaped, bottom kept
    restoreBoard(cover, board([at(6, "cover")]), () => wide); // cover crops to the box the design chose
    expect(mid.elements[0]!.size).toEqual({ width: 4, height: 4 });
    expect(edge.elements[0]!.size).toEqual({ width: 6, height: 3 });
    expect(edge.elements[0]!.position.y + edge.elements[0]!.size.height).toBe(10);
    expect(cover.elements[0]!.size).toEqual({ width: 4, height: 4 });
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

describe("alignScreen", () => {
  it("puts the phone's screen exactly under the overlay and trims the overlay to the screen", () => {
    const photo = { file: "p.png", width: 100, height: 200, screen: { x: 0.5, y: 0.1, width: 0.4, height: 0.5 } } as StockPhoto;
    const phone = { id: "p", type: "image", position: { x: 0, y: 0 }, size: { width: 1000, height: 2000 } } as never as ArtboardState["elements"][number];
    const overlay = { id: "o", type: "image", rotation: -0.4, position: { x: 400, y: 300 }, size: { width: 200, height: 900 } } as never as ArtboardState["elements"][number];
    const board = { elements: [phone, overlay] } as unknown as ArtboardState;
    alignScreen(board, phone, photo);
    // screen is 40 px wide in the file, so the phone scales 5x: 500 x 1000, screen at (250, 100) inside it.
    expect(phone.size).toEqual({ width: 500, height: 1000 });
    expect(phone.position).toEqual({ x: 150, y: 200 });
    expect(overlay.size).toEqual({ width: 200, height: 500 });
    expect(overlay.rotation).toBe(0);
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
