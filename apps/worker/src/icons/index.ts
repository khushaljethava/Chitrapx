import { strToU8, zipSync, type Zippable } from "fflate";
import sharp, { type Metadata } from "sharp";
import { PRICES } from "@chitrapx/db";
import { appIconsInput, MIN_ICON_SOURCE, RECOMMENDED_ICON_SOURCE } from "@chitrapx/document";
import type { BundleDeps } from "../bundle.ts";
import { FatalJobError, type JobContext } from "../runJob.ts";
import { androidExtras, cornerColour } from "./android.ts";
import { contentsJson } from "./contentsJson.ts";
import { iconResizer } from "./resize.ts";
import { APPICONSET, iconEntries, isApple, type IconPlatform } from "./sizes.ts";

export type IconOptions = {
  platforms: IconPlatform[];
  /** Android file name without extension (an Android resource name). */
  androidName: string;
  includeStores: boolean;
  /** `#rrggbb` behind the adaptive icon; defaults to the source's corner colour. */
  adaptiveBackground?: string;
};

/** Width and height of a square icon source, or a FatalJobError naming why it cannot be one. */
export async function checkIconSource(src: Buffer): Promise<{ size: number; warnings: string[] }> {
  let meta: Metadata;
  try { meta = await sharp(src).metadata(); } catch { throw new FatalJobError("icon_unreadable"); }
  const { width, height } = meta;
  if (!width || !height) throw new FatalJobError("icon_unreadable");
  if (width !== height) throw new FatalJobError("icon_not_square");
  if (width < MIN_ICON_SOURCE) throw new FatalJobError("icon_too_small");
  return { size: width, warnings: width < RECOMMENDED_ICON_SOURCE ? ["source_small"] : [] };
}

/**
 * Every file of the icon ZIP, keyed by path in a stable order (flow after launch/src/main.rs:740-797).
 * A path already present is never written twice (launch/src/zip.rs:23-27).
 */
export async function buildIconFiles(src: Buffer, opts: IconOptions): Promise<{ files: Record<string, Uint8Array>; warnings: string[]; background?: string }> {
  const { warnings } = await checkIconSource(src);
  const resized = iconResizer(src);
  const entries = iconEntries(opts.platforms, opts.androidName, opts.includeStores);
  const files: Record<string, Uint8Array> = {};
  const add = (path: string, data: Uint8Array) => { if (!(path in files)) files[path] = data; };
  for (const e of entries) add(`${e.folder}${e.filename}`, await resized(e.pixels, e.flatten));
  if (entries.some((e) => isApple(e.platform))) add(`${APPICONSET}Contents.json`, strToU8(contentsJson(entries)));
  let background: string | undefined;
  if (opts.platforms.includes("android")) {
    background = opts.adaptiveBackground?.toLowerCase() ?? await cornerColour(src);
    for (const [path, data] of await androidExtras(src, opts.androidName, background, resized)) add(path, data);
  }
  return { files, warnings, ...(background ? { background } : {}) };
}

/** ZIP timestamps are fixed so the same input always gives the same bytes. */
const ZIP_TIME = new Date(2025, 0, 1);

/** PNGs are stored (already compressed); JSON and XML are deflated. */
export function iconZip(files: Record<string, Uint8Array>): Uint8Array {
  const zippable: Zippable = {};
  for (const [path, data] of Object.entries(files)) zippable[path] = [data, { level: path.endsWith(".png") ? 0 : 6, mtime: ZIP_TIME }];
  return zipSync(zippable);
}

/** Storage the launch jobs use: the source from uploads, the result into exports. */
export type LaunchDeps = Pick<BundleDeps, "download" | "upload">;

/** app_icons: one square image into every store icon file, as one ZIP in the exports bucket (1 credit). */
export async function runAppIcons(raw: unknown, job: JobContext, deps: LaunchDeps): Promise<{ actual: number; output: unknown }> {
  const input = appIconsInput.parse(raw);
  // The path is built from the job's own workspace and a validated hash, never taken from the input.
  const src = await deps.download(`${job.workspaceId}/${input.sha256}`);
  const { files, warnings, background } = await buildIconFiles(src, input);
  const zip = iconZip(files);
  const path = `${job.workspaceId}/${job.id}.zip`;
  await deps.upload(path, zip, "application/zip", "exports");
  return { actual: PRICES.app_icons, output: { path, files: Object.keys(files).length, bytes: zip.byteLength, warnings, ...(background ? { background } : {}) } };
}
