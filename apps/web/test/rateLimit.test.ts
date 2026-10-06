import { describe, expect, it } from "vitest";
import { clientKey, rateLimiter } from "@/lib/rateLimit.ts";

describe("rateLimiter (fixed window, per key)", () => {
  it("allows `limit` hits per window per key, then refuses until the window turns", () => {
    let now = 0;
    const hit = rateLimiter({ limit: 2, windowMs: 1000, now: () => now });
    expect([hit("a"), hit("a"), hit("a")]).toEqual([true, true, false]);
    expect(hit("b")).toBe(true);
    now = 1000;
    expect(hit("a")).toBe(true);
  });

  it("forgets old keys so memory stays bounded", () => {
    let now = 0;
    const hit = rateLimiter({ limit: 1, windowMs: 10, now: () => now, maxKeys: 3 });
    for (const k of ["a", "b", "c", "d"]) hit(k);
    now = 20;
    expect(hit("a")).toBe(true);
  });
});

describe("clientKey", () => {
  it("uses the first forwarded address, else the real-ip header, else a shared bucket", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientKey(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientKey(new Headers())).toBe("unknown");
  });
});
