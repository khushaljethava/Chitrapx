import { useMemo } from "react";
import type { ChitrapxDoc } from "@chitrapx/document";
import { boardFor } from "./board.ts";
import { BoardFonts } from "./fonts.tsx";
import { StaticArtboard } from "./osg/StaticArtboard";
import type { ResolveSrc } from "./sources.ts";

export type BoardViewProps = {
  doc: ChitrapxDoc;
  groupId: string;
  boardIndex: number;
  locale: string | null;
  scale: number;
  resolveSrc: ResolveSrc;
};

/** One board exactly as it exports, at `scale`. Props only: no stores, no fetching. */
export function BoardView({ doc, groupId, boardIndex, locale, scale, resolveSrc }: BoardViewProps) {
  const { board } = useMemo(() => boardFor(doc, groupId, boardIndex, locale, resolveSrc), [doc, groupId, boardIndex, locale, resolveSrc]);
  return (
    <>
      <BoardFonts boards={[board]} />
      <StaticArtboard artboard={board} scale={scale} />
    </>
  );
}
