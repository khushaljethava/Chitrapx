import { z } from "zod";

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
