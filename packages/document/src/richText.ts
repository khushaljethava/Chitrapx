// Mark algebra ported from PixelDeck (MIT), src/utils/richText.ts (segmentMarks, normalizeMarks,
// applyMarkStyle, clearMarkStyle, getRangeStyle), reworked for Chitrapx's mark keys; remapMarks is new.
import { normalizeGradient, type Gradient } from "./gradient.ts";

export type MarkStyle = { color?: string; gradient?: Gradient; fontWeight?: number; italic?: boolean };
/** Styling over `content[start, end)`, offsets in UTF-16 code units. Later marks win per key. */
export type TextMark = MarkStyle & { start: number; end: number };
export type StylePatch = { [K in keyof MarkStyle]?: MarkStyle[K] | null };
export const MARK_KEYS = ["color", "gradient", "fontWeight", "italic"] as const satisfies ReadonlyArray<keyof MarkStyle>;
type Range = { start: number; end: number };
type Segment = { start: number; end: number; style: MarkStyle };

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sameStyle = (a: MarkStyle, b: MarkStyle) => MARK_KEYS.every((k) => sameValue(a[k], b[k]));

/** Only valid values survive, in a fixed key order. */
function cleanStyle(m: Record<string, unknown>): MarkStyle {
  const s: MarkStyle = {};
  if (typeof m.color === "string" && m.color.trim()) s.color = m.color.trim();
  const g = normalizeGradient(m.gradient);
  if (g) s.gradient = g;
  if (typeof m.fontWeight === "number" && Number.isFinite(m.fontWeight)) s.fontWeight = Math.min(1000, Math.max(1, Math.round(m.fontWeight)));
  if (typeof m.italic === "boolean") s.italic = m.italic;
  return s;
}
const canonical = (s: MarkStyle): MarkStyle => cleanStyle(s as Record<string, unknown>);

/** Colour and gradient are one fill: setting one removes the other. */
function setFill(style: MarkStyle, from: MarkStyle) {
  if (from.color !== undefined) delete style.gradient;
  if (from.gradient !== undefined) delete style.color;
  Object.assign(style, from);
}

function segmentRanges(marks: readonly TextMark[], length: number, cutsExtra: number[] = []): Segment[] {
  if (length <= 0) return [];
  const clamp = (n: number) => Math.max(0, Math.min(length, Math.floor(n)));
  const valid = marks.filter((m) => typeof m?.start === "number" && typeof m?.end === "number" && Number.isFinite(m.start) && Number.isFinite(m.end))
    .map((m) => ({ s: clamp(m.start), e: clamp(m.end), style: cleanStyle(m as unknown as Record<string, unknown>) }))
    .filter((m) => m.s < m.e && Object.keys(m.style).length);
  const cuts = [...new Set([0, length, ...valid.flatMap((m) => [m.s, m.e]), ...cutsExtra.filter((b) => b > 0 && b < length)])].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const start = cuts[i]!, end = cuts[i + 1]!;
    const style: MarkStyle = {};
    for (const m of valid) if (m.s <= start && m.e >= end) setFill(style, m.style);
    out.push({ start, end, style: canonical(style) });
  }
  return out;
}

function toMarks(segs: Segment[]): TextMark[] {
  const out: TextMark[] = [];
  for (const seg of segs) {
    if (!Object.keys(seg.style).length) continue;
    const prev = out.at(-1);
    if (prev && prev.end === seg.start && sameStyle(prev, seg.style)) prev.end = seg.end;
    else out.push({ start: seg.start, end: seg.end, ...seg.style });
  }
  return out;
}

const lengthOf = (marks: readonly TextMark[], range?: Range) => Math.max(range?.end ?? 0, 0, ...marks.map((m) => (Number.isFinite(m.end) ? m.end : 0)));

/** Canonical marks: clamped to `length`, overlaps split (later wins), empty dropped, equal neighbours merged, sorted. */
export function normalizeMarks(marks: readonly TextMark[], length: number): TextMark[] {
  return toMarks(segmentRanges(marks, length));
}

