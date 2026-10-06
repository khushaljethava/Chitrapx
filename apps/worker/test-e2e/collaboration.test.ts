import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { pool } from "@chitrapx/db";

/**
 * SP15 checks against the running web app (WEB_ORIGIN), signed out, with rows seeded straight into
 * the database the app uses (needs migration 0014). Signed-in role checks live in apps/web/test.
 */
const ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
let projectId: string;
let workspaceId: string;
const slug = () => randomBytes(18).toString("base64url");

beforeAll(async () => {
  const res = await fetch(`${ORIGIN}/api/health`).catch(() => null);
  if (!res?.ok) throw new Error(`web app not reachable at ${ORIGIN}; start it with pnpm dev`);
  const user = randomUUID();
  await pool.query("insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')", [user, `${user.slice(0, 8)}@e2e.local`]);
  workspaceId = (await pool.query("insert into workspaces (name, slug) values ('E2E', $1) returning id", [`e2e-${user}`])).rows[0].id;
  await pool.query("insert into memberships (workspace_id, user_id, role) values ($1, $2, 'owner')", [workspaceId, user]);
  const app = (await pool.query("insert into apps (workspace_id, name) values ($1, 'App') returning id", [workspaceId])).rows[0].id;
  const doc = { schemaVersion: 1, kind: "screenshots", brand: { appId: app }, localization: { baseLocale: "en-US", locales: [] },
    groups: [{ id: "g", target: "iphone-6.9", spanElements: [], boards: [{ id: "b1", name: "One", position: { x: 0, y: 0 }, size: { width: 100, height: 200 }, backgroundColor: "#123456", zoom: 1, elements: [] }] }] };
  projectId = (await pool.query("insert into projects (workspace_id, app_id, name, kind, doc, updated_by) values ($1, $2, 'Shared E2E', 'screenshots', $3, $4) returning id", [workspaceId, app, doc, user])).rows[0].id;
});

const share = async () => {
  const s = slug();
  await pool.query("update project_shares set revoked_at = now() where project_id = $1 and revoked_at is null", [projectId]);
  await pool.query("insert into project_shares (workspace_id, project_id, slug) values ($1, $2, $3)", [workspaceId, projectId, s]);
  return s;
};

describe("SP15 share by link (signed out)", () => {
  it("an anonymous browser sees the boards at /s/<slug>, noindex, with nothing private", async () => {
    const s = await share();
    const page = await fetch(`${ORIGIN}/s/${s}`, { redirect: "manual" });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Shared E2E");
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/);
    expect(html).not.toContain(workspaceId);
    const api = await fetch(`${ORIGIN}/api/shared/${s}`);
    expect(api.status).toBe(200);
    expect(api.headers.get("x-robots-tag")).toContain("noindex");
    const text = await api.text();
    expect(text).not.toContain(workspaceId);
    expect(text).not.toMatch(/workspace_?id|updated_?by/i);
  });

  it("saving the doc without a session is still 401", async () => {
    const res = await fetch(`${ORIGIN}/api/projects/${projectId}/doc`, { method: "PUT", body: JSON.stringify({ doc: {}, revision: 0 }), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(401);
  });

  it("disabling the link makes the same URL 404 on the next request; regenerate kills the old one", async () => {
    const old = await share();
    expect((await fetch(`${ORIGIN}/api/shared/${old}`)).status).toBe(200);
    const fresh = await share();
    expect((await fetch(`${ORIGIN}/api/shared/${old}`)).status).toBe(404);
    expect((await fetch(`${ORIGIN}/s/${old}`)).status).toBe(404);
    expect((await fetch(`${ORIGIN}/api/shared/${fresh}`)).status).toBe(200);
    await pool.query("update project_shares set revoked_at = now() where slug = $1", [fresh]);
    expect((await fetch(`${ORIGIN}/api/shared/${fresh}`)).status).toBe(404);
  });

  it("duplicating needs a session", async () => {
    const s = await share();
    expect((await fetch(`${ORIGIN}/api/shared/${s}/duplicate`, { method: "POST", body: "{}" })).status).toBe(401);
  });
});

describe("SP15 invites and comments (signed out)", () => {
  it("an invite link sends a signed-out visitor to sign in and back", async () => {
    const res = await fetch(`${ORIGIN}/invite/${randomBytes(32).toString("base64url")}`, { redirect: "manual" });
    expect([303, 307, 308]).toContain(res.status);
    expect(res.headers.get("location")).toMatch(/\/login\?next=%2Finvite%2F/);
  });

  it("comments, members and notifications need a session", async () => {
    for (const path of [`/api/projects/${projectId}/comments`, "/api/members", "/api/notifications", "/api/me"]) {
      expect((await fetch(`${ORIGIN}${path}`)).status).toBe(401);
    }
  });
});
