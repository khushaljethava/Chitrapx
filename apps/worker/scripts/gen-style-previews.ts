// Renders one fixed sample board in each named style through the real export path and writes
// apps/web/public/styles/<id>.png at 240 px wide. Needs what the e2e suite needs: local Supabase,
// MinIO and the web dev server at WEB_ORIGIN.
// Run: pnpm --filter @chitrapx/worker exec tsx --env-file=../../.env scripts/gen-style-previews.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { db, schema } from "@chitrapx/db";
import { applyStyle, STYLES, type ChitrapxDoc } from "@chitrapx/document";
import { EXPORTS_BUCKET } from "@chitrapx/storage";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { runExport } from "../src/export.ts";
import { runJob } from "../src/runJob.ts";
import { storage } from "../src/storage.ts";

const OUT = join(import.meta.dirname, "../../web/public/styles");
// The headline box is tall enough for the largest styles' type: this script has no DOM, so it cannot grow boxes with fitTextBox the way the editor does.
const SAMPLE = {
  schemaVersion: 1, kind: "screenshots", localization: { baseLocale: "en-US", locales: [] },
  groups: [{ id: "g", target: "iphone-6.9", spanElements: [], boards: [{ id: "b", name: "Sample", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "#ffffff", zoom: 1, elements: [
    { id: "h", type: "text", content: "Track habits.\nKeep streaks.", fontSize: 40, color: "#000000", fontFamily: "Inter", fontWeight: "700", textAlign: "center", lineHeight: 1.1, position: { x: 95, y: 100 }, size: { width: 1100, height: 1040 }, rotation: 0, scale: 1 },
    { id: "s", type: "text", content: "Your day, one tap at a time", fontSize: 14, color: "#333333", fontFamily: "Inter", fontWeight: "400", textAlign: "center", position: { x: 145, y: 1160 }, size: { width: 1000, height: 120 }, rotation: 0, scale: 1 },
    { id: "d", type: "device", deviceType: "iphone-17-pro-max", styleType: "normal", position: { x: 345, y: 1330 }, size: { width: 600, height: 1305 }, rotation: 0, scale: 1 },
  ] }] }],
} as unknown as ChitrapxDoc;

const ws = await makeWorkspace((await createUser()).id);
const [app] = await db.insert(schema.apps).values({ workspaceId: ws, name: "Style previews" }).returning();
mkdirSync(OUT, { recursive: true });
for (const style of STYLES) {
  const doc = applyStyle(SAMPLE, "g", style.id);
  const [p] = await db.insert(schema.projects).values({ workspaceId: ws, appId: app!.id, name: style.name, kind: "screenshots", doc }).returning();
  const [v] = await db.insert(schema.projectVersions).values({ workspaceId: ws, projectId: p!.id, revision: 0, doc }).returning();
  const [job] = await db.insert(schema.jobs).values({ workspaceId: ws, projectId: p!.id, type: "export_single", creditsReserved: 0,
    input: { versionId: v!.id, selection: { targets: ["iphone-6.9"], locales: ["en-US"], board: { groupId: "g", boardIndex: 0 } } } }).returning();
  await runJob(job!.id, (input, ctx) => runExport(input, ctx, "single"));
  const png = await storage().download(`${ws}/${job!.id}.png`, EXPORTS_BUCKET);
  writeFileSync(join(OUT, `${style.id}.png`), await sharp(png).resize({ width: 240 }).png().toBuffer());
  console.log(`wrote ${style.id}.png`);
}
process.exit(0);
