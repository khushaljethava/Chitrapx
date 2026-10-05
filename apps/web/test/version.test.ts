import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/version/route.ts";
import { config } from "@/proxy.ts";

describe("GET /api/version", () => {
  it("returns only the baked-in build id, never cached", async () => {
    process.env.NEXT_PUBLIC_BUILD_ID = "build-123";
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({ buildId: "build-123" });
  });

  it("is reachable signed out: the auth proxy skips it", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    expect(matcher.test("/api/version")).toBe(false);
    expect(matcher.test("/dashboard")).toBe(true);
  });
});
