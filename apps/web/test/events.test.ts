import { desc, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db, schema } from "@chitrapx/db";
import { POST } from "@/app/api/events/route.ts";

// Needs migration 0013 (analytics_events).
const post = (body: string) => POST(new Request("http://x/api/events", { method: "POST", body, headers: { "content-type": "application/json" } }));
const latest = async (name: string) => (await db.select().from(schema.analyticsEvents).where(eq(schema.analyticsEvents.name, name)).orderBy(desc(schema.analyticsEvents.id)).limit(1))[0];

describe("POST /api/events", () => {
  afterEach(() => { delete process.env.NEXT_PUBLIC_ANALYTICS; });

  it("stores only the cleaned, anonymous event", async () => {
    process.env.NEXT_PUBLIC_ANALYTICS = "on";
    const res = await post(JSON.stringify({ name: "export_started", path: "/editor/3f2b8c1e-1234-4abc-9def-0123456789ab?ref=x", props: { kind: "zip", email: "a@b.c" }, userId: "u1" }));
    expect(res.status).toBe(204);
    const row = await latest("export_started");
    expect(row).toMatchObject({ name: "export_started", path: "/editor/:id", props: { kind: "zip" } });
    expect(Object.keys(row!).sort()).toEqual(["createdAt", "id", "name", "path", "props"]);
  });

  it("ignores unknown events and stores nothing while analytics is off", async () => {
    process.env.NEXT_PUBLIC_ANALYTICS = "on";
    const before = await latest("sign_up");
    expect((await post(JSON.stringify({ name: "steal", path: "/" }))).status).toBe(204);
    delete process.env.NEXT_PUBLIC_ANALYTICS;
    expect((await post(JSON.stringify({ name: "sign_up", path: "/" }))).status).toBe(204);
    expect((await latest("sign_up"))?.id).toBe(before?.id);
  });

  it("refuses a body over 1 KB", async () => {
    process.env.NEXT_PUBLIC_ANALYTICS = "on";
    expect((await post(JSON.stringify({ name: "page_view", path: `/${"x".repeat(2000)}` }))).status).toBe(413);
  });
});
