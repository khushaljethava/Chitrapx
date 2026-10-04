import type { ArtboardState } from "./artboard.ts";

/** Layout properties apply-to-all copies, and that a language can detach. */
export const LAYOUT_KEYS = ["position", "size", "rotation", "scale"] as const;

/** Counterparts across boards: the nth element of a type on `source` pairs with the nth of that type on `target`. */
export function matchElements(source: ArtboardState, target: ArtboardState): Map<string, string> {
  const byType = new Map<string, string[]>();
  for (const e of target.elements) byType.set(e.type, [...(byType.get(e.type) ?? []), e.id]);
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const e of source.elements) {
    const n = seen.get(e.type) ?? 0;
    seen.set(e.type, n + 1);
    const t = byType.get(e.type)?.[n];
    if (t) out.set(e.id, t);
  }
  return out;
}
