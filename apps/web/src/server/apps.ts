import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, lockWorkspace, PLANS, schema, withTx } from "@chitrapx/db";
import { BRAND_TOKENS, FONT_FAMILY_UNSAFE } from "@chitrapx/document";
import type { Ctx } from "./context.ts";
import { badRequest, HttpError, notFound } from "./http.ts";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #1A2B3C");
const font = z.string().trim().min(1).max(80).refine((v) => !FONT_FAMILY_UNSAFE.test(v), "Not a font name");

const palette = z.array(z.object({ token: z.enum(BRAND_TOKENS), color: hex }).strict()).max(6)
  .refine((p) => new Set(p.map((x) => x.token)).size === p.length, "Each brand colour can appear once");

export const brandSchema = z.object({
  primaryColor: hex.optional(),
  secondaryColor: hex.optional(),
  headingFont: font.optional(),
  bodyFont: font.optional(),
  logoAssetId: z.uuid().optional(),
  palette: palette.optional(),
}).strict();

const appFields = {
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2000),
  platformHint: z.enum(["ios", "android", "both"]),
  brand: brandSchema,
};
const createInput = z.object({
  ...appFields,
  description: appFields.description.default(""),
  platformHint: appFields.platformHint.default("both"),
  brand: brandSchema.default({}),
});
const updateInput = z.object(appFields).partial();

export type App = typeof schema.apps.$inferSelect;

const own = (ctx: Ctx, appId: string) => and(eq(schema.apps.id, appId), eq(schema.apps.workspaceId, ctx.workspaceId));

export async function listApps(ctx: Ctx): Promise<App[]> {
  return db.select().from(schema.apps).where(eq(schema.apps.workspaceId, ctx.workspaceId)).orderBy(desc(schema.apps.createdAt));
}

export async function getApp(ctx: Ctx, appId: string): Promise<App> {
  if (!z.uuid().safeParse(appId).success) throw notFound();
  const [app] = await db.select().from(schema.apps).where(own(ctx, appId));
  if (!app) throw notFound();
  return app;
}

export async function createApp(ctx: Ctx, raw: unknown): Promise<App> {
  return withTx(async ({ db: tx }) => {
    await lockWorkspace(tx, ctx.workspaceId);
    const [{ n }] = (await tx.select({ n: count() }).from(schema.apps).where(eq(schema.apps.workspaceId, ctx.workspaceId))) as [{ n: number }];
    if (n >= PLANS[ctx.plan].maxApps) throw new HttpError(403, "plan_limit", `Your plan allows ${PLANS[ctx.plan].maxApps} app(s)`);
    const input = createInput.parse(raw);
    const [app] = await tx.insert(schema.apps).values({ ...input, workspaceId: ctx.workspaceId }).returning();
    return app!;
  });
}

export async function updateApp(ctx: Ctx, appId: string, raw: unknown): Promise<App> {
  const current = await getApp(ctx, appId);
  const input = updateInput.parse(raw);
  if (input.brand?.logoAssetId) {
    const [asset] = await db.select({ id: schema.assets.id }).from(schema.assets).where(and(
      eq(schema.assets.id, input.brand.logoAssetId), eq(schema.assets.workspaceId, ctx.workspaceId),
    ));
    if (!asset) throw badRequest("unknown_logo_asset");
  }
  const [app] = await db.update(schema.apps)
    .set({ ...input, ...(input.brand && { brand: { ...current.brand, ...input.brand } }) })
    .where(own(ctx, appId)).returning();
  if (!app) throw notFound();
  return app;
}

export async function deleteApp(ctx: Ctx, appId: string): Promise<void> {
  await getApp(ctx, appId);
  // ponytail: storage objects of the app's assets are left behind; add a GC sweep when storage cost matters.
  await db.delete(schema.apps).where(own(ctx, appId));
}
