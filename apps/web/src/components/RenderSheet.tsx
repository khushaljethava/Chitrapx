"use client";

import { useEffect, useMemo, useState } from "react";
import { resolveGroup, type ChitrapxDoc, type ExportItem } from "@chitrapx/document";
import { BoardFonts, boardFor, clearLocaleFontSizeCache, fontUsesOf, StaticArtboard, waitForRender, type RenderExtras } from "@chitrapx/renderer";

declare global {
  interface Window { __chitrapxReady?: { ok: boolean; errors: string[] } }
}

/** Every requested board at 1:1, one after another, each wrapped in [data-item] for the worker. */
export function RenderSheet({ doc, plan, indices, assetUrls, extras, transparent = false }: {
  doc: ChitrapxDoc; plan: ExportItem[]; indices: number[]; assetUrls: Record<string, string>; extras?: RenderExtras;
  /** SP12 mockups and collage frames: no page colour behind the boards, so a transparent board stays transparent. */
  transparent?: boolean;
}) {
  // Auto-shrink measures text with whatever face is loaded. The first pass runs before the faces arrive,
  // so once they have loaded the sizes are measured again before anything is captured.
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const boards = useMemo(() => {
    void fontsLoaded; // re-measure once the faces are in
    const cache = new Map();
    return indices.map((i) => {
      const item = plan[i]!;
      // A derived size draws its source group retargeted in memory; the saved document never changes.
      const g = resolveGroup(doc, item, cache);
      // Only this workspace's signed assets: the worker's browser must never fetch a URL a document names (SSRF).
      return { i, ...boardFor({ ...doc, groups: [g] }, g.id, item.boardIndex, item.locale, (src) => assetUrls[src] ?? null, { palette: extras?.palette }) };
    });
  }, [doc, plan, indices, assetUrls, extras?.palette, fontsLoaded]);
  // Recordings still converting render as placeholders instead of failing the export.
  const missing = useMemo(() => [...new Set(boards.flatMap((b) => b.missing))], [boards]);

  useEffect(() => {
    if (fontsLoaded) return;
    let cancelled = false;
    const families = fontUsesOf(boards.map((b) => b.board)).map((u) => u.family);
    Promise.all(families.map((f) => document.fonts.load(`16px "${f}"`).catch(() => [])))
      .then(() => document.fonts.ready)
      .then(() => { if (!cancelled) { clearLocaleFontSizeCache(); setFontsLoaded(true); } });
    return () => { cancelled = true; };
  }, [boards, fontsLoaded]);

  useEffect(() => {
    if (!fontsLoaded) return;
    let cancelled = false;
    waitForRender(document).then((r) => {
      if (cancelled) return;
      const errors = [...missing.map((m) => `asset_missing:${m}`), ...r.errors];
      window.__chitrapxReady = { ok: errors.length === 0, errors };
    });
    return () => { cancelled = true; };
  }, [missing, fontsLoaded]);

  return (
    <main style={{ background: transparent ? "transparent" : "#fff", padding: 0, margin: 0 }}>
      {/* The Next.js dev indicator would otherwise be captured into exported PNGs. */}
      <style>{`nextjs-portal{display:none!important}${transparent ? "html,body{background:transparent!important}" : ""}`}</style>
      <BoardFonts boards={boards.map((b) => b.board)} faces={extras?.faces} />
      {boards.map(({ i, board }) => (
        <div key={i} data-item={i} style={{ width: board.size.width, height: board.size.height, overflow: "hidden" }}>
          <StaticArtboard artboard={board} scale={1} />
        </div>
      ))}
    </main>
  );
}
