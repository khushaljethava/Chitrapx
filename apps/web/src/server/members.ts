import { createHash, randomBytes } from "node:crypto";
import { and, asc, count, eq, gt, isNull, sql } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";
import { z } from "zod";
import { db, lockWorkspace, PLANS, schema, withTx, type Db, type MemberRole, type Plan } from "@chitrapx/db";
import { authorize, can } from "./authz.ts";
import type { Ctx } from "./context.ts";
import { HttpError, notFound } from "./http.ts";

/** SP15 team management. No email is sent: an invite is a link shown once to the inviter. */
export const INVITE_DAYS = 7;
const m = schema.memberships;
const inv = schema.workspaceInvites;
const PLAN_LABEL: Record<Plan, string> = { free: "Free", pro: "Pro", studio: "Studio" };
const INVITABLE = ["admin", "editor", "viewer"] as const;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const normEmail = (e: string) => e.trim().toLowerCase();
const ownerProtected = (msg: string) => new HttpError(403, "owner_protected", msg);

export type SeatUsage = { used: number; members: number; pending: number; max: number; over: boolean };

const pendingWhere = (workspaceId: string) => and(eq(inv.workspaceId, workspaceId), isNull(inv.acceptedAt), isNull(inv.revokedAt), gt(inv.expiresAt, new Date()));

/** Members of every role plus pending invites, against the plan's seats. */
export async function seatUsage(workspaceId: string, plan: Plan, tx: Db = db): Promise<SeatUsage> {
  const [{ n: members }] = (await tx.select({ n: count() }).from(m).where(eq(m.workspaceId, workspaceId))) as [{ n: number }];
  const [{ n: pending }] = (await tx.select({ n: count() }).from(inv).where(pendingWhere(workspaceId))) as [{ n: number }];
  const max = PLANS[plan].maxSeats;
  return { used: members + pending, members, pending, max, over: members > max };
}

function seatLimit(plan: Plan): HttpError {
  const max = PLANS[plan].maxSeats;
  const next = plan === "free" ? "Pro or Studio" : plan === "pro" ? "Studio" : null;
  const how = next ? `Upgrade to ${next} in Billing to invite more people.` : "Remove a member or revoke an invite to make room.";
  return new HttpError(403, "plan_limit", `Your ${PLAN_LABEL[plan]} plan includes ${max} seat${max === 1 ? "" : "s"}. ${how}`, { limit: "seats", plan, max, upgradeUrl: "/dashboard/billing" });
}

export type MemberRow = { userId: string; email: string; name: string | null; role: MemberRole; joinedAt: Date; you: boolean };
export type InviteRow = { id: string; email: string; role: MemberRole; expiresAt: Date; createdAt: Date };

/** Everyone in the workspace (all roles see this); pending invites only for admins and the owner. */
export async function listMembers(ctx: Ctx): Promise<{ members: MemberRow[]; invites: InviteRow[]; seats: SeatUsage; plan: Plan; role: MemberRole }> {
  const rows = await db.select({ userId: m.userId, email: authUsers.email, name: schema.profiles.name, role: m.role, joinedAt: m.createdAt })
    .from(m).innerJoin(authUsers, eq(authUsers.id, m.userId)).leftJoin(schema.profiles, eq(schema.profiles.id, m.userId))
    .where(eq(m.workspaceId, ctx.workspaceId)).orderBy(asc(m.createdAt), asc(m.userId));
  const invites = can(ctx, "members")
    ? await db.select({ id: inv.id, email: inv.email, role: inv.role, expiresAt: inv.expiresAt, createdAt: inv.createdAt }).from(inv)
      .where(pendingWhere(ctx.workspaceId)).orderBy(asc(inv.createdAt))
    : [];
  return {
    members: rows.map((r) => ({ ...r, email: r.email ?? "", you: r.userId === ctx.userId })),
    invites, seats: await seatUsage(ctx.workspaceId, ctx.plan), plan: ctx.plan, role: ctx.role,
  };
}

const inviteInput = z.object({ email: z.string().trim().toLowerCase().pipe(z.email()), role: z.enum(INVITABLE) });

