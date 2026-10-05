// Palettes, layer order and symbol shapes ported from launch (MIT, Copyright (c) 2025 applogo
// contributors), src/generate_logo.rs:15-256, redrawn as SVG. launch's bundled font is not used.
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { db, PRICES, schema } from "@chitrapx/db";
import { cleanLogoText, logoInput } from "@chitrapx/document";
import { FatalJobError, type JobContext } from "../runJob.ts";
import type { LaunchDeps } from "./index.ts";
import { Rng } from "./prng.ts";

const OUTPUT = 1024;
/** Drawn at 3x, then downscaled with Lanczos3 for clean edges. */
const CANVAS = OUTPUT * 3;
const C = CANVAS / 2;

type RGB = readonly [number, number, number];
/** [background top, background bottom, foreground]. */
export const LOGO_PALETTES: ReadonlyArray<readonly [RGB, RGB, RGB]> = [
  [[28, 86, 246], [88, 214, 255], [255, 255, 255]],
  [[11, 132, 96], [143, 224, 120], [255, 252, 235]],
  [[230, 70, 58], [255, 187, 83], [32, 18, 12]],
  [[106, 67, 255], [255, 109, 207], [255, 255, 255]],
  [[18, 24, 38], [68, 214, 182], [248, 250, 252]],
  [[244, 124, 45], [255, 220, 97], [32, 24, 20]],
  [[37, 99, 235], [167, 139, 250], [255, 255, 255]],
  [[16, 185, 129], [14, 165, 233], [4, 24, 33]],
];
export const LOGO_STYLES = ["orbit", "stack", "bolt", "diamond", "node"] as const;
export type LogoStyle = (typeof LOGO_STYLES)[number];

const rgb = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;
const pts = (p: Array<[number, number]>) => p.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).join(" ");
const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
const escapeXml = (s: string) => s.replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch]!);

/** The first two draws pick the palette and the symbol, so the plan of a seed is cheap to inspect. */
export function logoPlan(seed: number, rng = new Rng(seed)): { palette: number; style: LogoStyle } {
  return { palette: rng.rangeInt(0, LOGO_PALETTES.length), style: LOGO_STYLES[rng.rangeInt(0, LOGO_STYLES.length)]! };
}

function symbol(style: LogoStyle, rng: Rng, fg: string, accent: string): string {
  const fgA = `fill="${fg}" fill-opacity="${(238 / 255).toFixed(3)}"`;
  const acA = `fill="${accent}" fill-opacity="${(230 / 255).toFixed(3)}"`;
  switch (style) {
    case "orbit":
      return [540, 380, 220].map((ring) => {
        const rx = ring / 2, ry = rx * 0.54;
        return `<ellipse cx="${C}" cy="${C}" rx="${rx}" ry="${ry}" fill="none" stroke="${fg}" stroke-opacity="0.933" stroke-width="22" transform="rotate(-24 ${C} ${C})"/>`
          + `<ellipse cx="${C}" cy="${C}" rx="${rx}" ry="${ry}" fill="none" stroke="${accent}" stroke-opacity="0.902" stroke-width="14" transform="rotate(34 ${C} ${C})"/>`;
      }).join("") + `<circle cx="${C}" cy="${C}" r="152" ${fgA}/><circle cx="${C}" cy="${C}" r="82" ${acA}/>`;
    case "stack":
      return [0, 1, 2, 3].map((i) => {
        const y = C - 330 + i * 220, o = (i % 2) * 70 - 35;
        return `<polygon points="${pts([[C - 360 + o, y], [C + o, y - 150], [C + 360 + o, y], [C + o, y + 150]])}" ${i % 2 === 0 ? fgA : acA}/>`;
      }).join("");
    case "bolt":
      return `<polygon points="${pts([[C + 80, C - 620], [C - 360, C + 40], [C - 60, C + 40], [C - 150, C + 620], [C + 390, C - 100], [C + 80, C - 100]])}" ${fgA}/>`
        + `<circle cx="${C + 240}" cy="${C - 360}" r="120" ${acA}/><circle cx="${C - 280}" cy="${C + 340}" r="150" ${acA}/>`;
    case "diamond":
      return `<polygon points="${pts([[C, C - 660], [C + 560, C], [C, C + 660], [C - 560, C]])}" ${fgA}/>`
        + `<polygon points="${pts([[C, C - 370], [C + 310, C], [C, C + 370], [C - 310, C]])}" ${acA}/>`;
    case "node": {
      const nodes = Array.from({ length: 6 }, (_, i) => {
        const angle = (i / 6) * Math.PI * 2 + rng.rangeFloat(-0.14, 0.14);
        const r = rng.rangeFloat(360, 610);
        return [C + Math.cos(angle) * r, C + Math.sin(angle) * r] as [number, number];
      });
      const lines = nodes.map((p, i) => { const q = nodes[(i + 2) % 6]!; return `<line x1="${Math.round(p[0])}" y1="${Math.round(p[1])}" x2="${Math.round(q[0])}" y2="${Math.round(q[1])}" stroke="${accent}" stroke-opacity="0.902" stroke-width="18" stroke-linecap="round"/>`; });
      const dots = nodes.map(([x, y]) => `<circle cx="${Math.round(x)}" cy="${Math.round(y)}" r="105" ${fgA}/><circle cx="${Math.round(x)}" cy="${Math.round(y)}" r="48" ${acA}/>`);
      return lines.join("") + dots.join("");
    }
  }
}

