"use client";

import { useEffect, useMemo } from "react";
import type { ChitrapxDoc, ExportItem } from "@chitrapx/document";
import { BoardFonts, boardFor, StaticArtboard, waitForRender } from "@chitrapx/renderer";

declare global {
  interface Window { __chitrapxReady?: { ok: boolean; errors: string[] } }
}

/** Every requested board at 1:1, one after another, each wrapped in [data-item] for the worker. */
export function RenderSheet({ doc, plan, indices, assetUrls }: {
  doc: ChitrapxDoc; plan: ExportItem[]; indices: number[]; assetUrls: Record<string, string>;
}) {
  const boards = useMemo(() => indices.map((i) => {
    const item = plan[i]!;
    // Only this workspace's signed assets: the worker's browser must never fetch a URL a document names (SSRF).
    return { i, ...boardFor(doc, item.groupId, item.boardIndex, item.locale, (src) => assetUrls[src] ?? null) };
  }), [doc, plan, indices, assetUrls]);
  // Recordings still converting render as placeholders instead of failing the export.
  const missing = useMemo(() => [...new Set(boards.flatMap((b) => b.missing))], [boards]);

  useEffect(() => {
    let cancelled = false;
    waitForRender(document).then((r) => {
      if (cancelled) return;
      const errors = [...missing.map((m) => `asset_missing:${m}`), ...r.errors];
      window.__chitrapxReady = { ok: errors.length === 0, errors };
    });
    return () => { cancelled = true; };
  }, [missing]);

  return (
    <main style={{ background: "#fff", padding: 0, margin: 0 }}>
      {/* The Next.js dev indicator would otherwise be captured into exported PNGs. */}
      <style>{"nextjs-portal{display:none!important}"}</style>
      <BoardFonts boards={boards.map((b) => b.board)} />
      {boards.map(({ i, board }) => (
        <div key={i} data-item={i} style={{ width: board.size.width, height: board.size.height, overflow: "hidden" }}>
          <StaticArtboard artboard={board} scale={1} />
        </div>
      ))}
    </main>
  );
}
