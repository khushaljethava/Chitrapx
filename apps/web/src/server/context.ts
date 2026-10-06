import { asc, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";
import { db, ensureWorkspace, schema, type MemberRole, type Plan } from "@chitrapx/db";
import { createClient } from "@/lib/supabase/server.ts";
import { authorize, type Action } from "./authz.ts";
import { HttpError } from "./http.ts";

/** The signed-in user, the workspace they are working in, its plan and their role there (SP15). */
export type Ctx = { userId: string; workspaceId: string; plan: Plan; role: MemberRole };

/** SP15: the current workspace, for users who belong to several. Set only by /api/workspaces/switch and invite acceptance. */
export const WS_COOKIE = "chitrapx_ws";

export async function currentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export type WorkspaceChoice = { id: string; name: string; plan: Plan; role: MemberRole };

/** Every workspace the user belongs to, oldest membership first. */
export async function listWorkspaces(userId: string): Promise<WorkspaceChoice[]> {
  return db.select({ id: schema.workspaces.id, name: schema.workspaces.name, plan: schema.workspaces.plan, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
    .where(eq(schema.memberships.userId, userId))
    .orderBy(asc(schema.memberships.createdAt), asc(schema.workspaces.id));
}

type SessionUser = { id: string; email?: string | null; user_metadata?: Record<string, string | undefined> };

/**
 * The context for a user and their chosen workspace (the cookie value). No choice means their
 * oldest membership. A choice they do not belong to is 403 `access_removed`, never a silent
 * fall-back, so a removed member's open tab cannot keep writing somewhere else.
 */
export async function contextFor(user: SessionUser, chosen: string | undefined): Promise<Ctx> {
  let all = await listWorkspaces(user.id);
  if (!all.length) {
    // Self-heal if the auth callback was interrupted before onboarding finished.
    await ensureWorkspace({ id: user.id, email: user.email ?? "", name: user.user_metadata?.full_name, avatarUrl: user.user_metadata?.avatar_url });
    all = await listWorkspaces(user.id);
  }
  const pick = chosen === undefined ? all[0] : z.uuid().safeParse(chosen).success ? all.find((w) => w.id === chosen) : undefined;
  if (!pick) throw new HttpError(403, "access_removed", "You no longer have access to this workspace.");
  return { userId: user.id, workspaceId: pick.id, plan: pick.plan, role: pick.role };
}

/** The workspace chosen with the switcher, if any. */
export async function chosenWorkspace(): Promise<string | undefined> {
  return (await cookies()).get(WS_COOKIE)?.value || undefined;
}

/**
 * Authenticated user + their current workspace, authorized for `action` (default: read).
 * Every route that writes passes the action it needs (see authz.ts).
 */
export async function requireContext(action: Action = "view"): Promise<Ctx> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "unauthenticated");
  const ctx = await contextFor(user, await chosenWorkspace());
  authorize(ctx, action);
  return ctx;
}
