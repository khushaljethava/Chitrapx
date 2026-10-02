import { spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { db, PRICES, renderUrl, schema } from "@chitrapx/db";
import { LOCALE_CODE, migrate, VIDEO_FORMAT_IDS, VIDEO_FORMATS, VIDEO_FPS } from "@chitrapx/document";
import { EXPORTS_BUCKET, exportOrigins, exportUrlAllowed } from "./export.ts";
import { FatalJobError, type JobContext } from "./runJob.ts";

const input = z.object({
  groupId: z.string().min(1),
  format: z.enum(VIDEO_FORMAT_IDS),
  locale: z.string().regex(LOCALE_CODE).optional(),
  secondsPerBoard: z.number().min(2).max(6).default(3),
});

/** ffmpeg arguments: JPEG frames on stdin, H.264 High yuv420p at 30 fps, plus a silent stereo AAC track (App Preview spec). */
export function ffmpegArgs(out: string): string[] {
  return [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(VIDEO_FPS), "-c:v", "mjpeg", "-i", "-",
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-shortest", "-map", "0:v", "-map", "1:a",
    "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", String(VIDEO_FPS), "-crf", "18",
    "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", out,
  ];
}

const discard = (path: string) => unlink(path).catch(() => {});

/** Renders a project's boards into an animated MP4 by stepping the render page frame by frame. */
export async function runVideo(raw: unknown, job: JobContext): Promise<{ actual: number; output: unknown }> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) throw new FatalJobError("invalid_input");
  if (!job.projectId) throw new FatalJobError("export_without_project");
  const [project] = await db.select().from(schema.projects)
    .where(and(eq(schema.projects.id, job.projectId), eq(schema.projects.workspaceId, job.workspaceId)));
  if (!project) throw new FatalJobError("project_missing");
  const group = migrate(project.doc).groups.find((g) => g.id === parsed.data.groupId);
  if (!group?.boards.length) throw new FatalJobError("nothing_to_export");
  const { width, height } = VIDEO_FORMATS[parsed.data.format];

  const out = join(tmpdir(), `chitrapx-${job.id}.mp4`);
  const ffmpeg = spawn(process.env.FFMPEG_PATH ?? "ffmpeg", ffmpegArgs(out), { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  ffmpeg.stderr.on("data", (d) => { stderr += String(d); });
  const exited = new Promise<number>((resolve, reject) => {
    ffmpeg.on("error", (err: NodeJS.ErrnoException) => reject(err.code === "ENOENT" ? new FatalJobError("ffmpeg_missing") : err));
    ffmpeg.on("close", (code) => resolve(code ?? 1));
  });
  const write = (buf: Buffer) => new Promise<void>((resolve, reject) => {
    ffmpeg.stdin.once("error", reject);
    if (!ffmpeg.stdin.write(buf)) ffmpeg.stdin.once("drain", resolve); else resolve();
  });

  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  let duration = 0;
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const origins = exportOrigins();
    await page.route("**/*", (route) => (exportUrlAllowed(route.request().url(), origins) ? route.continue() : route.abort("blockedbyclient")));
    const res = await page.goto(renderUrl(process.env.WEB_ORIGIN ?? "http://localhost:3000", job.id), { waitUntil: "load", timeout: 60_000 });
    if (!res?.ok()) throw new Error(`render page returned ${res?.status()}`);
    await page.waitForFunction(() => window.__chitrapxVideo, null, { timeout: 90_000 });
    const ready = await page.evaluate(() => window.__chitrapxVideo!);
    if (!ready.ok) throw new FatalJobError(ready.errors.slice(0, 5).join("; "));
    duration = ready.duration;
    const frames = Math.round(duration * VIDEO_FPS);
    for (let f = 0; f < frames; f++) {
      await page.evaluate((t) => window.__chitrapxSeek!(t), f / VIDEO_FPS);
      await write(await page.screenshot({ type: "jpeg", quality: 92 }));
    }
    ffmpeg.stdin.end();
    const code = await exited;
    if (code !== 0) throw new Error(`ffmpeg failed: ${stderr.slice(0, 300)}`);
  } catch (err) {
    ffmpeg.kill("SIGKILL");
    await exited.catch(() => {});
    await discard(out);
    throw err;
  } finally {
    await browser.close();
  }

  const bytes = await readFile(out);
  await discard(out);
  const path = `${job.workspaceId}/${job.id}.mp4`;
  const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }).storage;
  const { error } = await storage.from(EXPORTS_BUCKET).upload(path, bytes, { contentType: "video/mp4", upsert: true });
  if (error) throw new Error(`upload failed: ${error.message}`);
  return { actual: PRICES.video, output: { path, kind: "video", bytes: bytes.byteLength, duration, format: parsed.data.format } };
}
