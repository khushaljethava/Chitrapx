import { and, eq } from "drizzle-orm";
import { zipSync } from "fflate";
import { chromium, type Browser } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { db, PRICES, renderUrl, schema } from "@chitrapx/db";
import { exportBatches, exportPlan, migrate } from "@chitrapx/document";
import { FatalJobError, type JobContext } from "./runJob.ts";

export const EXPORTS_BUCKET = "exports";

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(buf: Buffer): { width: number; height: number } {
  if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") throw new Error("not a PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const storage = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
}).storage.from(EXPORTS_BUCKET);

// ponytail: one Chromium per job; keep a warm browser per worker when export volume grows.
async function launch(): Promise<Browser> {
  // SwiftShader gives headless Chromium a software WebGL for the 3D devices.
  return chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
}

/** Renders every board x locale of the job's project at exact store size and stores a ZIP. */
export async function runExport(input: unknown, job: JobContext): Promise<{ actual: number; output: unknown }> {
  if (!job.projectId) throw new FatalJobError("export_without_project");
  const [project] = await db.select().from(schema.projects)
    .where(and(eq(schema.projects.id, job.projectId), eq(schema.projects.workspaceId, job.workspaceId)));
  if (!project) throw new FatalJobError("project_missing");
  const plan = exportPlan(migrate(project.doc), (input as { locales?: string[] } | null)?.locales);
  if (!plan.length) throw new FatalJobError("nothing_to_export");

  const files: Record<string, Uint8Array> = {};
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1024 }, deviceScaleFactor: 1 });
    for (const batch of exportBatches(plan)) {
      const url = `${renderUrl(process.env.WEB_ORIGIN ?? "http://localhost:3000", job.id)}&items=${batch.join(",")}`;
      const res = await page.goto(url, { waitUntil: "load", timeout: 60_000 });
      if (!res?.ok()) throw new Error(`render page returned ${res?.status()}`);
      await page.waitForFunction(() => window.__chitrapxReady, null, { timeout: 90_000 });
      const ready = await page.evaluate(() => window.__chitrapxReady!);
      if (!ready.ok) throw new FatalJobError(ready.errors.slice(0, 5).join("; "));
      for (const i of batch) {
        const item = plan[i]!;
        const png = await page.locator(`[data-item="${i}"]`).screenshot({ type: "png", animations: "disabled" });
        const { width, height } = pngSize(png);
        if (width !== item.width || height !== item.height) {
          throw new Error(`${item.file}: rendered ${width}x${height}, expected ${item.width}x${item.height}`);
        }
        files[item.file] = png;
      }
    }
  } finally {
    await browser.close();
  }

  const zip = zipSync(files, { level: 0 }); // PNGs are already compressed
  const path = `${job.workspaceId}/${job.id}.zip`;
  const { error } = await storage().upload(path, zip, { contentType: "application/zip", upsert: true });
  if (error) throw new Error(`upload failed: ${error.message}`);
  return { actual: PRICES.export, output: { path, files: plan.length, bytes: zip.byteLength } };
}
