import type { ArtboardElement, ArtboardState, ShapeElementProps, TextElementProps } from "./artboard.ts";
import { getTarget } from "./targets.ts";

export type AsoIssue = {
  elementId: string;
  code: "headline_words" | "headline_lines" | "too_small" | "low_contrast" | "translation_long";
  severity: "warning" | "error";
  message: string;
};

/** OSG text renders at fontSize / 0.3 board pixels. */
const renderedPx = (t: TextElementProps) => t.fontSize / 0.3;
const MAX_HEADLINE_WORDS = 5;
const MAX_HEADLINE_LINES = 3;
/** Store search results show a portrait screenshot about 400 px tall; text below 6 px there is unreadable. */
const THUMB_HEIGHT = 400;
const MIN_THUMB_PX = 5;
/** Small text needs 3:1; big headline type (over 60 board px) stays readable down to about 2.2:1. */
const MIN_CONTRAST = 3;
const MIN_CONTRAST_LARGE = 2.2;
const LARGE_PX = 60;
const MAX_GROWTH = 1.4;
/** Average glyph advance as a share of the font size; enough for a wrapping estimate. */
const GLYPH = 0.5;

function rgb(color: string | undefined): [number, number, number] | null {
  if (!color) return null;
  const c = color.trim().toLowerCase();
  if (c === "white") return [255, 255, 255];
  if (c === "black") return [0, 0, 0];
  let m = /^#([0-9a-f]{3,8})$/.exec(c);
  if (m) {
    const h = m[1]!;
    const full = h.length <= 4 ? [...h.slice(0, 3)].map((x) => x + x).join("") : h.slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  }
  m = /^rgba?\(([^)]+)\)$/.exec(c);
  if (m) {
    const parts = m[1]!.split(/[\s,/]+/).filter(Boolean).slice(0, 3).map((p) => (p.endsWith("%") ? (parseFloat(p) * 255) / 100 : parseFloat(p)));
    return parts.length === 3 && parts.every(Number.isFinite) ? (parts as [number, number, number]) : null;
  }
  return null;
}

const luminance = ([r, g, b]: [number, number, number]) => {
  const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/** WCAG contrast ratio, or null when either colour cannot be read. */
export function contrastRatio(a: string | undefined, b: string | undefined): number | null {
  const x = rgb(a), y = rgb(b);
  if (!x || !y) return null;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** How many leading boards a shopper sees before scrolling. */
export function foldCount(targetId: string): number {
  const p = getTarget(targetId)?.platform;
  if (p === "play") return 1;
  if (p === "android") return 2;
  return 3;
}

const SOLID_SHAPES = new Set(["rectangle", "circle", "message", "speech-bubble"]);

/**
 * Colours directly behind a text element: the topmost shape under its centre, else the board
 * background. Null when a screenshot, photo or irregular shape is behind it, since those pixels are unknown here.
 */
function backgroundsBehind(board: ArtboardState, index: number): string[] | null {
  const el = board.elements[index]!;
  const cx = el.position.x + (el.size.width * (el.scale || 1)) / 2;
  const cy = el.position.y + (el.size.height * (el.scale || 1)) / 2;
  for (let i = index - 1; i >= 0; i--) {
    const s = board.elements[i]!;
    const inside = cx >= s.position.x && cx <= s.position.x + s.size.width * (s.scale || 1) && cy >= s.position.y && cy <= s.position.y + s.size.height * (s.scale || 1);
    if (inside && (s.type === "image" || s.type === "device" || s.type === "video" || s.type === "video-device")) return null;
    if (s.type !== "shape") continue;
    const shape = s as ShapeElementProps;
    // A custom path, star or polygon may be a solid pill or a hollow wreath: what is behind is unknown.
    if (inside && !SOLID_SHAPES.has(shape.shapeType)) return null;
    if (inside && (shape.fillOpacity ?? 1) >= 0.5 && (s.opacity ?? 1) >= 0.5) {
      return shape.fillGradient ? [shape.fillGradient.color1, shape.fillGradient.color2] : [shape.fillColor];
    }
  }
  return board.backgroundType === "gradient" && board.backgroundGradient
    ? [board.backgroundGradient.color1, board.backgroundGradient.color2]
    : [board.backgroundColor];
}

/** Lines a text needs: explicit line breaks, each wrapped by an estimate of its width in the box. */
function estimatedLines(t: TextElementProps, content: string): number {
  const box = t.size.width * (t.scale || 1);
  const px = renderedPx(t);
  return content.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil((line.length * px * GLYPH) / Math.max(1, box))), 0);
}

/**
 * Store-readiness checks for one board, in the given language (base text plus that language's
 * overrides). The headline is the board's largest text.
 */
export function lintBoard(board: ArtboardState, locale?: { code: string; base: string }): AsoIssue[] {
  const issues: AsoIssue[] = [];
  const overrides = locale && locale.code !== locale.base ? board.localized?.[locale.code] ?? {} : {};
  const texts = board.elements.map((e, i) => ({ e, i })).filter((x): x is { e: TextElementProps & ArtboardElement; i: number } => x.e.type === "text");
  const largest = Math.max(0, ...texts.map(({ e }) => renderedPx(e)));
  const thumbScale = THUMB_HEIGHT / board.size.height;

  for (const { e, i } of texts) {
    const base = e.content ?? "";
    const content = overrides[e.id]?.content ?? base;
    if (!content.trim()) continue;
    const isHeadline = renderedPx(e) >= largest * 0.9;
    if (isHeadline) {
      const words = Math.max(...content.split("\n").map((l) => l.trim().split(/\s+/).filter(Boolean).length));
      if (words > MAX_HEADLINE_WORDS) issues.push({ elementId: e.id, code: "headline_words", severity: "warning", message: `${words} words on one line. Shoppers skim: keep headline lines to ${MAX_HEADLINE_WORDS} words or fewer.` });
      const lines = estimatedLines(e, content);
      if (lines > MAX_HEADLINE_LINES) issues.push({ elementId: e.id, code: "headline_lines", severity: "warning", message: `About ${lines} lines. Keep the headline to ${MAX_HEADLINE_LINES} lines.` });
    }
    if (renderedPx(e) * thumbScale < MIN_THUMB_PX) {
      issues.push({ elementId: e.id, code: "too_small", severity: "warning", message: "Too small to read in store search results. Make it larger or remove it." });
    }
    // Decorative glyphs (stars, dots, arrows) carry no words to read.
    const ratios = /[\p{L}\p{N}]/u.test(content)
      ? (backgroundsBehind(board, i) ?? []).map((bg) => contrastRatio(e.color, bg)).filter((r): r is number => r !== null)
      : [];
    const needed = renderedPx(e) > LARGE_PX ? MIN_CONTRAST_LARGE : MIN_CONTRAST;
    if (ratios.length && Math.min(...ratios) < needed) {
      issues.push({ elementId: e.id, code: "low_contrast", severity: Math.min(...ratios) < 1.5 ? "error" : "warning", message: `Low contrast (${Math.min(...ratios).toFixed(1)}:1) with what is behind it. Aim for at least ${needed}:1.` });
    }
    if (content !== base && base.length > 0 && content.length > base.length * MAX_GROWTH) {
      issues.push({ elementId: e.id, code: "translation_long", severity: "warning", message: `This translation is ${Math.round((content.length / base.length - 1) * 100)} percent longer than the original and may not fit.` });
    }
  }
  return issues;
}
