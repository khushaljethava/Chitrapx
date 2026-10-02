import { describe, expect, it } from "vitest";
import { renderUrl, verifyRenderSig } from "../src/renderSig.ts";

describe("render signatures", () => {
  process.env.RENDER_SECRET = "test-secret-at-least-32-characters-long";
  const parse = (u: string) => { const url = new URL(u); return { exp: url.searchParams.get("exp")!, sig: url.searchParams.get("sig")! }; };

  it("accepts its own fresh signature for that job only", () => {
    const { exp, sig } = parse(renderUrl("http://web", "job-1"));
    expect(verifyRenderSig("job-1", exp, sig)).toBe(true);
    expect(verifyRenderSig("job-2", exp, sig)).toBe(false);
  });

  it("rejects tampered, expired, malformed and far-future signatures", () => {
    const { exp, sig } = parse(renderUrl("http://web", "job-1"));
    expect(verifyRenderSig("job-1", exp, sig.replace(/.$/, (c) => (c === "0" ? "1" : "0")))).toBe(false);
    expect(verifyRenderSig("job-1", exp, sig, Number(exp) + 1)).toBe(false);
    expect(verifyRenderSig("job-1", "abc", sig)).toBe(false);
    expect(verifyRenderSig("job-1", exp, "short")).toBe(false);
    const far = parse(renderUrl("http://web", "job-1", 24 * 3600_000));
    expect(verifyRenderSig("job-1", far.exp, far.sig)).toBe(false);
  });
});
