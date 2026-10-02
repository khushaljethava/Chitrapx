import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { unzipSync } from "fflate";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { balance, db, renderUrl, schema } from "@chitrapx/db";
import { seedTemplates } from "@chitrapx/db/seed";
import { migrate, type ChitrapxDoc } from "@chitrapx/document";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { EXPORTS_BUCKET, pngSize, runExport } from "../src/export.ts";
import { runJob } from "../src/runJob.ts";

const GOLDEN = join(import.meta.dirname, "../../../packages/assets/golden");
const ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

async function templateDoc(slug: string): Promise<ChitrapxDoc> {
  const [t] = await db.select().from(schema.templates).where(eq(schema.templates.slug, slug));
  return migrate(t!.doc);
}

/** A project plus an export job as reserveAndEnqueue leaves it (job queued, 1 credit reserved from 10). */
async function exportJob(doc: ChitrapxDoc) {
  const ws = await makeWorkspace((await createUser()).id);
  await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: 10, reason: "adjust" });
  const [app] = await db.insert(schema.apps).values({ workspaceId: ws, name: "E2E" }).returning();
  const [project] = await db.insert(schema.projects).values({ workspaceId: ws, appId: app!.id, name: "E2E", kind: doc.kind, doc }).returning();
  const [job] = await db.insert(schema.jobs).values({ workspaceId: ws, projectId: project!.id, type: "export", creditsReserved: 1, input: {} }).returning();
  await db.insert(schema.creditLedger).values({ workspaceId: ws, delta: -1, reason: "reserve", jobId: job!.id });
  return { ws, jobId: job!.id };
}

async function zipFiles(ws: string, jobId: string): Promise<Record<string, Uint8Array>> {
  const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }).storage;
  const { data, error } = await storage.from(EXPORTS_BUCKET).download(`${ws}/${jobId}.zip`);
  if (error) throw error;
  return unzipSync(new Uint8Array(await data.arrayBuffer()));
}

const jobRow = async (id: string) => (await db.select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0]!;

beforeAll(async () => {
  const res = await fetch(`${ORIGIN}/api/health`).catch(() => null);
  if (!res?.ok) throw new Error(`web app not reachable at ${ORIGIN}; start it with pnpm dev`);
  await seedTemplates();
});

describe("export", () => {
  it("renders every board at exact store size, zips them and charges 1 credit", async () => {
    const { ws, jobId } = await exportJob(await templateDoc("amoura-dating"));
    await runJob(jobId, runExport);
    expect(await jobRow(jobId)).toMatchObject({ status: "done", output: { files: 5 } });
    const files = await zipFiles(ws, jobId);
    expect(Object.keys(files)).toHaveLength(5);
    for (const [name, png] of Object.entries(files)) {
      expect(name).toMatch(/^ios\/iphone-6\.9\/en-US\/0\d-[a-z0-9-]+\.png$/);
      expect(pngSize(Buffer.from(png))).toEqual({ width: 1290, height: 2796 });
    }
    expect(await balance(db, ws)).toBe(9);
  });

  it("exports every board once per locale: 5 boards x 2 locales = 10 PNGs, translated text included", async () => {
    const doc = await templateDoc("amoura-dating");
    doc.localization = { baseLocale: "en-US", locales: [{ code: "de-DE" }] };
    const b0 = doc.groups[0]!.boards[0]!;
    const textId = b0.elements.find((e) => e.type === "text")!.id;
    b0.localized = { "de-DE": { [textId]: { content: "Triff jemanden Echtes" } } };
    const { ws, jobId } = await exportJob(doc);
    await runJob(jobId, runExport);
    expect(await jobRow(jobId)).toMatchObject({ status: "done", output: { files: 10 } });
    const files = await zipFiles(ws, jobId);
    expect(Object.keys(files).filter((f) => f.includes("/de-DE/"))).toHaveLength(5);
    const en = files["ios/iphone-6.9/en-US/01-meet-someone-real.png"]!;
    const de = files["ios/iphone-6.9/de-DE/01-meet-someone-real.png"]!;
    expect(Buffer.compare(Buffer.from(en), Buffer.from(de))).not.toBe(0);
  });

  it("fails by name and refunds when the document references a missing asset", async () => {
    const doc = await templateDoc("amoura-dating");
    const device = doc.groups[0]!.boards[0]!.elements.find((e) => e.type === "device") as { screenshotSrc?: string };
    device.screenshotSrc = `asset:${crypto.randomUUID()}`;
    const { ws, jobId } = await exportJob(doc);
    await runJob(jobId, runExport);
    const job = await jobRow(jobId);
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/asset_missing:asset:/);
    expect(await balance(db, ws)).toBe(10);
  });

  it("the render page answers 404 unless the signature is valid and the job is running", async () => {
    const { jobId } = await exportJob(await templateDoc("amoura-dating"));
    expect((await fetch(renderUrl(ORIGIN, jobId))).status).toBe(404); // job still queued
    await db.update(schema.jobs).set({ status: "running" }).where(eq(schema.jobs.id, jobId));
    expect((await fetch(renderUrl(ORIGIN, jobId))).status).toBe(200);
    expect((await fetch(renderUrl(ORIGIN, jobId).replace(/sig=./, "sig=0"))).status).toBe(404);
    expect((await fetch(`${ORIGIN}/render/${jobId}`)).status).toBe(404);
  });
});

describe("golden renders", () => {
  // A 2D phone set, a feature graphic and a 3D Mac board: the three renderer paths most likely to drift.
  for (const slug of ["amoura-dating", "fg-chat-connect", "mac-boardly"]) {
    it(`${slug}: first board matches the reference within 0.5% of pixels`, async () => {
      const { ws, jobId } = await exportJob(await templateDoc(slug));
      await runJob(jobId, runExport);
      expect((await jobRow(jobId)).status).toBe("done");
      const files = await zipFiles(ws, jobId);
      const first = Object.keys(files).sort()[0]!;
      const actual = PNG.sync.read(Buffer.from(files[first]!));
      const refPath = join(GOLDEN, `${slug}.png`);
      if (process.env.UPDATE_GOLDEN || !existsSync(refPath)) {
        writeFileSync(refPath, PNG.sync.write(actual));
        return;
      }
      const expected = PNG.sync.read(readFileSync(refPath));
      expect({ w: actual.width, h: actual.height }).toEqual({ w: expected.width, h: expected.height });
      const diff = pixelmatch(actual.data, expected.data, null, actual.width, actual.height, { threshold: 0.1 });
      expect(diff / (actual.width * actual.height)).toBeLessThan(0.005);
    });
  }
});
