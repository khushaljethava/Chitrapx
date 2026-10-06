// Draws Chitrapx's own template artwork (scrapbook pieces, night skies, the Pixara set, app screens)
// as SVG and writes each to apps/web/public/stock/<name>.webp, with a provenance row in
// packages/assets/stock.json. They stand in for OSG artwork that is not ours to ship; everything here is
// original, drawn in code. Then run `pnpm --filter @chitrapx/document restore-stock` to place them.
// Run: pnpm --filter @chitrapx/worker exec tsx scripts/gen-stock-art.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { StockPhoto } from "@chitrapx/document";
import { placeholderSvg } from "../../../packages/renderer/src/placeholder.ts";

const root = join(import.meta.dirname, "../../..");
const OUT = join(root, "apps/web/public/stock");
const DB = join(root, "packages/assets/stock.json");

/** Seeded random numbers, so every run draws the same art. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const svg = (w: number, h: number, body: string, defs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${body}</svg>`;

/** A rectangle with torn, deckled edges, as a polygon path. `jag` is how far the tears reach in. */
function torn(x: number, y: number, w: number, h: number, jag: number, seed: number, step = 14): string {
  const r = rng(seed), pts: string[] = [];
  const j = () => (r() - 0.5) * 2 * jag;
  for (let i = 0; i <= w; i += step) pts.push(`${x + i},${y + jag + j()}`);
  for (let i = 0; i <= h; i += step) pts.push(`${x + w - jag + j()},${y + i}`);
  for (let i = w; i >= 0; i -= step) pts.push(`${x + i},${y + h - jag + j()}`);
  for (let i = h; i >= 0; i -= step) pts.push(`${x + jag + j()},${y + i}`);
  return `M${pts.join(" L")} Z`;
}

/** Paper fibre noise as a filter: `tone` is the fibre colour, `alpha` its strength. */
const grainFilter = (id: string, tone: [number, number, number], alpha: number, freq = 0.85) =>
  `<filter id="${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="3" seed="7"/>` +
  `<feColorMatrix values="0 0 0 0 ${tone[0] / 255} 0 0 0 0 ${tone[1] / 255} 0 0 0 0 ${tone[2] / 255} 0 0 0 ${alpha * 3} -${alpha}"/></filter>`;

function stars(w: number, h: number, n: number, seed: number, maxY = h): string {
  const r = rng(seed);
  let out = "";
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * maxY, s = r() < 0.08 ? 3 + r() * 2 : 0.8 + r() * 1.8, o = 0.35 + r() * 0.65;
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${s.toFixed(2)}" fill="#fff" opacity="${o.toFixed(2)}"/>`;
    if (s > 3) out += `<path d="M${x - s * 3} ${y}H${x + s * 3}M${x} ${y - s * 3}V${y + s * 3}" stroke="#fff" stroke-width="1.2" opacity="${(o * 0.6).toFixed(2)}"/>`;
  }
  return out;
}

function moon(cx: number, cy: number, r: number, crescent = false): string {
  const glow = `<circle cx="${cx}" cy="${cy}" r="${r * 2.6}" fill="url(#moonGlow)"/>`;
  const disc = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#F4F1FF"/>` +
    `<circle cx="${cx - r * 0.3}" cy="${cy - r * 0.2}" r="${r * 0.16}" fill="#DCD6F2"/><circle cx="${cx + r * 0.35}" cy="${cy + r * 0.3}" r="${r * 0.1}" fill="#DCD6F2"/>`;
  return glow + (crescent ? `<g mask="url(#crescent)">${disc}</g>` : disc);
}

function sky(stops: string[], body: string, extraDefs = ""): string {
  const W = 1290, H = 2796;
  const grad = `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">${stops.map((c, i) => `<stop offset="${i / (stops.length - 1)}" stop-color="${c}"/>`).join("")}</linearGradient>` +
    `<radialGradient id="moonGlow"><stop offset="0" stop-color="#C9BFFF" stop-opacity="0.45"/><stop offset="1" stop-color="#C9BFFF" stop-opacity="0"/></radialGradient>` + extraDefs;
  return svg(W, H, `<rect width="${W}" height="${H}" fill="url(#sky)"/>${body}`, grad);
}

