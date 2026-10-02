import { randomBytes } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { schema, withTx } from "./client.ts";
import { monthKey } from "./month.ts";
import { PLANS } from "./plans.ts";

export type OnboardingUser = { id: string; email: string; name?: string | null; avatarUrl?: string | null };

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "workspace";

/** First sign-in creates profile, workspace, owner membership and the free grant. Idempotent. */
export async function ensureWorkspace(user: OnboardingUser): Promise<{ workspaceId: string; created: boolean }> {
  return withTx(async ({ db }) => {
    await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`user:${user.id}`}))`);
    const [existing] = await db.select({ ws: schema.memberships.workspaceId }).from(schema.memberships)
      .where(eq(schema.memberships.userId, user.id)).orderBy(asc(schema.memberships.createdAt)).limit(1);
    if (existing) return { workspaceId: existing.ws, created: false };

    const name = user.name?.trim() || user.email.split("@")[0] || "My";
    await db.insert(schema.profiles).values({ id: user.id, name, avatarUrl: user.avatarUrl ?? null }).onConflictDoNothing();
    const [ws] = await db.insert(schema.workspaces).values({
      name: `${name}'s workspace`,
      slug: `${slugify(name)}-${randomBytes(3).toString("hex")}`,
    }).returning({ id: schema.workspaces.id });
    await db.insert(schema.memberships).values({ workspaceId: ws!.id, userId: user.id, role: "owner" });
    await db.insert(schema.creditLedger).values({
      workspaceId: ws!.id, delta: PLANS.free.monthlyCredits, reason: "plan_grant", note: monthKey(new Date()),
    });
    return { workspaceId: ws!.id, created: true };
  });
}
