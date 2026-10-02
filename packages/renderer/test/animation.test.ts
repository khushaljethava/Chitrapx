import { describe, expect, it } from "vitest";
import { animationStateAt, defaultAnimations } from "../src/index.ts";

describe("animationStateAt (OSG behaviour)", () => {
  it("is idle with no animation and hidden before its delay", () => {
    expect(animationStateAt(undefined, 0, 100)).toEqual({ visible: true, opacity: 1, dx: 0, dy: 0, scale: 1 });
    expect(animationStateAt({ enter: "fade", enterDelay: 1 }, 0.5, 100).visible).toBe(false);
  });
  it("fades and slides in, then rests", () => {
    expect(animationStateAt({ enter: "fade" }, 0, 100).opacity).toBe(0);
    expect(animationStateAt({ enter: "fade" }, 0.3, 100).opacity).toBeGreaterThan(0.5);
    const mid = animationStateAt({ enter: "slide-up" }, 0.3, 100);
    expect(mid.dy).toBeGreaterThan(0);
    expect(mid.dy).toBeLessThan(100);
    expect(animationStateAt({ enter: "slide-up" }, 1, 100)).toEqual({ visible: true, opacity: 1, dx: 0, dy: 0, scale: 1 });
  });
  it("pop overshoots past full size before settling", () => {
    const peaks = [0.3, 0.4, 0.5].map((t) => animationStateAt({ enter: "pop" }, t, 100).scale);
    expect(Math.max(...peaks)).toBeGreaterThan(1);
  });
});

describe("defaultAnimations", () => {
  it("animates an unanimated board: texts slide up in turn, then devices scale in", () => {
    const els = [{ id: "t1", type: "text" }, { id: "d", type: "device" }, { id: "t2", type: "text" }] as never;
    const out = defaultAnimations(els) as Array<{ id: string; animation?: { enter: string; enterDelay?: number } }>;
    expect(out.find((e) => e.id === "t1")!.animation).toMatchObject({ enter: "slide-up", enterDelay: 0 });
    expect(out.find((e) => e.id === "t2")!.animation).toMatchObject({ enter: "slide-up", enterDelay: 0.12 });
    expect(out.find((e) => e.id === "d")!.animation?.enter).toBe("scale-up");
  });

  it("leaves a board alone once someone has animated any element on it", () => {
    const els = [{ id: "t1", type: "text" }, { id: "own", type: "text", animation: { enter: "fade" } }] as never;
    const out = defaultAnimations(els) as Array<{ id: string; animation?: unknown }>;
    expect(out.find((e) => e.id === "t1")!.animation).toBeUndefined();
    expect(out.find((e) => e.id === "own")!.animation).toEqual({ enter: "fade" });
  });
});
