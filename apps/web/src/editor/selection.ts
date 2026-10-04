import type { ChitrapxDoc } from "@chitrapx/document";
import { elementsOf, findElement, type Ref } from "./commands.ts";

const key = (r: Ref) => `${r.groupId}|${r.boardId}|${r.elementId}`;
function unique(refs: Ref[]): Ref[] {
  const seen = new Set<string>();
  return refs.filter((r) => (seen.has(key(r)) ? false : (seen.add(key(r)), true)));
}

/**
 * What a canvas click on `refs` selects: each clicked element plus the unlocked members of its
 * element group in the same list. `single` (alt-click) selects only what was clicked.
 */
export function expandToGroups(doc: ChitrapxDoc, refs: Ref[], opts: { single?: boolean } = {}): Ref[] {
  if (opts.single) return unique(refs);
  const out: Ref[] = [];
  for (const r of refs) {
    const els = elementsOf(doc, r.groupId, r.boardId);
    const el = els?.find((e) => e.id === r.elementId);
    if (!els || !el?.groupId) { out.push(r); continue; }
    for (const m of els) if (m.groupId === el.groupId && (!m.locked || m.id === el.id)) out.push({ ...r, elementId: m.id });
  }
  return unique(out);
}

/** Refs the canvas and keyboard may act on: existing, not locked, not hidden. */
export function selectableRefs(doc: ChitrapxDoc, refs: Ref[]): Ref[] {
  return refs.filter((r) => { const el = findElement(doc, r); return !!el && !el.locked && !el.hidden; });
}
