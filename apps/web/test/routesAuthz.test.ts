import { beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "@chitrapx/db";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";

// Needs migration 0014. The real route handlers run with a faked Supabase session and cookie jar.
const session: { user: { id: string; email: string } | null; ws: string | undefined } = { user: null, ws: undefined };
vi.mock("@/lib/supabase/server.ts", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: session.user } }) } }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "chitrapx_ws" && session.ws ? { name, value: session.ws } : undefined), set: () => {}, delete: () => {} }),
}));

const { PUT: putDoc } = await import("@/app/api/projects/[projectId]/doc/route.ts");
const { POST: postExport } = await import("@/app/api/projects/[projectId]/export/route.ts");
const { POST: postApp } = await import("@/app/api/apps/route.ts");
const { createApp } = await import("@/server/apps.ts");
const { createProject } = await import("@/server/projects.ts");

let ws: string;
let projectId: string;
const member = async (role: string) => {
  const u = await createUser();
  await makeWorkspace(u.id);
  await pool.query("insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)", [ws, u.id, role]);
  return u;
};
const as = (u: { id: string; email: string } | null) => { session.user = u; session.ws = ws; };
const params = () => ({ params: Promise.resolve({ projectId }) });
const save = async () => {
  const p = await pool.query("select doc, revision from projects where id = $1", [projectId]);
  return putDoc(new Request("http://x/api", { method: "PUT", body: JSON.stringify({ doc: p.rows[0].doc, revision: p.rows[0].revision }) }), params());
};

beforeAll(async () => {
  const owner = await createUser();
  ws = await makeWorkspace(owner.id, "pro");
  const ctx = { userId: owner.id, workspaceId: ws, plan: "pro" as const, role: "owner" as const };
  const app = await createApp(ctx, { name: "App" });
  projectId = (await createProject(ctx, app.id, { name: "P", kind: "screenshots" })).id;
});

describe("roles on real routes", () => {
  it("a viewer cannot save the doc, start a job or create an app (403)", async () => {
    as(await member("viewer"));
    const res = await save();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect((await postExport(new Request("http://x/api", { method: "POST", body: "{}" }), params())).status).toBe(403);
    expect((await postApp(new Request("http://x/api", { method: "POST", body: JSON.stringify({ name: "x" }) }))).status).toBe(403);
  });

  it("an editor saves the doc (200)", async () => {
    as(await member("editor"));
    expect((await save()).status).toBe(200);
  });

  it("a removed member's next call is 403 access_removed", async () => {
    const u = await member("editor");
    as(u);
    expect((await save()).status).toBe(200);
    await pool.query("delete from memberships where workspace_id = $1 and user_id = $2", [ws, u.id]);
    const res = await save();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("access_removed");
  });

  it("no session is still 401", async () => {
    as(null);
    expect((await save()).status).toBe(401);
  });
});
