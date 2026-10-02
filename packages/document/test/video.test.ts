import { describe, expect, it } from "vitest";
import { framesAt, videoTimeline, VIDEO_FORMATS } from "../src/index.ts";

const boards = (n: number, d?: number) => Array.from({ length: n }, () => ({ previewDurationSeconds: d }));

describe("videoTimeline", () => {
  it("stretches short sets to Apple's 15 second minimum", () => {
    const t = videoTimeline(boards(3), 3);
    expect(t.duration).toBeCloseTo(15);
    expect(t.slides.map((s) => s.boardIndex)).toEqual([0, 1, 2]);
    expect(t.slides[1]!.start).toBeCloseTo(5);
  });

  it("trims long sets to the 30 second maximum by dropping trailing boards", () => {
    const t = videoTimeline(boards(12), 3);
    expect(t.duration).toBeCloseTo(30);
    expect(t.slides).toHaveLength(10);
    expect(videoTimeline(boards(1, 40), 3).duration).toBe(30);
  });

  it("respects per-board durations and keeps crossfades at most half a slide", () => {
    const t = videoTimeline([{ previewDurationSeconds: 10 }, { previewDurationSeconds: 0.5 }, {}, {}], 3);
    expect(t.slides[0]!.end - t.slides[0]!.start).toBeGreaterThan(t.slides[1]!.end - t.slides[1]!.start);
    const shortest = Math.min(...t.slides.map((s) => s.end - s.start));
    expect(t.crossfade).toBeLessThanOrEqual(shortest / 2 + 1e-9);
  });
});

describe("framesAt", () => {
  const t = videoTimeline(boards(5), 3);
  it("shows one board mid-slide with its local time", () => {
    expect(framesAt(t, 1.5)).toEqual([{ boardIndex: 0, localTime: 1.5, opacity: 1 }]);
  });
  it("crossfades into the next board at the end of a slide", () => {
    const layers = framesAt(t, t.slides[0]!.end - t.crossfade / 2);
    expect(layers.map((l) => l.boardIndex)).toEqual([0, 1]);
    expect(layers[1]!.opacity).toBeCloseTo(0.5);
  });
  it("holds the last board at the very end", () => {
    expect(framesAt(t, t.duration).map((l) => l.boardIndex)).toEqual([4]);
  });
  it("defines Apple's App Preview size", () => {
    expect(VIDEO_FORMATS["app-preview-portrait"]).toEqual({ width: 886, height: 1920, label: expect.any(String) });
  });
});
