import { describe, expect, it } from "vitest";
import { aabb, resizeBox, rotationFromPointer, snapMove, type Box } from "@/editor/geometry.ts";

const box = (x: number, y: number, w: number, h: number, rotation = 0): Box => ({ x, y, w, h, rotation });
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

describe("resizeBox", () => {
  it("dragging the east handle widens to the right and keeps the left edge", () => {
    const r = resizeBox(box(100, 100, 200, 100), "e", 50, 30, false);
    expect(r).toMatchObject({ x: 100, y: 100, w: 250, h: 100 });
  });

  it("dragging the north-west corner keeps the south-east corner fixed", () => {
    const r = resizeBox(box(100, 100, 200, 100), "nw", -20, -10, false);
    expect(r).toMatchObject({ x: 80, y: 90, w: 220, h: 110 });
  });

  it("aspect lock scales both sides by the dominant drag", () => {
    const r = resizeBox(box(0, 0, 200, 100), "se", 100, 10, true);
    expect(r.w).toBe(300);
    expect(r.h).toBe(150);
  });

  it("never shrinks below the minimum size", () => {
    const r = resizeBox(box(0, 0, 100, 100), "w", 500, 0, false);
    expect(r.w).toBe(8);
    expect(r.x + r.w).toBe(100);
  });

  it("on a rotated box the opposite corner stays put in board space", () => {
    const b = box(100, 100, 200, 100, 90);
    const before = corner(b, 1, 1); // anchor for the nw handle
    const r = resizeBox(b, "nw", 0, -40, false); // board up = element's -x after a 90 degree turn
    close(r.w, 240);
    const after = corner(r, 1, 1);
    close(after.x, before.x);
    close(after.y, before.y);
  });
});

/** Board-space position of a box corner; sx, sy in {-1, 1}. */
function corner(b: Box, sx: number, sy: number) {
  const t = (b.rotation * Math.PI) / 180;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, lx = (sx * b.w) / 2, ly = (sy * b.h) / 2;
  return { x: cx + lx * Math.cos(t) - ly * Math.sin(t), y: cy + lx * Math.sin(t) + ly * Math.cos(t) };
}

describe("rotationFromPointer", () => {
  it("is 0 straight above the centre, 90 to the right, and snaps to 15 with shift", () => {
    close(rotationFromPointer({ x: 0, y: 0 }, { x: 0, y: -10 }, false), 0);
    close(rotationFromPointer({ x: 0, y: 0 }, { x: 10, y: 0 }, false), 90);
    expect(rotationFromPointer({ x: 0, y: 0 }, { x: 10, y: -9 }, true)).toBe(45);
  });
});

describe("aabb", () => {
  it("of a box turned 90 degrees swaps width and height around the centre", () => {
    const a = aabb(box(0, 0, 200, 100, 90));
    close(a.left, 50); close(a.right, 150); close(a.top, -50); close(a.bottom, 150);
  });
});

describe("snapMove", () => {
  it("snaps the box centre to the board centre line within the threshold and reports the guide", () => {
    const r = snapMove(box(590, 300, 100, 100), [], 1290, 2796, 8);
    expect(r.dx).toBe(5); // centre 640 -> 645
    expect(r.guides.x).toEqual([645]);
  });

  it("snaps edges to another element's edge, and does nothing beyond the threshold", () => {
    const other = box(400, 1000, 200, 100);
    const r = snapMove(box(603, 300, 100, 100), [other], 1290, 2796, 8);
    expect(r.dx).toBe(-3); // left 603 -> other's right 600
    const far = snapMove(box(700, 1300, 50, 50), [other], 1290, 2796, 8);
    expect(far).toEqual({ dx: 0, dy: 0, guides: { x: [], y: [] } });
  });
});
