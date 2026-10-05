import { beforeAll, describe, expect, it } from "vitest";

/** SP16 checks against the running web app (WEB_ORIGIN), all signed out. */
const ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

beforeAll(async () => {
  const res = await fetch(`${ORIGIN}/api/health`).catch(() => null);
  if (!res?.ok) throw new Error(`web app not reachable at ${ORIGIN}; start it with pnpm dev`);
});

describe("SP16 polish (signed out)", () => {
  it("/api/version answers signed out with only the build id, never cached", async () => {
    const res = await fetch(`${ORIGIN}/api/version`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["buildId"]);
    expect(body.buildId).toMatch(/^[\w.-]{1,64}$/);
  });

  it("/changelog renders releases as text, signed out", async () => {
    const res = await fetch(`${ORIGIN}/changelog`, { redirect: "manual" });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Changelog");
    expect(html).toMatch(/<time dateTime="\d{4}-\d{2}-\d{2}"/);
  });

  it("pages carry the report-only CSP with no analytics host", async () => {
    const res = await fetch(`${ORIGIN}/privacy`, { redirect: "manual" });
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy-report-only") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/umami|plausible|googletagmanager/);
  });

  it("the events endpoint never errors for a visitor, whatever it is sent", async () => {
    for (const body of ["{}", "not json", JSON.stringify({ name: "page_view", path: "/" })]) {
      const res = await fetch(`${ORIGIN}/api/events`, { method: "POST", body, headers: { "content-type": "application/json" } });
      expect(res.status).toBe(204);
    }
  });

  it("the community API needs a signed-in user", async () => {
    expect((await fetch(`${ORIGIN}/api/community`)).status).toBe(401);
  });
});
