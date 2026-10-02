import { useMemo } from "react";
import { framesAt, type ChitrapxDoc, type VideoTimeline } from "@chitrapx/document";
import { boardFor } from "./board.ts";
import { BoardFonts } from "./fonts.tsx";
import { defaultAnimations } from "./motion.ts";
import { StaticArtboard } from "./osg/StaticArtboard";
import type { ResolveSrc } from "./sources.ts";

export type VideoFrameProps = {
  doc: ChitrapxDoc;
  groupId: string;
  locale: string | null;
  timeline: VideoTimeline;
  /** Seconds since the start of the video. */
  time: number;
  /** Output size in CSS pixels; boards are fitted and letterboxed with their background. */
  width: number;
  height: number;
  resolveSrc: ResolveSrc;
};

/** One video frame: the current board (and the next one during a crossfade) with animations at `time`. */
export function VideoFrame({ doc, groupId, locale, timeline, time, width, height, resolveSrc }: VideoFrameProps) {
  const group = doc.groups.find((g) => g.id === groupId);
  const boards = useMemo(() => (group?.boards ?? []).map((_, i) => {
    const b = boardFor(doc, groupId, i, locale, resolveSrc).board;
    return { ...b, elements: defaultAnimations(b.elements) };
  }), [doc, group, groupId, locale, resolveSrc]);
  const layers = framesAt(timeline, time);
  return (
    <div style={{ position: "relative", width, height, overflow: "hidden", background: "#000" }}>
      <BoardFonts boards={boards} />
      {layers.map(({ boardIndex, localTime, opacity }) => {
        const b = boards[boardIndex];
        if (!b) return null;
        const scale = Math.min(width / b.size.width, height / b.size.height);
        return (
          <div key={boardIndex} style={{ position: "absolute", inset: 0, opacity, display: "flex", alignItems: "center", justifyContent: "center", background: b.backgroundColor }}>
            <StaticArtboard artboard={b} scale={scale} time={localTime} />
          </div>
        );
      })}
    </div>
  );
}