/** Applies `style` to `range`: a value sets that key, null removes it. Returns canonical marks. */
export function applyMark(marks: readonly TextMark[], range: Range, style: StylePatch): TextMark[] {
  const length = lengthOf(marks, range);
  const s = Math.max(0, Math.floor(range.start)), e = Math.min(length, Math.floor(range.end));
  if (s >= e) return normalizeMarks(marks, length);
  const segs = segmentRanges(marks, length, [s, e]);
  for (const seg of segs) {
    if (seg.start < s || seg.end > e) continue;
    const set: MarkStyle = {};
    for (const k of MARK_KEYS) {
      const v = style[k];
      if (v === null) delete seg.style[k];
      else if (v !== undefined) (set as Record<string, unknown>)[k] = v;
    }
    setFill(seg.style, canonical(set));
    seg.style = canonical(seg.style);
  }
  return toMarks(segs);
}

/** Removes `keys` (all by default) from `range`. */
export function clearMark(marks: readonly TextMark[], range: Range, keys: readonly (keyof MarkStyle)[] = MARK_KEYS): TextMark[] {
  return applyMark(marks, range, Object.fromEntries(keys.map((k) => [k, null])) as StylePatch);
}

/** Each key's common value over `range`, or "mixed". A collapsed range reports the letter after the caret. */
export function rangeStyle(marks: readonly TextMark[], range: Range): { [K in keyof MarkStyle]: MarkStyle[K] | "mixed" | undefined } {
  const start = Math.max(0, Math.floor(range.start));
  const end = Math.max(start + (range.end > range.start ? 0 : 1), Math.floor(range.end));
  const length = lengthOf(marks, { start, end });
  const segs = segmentRanges(marks, length, [start, end]).filter((sg) => sg.start >= start && sg.end <= end);
  const out = {} as { [K in keyof MarkStyle]: MarkStyle[K] | "mixed" | undefined };
  for (const k of MARK_KEYS) {
    const values = segs.map((sg) => sg.style[k]);
    (out as Record<string, unknown>)[k] = values.every((v) => sameValue(v, values[0])) ? values[0] : "mixed";
  }
  return out;
}

/** The content cut into runs of one style, covering every letter. What the renderer draws. */
export function segments(content: string, marks: readonly TextMark[] = []): Array<Segment & { text: string }> {
  return segmentRanges(marks, content.length).map((sg) => ({ start: sg.start, end: sg.end, text: content.slice(sg.start, sg.end), style: sg.style }));
}

/** Marks carried across an edit of `oldContent` into `newContent` (see the plan's remap rules). */
export function remapMarks(oldContent: string, newContent: string, marks: readonly TextMark[] = []): TextMark[] {
  if (!marks.length) return [];
  if (oldContent === newContent) return normalizeMarks(marks, newContent.length);
  const max = Math.min(oldContent.length, newContent.length);
  let p = 0;
  while (p < max && oldContent[p] === newContent[p]) p++;
  let q = 0;
  while (q < max - p && oldContent[oldContent.length - 1 - q] === newContent[newContent.length - 1 - q]) q++;
  const oldEnd = oldContent.length - q, newEnd = newContent.length - q, delta = newContent.length - oldContent.length;
  const out: TextMark[] = [];
  for (const m of marks) {
    if (m.end <= p) out.push({ ...m });                                         // before the edit
    else if (m.start >= oldEnd) out.push({ ...m, start: m.start + delta, end: m.end + delta }); // after it
    else if (m.start < p && m.end > oldEnd) out.push({ ...m, end: m.end + delta });        // the edit is inside the mark
    else if (m.start >= p && m.end <= oldEnd) continue;                         // deleted or replaced with the edit
    else if (m.start < p) out.push({ ...m, end: p });                           // clipped on the right
    else out.push({ ...m, start: newEnd, end: m.end + delta });                 // clipped on the left
  }
  return normalizeMarks(out, newContent.length);
}
