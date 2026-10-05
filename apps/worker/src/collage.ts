import sharp, { type OverlayOptions } from "sharp";
import { PRICES } from "@chitrapx/db";
import { collageInput, type Crop } from "@chitrapx/document";
import { collageLayout, defaultPadding, fitInside, gridSize } from "./collageLayout.ts";
import type { LaunchDeps } from "./icons/index.ts";
import { renderMockups } from "./mockup.ts";
import { FatalJobError, type JobContext } from "./runJob.ts";

type RenderFramed = (job: JobContext & { type: "collage" }, input: unknown, crops: Crop[]) => Promise<Buffer[]>;

/** Solid colour, or `from` at the top to `to` at the bottom (launch draws a vertical gradient too). */
function background(width: number, height: number, bg: { from: string; to?: string }): Buffer {
  const fill = bg.to
    ? `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg.from}"/><stop offset="1" stop-color="${bg.to}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`
    : `<rect width="100%" height="100%" fill="${bg.from}"/>`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${fill}</svg>`);
}

async function size(img: Buffer): Promise<{ width: number; height: number }> {
  const m = await sharp(img).metadata().catch(() => null);
  if (!m?.width || !m.height) throw new FatalJobError("collage_unreadable");
  return { width: m.width, height: m.height };
}

/**
 * collage (1 credit): 2 to 12 screenshots in one grid PNG. With a frame each screenshot is first
 * drawn inside the device by the render page (one Chromium page for all of them).
 */
export async function runCollage(raw: unknown, job: JobContext, deps: LaunchDeps, renderFramed: RenderFramed = renderMockups): Promise<{ actual: number; output: unknown }> {
  const input = collageInput.parse(raw);
  let images: Buffer[];
  if (input.frame) {
    if (!input.crops || input.crops.length !== input.images.length) throw new FatalJobError("mockup_invalid");
    images = await renderFramed({ ...job, type: "collage" }, raw, input.crops);
  } else {
    // Paths come from the job's own workspace and validated hashes, never from the input as given.
    images = await Promise.all(input.images.map((i) => deps.download(`${job.workspaceId}/${i.sha256}`)));
  }
  const sizes = await Promise.all(images.map(size));
  const first = sizes[0]!;
  const { cols, rows } = gridSize(images.length);
  const layout = collageLayout(images.length, first.width, first.height, input.padding ?? defaultPadding(first.width, cols, rows));
  const overlays: OverlayOptions[] = await Promise.all(images.map(async (img, i) => {
    const fit = fitInside(sizes[i]!.width, sizes[i]!.height, layout.cellW, layout.cellH);
    const input = await sharp(img).resize(fit.width, fit.height, { fit: "fill", kernel: "lanczos3" }).png().toBuffer();
    return { input, left: layout.cells[i]!.x + fit.left, top: layout.cells[i]!.y + fit.top };
  }));
  const png = await sharp(background(layout.width, layout.height, input.background))
    .composite(overlays).flatten({ background: input.background.from }).removeAlpha().png().toBuffer();
  const path = `${job.workspaceId}/${job.id}.png`;
  await deps.upload(path, png, "image/png", "exports");
  return { actual: PRICES.collage, output: { path, files: 1, bytes: png.byteLength, width: layout.width, height: layout.height, cols: layout.cols, rows: layout.rows } };
}