/** Creates an invite link (token shown once). Re-inviting an email revokes its earlier link. */
export async function createInvite(ctx: Ctx, raw: unknown): Promise<{ id: string; token: string; path: string; email: string; role: MemberRole; expiresAt: Date }> {
  authorize(ctx, "members");
  const input = inviteInput.parse(raw);
  const [existing] = await db.select({ id: m.userId }).from(m).innerJoin(authUsers, eq(authUsers.id, m.userId))
    .where(and(eq(m.workspaceId, ctx.workspaceId), sql`lower(${authUsers.email}) = ${input.email}`));
  if (existing) throw new HttpError(409, "already_member", `${input.email} is already in this workspace`);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
  return withTx(async ({ db: tx }) => {
    await lockWorkspace(tx, ctx.workspaceId);
    await tx.update(inv).set({ revokedAt: new Date() }).where(and(pendingWhere(ctx.workspaceId), eq(inv.email, input.email)));
    const seats = await seatUsage(ctx.workspaceId, ctx.plan, tx);
    if (seats.used >= seats.max) throw seatLimit(ctx.plan);
    const [row] = await tx.insert(inv).values({ workspaceId: ctx.workspaceId, email: input.email, role: input.role, tokenHash: hashToken(token), invitedBy: ctx.userId, expiresAt })
      .returning({ id: inv.id });
    return { id: row!.id, token, path: `/invite/${token}`, email: input.email, role: input.role, expiresAt };
  });
}

export async function revokeInvite(ctx: Ctx, inviteId: string): Promise<void> {
  authorize(ctx, "members");
  if (!z.uuid().safeParse(inviteId).success) throw notFound();
  const gone = await db.update(inv).set({ revokedAt: new Date() })
    .where(and(eq(inv.id, inviteId), eq(inv.workspaceId, ctx.workspaceId), isNull(inv.acceptedAt), isNull(inv.revokedAt))).returning({ id: inv.id });
  if (!gone.length) throw notFound();
}

type Invitee = { id: string; email?: string | null };
export type InviteStatus = "ok" | "used" | "expired" | "revoked" | "wrong_email";

async function findInvite(token: string) {
  if (!token || token.length > 200) return undefined;
  const [row] = await db.select({ invite: inv, workspaceName: schema.workspaces.name, plan: schema.workspaces.plan })
    .from(inv).innerJoin(schema.workspaces, eq(schema.workspaces.id, inv.workspaceId)).where(eq(inv.tokenHash, hashToken(token)));
  return row;
}

function statusOf(invite: typeof inv.$inferSelect, user: Invitee): InviteStatus {
  if (invite.acceptedAt) return "used";
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt <= new Date()) return "expired";
  if (normEmail(user.email ?? "") !== normEmail(invite.email)) return "wrong_email";
  return "ok";
}

function inviteError(status: Exclude<InviteStatus, "ok">, invite: typeof inv.$inferSelect): HttpError {
  switch (status) {
    case "used": return new HttpError(410, "invite_used", "This invite has already been used.");
    case "revoked": return new HttpError(410, "invite_revoked", "This invite was cancelled. Ask for a new one.");
    case "expired": return new HttpError(410, "invite_expired", `This invite expired on ${invite.expiresAt.toISOString().slice(0, 10)}. Ask for a new one.`);
    case "wrong_email": return new HttpError(403, "invite_wrong_email", `This invite is for ${invite.email}. Sign in with that email to accept it.`);
  }
}

/** What the invite page shows: the workspace, the role, and whether this user can accept it. */
export async function inviteInfo(token: string, user: Invitee): Promise<{ status: InviteStatus; workspaceName: string; role: MemberRole; email: string; expiresAt: Date }> {
  const row = await findInvite(token);
  if (!row) throw notFound();
  return { status: statusOf(row.invite, user), workspaceName: row.workspaceName, role: row.invite.role, email: row.invite.email, expiresAt: row.invite.expiresAt };
}

