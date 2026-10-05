import type { ArtboardElement, ArtboardState } from "./artboard.ts";
import type { BoardGroup } from "./doc.ts";
import { getTarget, type TargetId } from "./targets.ts";

/**
 * Fits a group's design into another store size: uniform scale to fit, centred, so nothing
 * crops and relative layout is kept. The board background fills the margin.
 * ponytail: letterboxes when aspect ratios differ a lot (phone to tablet); smarter
 * per-element reflow belongs to the editor's layout tools.
 */
export function retarget(group: BoardGroup, targetId: TargetId): BoardGroup {
  const target = getTarget(targetId);
  if (!target) throw new Error(`unknown target ${targetId}`);
  const first = group.boards[0];
  if (!first) return { ...group, target: targetId };
  const { width: w, height: h } = first.size;
  const s = Math.min(target.width / w, target.height / h);
  const ox = (target.width - w * s) / 2;
  const oy = (target.height - h * s) / 2;

  const move = (el: ArtboardElement, boardOffsetX = 0, newBoardOffsetX = 0): ArtboardElement => {
    const out = {
      ...el,
      position: { x: (el.position.x - boardOffsetX) * s + ox + newBoardOffsetX, y: el.position.y * s + oy },
      size: { width: el.size.width * s, height: el.size.height * s },
    } as ArtboardElement;
    if (out.type === "text" || out.type === "chips") out.fontSize = out.fontSize * s;
    if (out.type === "chips" && out.gap !== undefined) out.gap = out.gap * s;
    return out;
  };

  const boards: ArtboardState[] = group.boards.map((b) => ({
    ...b,
    size: { width: target.width, height: target.height },
    elements: b.elements.map((el) => move(el)),
  }));
  // Span elements live in strip coordinates: map each into the board it starts on, then back.
  const spanElements = group.spanElements.map((el) => {
    const i = Math.max(0, Math.min(group.boards.length - 1, Math.floor(el.position.x / w)));
    return move(el, i * w, i * target.width);
  });
  return { ...group, target: targetId, boards, spanElements };
}
