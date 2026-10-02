import type { ArtboardState, ChitrapxDoc } from "@chitrapx/document";
import { projectArtboards } from "./osg/i18n/project";
import { resolveBoardSources, type ResolveSrc } from "./sources.ts";

/**
 * The exact board that renders: localized, with the group's span elements shifted into this
 * board's coordinates (drawn beneath its own elements), and every source resolved.
 */
export function boardFor(doc: ChitrapxDoc, groupId: string, boardIndex: number, locale: string | null, resolveSrc: ResolveSrc):
  { board: ArtboardState; missing: string[] } {
  const group = doc.groups.find((g) => g.id === groupId);
  const base = group?.boards[boardIndex];
  if (!group || !base) throw new Error(`no board ${groupId}[${boardIndex}]`);
  // OSG reads localization from the boards themselves.
  const stamped = group.boards.map((b) => ({ ...b, localization: doc.localization }));
  const board = projectArtboards(stamped, locale)[boardIndex]!;
  const offset = boardIndex * base.size.width;
  const span = group.spanElements.map((el) => ({ ...el, position: { ...el.position, x: el.position.x - offset } }));
  const missing = new Set<string>();
  return { board: resolveBoardSources({ ...board, elements: [...span, ...board.elements] }, resolveSrc, missing), missing: [...missing] };
}