/** Noto Sans first, then the CJK faces, all through fontconfig (the worker image installs them). */
const FONT = "'Noto Sans', 'Noto Sans CJK SC', 'Noto Serif CJK SC', sans-serif";

function wordmark(text: string, colour: RGB): string {
  const size = [...text].length <= 2 ? 620 : 460;
  const y = Math.round(C + size * 0.35);
  const attrs = `x="${C}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${size}"`;
  const body = escapeXml(text);
  const shadow = [[-18, 0], [18, 0], [0, -18], [0, 18], [-14, -14], [14, -14], [-14, 14], [14, 14]]
    .map(([dx, dy]) => `<text ${attrs} y="${y}" transform="translate(${dx} ${dy})" fill="#000" fill-opacity="${(70 / 255).toFixed(3)}">${body}</text>`).join("");
  return `${shadow}<text ${attrs} y="${y}" fill="${rgb(colour)}">${body}</text>`;
}

/** The logo as a 3072 px SVG: gradient, soft shapes, symbol, then the wordmark (launch's render_logo order). */
export function logoSvg(seed: number, text?: string | null): string {
  const rng = new Rng(seed);
  const plan = logoPlan(seed, rng);
  const [top, bottom, fg] = LOGO_PALETTES[plan.palette]!;
  const shapes = Array.from({ length: 6 }, () => {
    const x = rng.rangeInt(250, CANVAS - 250), y = rng.rangeInt(250, CANVAS - 250), r = rng.rangeInt(140, 390);
    const colour = rng.nextBool() ? top : bottom;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="${rgb(colour)}" fill-opacity="${(rng.rangeInt(34, 82) / 255).toFixed(3)}"/>`;
  }).join("");
  const word = cleanLogoText(text);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">`
    + `<defs><linearGradient id="bg" x1="0" y1="0" x2="0.25" y2="1"><stop offset="0" stop-color="${rgb(top)}"/><stop offset="1" stop-color="${rgb(bottom)}"/></linearGradient></defs>`
    + `<rect width="${CANVAS}" height="${CANVAS}" fill="url(#bg)"/>${shapes}${symbol(plan.style, rng, rgb(fg), rgb(bottom))}${word ? wordmark(word, fg) : ""}</svg>`;
}

/** A 1024x1024 opaque PNG; the same seed and text always give the same bytes. */
export async function renderLogo(seed: number, text?: string | null): Promise<Buffer> {
  return sharp(Buffer.from(logoSvg(seed, text)))
    .resize(OUTPUT, OUTPUT, { kernel: "lanczos3" })
    .flatten({ background: "#ffffff" }).removeAlpha()
    .png().toBuffer();
}

/** logo_starter (free): renders the logo and stores it as an image upload of the app. */
export async function runLogo(raw: unknown, job: JobContext, deps: Pick<LaunchDeps, "upload">): Promise<{ actual: number; output: unknown }> {
  const input = logoInput.parse(raw);
  const [app] = await db.select({ id: schema.apps.id }).from(schema.apps).where(and(eq(schema.apps.id, input.appId), eq(schema.apps.workspaceId, job.workspaceId)));
  if (!app) throw new FatalJobError("app_missing");
  const png = await renderLogo(input.seed, input.text);
  const sha256 = createHash("sha256").update(png).digest("hex");
  const path = `${job.workspaceId}/${sha256}`;
  await deps.upload(path, png, "image/png", "uploads");
  const [inserted] = await db.insert(schema.assets).values({
    workspaceId: job.workspaceId, appId: app.id, kind: "image", storagePath: path, mime: "image/png", width: OUTPUT, height: OUTPUT, bytes: png.byteLength, sha256,
  }).onConflictDoNothing().returning({ id: schema.assets.id });
  const assetId = inserted?.id ?? (await db.select({ id: schema.assets.id }).from(schema.assets)
    .where(and(eq(schema.assets.workspaceId, job.workspaceId), eq(schema.assets.appId, app.id), eq(schema.assets.sha256, sha256))))[0]!.id;
  return { actual: PRICES.logo_starter, output: { assetId, seed: input.seed, text: cleanLogoText(input.text) ?? "" } };
}
