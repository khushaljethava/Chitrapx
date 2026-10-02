import { asc, eq } from "drizzle-orm";
import { db, ensureWorkspace, schema, type Plan } from "@chitrapx/db";
import { createClient } from "@/lib/supabase/server.ts";
import { HttpError } from "./http.ts";

export type Ctx = { userId: string; workspaceId: string; plan: Plan };

export async function currentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/** Authenticated user + their workspace. v1: a user has exactly one workspace. */
export async function requireContext(): Promise<Ctx> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "unauthenticated");
  const find = () => db.select({ workspaceId: schema.workspaces.id, plan: schema.workspaces.plan })
    .from(schema.memberships)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
    .where(eq(schema.memberships.userId, user.id))
    .orderBy(asc(schema.memberships.createdAt)).limit(1);
  let [m] = await find();
  if (!m) {
    // Self-heal if the auth callback was interrupted before onboarding finished.
    await ensureWorkspace({ id: user.id, email: user.email ?? "", name: user.user_metadata?.full_name, avatarUrl: user.user_metadata?.avatar_url });
    [m] = await find();
  }
  return { userId: user.id, workspaceId: m!.workspaceId, plan: m!.plan };
}