/** A still life (wall, table, vase with stems, fruit bowl, bottle) in one of four lighting moods. */
function stillLife(p: { wall: [string, string]; table: string; vase: string; stem: string; fruit: string[]; bottle: string; light: string; lightOpacity: number }): string {
  const S = 840;
  const defs = `<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.wall[0]}"/><stop offset="1" stop-color="${p.wall[1]}"/></linearGradient>` +
    `<radialGradient id="light" cx="0.3" cy="0.25" r="0.7"><stop offset="0" stop-color="${p.light}" stop-opacity="${p.lightOpacity}"/><stop offset="1" stop-color="${p.light}" stop-opacity="0"/></radialGradient>`;
  const fruit = p.fruit.map((c, i) => `<circle cx="${470 + i * 70}" cy="${560 - (i === 1 ? 20 : 0)}" r="48" fill="${c}"/><circle cx="${455 + i * 70}" cy="${540 - (i === 1 ? 20 : 0)}" r="12" fill="#fff" opacity="0.35"/>`).join("");
  return svg(S, S,
    `<rect width="${S}" height="${S}" fill="url(#wall)"/><rect y="610" width="${S}" height="${S - 610}" fill="${p.table}"/>` +
    `<path d="M215 300 C 190 230 230 170 205 120 M240 300 C 260 220 300 200 310 140" stroke="${p.stem}" stroke-width="8" fill="none" stroke-linecap="round"/>` +
    `<ellipse cx="205" cy="118" rx="28" ry="16" fill="${p.stem}" transform="rotate(-30 205 118)"/><ellipse cx="312" cy="138" rx="28" ry="16" fill="${p.stem}" transform="rotate(25 312 138)"/>` +
    `<path d="M175 610 C 150 520 165 420 200 390 L200 300 L255 300 L255 390 C 290 420 305 520 280 610 Z" fill="${p.vase}"/>` +
    `<ellipse cx="560" cy="600" rx="170" ry="26" fill="#000" opacity="0.18"/>${fruit}<path d="M400 560 Q 560 690 720 560 Z" fill="${p.vase}" opacity="0.9"/>` +
    `<rect x="690" y="330" width="56" height="280" rx="18" fill="${p.bottle}"/><rect x="704" y="270" width="28" height="80" rx="8" fill="${p.bottle}"/>` +
    `<rect width="${S}" height="${S}" fill="url(#light)"/>`, defs);
}

/** A résumé page: sidebar, header band or centred header, all as blocks (no names or text). */
function resume(kind: "a" | "b" | "c"): string {
  const W = 810, H = 1140, line = (x: number, y: number, w: number, c = "#D9DCE3") => `<rect x="${x}" y="${y}" width="${w}" height="12" rx="6" fill="${c}"/>`;
  let body = `<rect width="${W}" height="${H}" fill="#fff"/>`;
  if (kind === "a") {
    body += `<rect width="250" height="${H}" fill="#262A33"/><circle cx="125" cy="140" r="62" fill="#4A505C"/>`;
    for (let i = 0; i < 9; i++) body += line(40, 260 + i * 34, 140 + (i % 3) * 20, "#4A505C");
    for (let s = 0; s < 3; s++) { body += `<rect x="290" y="${70 + s * 330}" width="140" height="16" rx="8" fill="#F2B632"/>`; for (let i = 0; i < 7; i++) body += line(290, 110 + s * 330 + i * 30, 460 - (i % 4) * 50); }
    body += `<rect x="290" y="30" width="300" height="26" rx="8" fill="#262A33"/>`;
  } else if (kind === "b") {
    body += `<rect width="${W}" height="220" fill="#5B5BD6"/><rect x="60" y="70" width="320" height="34" rx="10" fill="#fff"/><rect x="60" y="124" width="200" height="16" rx="8" fill="#C9C9F5"/>`;
    for (let c = 0; c < 2; c++) for (let s = 0; s < 3; s++) {
      const x = 60 + c * 360, y = 280 + s * 280;
      body += `<rect x="${x}" y="${y}" width="120" height="16" rx="8" fill="#5B5BD6"/>`;
      for (let i = 0; i < 6; i++) body += line(x, y + 40 + i * 30, 300 - (i % 3) * 40);
    }
  } else {
    body += `<rect x="${W / 2 - 180}" y="80" width="360" height="34" rx="10" fill="#1F2933"/><rect x="${W / 2 - 120}" y="134" width="240" height="14" rx="7" fill="#14B8A6"/><rect x="60" y="190" width="${W - 120}" height="3" fill="#14B8A6"/>`;
    for (let s = 0; s < 4; s++) { body += `<rect x="60" y="${240 + s * 220}" width="160" height="16" rx="8" fill="#14B8A6"/>`; for (let i = 0; i < 5; i++) body += line(60, 280 + s * 220 + i * 30, W - 120 - (i % 3) * 90); }
  }
  return svg(W, H, body);
}

