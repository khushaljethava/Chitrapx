/**
 * The array index (last is front-most) for an element dropped in a front-most-first panel list.
 * `panel` is the panel order after the move; it may omit collapsed rows. `elements` is the current
 * array. The element just below the dropped one in the panel is just behind it in the array.
 */
export function arrayIndexForPanelDrop(panel: string[], elements: string[], id: string): number {
  const without = elements.filter((x) => x !== id);
  const behind = panel[panel.indexOf(id) + 1];
  if (behind === undefined) return 0; // dropped at the bottom of the panel: back-most
  return without.indexOf(behind) + 1;
}
