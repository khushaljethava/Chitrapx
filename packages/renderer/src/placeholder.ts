import type { ArtboardElement, ArtboardState } from "@chitrapx/document";

/**
 * Original, generic app screens drawn as SVG, so template previews never show an empty phone.
 * Only for previews (the template gallery): exports keep empty screens blank, so a placeholder
 * can never reach a store upload. The art is ours; nothing comes from OSG's unlicensed PNGs.
 */

type Theme = { bg: string; card: string; block: string; line: string; accent: string; soft: string };
const ACCENTS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];
const LAYOUTS = ["list", "feed", "grid", "chat", "dashboard"] as const;
export type PlaceholderLayout = (typeof LAYOUTS)[number] | "desktop" | "watch";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function theme(dark: boolean, accent: string): Theme {
  return dark
    ? { bg: "#14161b", card: "#1f232a", block: "#2c313a", line: "#3a404b", accent, soft: `${accent}55` }
    : { bg: "#f6f7f9", card: "#ffffff", block: "#e4e7ec", line: "#d3d8df", accent, soft: `${accent}33` };
}

const rect = (x: number, y: number, w: number, h: number, rx: number, fill: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"/>`;
const circle = (cx: number, cy: number, r: number, fill: string) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
const lines = (x: number, y: number, w: number, t: Theme) => rect(x, y, w, 12, 6, t.block) + rect(x, y + 20, w * 0.6, 10, 5, t.line);

/** Repeats `row` (which returns its svg and height) down the screen until `bottom`. */
function fill(y: number, bottom: number, row: (y: number, i: number) => [string, number]): string {
  let out = "";
  for (let i = 0; y < bottom; i++) {
    const [svg, h] = row(y, i);
    if (y + h > bottom) break;
    out += svg;
    y += h;
  }
  return out;
}

function tall(layout: (typeof LAYOUTS)[number], W: number, H: number, t: Theme): string {
  const p = 24, top = Math.round(H * 0.07), tabH = 64, bottom = H - tabH - 8;
  const header = rect(p, top, W * 0.45, 22, 8, t.block) + circle(W - p - 16, top + 11, 16, t.soft);
  const tabs = rect(0, H - tabH, W, tabH, 0, t.card) +
    [0, 1, 2, 3].map((i) => circle(W * (0.14 + i * 0.24), H - tabH / 2, 9, i === 0 ? t.accent : t.line)).join("");
  let body = "";
  const y0 = top + 48;
  switch (layout) {
    case "list":
      body = rect(p, y0, W - 2 * p, 40, 20, t.card) +
        fill(y0 + 60, bottom, (y) => [circle(p + 22, y + 22, 22, t.soft) + lines(p + 60, y + 6, W - 2 * p - 60, t), 64]);
      break;
    case "feed":
      body = fill(y0, bottom, (y) => [rect(p, y, W - 2 * p, 260, 18, t.card) + rect(p + 12, y + 12, W - 2 * p - 24, 170, 12, t.soft) +
        lines(p + 16, y + 198, W - 2 * p - 80, t), 276]);
      break;
    case "grid": {
      const cw = (W - 2 * p - 14) / 2;
      body = [0, 1, 2].map((i) => rect(p + i * 92, y0, 80, 30, 15, i === 0 ? t.accent : t.block)).join("") +
        fill(y0 + 48, bottom, (y) => [[0, 1].map((c) => rect(p + c * (cw + 14), y, cw, cw * 1.15, 16, c ? t.block : t.soft) +
          rect(p + c * (cw + 14) + 10, y + cw * 1.15 - 30, cw * 0.6, 12, 6, t.card)).join(""), cw * 1.15 + 14]);
      break;
    }
    case "chat":
      body = fill(y0, bottom - 60, (y, i) => {
        const mine = i % 2 === 1, w = W * (0.45 + ((i * 37) % 25) / 100), h = 44 + (i % 3) * 18;
        return [rect(mine ? W - p - w : p, y, w, h, 18, mine ? t.accent : t.card), h + 14];
      }) + rect(p, bottom - 48, W - 2 * p, 44, 22, t.card) + circle(W - p - 22, bottom - 26, 14, t.accent);
      break;
    case "dashboard": {
      const sw = (W - 2 * p - 14) / 2;
      const bars = [0.5, 0.8, 0.35, 0.9, 0.6, 0.75, 0.45].map((v, i) =>
        rect(p + 18 + i * ((W - 2 * p - 36) / 7), y0 + 380 - 90 * v, 22, 90 * v, 6, i === 3 ? t.accent : t.soft)).join("");
      body = rect(p, y0, W - 2 * p, 150, 22, t.accent) + rect(p + 20, y0 + 28, 120, 14, 7, "#ffffff99") + rect(p + 20, y0 + 56, 190, 36, 10, "#ffffffcc") +
        rect(p, y0 + 166, sw, 90, 18, t.card) + rect(p + sw + 14, y0 + 166, sw, 90, 18, t.card) +
        rect(p + 14, y0 + 186, sw * 0.5, 12, 6, t.block) + rect(p + sw + 28, y0 + 186, sw * 0.5, 12, 6, t.block) +
        rect(p, y0 + 270, W - 2 * p, 130, 18, t.card) + bars +
        fill(y0 + 416, bottom, (y) => [rect(p, y, W - 2 * p, 56, 14, t.card) + lines(p + 16, y + 14, W * 0.5, t), 66]);
      break;
    }
  }
  return header + body + tabs;
}

function desktop(W: number, H: number, t: Theme): string {
  const side = W * 0.2, p = 16;
  const cw = (W - side - 4 * p) / 3;
  return rect(0, 0, side, H, 0, t.card) +
    fill(p, H - p, (y, i) => [rect(p, y, side - 2 * p, 14, 7, i === 1 ? t.accent : t.block), 26]) +
    rect(side + p, p, W * 0.3, 18, 8, t.block) +
    [0, 1, 2].map((i) => rect(side + p + i * (cw + p), 50, cw, H * 0.3, 12, i ? t.card : t.soft)).join("") +
    rect(side + p, 66 + H * 0.3, W - side - 2 * p, H - 82 - H * 0.3, 12, t.card);
}

function watch(W: number, H: number, t: Theme): string {
  const r = Math.min(W, H) * 0.28, cx = W / 2, cy = H * 0.42;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${t.soft}" stroke-width="26"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${t.accent}" stroke-width="26" stroke-dasharray="${r * 4} ${r * 8}" transform="rotate(-90 ${cx} ${cy})"/>` +
    rect(W * 0.2, H * 0.78, W * 0.6, 16, 8, t.block);
}

/** The layout a screen of this shape gets: desktop for wide, watch for squarish, else one of five picked by `seed`. */
export function placeholderLayout(seed: string, width: number, height: number): PlaceholderLayout {
  const ratio = height / width;
  if (ratio < 0.9) return "desktop";
  if (ratio < 1.3) return "watch";
  return LAYOUTS[hash(seed) % LAYOUTS.length]!;
}

/** An SVG data URL of a generic app screen with the given aspect. Same seed, same screen. */
export function placeholderScreen(seed: string, width: number, height: number, dark = false): string {
  const W = 400, H = Math.max(200, Math.round((W * height) / Math.max(1, width)));
  const t = theme(dark, ACCENTS[hash(`${seed}:accent`) % ACCENTS.length]!);
  const layout = placeholderLayout(seed, width, height);
  const body = layout === "desktop" ? desktop(W, H, t) : layout === "watch" ? watch(W, H, t) : tall(layout, W, H, t);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${rect(0, 0, W, H, 0, t.bg)}${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const isEmptyScreen = (el: ArtboardElement) =>
  el.type === "device" && !(el as { screenshotSrc?: string }).screenshotSrc && (el as { deviceType?: string }).deviceType !== "custom";

/** Puts a placeholder screen into every empty device on an already-resolved board. */
export function withPlaceholderScreens(board: ArtboardState): ArtboardState {
  if (!board.elements.some(isEmptyScreen)) return board;
  return {
    ...board,
    elements: board.elements.map((el) => {
      if (!isEmptyScreen(el)) return el;
      const dark = (el as { statusBarTheme?: string }).statusBarTheme === "light"; // light status text sits on a dark screen
      return { ...el, screenshotSrc: placeholderScreen(el.id, el.size.width, el.size.height, dark),
        screenshotRect: { left: 0, top: 0, width: 100, height: 100 }, screenshotObjectFit: "cover" } as ArtboardElement;
    }),
  };
}