/** Washi tape: translucent, striped, with ragged torn ends. */
function tape(color: string, stripe: string, seed: number): string {
  const W = 707, H = 200, r = rng(seed), pts: string[] = [];
  for (let y = 0; y <= H; y += 16) pts.push(`${(W - r() * 18).toFixed(1)},${y}`);
  for (let y = H; y >= 0; y -= 16) pts.push(`${(r() * 18).toFixed(1)},${y}`);
  const defs = `<pattern id="stripes" width="44" height="44" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="16" height="44" fill="${stripe}" opacity="0.5"/></pattern>` +
    `<clipPath id="t"><path d="M${pts.join(" L")} Z"/></clipPath>`;
  return svg(W, H, `<g clip-path="url(#t)" opacity="0.82"><rect width="${W}" height="${H}" fill="${color}"/><rect width="${W}" height="${H}" fill="url(#stripes)"/><rect width="${W}" height="10" fill="#fff" opacity="0.35"/></g>`, defs);
}

function sticker(kind: string, cx: number, cy: number): string {
  const o = (d: string, fill: string) => `<path d="${d}" fill="${fill}" stroke="#fff" stroke-width="14" stroke-linejoin="round" paint-order="stroke"/>`;
  const at = (s: string) => `<g transform="translate(${cx} ${cy})">${s}</g>`;
  switch (kind) {
    case "sun": return at(`<circle r="62" fill="#fff"/>` + Array.from({ length: 10 }, (_, i) => `<rect x="-7" y="-92" width="14" height="30" rx="7" fill="#F6B73C" transform="rotate(${i * 36})"/>`).join("") + `<circle r="46" fill="#F6B73C"/><circle cx="-14" cy="-6" r="5" fill="#7A4A12"/><circle cx="14" cy="-6" r="5" fill="#7A4A12"/><path d="M-14 14 Q0 26 14 14" stroke="#7A4A12" stroke-width="5" fill="none" stroke-linecap="round"/>`);
    case "star": return at(o("M0 -70 L20 -22 L72 -20 L32 12 L44 64 L0 36 L-44 64 L-32 12 L-72 -20 L-20 -22 Z", "#F4C430"));
    case "cloud": return at(o("M-70 30 C-100 30 -100 -14 -66 -14 C-62 -50 -14 -56 0 -28 C14 -52 66 -44 62 -6 C96 -6 96 30 66 30 Z", "#8EC9F0"));
    case "heart": return at(o("M0 60 C-90 0 -70 -70 -20 -60 C-6 -56 0 -44 0 -36 C0 -44 6 -56 20 -60 C70 -70 90 0 0 60 Z", "#F07A9C"));
    case "rainbow": return at(`<path d="M-90 46 A90 90 0 0 1 90 46" stroke="#fff" stroke-width="84" fill="none"/>` + ["#F07A7A", "#F6B73C", "#7BCB8B", "#7BA7F0"].map((c, i) => `<path d="M${-80 + i * 16} 40 A${80 - i * 16} ${80 - i * 16} 0 0 1 ${80 - i * 16} 40" stroke="${c}" stroke-width="16" fill="none"/>`).join(""));
    case "bolt": return at(o("M10 -72 L-44 8 L-6 8 L-18 72 L44 -14 L6 -14 Z", "#F6A23C"));
    case "flower": return at(Array.from({ length: 6 }, (_, i) => `<ellipse cx="0" cy="-36" rx="22" ry="34" fill="#F49AC1" stroke="#fff" stroke-width="10" paint-order="stroke" transform="rotate(${i * 60})"/>`).join("") + `<circle r="22" fill="#F6C84C"/>`);
    default: return at(`<circle r="62" fill="#F6C84C" stroke="#fff" stroke-width="14" paint-order="stroke"/><circle cx="-20" cy="-12" r="7" fill="#7A4A12"/><circle cx="20" cy="-12" r="7" fill="#7A4A12"/><path d="M-26 14 Q0 40 26 14" stroke="#7A4A12" stroke-width="7" fill="none" stroke-linecap="round"/>`);
  }
}

