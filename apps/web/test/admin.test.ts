import { beforeAll, describe, expect, it, vi } from "vitest";
import { balance, db, pool } from "@chitrapx/db";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";

// The real admin routes and queries run against the test database with a faked Supabase session.
const session: { user: { id: string; email: string } | null } = { user: null };
vi.mock("@/lib/supabase/server.ts", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: session.user } }) } }) }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

const { POST: postCredits } = await import("@/app/api/admin/credits/route.ts");
const { POST: postPlan } = await import("@/app/api/admin/plan/route.ts");
const { adminStats, adminWorkspaces, failedJobs, recentPayments } = await import("@/server/admin.ts");

let admin: { id: string; email: string };
let user: { id: string; email: string };
let ws: string;
const post = (handler: (r: Request) => Promise<Response>, body: unknown) => handler(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }));

beforeAll(async () => {
  admin = await createUser();
  user = await createUser();
  ws = await makeWorkspace(user.id);
  await pool.query("insert into payments (workspace_id, razorpay_order_id, pack, credits, amount, currency, status, paid_at) values ($1, $2, 'small', 100, 1900, 'AED', 'paid', now())", [ws, `order_admin_${ws}`]);
  process.env.ADMIN_EMAILS = `someone@else.test, ${admin.email.toUpperCase()}`;
});

describe("admin panel", () => {
  it("is a 404 for signed-out users and for accounts not in ADMIN_EMAILS", async () => {
    session.user = null;
    expect((await post(postCredits, { workspaceId: ws, delta: 10, note: "x" })).status).toBe(404);
    session.user = user;
    expect((await post(postCredits, { workspaceId: ws, delta: 10, note: "x" })).status).toBe(404);
    expect((await post(postPlan, { workspaceId: ws, plan: "studio" })).status).toBe(404);
    expect(await balance(db, ws)).toBe(0);
  });

  it("lets an admin grant credits (logged with the admin's email) and set the plan", async () => {
    session.user = admin;
    expect((await post(postCredits, { workspaceId: ws, delta: 250, note: "launch promo" })).status).toBe(200);
    expect(await balance(db, ws)).toBe(250);
    const { rows } = await pool.query("select note from credit_ledger where workspace_id = $1 and reason = 'adjust'", [ws]);
    expect(rows[0].note).toBe(`admin:${admin.email}: launch promo`);
    expect((await post(postCredits, { workspaceId: ws, delta: 0, note: "x" })).status).toBe(400);
    expect((await post(postPlan, { workspaceId: ws, plan: "studio" })).status).toBe(200);
    expect((await pool.query("select plan from workspaces where id = $1", [ws])).rows[0].plan).toBe("studio");
    expect((await post(postPlan, { workspaceId: crypto.randomUUID(), plan: "pro" })).status).toBe(404);
  });

  it("reports counts, revenue per currency, payments and searchable workspaces", async () => {
    const s = await adminStats();
    expect(s.users).toBeGreaterThanOrEqual(2);
    expect(s.payments).toBeGreaterThanOrEqual(1);
    expect(s.revenue.find((r) => r.currency === "AED")!.amount).toBeGreaterThanOrEqual(1900);
    expect((await recentPayments(500)).find((p) => p.email === user.email)).toMatchObject({ amount: 1900, currency: "AED", credits: 100 });
    const found = await adminWorkspaces(user.email.slice(0, 8));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: ws, email: user.email, plan: "studio", credits: 250 });
    expect(await adminWorkspaces("%")).not.toContainEqual(expect.objectContaining({ id: ws })); // % is matched literally
    await expect(failedJobs()).resolves.toBeInstanceOf(Array);
  });
});
