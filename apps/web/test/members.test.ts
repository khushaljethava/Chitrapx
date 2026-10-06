import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pool, type MemberRole, type Plan } from "@chitrapx/db";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import type { Ctx } from "@/server/context.ts";
import { contextFor } from "@/server/context.ts";
import { acceptInvite, assertMember, changeRole, createInvite, inviteInfo, listMembers, removeMember, revokeInvite, seatUsage } from "@/server/members.ts";

// Needs migration 0014.
type User = { id: string; email: string };

async function team(plan: Plan = "studio"): Promise<{ owner: User; ctx: Ctx }> {
  const owner = await createUser();
  const ws = await makeWorkspace(owner.id, plan);
  return { owner, ctx: { userId: owner.id, workspaceId: ws, plan, role: "owner" } };
}
async function add(ctx: Ctx, role: MemberRole): Promise<{ user: User; ctx: Ctx }> {
  const user = await createUser();
  await makeWorkspace(user.id);
  await pool.query("insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)", [ctx.workspaceId, user.id, role]);
  return { user, ctx: { userId: user.id, workspaceId: ctx.workspaceId, plan: ctx.plan, role } };
}
const roleOf = async (ws: string, user: string) => (await pool.query("select role from memberships where workspace_id = $1 and user_id = $2", [ws, user])).rows[0]?.role as string | undefined;
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => `${e.status} ${e.code}`);

describe("invites", () => {
  it("an editor invite opened by the invited email makes them an editor, once", async () => {
    const { ctx } = await team();
    const invitee = await createUser();
    const inv = await createInvite(ctx, { email: invitee.email.toUpperCase(), role: "editor" });
    expect(inv.path).toBe(`/invite/${inv.token}`);
    expect(inv.token.length).toBeGreaterThanOrEqual(43);
    const stored = (await pool.query("select token_hash from workspace_invites where id = $1", [inv.id])).rows[0].token_hash;
    expect(stored).toBe(createHash("sha256").update(inv.token).digest("hex"));
    expect(stored).not.toContain(inv.token);

    expect(await inviteInfo(inv.token, invitee)).toMatchObject({ status: "ok", role: "editor" });
    expect(await acceptInvite(invitee, inv.token)).toEqual({ workspaceId: ctx.workspaceId, role: "editor" });
    expect(await roleOf(ctx.workspaceId, invitee.id)).toBe("editor");
    expect(await code(acceptInvite(invitee, inv.token))).toBe("410 invite_used");
    expect((await inviteInfo(inv.token, invitee)).status).toBe("used");
  });

  it("refuses expired, revoked, unknown and other-email links with clear errors", async () => {
    const { ctx } = await team();
    const invitee = await createUser();
    const expired = await createInvite(ctx, { email: invitee.email, role: "viewer" });
    await pool.query("update workspace_invites set expires_at = now() - interval '1 minute' where id = $1", [expired.id]);
    const err = await acceptInvite(invitee, expired.token).catch((e) => e);
    expect(`${err.status} ${err.code}`).toBe("410 invite_expired");
    expect(err.message).toMatch(/expired/i);

    const other = await createUser();
    const wrong = await createInvite(ctx, { email: invitee.email, role: "viewer" });
    const e2 = await acceptInvite(other, wrong.token).catch((e) => e);
    expect(`${e2.status} ${e2.code}`).toBe("403 invite_wrong_email");
    expect(e2.message).toContain(invitee.email);

    await revokeInvite(ctx, wrong.id);
    expect(await code(acceptInvite(invitee, wrong.token))).toBe("410 invite_revoked");
    expect(await code(acceptInvite(invitee, "nope"))).toBe("404 not_found");
  });

  it("inviting the same email again revokes the earlier link", async () => {
    const { ctx } = await team();
    const invitee = await createUser();
    const first = await createInvite(ctx, { email: invitee.email, role: "viewer" });
    const second = await createInvite(ctx, { email: invitee.email, role: "editor" });
    expect(await code(acceptInvite(invitee, first.token))).toBe("410 invite_revoked");
    expect((await acceptInvite(invitee, second.token)).role).toBe("editor");
  });

  it("refuses inviting an existing member and the owner role", async () => {
    const { ctx } = await team();
    const { user } = await add(ctx, "viewer");
    expect(await code(createInvite(ctx, { email: user.email, role: "editor" }))).toBe("409 already_member");
    // Invalid input is a ZodError, which route() turns into 400 invalid_input.
    await expect(createInvite(ctx, { email: "x@y.io", role: "owner" })).rejects.toMatchObject({ name: "ZodError" });
  });

  it("only admins and the owner may invite", async () => {
    const { ctx } = await team();
    const editor = await add(ctx, "editor");
    expect(await code(createInvite(editor.ctx, { email: "z@y.io", role: "viewer" }))).toBe("403 forbidden");
    const admin = await add(ctx, "admin");
    expect(await code(createInvite(admin.ctx, { email: "z@y.io", role: "admin" }))).toBe("ok");
  });
});

