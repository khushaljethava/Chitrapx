export type LayoutPreset = "text-top" | "text-middle" | "text-bottom" | "phone-center" | "phone-hero" | "phone-bleed" | "phone-tilt";
export const LAYOUT_PRESETS = ["text-top", "text-middle", "text-bottom", "phone-center", "phone-hero", "phone-bleed", "phone-tilt"] as const satisfies readonly LayoutPreset[];
export const presetKind = (p: LayoutPreset): "text" | "phone" => (p.startsWith("text-") ? "text" : "phone");

const TEXT_WIDTH = 0.88;
const MARGIN = 0.06;
const MAX_DEVICE_WIDTH = 0.9;
/** Device height and top edge as fractions of the board; `top: null` centres vertically. */
const PHONE: Record<string, { height: number; top: number | null; dx: number; rotation: number }> = {
  "phone-center": { height: 0.8, top: null, dx: 0, rotation: 0 },
  "phone-hero": { height: 0.85, top: 0.28, dx: 0, rotation: 0 },
  "phone-bleed": { height: 0.95, top: 0.4, dx: 0, rotation: 0 },
  "phone-tilt": { height: 0.72, top: 0.18, dx: 0.04, rotation: -12 },
};

type Box = { position: { x: number; y: number }; size: { width: number; height: number }; rotation: number };
const round = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * Where a preset puts an element on a board. Pure: the result depends only on the board and the
 * element's aspect, so applying a preset twice changes nothing. Sizes are the element's base size
 * (displayed size divided by `scale`).
 */
export function layoutFor(preset: LayoutPreset, board: { width: number; height: number }, el: { size: { width: number; height: number }; scale?: number }): Box {
  const W = board.width, H = board.height, s = el.scale || 1;
  if (presetKind(preset) === "text") {
    const w = TEXT_WIDTH * W, h = el.size.height * s;
    const y = preset === "text-top" ? MARGIN * H : preset === "text-bottom" ? H - h - MARGIN * H : (H - h) / 2;
    return { position: { x: round((W - w) / 2), y: round(y) }, size: { width: round(w / s), height: round(h / s) }, rotation: 0 };
  }
  const spec = PHONE[preset]!;
  const aspect = el.size.width / el.size.height;
  let h = spec.height * H, w = h * aspect;
  if (w > MAX_DEVICE_WIDTH * W) { w = MAX_DEVICE_WIDTH * W; h = w / aspect; }
  const x = (W - w) / 2 + spec.dx * W;
  const y = spec.top === null ? (H - h) / 2 : spec.top * H;
  return { position: { x: round(x), y: round(y) }, size: { width: round(w / s), height: round(h / s) }, rotation: spec.rotation };
}
