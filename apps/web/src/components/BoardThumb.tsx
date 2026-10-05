"use client";

import type { ChitrapxDoc } from "@chitrapx/document";
import { BoardView, type RenderExtras, type ResolveSrc } from "@chitrapx/renderer";
import { LazyMount } from "./LazyMount.tsx";

/** A board scaled to a fixed height, mounted only while visible. */
export function BoardThumb({ doc, groupId, boardIndex, locale, height, resolveSrc, extras }: {
  doc: ChitrapxDoc; groupId: string; boardIndex: number; locale: string | null; height: number; resolveSrc: ResolveSrc; extras?: RenderExtras;
}) {
  const board = doc.groups.find((g) => g.id === groupId)?.boards[boardIndex];
  if (!board) return null;
  const scale = height / board.size.height;
  return (
    <LazyMount width={Math.round(board.size.width * scale)} height={height}>
      <BoardView doc={doc} groupId={groupId} boardIndex={boardIndex} locale={locale} scale={scale} resolveSrc={resolveSrc} extras={extras} />
    </LazyMount>
  );
}