describe("seats", () => {
  it("free plan: inviting a second person is refused naming the plan and the upgrade", async () => {
    const { ctx } = await team("free");
    const err = await createInvite(ctx, { email: "second@y.io", role: "editor" }).catch((e) => e);
    expect(`${err.status} ${err.code}`).toBe("403 plan_limit");
    expect(err.message).toMatch(/Free plan includes 1 seat/);
    expect(err.message).toMatch(/Upgrade/);
    expect(err.details).toMatchObject({ limit: "seats", plan: "free", max: 1, upgradeUrl: "/dashboard/billing" });
  });

  it("pro plan: members plus pending invites count; the 4th person is refused", async () => {
    const { ctx } = await team("pro");
    await add(ctx, "editor");
    await createInvite(ctx, { email: "third@y.io", role: "viewer" });
    expect(await seatUsage(ctx.workspaceId, "pro")).toMatchObject({ used: 3, members: 2, pending: 1, max: 3 });
    expect(await code(createInvite(ctx, { email: "fourth@y.io", role: "viewer" }))).toBe("403 plan_limit");
  });

  it("a downgrade keeps every member but blocks new invites and invite acceptance", async () => {
    const { ctx } = await team("pro");
    const invitee = await createUser();
    const inv = await createInvite(ctx, { email: invitee.email, role: "viewer" });
    await add(ctx, "editor");
    await add(ctx, "viewer");
    await pool.query("update workspaces set plan = 'free' where id = $1", [ctx.workspaceId]);
    const free = { ...ctx, plan: "free" as const };
    const list = await listMembers(free);
    expect(list.members).toHaveLength(3);
    expect(list.seats).toMatchObject({ members: 3, max: 1, over: true });
    expect(await code(createInvite(free, { email: "more@y.io", role: "viewer" }))).toBe("403 plan_limit");
    expect(await code(acceptInvite(invitee, inv.token))).toBe("403 plan_limit");
  });
});

describe("roles and removal", () => {
  it("an admin cannot change or remove the owner, nor make anyone owner", async () => {
    const { owner, ctx } = await team();
    const admin = await add(ctx, "admin");
    const editor = await add(ctx, "editor");
    expect(await code(changeRole(admin.ctx, owner.id, { role: "viewer" }))).toBe("403 owner_protected");
    expect(await code(removeMember(admin.ctx, owner.id))).toBe("403 owner_protected");
    expect(await code(changeRole(admin.ctx, editor.user.id, { role: "owner" }))).toBe("403 forbidden");
    await changeRole(admin.ctx, editor.user.id, { role: "viewer" });
    expect(await roleOf(ctx.workspaceId, editor.user.id)).toBe("viewer");
  });

  it("the sole owner cannot leave or demote themselves; transferring swaps owner and admin", async () => {
    const { owner, ctx } = await team();
    const editor = await add(ctx, "editor");
    expect(await code(removeMember(ctx, owner.id))).toBe("403 owner_protected");
    expect(await code(changeRole(ctx, owner.id, { role: "admin" }))).toBe("403 owner_protected");
    await changeRole(ctx, editor.user.id, { role: "owner" });
    expect(await roleOf(ctx.workspaceId, editor.user.id)).toBe("owner");
    expect(await roleOf(ctx.workspaceId, owner.id)).toBe("admin");
  });

  it("editors cannot manage members; anyone but the owner can leave", async () => {
    const { ctx } = await team();
    const editor = await add(ctx, "editor");
    const viewer = await add(ctx, "viewer");
    expect(await code(removeMember(editor.ctx, viewer.user.id))).toBe("403 forbidden");
    expect(await code(changeRole(editor.ctx, viewer.user.id, { role: "editor" }))).toBe("403 forbidden");
    await removeMember(viewer.ctx, viewer.user.id);
    expect(await roleOf(ctx.workspaceId, viewer.user.id)).toBeUndefined();
  });

  it("a removed member's next request for that workspace is 403 access_removed", async () => {
    const { ctx } = await team();
    const editor = await add(ctx, "editor");
    expect((await contextFor(editor.user, ctx.workspaceId)).role).toBe("editor");
    await removeMember(ctx, editor.user.id);
    expect(await code(contextFor(editor.user, ctx.workspaceId))).toBe("403 access_removed");
  });

  it("lists members with email, name and role; invites only for admins", async () => {
    const { owner, ctx } = await team();
    const viewer = await add(ctx, "viewer");
    await createInvite(ctx, { email: "p@y.io", role: "editor" });
    const mine = await listMembers(ctx);
    expect(mine.members.map((m) => [m.email, m.role, m.you])).toEqual([[owner.email, "owner", true], [viewer.user.email, "viewer", false]]);
    expect(mine.invites.map((i) => i.email)).toEqual(["p@y.io"]);
    expect(JSON.stringify(mine)).not.toMatch(/token/i);
    expect((await listMembers(viewer.ctx)).invites).toEqual([]);
  });

  it("switching is allowed only into the user's own workspaces", async () => {
    const { owner, ctx } = await team();
    const other = await team();
    await expect(assertMember(owner.id, ctx.workspaceId)).resolves.toBeUndefined();
    expect(await code(assertMember(owner.id, other.ctx.workspaceId))).toBe("404 not_found");
  });
});
