import { strToU8, zipSync } from "fflate";
import { chromium, type Browser } from "playwright";
import { storageOrigin } from "@chitrapx/storage";
import { exportSource, PRICES, renderUrl } from "@chitrapx/db";
import { checkExportable, exportBatches, storeReadiness, type ExportItem } from "@chitrapx/document";
import { FatalJobError, type JobContext } from "./runJob.ts";
import { finishPng, reportText, type FileIssue } from "./storeFiles.ts";
import { storage } from "./storage.ts";

/**
 * The export browser may only reach our web app, our storage, and Google Fonts. Anything a
 * document might smuggle into CSS (internal hosts, cloud metadata) is aborted (SSRF guard).
 */
export function exportUrlAllowed(url: string, origins: string[]): boolean {
  if (url.startsWith("data:") || url.startsWith("blob:")) return true;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  return origins.includes(u.origin);
}

export async function exportOrigins(): Promise<string[]> {
  return [process.env.WEB_ORIGIN ?? "http://localhost:3000", await storageOrigin("uploads"), "https://fonts.googleapis.com", "https://fonts.gstatic.com"]
    .map((o) => new URL(o).origin);
}

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(buf: Buffer): { width: number; height: number } {
  if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") throw new Error("not a PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// ponytail: one Chromium per job; keep a warm browser per worker when export volume grows.
async function launch(): Promise<Browser> {
  // SwiftShader gives headless Chromium a software WebGL for the 3D devices.
  return chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
}

/**
 * Screenshots every plan item through the signed render page, at exact size, in plan order. Raw
 * PNGs: exports finish them for the stores; `transparent` (SP12 mockups) keeps their alpha.
 */
export async function renderPlan(job: JobContext, plan: ExportItem[], opts: { transparent?: boolean } = {}): Promise<Buffer[]> {
  const origins = await exportOrigins();
  const out: Buffer[] = [];
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1024 }, deviceScaleFactor: 1 });
    await page.route("**/*", (route) => (exportUrlAllowed(route.request().url(), origins) ? route.continue() : route.abort("blockedbyclient")));
    for (const batch of exportBatches(plan)) {
      const url = `${renderUrl(process.env.WEB_ORIGIN ?? "http://localhost:3000", job.id)}&items=${batch.join(",")}`;
      const res = await page.goto(url, { waitUntil: "load", timeout: 60_000 });
      if (!res?.ok()) throw new Error(`render page returned ${res?.status()}`);
      await page.waitForFunction(() => window.__chitrapxReady, null, { timeout: 90_000 });
      const ready = await page.evaluate(() => window.__chitrapxReady!);
      if (!ready.ok) throw new FatalJobError(ready.errors.slice(0, 5).join("; "));
      for (const i of batch) {
        const item = plan[i]!;
        const png = await page.locator(`[data-item="${i}"]`).screenshot({ type: "png", animations: "disabled", omitBackground: opts.transparent ?? false });
        const { width, height } = pngSize(png);
        if (width !== item.width || height !== item.height) {
          throw new Error(`${item.file}: rendered ${width}x${height}, expected ${item.width}x${item.height}`);
        }
        out[i] = png;
      }
    }
  } finally {
    await browser.close();
  }
  return out;
}

/** Renders every board x locale of the job's project at exact store size and stores a ZIP. */
export async function runExport(input: unknown, job: JobContext, kind: "zip" | "single" = "zip"): Promise<{ actual: number; output: unknown }> {
  const src = await exportSource({ workspaceId: job.workspaceId, projectId: job.projectId, input });
  if (!src) throw new FatalJobError("project_missing");
  const check = checkExportable(src.doc, src.selection);
  if (!check.ok) throw new FatalJobError(check.code);
  const plan = check.plan;

  const files: Record<string, Uint8Array> = {};
  const post: FileIssue[] = [];
  const pngs = await renderPlan(job, plan);
  for (const [i, item] of plan.entries()) {
    const done = await finishPng(pngs[i]!, item.file);
    post.push(...done.issues);
    files[item.file] = done.png;
  }

  if (kind === "single") {
    const only = plan.length === 1 ? files[plan[0]!.file] : undefined;
    if (!only) throw new FatalJobError("single_export_needs_one_board");
    const path = `${job.workspaceId}/${job.id}.png`;
    await storage().put(path, only, "image/png", "exports");
    return { actual: PRICES.export_single, output: { path, files: 1, bytes: only.byteLength } };
  }

  const pre = storeReadiness(plan, src.doc);
  files["report.txt"] = strToU8(reportText(src.doc, plan, pre, post));
  const zip = zipSync(files, { level: 0 }); // PNGs are already compressed
  const path = `${job.workspaceId}/${job.id}.zip`;
  await storage().put(path, zip, "application/zip", "exports");
  return { actual: PRICES.export, output: { path, files: plan.length, bytes: zip.byteLength, issues: pre.length + post.length } };
}
