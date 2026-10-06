import { resolveBrand, type ArtboardState, type BrandPalette, type ChitrapxDoc } from "@chitrapx/document";
import { projectArtboards } from "./osg/i18n/project";
import { withPlaceholderScreens } from "./placeholder.ts";
import { resolveBoardSources, type ResolveSrc } from "./sources.ts";

/**
 * The exact board that renders: localized, with the group's span elements shifted into this
 * board's coordinates (drawn beneath its own elements), and every source resolved.
 */
export function boardFor(doc: ChitrapxDoc, groupId: string, boardIndex: number, locale: string | null, resolveSrc: ResolveSrc,
  opts: { palette?: BrandPalette; placeholders?: boolean } = {}): { board: ArtboardState; missing: string[] } {
  const group = doc.groups.find((g) => g.id === groupId);
  const base = group?.boards[boardIndex];
  if (!group || !base) throw new Error(`no board ${groupId}[${boardIndex}]`);
  // OSG reads localization from the boards themselves.
  const stamped = group.boards.map((b) => ({ ...b, localization: doc.localization }));
  const board = projectArtboards(stamped, locale)[boardIndex]!;
  const offset = boardIndex * base.size.width;
  const span = group.spanElements.map((el) => ({ ...el, position: { ...el.position, x: el.position.x - offset } }));
  const missing = new Set<string>();
  // SP9: hidden elements are not drawn anywhere (canvas, preview, export).
  const elements = [...span, ...board.elements].filter((el) => !el.hidden);
  // SP10: brand tokens resolve here, once, so canvas, preview, export and video agree.
  const branded = resolveBrand({ ...board, elements }, opts.palette);
  const resolved = resolveBoardSources(branded, resolveSrc, missing);
  // Previews only: empty screens get a generic app screen. Exports never pass this.
  return { board: opts.placeholders ? withPlaceholderScreens(resolved) : resolved, missing: [...missing] };
}