const tornPaper = (w: number, h: number, jag: number, seed: number, fill: string, grain: string) =>
  svg(w, h, `<path d="${torn(0, 0, w, h, jag, seed)}" fill="${fill}"/><path d="${torn(0, 0, w, h, jag, seed)}" filter="url(#g)"/>`, grain);
const paperGrain = grainFilter("g", [150, 120, 80], 0.07);

type Art = { file: string; replaces: string[]; svg: () => string; width?: number; quality?: number };

const ART: Art[] = [
  // Scrappi journal: paper, tape and keepsakes on kraft.
  { file: "scrapbook-grain.webp", replaces: ["scrappi-journal-grain.png"], quality: 40, width: 323, svg: () => svg(645, 1398, `<rect width="645" height="1398" filter="url(#g)"/>`, grainFilter("g", [90, 60, 30], 0.09)) },
  { file: "scrapbook-page.webp", replaces: ["scrappi-journal-page.png"], svg: () => tornPaper(1170, 1702, 10, 11, "#FBF5E8", grainFilter("g", [150, 120, 80], 0.06)) },
  { file: "scrapbook-shadow.webp", replaces: ["scrappi-journal-shadow.png"], svg: () => svg(570, 1003, `<rect x="70" y="70" width="430" height="863" rx="70" fill="#3C2810" opacity="0.42" filter="url(#b)"/>`, `<filter id="b" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="28"/></filter>`) },
  { file: "scrapbook-clip.webp", replaces: ["scrappi-journal-clip.png"], svg: () => svg(192, 370, `<path d="M116 116 V284 A30 30 0 0 1 56 284 V84 A52 52 0 0 1 160 84 V296 A66 66 0 0 1 28 296 V130" stroke="url(#m)" stroke-width="13" fill="none" stroke-linecap="round"/><path d="M116 116 V284 A30 30 0 0 1 56 284 V84 A52 52 0 0 1 160 84 V296" stroke="#fff" stroke-width="3" fill="none" opacity="0.6" stroke-linecap="round"/>`, `<linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F1F3F5"/><stop offset="0.5" stop-color="#A9B1B9"/><stop offset="1" stop-color="#DDE2E6"/></linearGradient>`) },
  { file: "scrapbook-flower.webp", replaces: ["scrappi-journal-flower.png"], svg: () => svg(560, 560,
    `<path d="M280 300 C 290 380 270 450 285 540" stroke="#5E8C4A" stroke-width="12" fill="none" stroke-linecap="round"/><ellipse cx="330" cy="430" rx="58" ry="22" fill="#6E9E58" transform="rotate(-35 330 430)"/>` +
    Array.from({ length: 10 }, (_, i) => `<ellipse cx="280" cy="170" rx="34" ry="92" fill="${i % 2 ? "#F29BB8" : "#F6B3C9"}" opacity="0.92" transform="rotate(${i * 36} 280 250)"/>`).join("") +
    `<circle cx="280" cy="250" r="46" fill="#E8B84A"/>` + Array.from({ length: 14 }, (_, i) => `<circle cx="${(280 + Math.cos(i) * 24).toFixed(1)}" cy="${(250 + Math.sin(i * 1.7) * 24).toFixed(1)}" r="5" fill="#B5832A"/>`).join("")) },
  { file: "scrapbook-polaroid.webp", replaces: ["scrappi-journal-polaroid.png"], svg: () => svg(660, 792,
    `<rect x="30" y="30" width="600" height="732" rx="10" fill="#000" opacity="0.18" filter="url(#b)"/><rect x="20" y="16" width="600" height="732" rx="10" fill="#FFFDF8"/><rect x="66" y="62" width="508" height="508" fill="#EFE6D4"/>` +
    `<rect x="90" y="86" width="460" height="460" fill="none" stroke="#CDBE9F" stroke-width="4" stroke-dasharray="14 10"/><rect x="250" y="250" width="140" height="110" rx="14" fill="none" stroke="#B9A884" stroke-width="10"/><circle cx="290" cy="285" r="13" fill="#B9A884"/><path d="M262 348 L305 305 L335 330 L355 312 L380 348 Z" fill="#B9A884"/>`,
    `<filter id="b"><feGaussianBlur stdDeviation="12"/></filter>`) },
  { file: "scrapbook-kraft.webp", replaces: ["scrappi-journal-scrap-kraft.png"], svg: () => tornPaper(760, 542, 16, 21, "#C9A26E", grainFilter("g", [110, 75, 35], 0.18, 0.6)) },
  { file: "scrapbook-strip.webp", replaces: ["scrappi-journal-scrap-strip.png"], svg: () => tornPaper(1540, 328, 14, 31, "#FBF3E2", paperGrain) },
  { file: "scrapbook-tab.webp", replaces: ["scrappi-journal-scrap-tab.png"], svg: () => tornPaper(480, 258, 12, 41, "#FBF3E2", paperGrain) },
  { file: "scrapbook-stickers.webp", replaces: ["scrappi-journal-stickersheet.png"], svg: () => svg(860, 1762,
    `<rect x="40" y="46" width="780" height="1680" rx="44" fill="#000" opacity="0.16" filter="url(#b)"/><rect x="30" y="30" width="780" height="1680" rx="44" fill="#FFF9EE"/>` +
    ["sun", "star", "cloud", "heart", "rainbow", "bolt", "flower", "smile"].map((k, i) => sticker(k, 230 + (i % 2) * 380, 240 + Math.floor(i / 2) * 400)).join(""),
    `<filter id="b"><feGaussianBlur stdDeviation="14"/></filter>`) },
  { file: "washi-tape-mint.webp", replaces: ["scrappi-journal-tape-mint.png"], svg: () => tape("#9FE0C6", "#E6FAF1", 51) },
  { file: "washi-tape-straw.webp", replaces: ["scrappi-journal-tape-straw.png"], svg: () => tape("#F1D68A", "#FFF4D2", 61) },

  // Somnia sleep: five night skies, one per board.
  { file: "night-sky-1.webp", replaces: ["somnia-sleep-sky-1.png"], svg: () => sky(["#2A1A5E", "#3A2676", "#4B3288"], stars(1290, 2796, 260, 1)) },
  { file: "night-sky-2.webp", replaces: ["somnia-sleep-sky-2.png"], svg: () => sky(["#22164F", "#34226C", "#432D80"], stars(1290, 2796, 240, 2) + moon(0, 1950, 70)) },
  { file: "night-sky-3.webp", replaces: ["somnia-sleep-sky-3.png"], svg: () => sky(["#181040", "#2A1C5C", "#3B2A74"], stars(1290, 2796, 280, 3) + moon(645, 560, 95)) },
  { file: "night-sky-4.webp", replaces: ["somnia-sleep-sky-4.png"], svg: () => sky(["#1E1448", "#30226A", "#41307E"], stars(1290, 2796, 240, 4) + moon(1170, 1580, 54, true),
    `<mask id="crescent"><rect width="1290" height="2796" fill="#fff"/><circle cx="1194" cy="1566" r="50" fill="#000"/></mask>`) },
  { file: "night-sky-5.webp", replaces: ["somnia-sleep-sky-5.png"], svg: () => sky(["#2B1D5C", "#5A3C86", "#B67C9A", "#F4B888"], stars(1290, 2796, 160, 5, 1300)) },

  // Breathora: the bottom of the last board fades into its green.
  { file: "fade-green.webp", replaces: ["breathora-bottom-fade.png"], svg: () => svg(1290, 700, `<rect width="1290" height="700" fill="url(#f)"/>`, `<linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#B9DCAE" stop-opacity="0"/><stop offset="0.7" stop-color="#B9DCAE" stop-opacity="0.92"/><stop offset="1" stop-color="#B9DCAE"/></linearGradient>`) },

  // Pixara AI: dark photo-editor set.
  { file: "aurora-ribbon.webp", replaces: ["pixara-ai-ribbon.png"], svg: () => {
    const d = "M-50 420 C 400 120, 700 640, 1100 380 S 1700 140, 2000 520 S 2700 700, 3275 260";
    return svg(3225, 1398, `<path d="${d}" stroke="url(#r)" stroke-width="60" fill="none" opacity="0.35" filter="url(#b)"/><path d="${d}" stroke="url(#r)" stroke-width="12" fill="none"/><path d="${d}" stroke="#fff" stroke-width="3" fill="none" opacity="0.7"/>` +
      `<circle cx="120" cy="330" r="70" fill="#FF4FA3" opacity="0.5" filter="url(#b)"/><circle cx="3120" cy="300" r="70" fill="#4FD7FF" opacity="0.5" filter="url(#b)"/>`,
      `<linearGradient id="r" x1="0" x2="1"><stop offset="0" stop-color="#FF4FA3"/><stop offset="0.5" stop-color="#9B6CFF"/><stop offset="1" stop-color="#4FD7FF"/></linearGradient><filter id="b" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="30"/></filter>`);
  } },
  { file: "grain-wash-dark.webp", replaces: ["pixara-ai-grain.png"], quality: 40, width: 162, svg: () => svg(323, 1398, `<rect width="323" height="1398" fill="#2A2E2A" opacity="0.55"/><rect width="323" height="1398" filter="url(#g)"/>`, grainFilter("g", [200, 200, 200], 0.22, 0.95)) },
  { file: "old-photo.webp", replaces: ["pixara-ai-paper.png"], svg: () => svg(780, 960,
    `<rect x="20" y="20" width="740" height="920" rx="8" fill="#E9DCC0"/><rect x="70" y="70" width="640" height="700" fill="#9C8664"/><rect x="70" y="560" width="640" height="210" fill="#7F6A4B"/>` +
    `<path d="M240 560 V430 L330 360 L420 430 V560 Z" fill="#5E4A33"/><rect x="305" y="480" width="50" height="80" fill="#3F3122"/><circle cx="560" cy="430" r="62" fill="#5E4A33"/><rect x="552" y="470" width="16" height="90" fill="#4A3A28"/>` +
    `<path d="M70 300 L210 340 L260 300 L390 380 M500 70 L470 200 L520 260 M700 600 L600 640 L560 700" stroke="#F3E9D2" stroke-width="5" fill="none" opacity="0.8"/><rect x="20" y="20" width="740" height="920" rx="8" filter="url(#g)"/>`,
    grainFilter("g", [80, 60, 30], 0.12)) },
  { file: "beach-scene.webp", replaces: ["pixara-ai-beach-after.png"], svg: () => svg(760, 940,
    `<rect width="760" height="560" fill="url(#s)"/><circle cx="600" cy="150" r="58" fill="#FFE27A"/><ellipse cx="200" cy="140" rx="110" ry="26" fill="#fff" opacity="0.85"/><ellipse cx="420" cy="230" rx="80" ry="20" fill="#fff" opacity="0.7"/>` +
    `<rect y="560" width="760" height="170" fill="#1BA9C4"/><rect y="600" width="760" height="10" fill="#7FD8E6" opacity="0.7"/><rect y="660" width="760" height="8" fill="#7FD8E6" opacity="0.5"/><path d="M0 730 Q 380 690 760 730 V940 H0 Z" fill="#EBD3A0"/>`,
    `<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5FB2EA"/><stop offset="1" stop-color="#C9ECFA"/></linearGradient>`) },
  { file: "neon-tile-frame.webp", replaces: ["pixara-ai-tile-frame.png"], svg: () => svg(640, 640, `<rect x="24" y="24" width="592" height="592" rx="48" fill="#15151C"/><rect x="24" y="24" width="592" height="592" rx="48" fill="none" stroke="url(#n)" stroke-width="18" opacity="0.5" filter="url(#b)"/><rect x="24" y="24" width="592" height="592" rx="48" fill="none" stroke="url(#n)" stroke-width="5"/>`,
    `<linearGradient id="n" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF4FA3"/><stop offset="0.5" stop-color="#9B6CFF"/><stop offset="1" stop-color="#4FD7FF"/></linearGradient><filter id="b" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="10"/></filter>`) },
  { file: "still-life-golden.webp", replaces: ["pixara-ai-tile-golden.png"], svg: () => stillLife({ wall: ["#6B4A3A", "#3D2A22"], table: "#4A2E22", vase: "#C79AB8", stem: "#8DAA5A", fruit: ["#F2A33A", "#F06A4A", "#F6C64A"], bottle: "#5E7A52", light: "#FFC26B", lightOpacity: 0.45 }) },
  { file: "still-life-neon.webp", replaces: ["pixara-ai-tile-neon.png"], svg: () => stillLife({ wall: ["#2A1648", "#140B26"], table: "#1C1030", vase: "#FF4FA3", stem: "#4FD7FF", fruit: ["#9B6CFF", "#FF4FA3", "#4FD7FF"], bottle: "#4FD7FF", light: "#FF4FA3", lightOpacity: 0.35 }) },
  { file: "still-life-noir.webp", replaces: ["pixara-ai-tile-noir.png"], svg: () => stillLife({ wall: ["#4A4A4A", "#1C1C1C"], table: "#262626", vase: "#9A9A9A", stem: "#6E6E6E", fruit: ["#BDBDBD", "#8A8A8A", "#D6D6D6"], bottle: "#5A5A5A", light: "#FFFFFF", lightOpacity: 0.3 }) },
  { file: "still-life-soft.webp", replaces: ["pixara-ai-tile-soft.png"], svg: () => stillLife({ wall: ["#EADFF0", "#D9CBE4"], table: "#C8B6D2", vase: "#F3C6D6", stem: "#A9C79A", fruit: ["#F7C9A0", "#F4A9A8", "#F9DE9C"], bottle: "#B9D4C2", light: "#FFFFFF", lightOpacity: 0.5 }) },

  // App screens shown floating or inside hand-held phones (placeholderSvg draws at 400 px; `width` is the size to render at).
  { file: "screen-inbox.webp", replaces: ["inboxly-screen-inbox.png"], width: 846, svg: () => placeholderSvg("inbox", 846, 1710, false, { layout: "list", accent: "#6366f1" }) },
  { file: "screen-feed-coral.webp", replaces: ["app-feed-coral.png"], width: 692, svg: () => placeholderSvg("feed", 692, 1448, false, { layout: "feed", accent: "#F06A5A" }) },
  { file: "resume-sidebar.webp", replaces: ["cvcraft-resume-a.png"], svg: () => resume("a") },
  { file: "resume-header.webp", replaces: ["cvcraft-resume-b.png"], svg: () => resume("b") },
  { file: "resume-minimal.webp", replaces: ["cvcraft-resume-c.png"], svg: () => resume("c") },
  { file: "screen-tv-remote.webp", replaces: ["zapio-remote-screen-ui.png"], svg: () => svg(692, 1448,
    `<rect width="692" height="1448" fill="url(#p)"/><rect x="40" y="90" width="260" height="22" rx="11" fill="#fff" opacity="0.5"/><circle cx="346" cy="250" r="56" fill="#fff" opacity="0.16"/><circle cx="346" cy="250" r="26" fill="none" stroke="#fff" stroke-width="7"/><path d="M346 214 V246" stroke="#fff" stroke-width="7" stroke-linecap="round"/>` +
    [0, 1].map((i) => `<rect x="${130 + i * 300}" y="380" width="132" height="300" rx="66" fill="#fff" opacity="0.16"/><path d="M${178 + i * 300} 450 l18 -18 l18 18 M${178 + i * 300} 610 l18 18 l18 -18" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round"/>`).join("") +
    `<circle cx="346" cy="960" r="210" fill="#fff" opacity="0.16"/><circle cx="346" cy="960" r="76" fill="#fff"/><path d="M346 790 l-16 20 h32 Z M346 1130 l-16 -20 h32 Z M176 960 l20 -16 v32 Z M516 960 l-20 -16 v32 Z" fill="#fff"/>` +
    [0, 1, 2, 3].map((i) => `<circle cx="${130 + i * 144}" cy="1300" r="40" fill="#fff" opacity="0.16"/>`).join(""),
    `<linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7356FF"/><stop offset="1" stop-color="#4B2FD8"/></linearGradient>`) },
  { file: "screen-tv-home.webp", replaces: ["zapio-remote-screen-tv.png"], svg: () => {
    const tiles = ["#7C5CFF", "#E0736A", "#4FBF8B", "#5AA2E8", "#C2557E", "#C9A24A", "#3FA7A0", "#8A6CE0"];
    return svg(1548, 879, `<rect width="1548" height="879" fill="#14141C"/><rect x="50" y="40" width="240" height="22" rx="11" fill="#fff" opacity="0.55"/>` +
      [0, 1, 2].map((i) => `<rect x="${50 + i * 490}" y="96" width="460" height="260" rx="18" fill="${["#3B3352", "#4A3438", "#33424A"][i]}"/><circle cx="${280 + i * 490}" cy="226" r="34" fill="#fff" opacity="0.85"/><path d="M${270 + i * 490} 208 l30 18 l-30 18 Z" fill="#14141C"/>`).join("") +
      tiles.map((c, i) => `<rect x="${50 + (i % 4) * 365}" y="${410 + Math.floor(i / 4) * 220}" width="335" height="190" rx="16" fill="${c}"/><rect x="${74 + (i % 4) * 365}" y="${560 + Math.floor(i / 4) * 220}" width="120" height="14" rx="7" fill="#fff" opacity="0.7"/>`).join(""));
  } },
];

