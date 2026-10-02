/** Video output sizes. App Preview 886x1920 is Apple's accepted size for iPhone 6.5 and 6.9 inch previews. */
export const VIDEO_FORMATS = {
  "app-preview-portrait": { width: 886, height: 1920, label: "App Preview (portrait)" },
  "app-preview-landscape": { width: 1920, height: 886, label: "App Preview (landscape)" },
  story: { width: 1080, height: 1920, label: "Story (Instagram, TikTok)" },
  square: { width: 1080, height: 1080, label: "Square post" },
} as const;
export type VideoFormat = keyof typeof VIDEO_FORMATS;
export const VIDEO_FORMAT_IDS = Object.keys(VIDEO_FORMATS) as [VideoFormat, ...VideoFormat[]];

export const VIDEO_MIN_SECONDS = 15;
export const VIDEO_MAX_SECONDS = 30;
export const VIDEO_FPS = 30;
const CROSSFADE = 0.4;

export type VideoSlide = { boardIndex: number; start: number; end: number };
export type VideoTimeline = { slides: VideoSlide[]; duration: number; crossfade: number };

/**
 * Boards in order, `secondsPerBoard` each (a board's own `previewDurationSeconds` wins), stretched
 * to Apple's 15 second minimum or cut to the 30 second maximum by dropping trailing boards.
 */
export function videoTimeline(boards: Array<{ previewDurationSeconds?: number }>, secondsPerBoard: number): VideoTimeline {
  let durations = boards.map((b) => Math.max(0.5, b.previewDurationSeconds ?? secondsPerBoard));
  const total = durations.reduce((a, d) => a + d, 0);
  if (total < VIDEO_MIN_SECONDS) durations = durations.map((d) => (d * VIDEO_MIN_SECONDS) / total);
  const slides: VideoSlide[] = [];
  let t = 0;
  for (const [i, d] of durations.entries()) {
    if (t >= VIDEO_MAX_SECONDS) break;
    const end = Math.min(VIDEO_MAX_SECONDS, t + d);
    slides.push({ boardIndex: i, start: t, end });
    t = end;
  }
  const shortest = Math.min(...slides.map((s) => s.end - s.start));
  return { slides, duration: t, crossfade: Math.min(CROSSFADE, shortest / 2) };
}

export type FrameLayer = { boardIndex: number; localTime: number; opacity: number };

/** The board layers visible at time `t`: one, or two during the crossfade into the next board. */
export function framesAt(tl: VideoTimeline, t: number): FrameLayer[] {
  const i = Math.max(0, tl.slides.findIndex((s) => t < s.end));
  const idx = tl.slides[i] && t < tl.slides[i]!.end ? i : tl.slides.length - 1;
  const cur = tl.slides[idx]!;
  const layers: FrameLayer[] = [{ boardIndex: cur.boardIndex, localTime: Math.max(0, t - cur.start), opacity: 1 }];
  const next = tl.slides[idx + 1];
  if (next && t > cur.end - tl.crossfade) {
    // The next board fades in over the current one; its animations start as the fade begins.
    const into = t - (cur.end - tl.crossfade);
    layers.push({ boardIndex: next.boardIndex, localTime: into, opacity: Math.min(1, into / tl.crossfade) });
  }
  return layers;
}