/** Single use, bound to the invited email. Adds the membership; the caller switches to the workspace. */
export async function acceptInvite(user: Invitee, token: string): Promise<{ workspaceId: string; role: MemberRole }> {
  const row = await findInvite(token);
  if (!row) throw notFound();
  const status = statusOf(row.invite, user);
  if (status !== "ok") throw inviteError(status, row.invite);
  const { invite, plan } = row;
  return withTx(async ({ db: tx }) => {
    await lockWorkspace(tx, invite.workspaceId);
    const [already] = await tx.select({ role: m.role }).from(m).where(and(eq(m.workspaceId, invite.workspaceId), eq(m.userId, user.id)));
    if (already) throw new HttpError(409, "already_member", "You are already in this workspace.");
    const claimed = await tx.update(inv).set({ acceptedAt: new Date(), acceptedBy: user.id })
      .where(and(eq(inv.id, invite.id), isNull(inv.acceptedAt), isNull(inv.revokedAt), gt(inv.expiresAt, new Date()))).returning({ id: inv.id });
    if (!claimed.length) throw inviteError("used", invite);
    // A downgrade since the invite was sent can leave no room: members alone must still fit.
    const seats = await seatUsage(invite.workspaceId, plan, tx);
    if (seats.members >= seats.max) throw seatLimit(plan);
    await tx.insert(m).values({ workspaceId: invite.workspaceId, userId: user.id, role: invite.role });
    return { workspaceId: invite.workspaceId, role: invite.role };
  });
}

async function memberRole(tx: Db, workspaceId: string, userId: string): Promise<MemberRole> {
  if (!z.uuid().safeParse(userId).success) throw notFound();
  const [row] = await tx.select({ role: m.role }).from(m).where(and(eq(m.workspaceId, workspaceId), eq(m.userId, userId)));
  if (!row) throw notFound();
  return row.role;
}

const roleInput = z.object({ role: z.enum(["owner", ...INVITABLE]) });

/**
 * Changes a member's role. Admins and the owner manage everyone except the owner. Assigning `owner`
 * is a transfer, owner only: the old owner becomes an admin in the same transaction.
 */
export async function changeRole(ctx: Ctx, userId: string, raw: unknown): Promise<{ role: MemberRole }> {
  authorize(ctx, "members");
  const { role } = roleInput.parse(raw);
  if (role === "owner") authorize(ctx, "billing");
  return withTx(async ({ db: tx }) => {
    await lockWorkspace(tx, ctx.workspaceId);
    const current = await memberRole(tx, ctx.workspaceId, userId);
    if (current === "owner") throw ownerProtected("The owner's role changes only when they transfer ownership to someone else.");
    // Demote first: the one-owner index must hold after every statement.
    if (role === "owner") await tx.update(m).set({ role: "admin" }).where(and(eq(m.workspaceId, ctx.workspaceId), eq(m.userId, ctx.userId)));
    await tx.update(m).set({ role }).where(and(eq(m.workspaceId, ctx.workspaceId), eq(m.userId, userId)));
    return { role };
  });
}

/** Removes a member (admins and the owner), or leaves (anyone but the owner, for themselves). Immediate. */
export async function removeMember(ctx: Ctx, userId: string): Promise<void> {
  if (userId !== ctx.userId) authorize(ctx, "members");
  await withTx(async ({ db: tx }) => {
    await lockWorkspace(tx, ctx.workspaceId);
    const role = await memberRole(tx, ctx.workspaceId, userId);
    if (role === "owner") {
      throw ownerProtected(userId === ctx.userId ? "Transfer ownership to someone else before leaving this workspace." : "The workspace owner cannot be removed.");
    }
    await tx.delete(m).where(and(eq(m.workspaceId, ctx.workspaceId), eq(m.userId, userId)));
    await tx.delete(schema.notifications).where(and(eq(schema.notifications.workspaceId, ctx.workspaceId), eq(schema.notifications.userId, userId)));
  });
}

/** For the workspace switcher: 404 unless the user belongs to the workspace. */
export async function assertMember(userId: string, workspaceId: string): Promise<void> {
  if (!z.uuid().safeParse(workspaceId).success) throw notFound();
  const [row] = await db.select({ id: m.userId }).from(m).where(and(eq(m.workspaceId, workspaceId), eq(m.userId, userId)));
  if (!row) throw notFound();
}
