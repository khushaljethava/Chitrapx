/**
 * Puts licensed stock photos back into imported OSG templates, where OSG's own artwork was dropped.
 *
 * import-osg removes every OSG image file (not ours to ship). This script reads OSG's original
 * template JSON again, finds the image elements that were dropped, and re-inserts each one whose
 * OSG file has a replacement in packages/assets/stock.json (and whose file is in apps/web/public/stock),
 * with the same id, position, size and stacking order, pointing at `stock:<file>`.
 * It edits the existing template files in place (keeping hand edits) and is safe to re-run. Usage:
 *   pnpm --filter @chitrapx/document restore-stock [path/to/open-screenshot-generator]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { ArtboardElement, ArtboardState } from "../src/artboard.ts";
import { stockSrc, type StockPhoto } from "../src/stock.ts";

const root = resolve(import.meta.dirname, "../../..");
const templatesDir = join(root, "packages/assets/templates");
const stockDir = join(root, "apps/web/public/stock");

type Lookup = (osgSrc: string) => StockPhoto | undefined;

/**
 * The OSG box reshaped to the photo's proportions: same area, same bottom-centre point (these
 * decorations sit along a board edge), so a wide photo in a tall slot is not drawn tiny.
 */
export function fitBox(el: ArtboardElement, photo: Pick<StockPhoto, "width" | "height">) {
  const { width: w, height: h } = el.size;
  const ratio = photo.width / photo.height;
  const width = Math.round(Math.sqrt(w * h * ratio));
  const height = Math.round(Math.sqrt((w * h) / ratio));
  return { size: { width, height }, position: { x: Math.round(el.position.x + (w - width) / 2), y: Math.round(el.position.y + h - height) } };
}

/**
 * Re-inserts the dropped OSG image elements that have a stock replacement. Returns how many were added.
 * Each goes right after the nearest earlier OSG element still on the board, so stacking order holds.
 */
export function restoreBoard(board: ArtboardState, osgBoard: ArtboardState, lookup: Lookup): number {
  let added = 0;
  osgBoard.elements.forEach((raw, i) => {
    const src = (raw as { imageSrc?: string }).imageSrc;
    const photo = raw.type === "image" && src ? lookup(src) : undefined;
    if (!photo || board.elements.some((e) => e.id === raw.id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = board.elements.findIndex((e) => e.id === osgBoard.elements[j]!.id);
      if (k >= 0) { at = k + 1; break; }
    }
    const { mediaId: _drop, ...el } = raw as unknown as Record<string, unknown>;
    board.elements.splice(at, 0, { ...el, ...fitBox(raw, photo), imageSrc: stockSrc(photo.file) } as unknown as ArtboardElement);
    added++;
  });
  return added;
}

if (import.meta.main) {
  const osg = resolve(process.argv[2] ?? join(root, "../open-screenshot-generator"));
  const photos = JSON.parse(readFileSync(join(root, "packages/assets/stock.json"), "utf8")) as StockPhoto[];
  const ready = photos.filter((p) => existsSync(join(stockDir, p.file)));
  const pending = photos.filter((p) => !ready.includes(p)).map((p) => p.file);
  const byOsgFile = new Map(ready.flatMap((p) => p.replaces.map((f) => [f, p] as const)));
  const lookup: Lookup = (src) => byOsgFile.get(basename(src));

  let total = 0;
  for (const f of readdirSync(templatesDir).filter((x) => x.endsWith(".json") && !x.startsWith("_"))) {
    const path = join(templatesDir, f);
    const template = JSON.parse(readFileSync(path, "utf8")) as { slug: string; source: string; doc: { groups: Array<{ boards: ArtboardState[] }> } };
    const osgFile = join(osg, "public/data/projects", `${template.slug}.json`);
    if (template.source !== "osg" || !existsSync(osgFile)) continue;
    const osgBoards = (JSON.parse(readFileSync(osgFile, "utf8")) as { projectData: ArtboardState[] }).projectData;
    let added = 0;
    for (const board of template.doc.groups.flatMap((g) => g.boards)) {
      const osgBoard = osgBoards.find((b) => b.id === board.id);
      if (osgBoard) added += restoreBoard(board, osgBoard, lookup);
    }
    // ponytail: background pictures are not restored; no OSG template lost one (see _report.json).
    if (!added) continue;
    writeFileSync(path, `${JSON.stringify(template, null, 1)}\n`);
    console.log(`${template.slug}: restored ${added}`);
    total += added;
  }
  console.log(`restored ${total} images from ${ready.length} stock photos`);
  if (pending.length) console.log(`no file yet in apps/web/public/stock: ${pending.join(", ")}`);
}
