import { CHIP_MAX_CHARS } from "@chitrapx/document";

/** A chip as setChips stores it. */
const clean = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, CHIP_MAX_CHARS);

/**
 * Why typing `text` into base chip `i` is refused, or null. setChips refuses a repeated chip (case aside) so later
 * chips' translations do not shift; the editor says so instead of dropping the edit silently.
 */
export function chipEditError(chips: readonly string[], i: number, text: string): string | null {
  const t = clean(text).toLowerCase();
  if (!t) return null;
  return chips.some((c, k) => k !== i && clean(c).toLowerCase() === t) ? "Each chip must be different" : null;
}
