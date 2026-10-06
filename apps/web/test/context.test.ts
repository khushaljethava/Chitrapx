import { describe, expect, it } from "vitest";
import { pool } from "@chitrapx/db";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { contextFor, listWorkspaces } from "@/server/context.ts";
import { HttpError } from "@/server/http.ts";

// Needs migration 0014 (four roles).
const join = (ws: string, user: string, role: string) => pool.query("insert into memberships (workspace_id, user_id, role, created_at) values ($1, $2, $3, now() + interval '1 second')", [ws, user, role]);

describe("contextFor (current workspace and role)", () => {
  it("uses the oldest membership when no workspace is chosen, with its role", async () => {
    const u = await createUser();
    const own = await makeWorkspace(u.id, "pro");
    const other = await makeWorkspace((await createUser()).id, "studio");
    await join(other, u.id, "viewer");
    expect(await contextFor(u, undefined)).toEqual({ userId: u.id, workspaceId: own, plan: "pro", role: "owner" });
  });

  it("uses the chosen workspace when the user belongs to it", async () => {
    const u = await createUser();
    await makeWorkspace(u.id);
    const team = await makeWorkspace((await createUser()).id, "studio");
    await join(team, u.id, "editor");
    expect(await contextFor(u, team)).toMatchObject({ workspaceId: team, plan: "studio", role: "editor" });
  });

  it("refuses a chosen workspace the user does not (or no longer) belong to with 403 access_removed", async () => {
    const u = await createUser();
    await makeWorkspace(u.id);
    const team = await makeWorkspace((await createUser()).id);
    const err = await contextFor(u, team).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(403);
    expect(err.code).toBe("access_removed");
    expect(await contextFor(u, "not-a-uuid").catch((e) => e.code)).toBe("access_removed");
  });

  it("self-heals a user with no workspace", async () => {
    const u = await createUser();
    const ctx = await contextFor(u, undefined);
    expect(ctx.role).toBe("owner");
  });

  it("lists every workspace with the user's role, oldest first", async () => {
    const u = await createUser();
    const own = await makeWorkspace(u.id);
    const team = await makeWorkspace((await createUser()).id);
    await join(team, u.id, "admin");
    const list = await listWorkspaces(u.id);
    expect(list.map((w) => [w.id, w.role])).toEqual([[own, "owner"], [team, "admin"]]);
  });
});
