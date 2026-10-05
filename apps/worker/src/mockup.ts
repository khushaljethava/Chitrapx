import sharp from "sharp";
import { launchSource, PRICES } from "@chitrapx/db";
import { exportPlan, mockupInput, type Crop } from "@chitrapx/document";
import { renderPlan } from "./export.ts";
import type { LaunchDeps } from "./icons/index.ts";
import { FatalJobError, type JobContext } from "./runJob.ts";

/** Renders the boards of an in-memory mockup document (render page + Chromium) and cuts out each crop, alpha kept. */
export async function renderMockups(job: JobContext & { type: "mockup" | "collage" }, input: unknown, crops: Crop[]): Promise<Buffer[]> {
  const src = launchSource({ type: job.type, input });
  if (!src) throw new FatalJobError("mockup_invalid");
  const plan = exportPlan(src.doc, src.selection);
  if (plan.length !== crops.length) throw new FatalJobError("mockup_invalid");
  const pngs = await renderPlan(job, plan, { transparent: true });
  return Promise.all(pngs.map((png, i) => sharp(png).extract(crops[i]!).png().toBuffer()));
}

/** mockup (free): one screenshot inside a device frame, as one PNG in the exports bucket. */
export async function runMockup(raw: unknown, job: JobContext, deps: Pick<LaunchDeps, "upload">): Promise<{ actual: number; output: unknown }> {
  const input = mockupInput.parse(raw);
  const [png] = await renderMockups({ ...job, type: "mockup" }, raw, input.crops);
  const path = `${job.workspaceId}/${job.id}.png`;
  await deps.upload(path, png!, "image/png", "exports");
  return { actual: PRICES.mockup, output: { path, files: 1, bytes: png!.byteLength, width: input.crops[0]!.width, height: input.crops[0]!.height } };
}
