/**
 * Converts open-screenshot-generator templates into Chitrapx documents.
 *
 * OSG's MIT licence covers its template JSON, not its artwork (see its THIRD-PARTY-ASSETS.md),
 * so every reference to an OSG image file is removed here: device screens become empty slots,
 * photo elements and background pictures are dropped. Usage:
 *   pnpm --filter @chitrapx/document import-osg [path/to/open-screenshot-generator]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { ArtboardElement, ArtboardState } from "../src/artboard.ts";
import { DEFAULT_BASE_LOCALE, migrate, type BoardGroup, type ChitrapxDoc, type ProjectKind } from "../src/doc.ts";
import { targetForSize } from "../src/targets.ts";

const osg = resolve(process.argv[2] ?? join(import.meta.dirname, "../../../../open-screenshot-generator"));
const out = resolve(import.meta.dirname, "../../assets/templates");

/** A source pointing into OSG's own files (or inlined bytes): not ours to ship. */
export const isThirdPartySrc = (v: unknown): boolean => typeof v === "string" && (v.startsWith("/") || v.startsWith("data:"));

type Report = { slug: string; droppedImages: number; droppedBackgrounds: number; clearedScreens: number };

function categoriesBySlug(): Map<string, string> {
  const text = readFileSync(join(osg, "src/lib/templateCategories.ts"), "utf8");
  const map = new Map<string, string>();
  for (const block of text.split(/\n\s*\{\n\s*id: '/).slice(1)) {
    const id = block.slice(0, block.indexOf("'"));
    for (const m of block.matchAll(/'([^']+)\.json'/g)) map.set(m[1]!, id);
  }
  return map;
}

export function stripBoard(board: ArtboardState, report: Report): ArtboardState {
  const elements: ArtboardElement[] = [];
  for (const raw of board.elements) {
    const el = { ...raw } as Record<string, unknown> & ArtboardElement;
    if (el.type === "image" && isThirdPartySrc(el.imageSrc)) { report.droppedImages++; continue; }
    if (el.type === "video" && isThirdPartySrc(el.videoSrc)) { report.droppedImages++; continue; }
    if (el.type === "device" || el.type === "video-device") {
      if (el.deviceType === "custom" && isThirdPartySrc(el.customFrameSrc)) { report.droppedImages++; continue; }
      if (isThirdPartySrc(el.screenshotSrc) || isThirdPartySrc(el.posterSrc)) report.clearedScreens++;
      for (const key of ["screenshotSrc", "posterSrc", "mediaId"]) delete el[key];
    }
    elements.push(el);
  }
  const next: Record<string, unknown> = { ...board, position: { x: 0, y: 0 }, elements };
  if (isThirdPartySrc(board.backgroundImage)) {
    report.droppedBackgrounds++;
    for (const key of ["backgroundImage", "backgroundImageFit", "backgroundImageTintColor", "backgroundImageTintOpacity", "backgroundImageApply", "backgroundImageSlice"]) delete next[key];
  }
  delete next.localization; // doc-level in Chitrapx
  if (board.localized) {
    next.localized = Object.fromEntries(Object.entries(board.localized).map(([locale, byEl]) => [locale,
      Object.fromEntries(Object.entries(byEl).map(([id, ov]) => {
        const o: Record<string, unknown> = { ...ov };
        for (const key of ["screenshotSrc", "imageSrc", "mediaId"]) if (isThirdPartySrc(o[key]) || key === "mediaId") delete o[key];
        return [id, o];
      }))]));
  }
  return next as unknown as ArtboardState;
}

function convert(file: string, category: string | undefined) {
  const slug = basename(file, ".json");
  const src = JSON.parse(readFileSync(file, "utf8")) as { name: string; description?: string; projectData: ArtboardState[] };
  const report: Report = { slug, droppedImages: 0, droppedBackgrounds: 0, clearedScreens: 0 };
  const boards = src.projectData.map((b) => stripBoard(b, report));

  // One group per distinct board size, in first-seen order.
  const groups: BoardGroup[] = [];
  for (const b of boards) {
    const target = targetForSize(b.size.width, b.size.height);
    let g = groups.find((x) => x.target === target.id);
    if (!g) groups.push(g = { id: `${slug}-${target.id}`, target: target.id as BoardGroup["target"], boards: [], spanElements: [] });
    g.boards.push(b);
  }
  const hasMotion = boards.some((b) => b.elements.some((e) => e.type === "video-device" || e.type === "gesture" || e.type === "video"));
  const kind: ProjectKind = hasMotion || groups.some((g) => g.target === "app-preview-portrait") ? "video" : "screenshots";
  const localization = src.projectData.find((b) => b.localization)?.localization ?? { baseLocale: DEFAULT_BASE_LOCALE, locales: [] };
  const doc: ChitrapxDoc = migrate({ schemaVersion: 1, kind, groups, localization });

  const leftover = JSON.stringify(doc).match(/"(\/(data|elements)\/[^"]+|data:image[^"]{0,20})"/);
  if (leftover) throw new Error(`${slug}: third-party reference survived: ${leftover[1]}`);

  return {
    template: {
      slug, name: src.name, description: src.description ?? "", category: category ?? "screenshots",
      platforms: [...new Set(groups.map((g) => targetForSize(g.boards[0]!.size.width, g.boards[0]!.size.height).platform))],
      kind, source: "osg" as const,
      licenseNote: "Layout from open-screenshot-generator (MIT, Copyright (c) 2026 Idrees Khan); artwork removed.",
      doc,
    },
    report,
  };
}

if (import.meta.main) {
  const cats = categoriesBySlug();
  const dir = join(osg, "public/data/projects");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const reports: Report[] = [];
  for (const f of files) {
    const { template, report } = convert(join(dir, f), cats.get(basename(f, ".json")));
    writeFileSync(join(out, `${template.slug}.json`), `${JSON.stringify(template, null, 1)}\n`);
    reports.push(report);
  }
  writeFileSync(join(out, "_report.json"), `${JSON.stringify(reports, null, 1)}\n`);
  const sum = (k: keyof Omit<Report, "slug">) => reports.reduce((n, r) => n + r[k], 0);
  console.log(`${files.length} templates -> ${out}`);
  console.log(`cleared screens ${sum("clearedScreens")}, dropped images ${sum("droppedImages")}, dropped backgrounds ${sum("droppedBackgrounds")}`);
}
