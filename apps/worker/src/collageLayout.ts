// Grid rules ported from launch (MIT, Copyright (c) 2025 applogo contributors), src/collage.rs:50-97.

/** The collage's longest side; bigger layouts are scaled down before compositing to bound memory. */
export const MAX_COLLAGE_EDGE = 8192;

export function gridSize(n: number): { cols: number; rows: number } {
  const cols = Math.ceil(Math.sqrt(n));
  return { cols, rows: Math.ceil(n / cols) };
}

/** 3% of the cell width, grown by 40% per extra row or column (launch's padding heuristic). */
export function defaultPadding(cellW: number, cols: number, rows: number): number {
  return Math.floor(Math.floor(cellW * 0.03) * (1 + (Math.max(cols, rows) - 1) * 0.4));
}

/** Cell origins, left to right then top to bottom, and the canvas size. */
export function layoutGrid(n: number, cellW: number, cellH: number, padding: number) {
  const { cols, rows } = gridSize(n);
  const cells = Array.from({ length: n }, (_, i) => ({
    x: padding + (i % cols) * (cellW + padding),
    y: padding + Math.floor(i / cols) * (cellH + padding),
  }));
  return { cols, rows, cellW, cellH, padding, width: cols * cellW + (cols + 1) * padding, height: rows * cellH + (rows + 1) * padding, cells };
}
export type CollageLayout = ReturnType<typeof layoutGrid>;

/** `layoutGrid`, with cells and padding scaled down together when the canvas would pass MAX_COLLAGE_EDGE. */
export function collageLayout(n: number, cellW: number, cellH: number, padding: number): CollageLayout {
  const full = layoutGrid(n, cellW, cellH, padding);
  const s = MAX_COLLAGE_EDGE / Math.max(full.width, full.height);
  if (s >= 1) return full;
  return layoutGrid(n, Math.max(1, Math.floor(cellW * s)), Math.max(1, Math.floor(cellH * s)), Math.floor(padding * s));
}

/** The largest size of a w x h image inside a cell, aspect kept, and its offset to sit centred (Chitrapx does not stretch). */
export function fitInside(w: number, h: number, cellW: number, cellH: number) {
  const s = Math.min(cellW / w, cellH / h);
  const width = Math.max(1, Math.round(w * s)), height = Math.max(1, Math.round(h * s));
  return { width, height, left: Math.floor((cellW - width) / 2), top: Math.floor((cellH - height) / 2) };
}
