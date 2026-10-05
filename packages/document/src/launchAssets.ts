import { z } from "zod";
import { MOCKUP_DEVICE_IDS, MOCKUP_FITS } from "./mockup.ts";

/** SP12 launch assets: request bodies (web) and job inputs (worker), shared so both validate alike. */

export const ICON_PLATFORMS = ["iphone", "ipad", "watch", "mac", "android"] as const;
export type IconPlatform = (typeof ICON_PLATFORMS)[number];

/** Android resource names: lowercase letters, digits and underscores, starting with a letter. */
export const ANDROID_RESOURCE_NAME = /^[a-z][a-z0-9_]{0,40}$/;
/** Colours that end up inside generated SVG or XML: plain #rrggbb only. */
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const SHA256 = /^[a-f0-9]{64}$/;

/** Launch asset sources (icons, collages, mockups) are images of at most 10 MB. */
export const LAUNCH_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
export const MIN_ICON_SOURCE = 64;
export const RECOMMENDED_ICON_SOURCE = 1024;

const hex = z.string().regex(HEX_COLOR, "Use a colour like #1a2b3c").transform((s) => s.toLowerCase());

export const appIconsRequest = z.object({
  assetId: z.uuid(),
  platforms: z.array(z.enum(ICON_PLATFORMS)).min(1).max(ICON_PLATFORMS.length).default([...ICON_PLATFORMS]),
  androidName: z.string().regex(ANDROID_RESOURCE_NAME, "Use lowercase letters, digits and underscores, starting with a letter").default("ic_launcher"),
  includeStores: z.boolean().default(true),
  adaptiveBackground: hex.optional(),
}).strict();
export type AppIconsRequest = z.infer<typeof appIconsRequest>;

/** What the app_icons job reads: the request plus the source's content hash (its storage key). */
export const appIconsInput = appIconsRequest.extend({ sha256: z.string().regex(SHA256) });
export type AppIconsInput = z.infer<typeof appIconsInput>;

/** Logo seeds are 32-bit so they survive JSON and JavaScript numbers exactly. */
export const LOGO_SEED_MAX = 0xffffffff;
export const LOGO_TEXT_MAX = 4;

/** The wordmark as drawn: trimmed, whitespace removed, at most 4 characters; null when nothing is left (launch's clean_logo_text). */
export function cleanLogoText(text: string | undefined | null): string | null {
  const chars = [...(text ?? "").replace(/\s+/gu, "")].slice(0, LOGO_TEXT_MAX);
  return chars.length ? chars.join("") : null;
}

export const cropSchema = z.object({ left: z.number().int().min(0), top: z.number().int().min(0), width: z.number().int().positive(), height: z.number().int().positive() });

export const mockupRequest = z.object({
  assetId: z.uuid(),
  deviceType: z.enum(MOCKUP_DEVICE_IDS),
  fit: z.enum(MOCKUP_FITS).optional(),
  background: hex.optional(),
}).strict();
export type MockupRequest = z.infer<typeof mockupRequest>;
/** The mockup job also carries the document the web app built (read through launchSource) and the area to keep. */
export const mockupInput = mockupRequest.extend({ doc: z.unknown(), selection: z.unknown(), crops: z.array(cropSchema).length(1) });

export const COLLAGE_MIN = 2;
export const COLLAGE_MAX = 12;
/** Longest side of one collage source; the output is capped separately (MAX_COLLAGE_EDGE in the worker). */
export const COLLAGE_SOURCE_MAX_EDGE = 8000;

export const collageRequest = z.object({
  assetIds: z.array(z.uuid()).min(COLLAGE_MIN, "Pick at least 2 screenshots").max(COLLAGE_MAX, "Pick at most 12 screenshots")
    .refine((ids) => new Set(ids).size === ids.length, "Each screenshot can appear once"),
  /** Pixels between and around the cells; omitted means launch's heuristic (3% of a cell, more for bigger grids). */
  padding: z.number().int().min(0).max(2000).optional(),
  /** One colour, or two as a top-to-bottom gradient. */
  background: z.object({ from: hex, to: hex.optional() }).strict().default({ from: "#f4f4f5" }),
  frame: z.object({ deviceType: z.enum(MOCKUP_DEVICE_IDS), fit: z.enum(MOCKUP_FITS).optional() }).strict().optional(),
}).strict();
export type CollageRequest = z.infer<typeof collageRequest>;
/** The collage job reads the sources' hashes in order and, when framed, the mockup document of all of them. */
export const collageInput = collageRequest.extend({
  images: z.array(z.object({ assetId: z.uuid(), sha256: z.string().regex(SHA256) })).min(COLLAGE_MIN).max(COLLAGE_MAX),
  doc: z.unknown().optional(),
  selection: z.unknown().optional(),
  crops: z.array(cropSchema).optional(),
});
export type CollageInput = z.infer<typeof collageInput>;

const seed = z.number().int().min(0).max(LOGO_SEED_MAX);
export const logoRequest = z.object({ appId: z.uuid(), text: z.string().max(40).optional(), seed: seed.optional() }).strict();
export const logoInput = z.object({ appId: z.uuid(), text: z.string().max(40).default(""), seed });
export type LogoInput = z.infer<typeof logoInput>;
