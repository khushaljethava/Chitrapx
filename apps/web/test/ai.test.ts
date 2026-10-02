import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { balance, db, InsufficientCreditsError, schema } from "@chitrapx/db";
import { seedTemplates } from "@chitrapx/db/seed";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { startAiDesign, startCopyVariants, startTranslate } from "@/server/ai.ts";
import { createApp } from "@/server/apps.ts";
import type { Ctx } from "@/server/context.ts";
import { createProject, listProjects } from "@/server/projects.ts";

let boss: PgBoss;
beforeAll(async () => {
  await seedTemplates();
  boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss_test" });
  await boss.start();
  for (const q of ["ai_design", "ai_translate", "ai_copy"]) await boss.createQueue(q);
});
afterAll(async () => { await boss.stop({ graceful: false }); });

async function setup(credits: number, shots = 1) {
  const user = await createUser();
  const ctx: Ctx = { userId: user.id, workspaceId: await makeWorkspace(user.id, "pro"), plan: "pro" };
  if (credits) await db.insert(schema.creditLedger).values({ workspaceId: ctx.workspaceId, delta: credits, reason: "adjust" });
  const app = await createApp(ctx, { name: "Bloom" });
  for (let i = 0; i < shots; i++) {
    const sha = String(i).repeat(64);
    await db.insert(schema.assets).values({ workspaceId: ctx.workspaceId, appId: app.id, kind: "screenshot", storagePath: `${ctx.workspaceId}/${sha}`, mime: "image/png", bytes: 1, sha256: sha });
  }
  return { ctx, app };
}

describe("AI job starters", () => {
  it("design creates a project and queues a 10 credit job; without screenshots it is refused", async () => {
    const s = await setup(20);
    const { projectId } = await startAiDesign(s.ctx, boss, s.app.id, { brief: "cozy" });
    expect(await listProjects(s.ctx, s.app.id)).toEqual([expect.objectContaining({ id: projectId })]);
    expect(await balance(db, s.ctx.workspaceId)).toBe(10);
    const none = await setup(20, 0);
    await expect(startAiDesign(none.ctx, boss, none.app.id, {})).rejects.toMatchObject({ status: 400, code: "no_screenshots" });
  });

  it("design without enough credits leaves no empty project behind", async () => {
    const s = await setup(5);
    await expect(startAiDesign(s.ctx, boss, s.app.id, {})).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(await listProjects(s.ctx, s.app.id)).toEqual([]);
  });

  it("translate charges per language and rejects bad or base locales; copy variants cost 3", async () => {
    const s = await setup(20);
    const p = await createProject(s.ctx, s.app.id, { name: "T", templateSlug: "amoura-dating" });
    await expect(startTranslate(s.ctx, boss, p.id, { locales: ["../x"] })).rejects.toThrow();
    await expect(startTranslate(s.ctx, boss, p.id, { locales: ["en-US"] })).rejects.toMatchObject({ code: "base_locale" });
    await startTranslate(s.ctx, boss, p.id, { locales: ["de-DE", "fr-FR", "ja"] });
    expect(await balance(db, s.ctx.workspaceId)).toBe(14);
    await startCopyVariants(s.ctx, boss, p.id);
    expect(await balance(db, s.ctx.workspaceId)).toBe(11);
  });
});
