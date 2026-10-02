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

const point = z.object({ x: z.number(), y: z.number() });
const size = z.object({ width: z.number().positive(), height: z.number().positive() });
const element = z.object({
  id: z.string().min(1),
  type: z.enum(["text", "shape", "device", "image", "video", "video-device", "gesture", "audio"]),
  position: point,
  size,
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
  boards: z.array(board),
  spanElements: z.array(element).default([]),
});
const localization = z.object({
  baseLocale: z.string().default(DEFAULT_BASE_LOCALE),
  locales: z.array(z.object({ code: z.string().min(2) }).passthrough()).default([]),
}).passthrough();

export const docSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.enum(projectKinds),
  groups: z.array(group),
  localization: localization.default({ baseLocale: DEFAULT_BASE_LOCALE, locales: [] }),
  brand: z.object({ appId: z.string() }).optional(),
});

export function emptyDoc(kind: ProjectKind): ChitrapxDoc {
  return { schemaVersion: 1, kind, groups: [], localization: { baseLocale: DEFAULT_BASE_LOCALE, locales: [] } };
}

/** Every load goes through here: upgrades older shapes, then validates. Throws ZodError on garbage. */
export function migrate(raw: unknown): ChitrapxDoc {
  // v1 is the only version so far; Foundation docs lacked baseLocale, which the schema defaults.
  return docSchema.parse(raw) as unknown as ChitrapxDoc;
}
