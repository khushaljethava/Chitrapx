import { useMemo } from "react";
import type { ChitrapxDoc } from "@chitrapx/document";
import { boardFor } from "./board.ts";
import { BoardFonts } from "./fonts.tsx";
import { StaticArtboard } from "./osg/StaticArtboard";
import type { RenderExtras } from "./extras.ts";
import type { ResolveSrc } from "./sources.ts";

export type BoardViewProps = {
  doc: ChitrapxDoc;
  groupId: string;
  boardIndex: number;
  locale: string | null;
  scale: number;
  resolveSrc: ResolveSrc;
  /** Workspace data beyond the document (uploaded fonts). */
  extras?: RenderExtras;
  /** Draw a generic app screen in empty devices (template previews only; never for export). */
  placeholders?: boolean;
};

/** One board exactly as it exports, at `scale`. Props only: no stores, no fetching. */
export function BoardView({ doc, groupId, boardIndex, locale, scale, resolveSrc, extras, placeholders }: BoardViewProps) {
  const { board } = useMemo(() => boardFor(doc, groupId, boardIndex, locale, resolveSrc, { palette: extras?.palette, placeholders }),
    [doc, groupId, boardIndex, locale, resolveSrc, extras?.palette, placeholders]);
  return (
    <>
      <BoardFonts boards={[board]} faces={extras?.faces} />
      <StaticArtboard artboard={board} scale={scale} />
    </>
  );
}