const rows = JSON.parse(readFileSync(DB, "utf8")) as StockPhoto[];
const today = new Date().toISOString().slice(0, 10);
for (const art of ART) {
  const markup = art.svg();
  const drawn = Number(/width="([\d.]+)"/.exec(markup)![1]);
  // Grain is noise, which hides compression; at quality 88 one grain file is about 1 MB.
  const info = await sharp(Buffer.from(markup), { density: (72 * (art.width ?? drawn)) / drawn })
    .webp({ quality: art.quality ?? 88, alphaQuality: art.quality ?? 92, effort: 6 }).toFile(join(OUT, art.file));
  const row: StockPhoto = {
    file: art.file, width: info.width, height: info.height, source: "original", sourceId: `gen-stock-art:${art.file.replace(".webp", "")}`,
    sourceUrl: "apps/worker/scripts/gen-stock-art.ts", photographer: "Chitrapx (drawn in code)", license: "Original work owned by Chitrapx",
    licenseUrl: "NOTICES.md", retrieved: today, processing: "Drawn as SVG in apps/worker/scripts/gen-stock-art.ts; rasterized to WebP", replaces: art.replaces,
  };
  const i = rows.findIndex((r) => r.file === art.file);
  if (i >= 0) rows[i] = row; else rows.push(row);
  console.log(`${art.file} ${info.width}x${info.height} ${(info.size / 1024).toFixed(0)} KB`);
}
writeFileSync(DB, `${JSON.stringify(rows, null, 1)}\n`);
