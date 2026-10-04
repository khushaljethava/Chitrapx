import { z } from "zod";
import type { ArtboardElement, ArtboardState, ProjectLocalization } from "./artboard.ts";
import { TARGET_IDS, type TargetId } from "./targets.ts";

export const projectKinds = ["screenshots", "video", "social"] as const;
export type ProjectKind = (typeof projectKinds)[number];
export const DEFAULT_BASE_LOCALE = "en-US";
export const CURRENT_SCHEMA_VERSION = 1;

/** One device/format strip: boards side by side, plus elements that may cross board seams. */
export interface BoardGroup {
  id: string;
  target: TargetId;
  /** A/B variant of another group with the same target ("B", "C", ...); exported to its own folder. */
  variant?: string;
  boards: ArtboardState[];
  spanElements: ArtboardElement[];
}

export interface ChitrapxDoc {
  schemaVersion: 1;
  kind: ProjectKind;
  groups: BoardGroup[];
  localization: ProjectLocalization;
  brand?: { appId: string };
}

/** Largest board edge we render; the biggest store target is 3840 px. */
export const MAX_BOARD_EDGE = 8192;
/** BCP 47-ish store locale codes: "en-US", "zh-Hans", "sq". Never a path. */
export const LOCALE_CODE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;
const COLOR = /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([0-9\s.,%/+-]+\)|[a-zA-Z]{3,30})$/;
/** True for values the document accepts as a colour (hex, rgb/hsl functions, named colours). */
export const isColor = (v: string) => COLOR.test(v.trim());
const COLOR_KEYS = new Set(["color", "color1", "color2", "fillColor", "strokeColor", "frameColor", "notchColor", "statusBarColor", "tintColor", "backgroundColor", "backgroundImageTintColor"]);
/** Strings shown as text, never interpreted as CSS. */
const TEXT_KEYS = new Set(["content", "name", "imageAlt", "groupName", "description"]);
/** Anything in a styling string that could make a browser fetch or load something. */
const CSS_FETCH = /url\s*\(|image-set|@import|expression\s*\(|\\/i;

/**
 * Documents are rendered into CSS by the ported OSG renderer and then by the export browser, so
 * a colour like `red), url("http://internal/")` would make the worker fetch internal addresses.
 * Every colour must be a colour, and no styling string may contain url(), @import or escapes.
 */
function cssSafe(value: unknown, ctx: z.RefinementCtx, path: (string | number)[] = []): void {
  if (Array.isArray(value)) { value.forEach((v, i) => cssSafe(v, ctx, [...path, i])); return; }
  if (!value || typeof value !== "object") return;
  for (const [key, v] of Object.entries(value)) {
    const at = [...path, key];
    if (typeof v === "string") {
      if (COLOR_KEYS.has(key) && v !== "" && !COLOR.test(v.trim())) ctx.addIssue({ code: "custom", path: at, message: "Not a colour" });
      else if (!TEXT_KEYS.has(key) && !key.endsWith("Src") && key !== "backgroundImage" && CSS_FETCH.test(v)) ctx.addIssue({ code: "custom", path: at, message: "Not allowed in a style value" });
    } else cssSafe(v, ctx, at);
  }
}

const point = z.object({ x: z.number(), y: z.number() });
const size = z.object({ width: z.number().positive().max(MAX_BOARD_EDGE), height: z.number().positive().max(MAX_BOARD_EDGE) });
const element = z.object({
  id: z.string().min(1),
  type: z.enum(["text", "shape", "device", "image", "video", "video-device", "gesture", "audio"]),
  position: point,
  size,
  statusBarTime: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
}).passthrough();
const board = z.object({
  id: z.string().min(1),
  name: z.string(),
  position: point.default({ x: 0, y: 0 }),
  size,
  elements: z.array(element),
  backgroundColor: z.string().default("#ffffff"),
  zoom: z.number().default(1),
}).passthrough();
const group = z.object({
  id: z.string().min(1),
  target: z.enum(TARGET_IDS),
  variant: z.string().regex(/^[B-Z]$/).optional(),
  boards: z.array(board),
  spanElements: z.array(element).default([]),
});
const localization = z.object({
  baseLocale: z.string().regex(LOCALE_CODE).default(DEFAULT_BASE_LOCALE),
  locales: z.array(z.object({ code: z.string().regex(LOCALE_CODE) }).passthrough()).default([]),
}).passthrough().refine((l) => {
  const codes = [l.baseLocale, ...l.locales.map((x) => x.code)];
  return new Set(codes).size === codes.length;
}, { message: "Each language may appear once" });

export const docSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.enum(projectKinds),
  groups: z.array(group),
  localization: localization.default({ baseLocale: DEFAULT_BASE_LOCALE, locales: [] }),
  brand: z.object({ appId: z.string() }).optional(),
}).superRefine((doc, ctx) => cssSafe(doc.groups, ctx, ["groups"]));

export function emptyDoc(kind: ProjectKind): ChitrapxDoc {
  return { schemaVersion: 1, kind, groups: [], localization: { baseLocale: DEFAULT_BASE_LOCALE, locales: [] } };
}

/** Every load goes through here: upgrades older shapes, then validates. Throws ZodError on garbage. */
export function migrate(raw: unknown): ChitrapxDoc {
  // v1 is the only version so far; Foundation docs lacked baseLocale, which the schema defaults.
  return docSchema.parse(raw) as unknown as ChitrapxDoc;
}
