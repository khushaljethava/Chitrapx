/** Editor geometry in board pixels. Rotation is degrees clockwise about the box centre. */
export type Box = { x: number; y: number; w: number; h: number; rotation: number };
export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type Point = { x: number; y: number };

export const MIN_SIZE = 8;
const rad = (deg: number) => (deg * Math.PI) / 180;
const rotate = (p: Point, deg: number): Point => {
  const t = rad(deg);
  return { x: p.x * Math.cos(t) - p.y * Math.sin(t), y: p.x * Math.sin(t) + p.y * Math.cos(t) };
};
const SIGNS: Record<Handle, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], ne: [1, -1], nw: [-1, -1], se: [1, 1], sw: [-1, 1] };

/**
 * New box after dragging `handle` by (dx, dy) board pixels. The opposite edge or corner stays
 * fixed in board space, also when the box is rotated. `lockAspect` scales both sides together.
 */
export function resizeBox(b: Box, handle: Handle, dx: number, dy: number, lockAspect: boolean): Box {
  const [sx, sy] = SIGNS[handle];
  const local = rotate({ x: dx, y: dy }, -b.rotation);
  let w = sx ? Math.max(MIN_SIZE, b.w + sx * local.x) : b.w;
  let h = sy ? Math.max(MIN_SIZE, b.h + sy * local.y) : b.h;
  if (lockAspect) {
    const fx = sx ? w / b.w : 0;
    const fy = sy ? h / b.h : 0;
    const f = Math.max(MIN_SIZE / Math.min(b.w, b.h), Math.abs(fx - 1) >= Math.abs(fy - 1) ? fx || fy : fy || fx);
    w = b.w * f;
    h = b.h * f;
  }
  // Keep the anchor (the point opposite the handle) where it was.
  const center = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const anchorOffset = rotate({ x: (-sx * b.w) / 2, y: (-sy * b.h) / 2 }, b.rotation);
  const anchor = { x: center.x + anchorOffset.x, y: center.y + anchorOffset.y };
  const back = rotate({ x: (-sx * w) / 2, y: (-sy * h) / 2 }, b.rotation);
  const c = { x: anchor.x - back.x, y: anchor.y - back.y };
  return { x: c.x - w / 2, y: c.y - h / 2, w, h, rotation: b.rotation };
}

/** Degrees for a rotate handle dragged to `pointer`: 0 when straight above the centre. Shift snaps to 15. */
export function rotationFromPointer(center: Point, pointer: Point, snap: boolean): number {
  let deg = (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI + 90;
  deg = ((deg % 360) + 360) % 360;
  if (deg > 180) deg -= 360;
  return snap ? Math.round(deg / 15) * 15 : deg;
}

/** Axis-aligned bounds of a (possibly rotated) box. */
export function aabb(b: Box) {
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => rotate({ x: (sx! * b.w) / 2, y: (sy! * b.h) / 2 }, b.rotation));
  const xs = pts.map((p) => c.x + p.x), ys = pts.map((p) => c.y + p.y);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

/**
 * Nudge for a moving box so one of its edges or its centre lines up with the board's edges or
 * centre, or another element's edges or centre, when within `threshold` board pixels.
 */
export function snapMove(moving: Box, others: Box[], boardW: number, boardH: number, threshold: number) {
  const m = aabb(moving);
  const lines = (lo: number, hi: number) => [lo, (lo + hi) / 2, hi];
  const targetsX = [0, boardW / 2, boardW, ...others.flatMap((o) => { const a = aabb(o); return lines(a.left, a.right); })];
  const targetsY = [0, boardH / 2, boardH, ...others.flatMap((o) => { const a = aabb(o); return lines(a.top, a.bottom); })];
  const best = (mine: number[], targets: number[]) => {
    let pick: { d: number; at: number } | null = null;
    for (const v of mine) for (const t of targets) {
      const d = t - v;
      if (Math.abs(d) <= threshold && (!pick || Math.abs(d) < Math.abs(pick.d))) pick = { d, at: t };
    }
    return pick;
  };
  const sx = best(lines(m.left, m.right), targetsX);
  const sy = best(lines(m.top, m.bottom), targetsY);
  return { dx: sx?.d ?? 0, dy: sy?.d ?? 0, guides: { x: sx ? [sx.at] : [], y: sy ? [sy.at] : [] } };
}

/** A frame of `aspect` (width/height) at `widthPct` of the board's width, centred: how a landscape frame sits on a portrait board. */
export function fitLandscape(board: { width: number; height: number }, aspect: number, widthPct = 0.9) {
  const width = Math.round(board.width * widthPct * 10) / 10;
  const height = Math.round((width / aspect) * 10) / 10;
  return { position: { x: Math.round(((board.width - width) / 2) * 10) / 10, y: Math.round(((board.height - height) / 2) * 10) / 10 }, size: { width, height } };
}
