import type { ArtboardElement, DeviceType } from "./artboard.ts";
import { DEFAULT_BASE_LOCALE, type ChitrapxDoc } from "./doc.ts";
import type { ExportSelection } from "./exportPlan.ts";
import { getTarget, type TargetId } from "./targets.ts";

/**
 * SP12 quick mockups: device geometry for building one-device boards on the server.
 * Mirrors packages/renderer/src/osg/lib/deviceRegistry.ts (pinned by a renderer test), which the
 * server cannot import because it is a React package. Insets are % of the device's width.
 */
type Insets = { top: number; right: number; bottom: number; left: number };
export type MockupCategory = "phone" | "tablet" | "watch" | "desktop" | "vehicle";
export type MockupDevice = { label: string; category: MockupCategory; nativeAspect: number; screen: Insets };
export type MockupDeviceId = Exclude<DeviceType, "custom">;

const d = (label: string, category: MockupCategory, nativeAspect: number, top: number, right: number, bottom: number, left: number): MockupDevice =>
  ({ label, category, nativeAspect, screen: { top, right, bottom, left } });

export const MOCKUP_DEVICES: Record<MockupDeviceId, MockupDevice> = {
  "iphone": d("iPhone (Classic)", "phone", 390 / 844, 3.5, 3.5, 3.5, 3.5),
  "iphone-x": d("iPhone X", "phone", 375 / 812, 3, 3, 3, 3),
  "iphone-13": d("iPhone 13", "phone", 390 / 844, 3, 3, 3, 3),
  "iphone-14": d("iPhone 14", "phone", 390 / 844, 3, 3, 3, 3),
  "iphone-15": d("iPhone 15", "phone", 390 / 844, 2.5, 3, 2.5, 3),
  "iphone-15-pro": d("iPhone 15 Pro", "phone", 390 / 844, 2.5, 3, 2.5, 3),
  "iphone-17-pro-max": d("iPhone 17 Pro Max", "phone", 440 / 956, 2.4, 2.8, 2.4, 2.8),
  "ipad-pro-13": d("iPad Pro 13-inch", "tablet", 2064 / 2752, 3.2, 3.2, 3.2, 3.2),
  "ipad-11": d("iPad 11-inch", "tablet", 1668 / 2420, 3.6, 3.6, 3.6, 3.6),
  "apple-watch": d("Apple Watch", "watch", 39 / 46, 10, 10, 10, 10),
  "android-bar": d("Android (Bar)", "phone", 1080 / 2340, 6, 3, 3, 3),
  "android-notch": d("Android (Notch)", "phone", 1080 / 2340, 3, 3, 3, 3),
  "android-punch-hole": d("Android (Punch Hole)", "phone", 1080 / 2400, 3, 3, 3, 3),
  "tablet": d("Tablet", "tablet", 768 / 1024, 2.5, 2.5, 2.5, 2.5),
  "tablet-7": d("7-inch Tablet", "tablet", 800 / 1280, 4.5, 4.5, 4.5, 4.5),
  "tablet-10": d("10-inch Tablet", "tablet", 1600 / 2560, 3, 3, 3, 3),
  "desktop": d("Desktop Monitor", "desktop", 16 / 9, 1.5, 1.5, 3.5, 1.5),
  "macbook": d("MacBook", "desktop", 100 / 57.9, 2, 10, 5.9, 10),
  "imac": d("iMac", "desktop", 100 / 74.2, 1.5, 1.5, 18.1, 1.5),
  "carplay": d("CarPlay", "vehicle", 800 / 480, 1.6, 1.6, 1.6, 1.6),
};
export const MOCKUP_DEVICE_IDS = Object.keys(MOCKUP_DEVICES) as [MockupDeviceId, ...MockupDeviceId[]];

/** "fit" shows the whole screenshot (contain), "fill" covers the screen and crops (cover). */
export const MOCKUP_FITS = ["fit", "fill"] as const;
export type MockupFit = (typeof MOCKUP_FITS)[number];
/**
 * Screenshots whose shape differs from the screen's by more than this must choose fit or fill.
 * The frames are drawn, not traced from hardware: a real 1170x2532 iPhone shot is 4% off the
 * iPhone 15 frame's screen, and filling it crops only a sliver, so small differences just fill.
 */
export const FIT_TOLERANCE = 0.06;

/** Width / height of the device's screen area. */
export function screenAspect(id: MockupDeviceId): number {
  const { nativeAspect, screen } = MOCKUP_DEVICES[id];
  return (1 - (screen.left + screen.right) / 100) / (1 / nativeAspect - (screen.top + screen.bottom) / 100);
}

export function needsFitChoice(id: MockupDeviceId, width: number, height: number): boolean {
  return Math.abs(width / height / screenAspect(id) - 1) > FIT_TOLERANCE;
}

/** The store size each kind of device is drawn on; any target works, these give big, well-shaped boards. */
const BOARD: Record<MockupCategory, TargetId> = { phone: "iphone-6.9-1320", tablet: "ipad-13", watch: "instagram-post", desktop: "mac-2880", vehicle: "mac-2880" };
/** The device fills this share of the board's limiting side. */
const FILL = 0.88;

export type MockupShot = { src: string; fit?: MockupFit };
export type Crop = { left: number; top: number; width: number; height: number };

/**
 * A document with one board per shot, each holding the shot inside a flat device frame, plus the
 * area of each board to keep: the device and a margin of `margin` x its width. Boards are
 * transparent unless a background colour is given. Nothing is stored; the job carries it.
 */
export function mockupDoc(shots: MockupShot[], opts: { deviceType: MockupDeviceId; background?: string; margin?: number }):
  { doc: ChitrapxDoc; selection: ExportSelection; crops: Crop[] } {
  const device = MOCKUP_DEVICES[opts.deviceType];
  const target = getTarget(BOARD[device.category])!;
  const W = target.width, H = target.height;
  const ew = Math.round(Math.min(W * FILL, H * FILL * device.nativeAspect));
  const eh = Math.round(ew / device.nativeAspect);
  const x = Math.round((W - ew) / 2), y = Math.round((H - eh) / 2);
  const m = Math.min(Math.round(ew * (opts.margin ?? 0.06)), x, y);
  const boards = shots.map((shot, i) => ({
    id: `shot-${i + 1}`, name: `Shot ${i + 1}`, position: { x: 0, y: 0 }, size: { width: W, height: H },
    backgroundColor: opts.background ?? "transparent", zoom: 1,
    elements: [{
      id: "device", type: "device", name: device.label, position: { x, y }, size: { width: ew, height: eh }, rotation: 0, scale: 1,
      deviceType: opts.deviceType, styleType: "normal", screenshotSrc: shot.src, screenshotObjectFit: shot.fit === "fit" ? "contain" : "cover",
      screenshotRect: { left: 0, top: 0, width: 100, height: 100 },
    } as unknown as ArtboardElement],
  }));
  const doc: ChitrapxDoc = {
    schemaVersion: 1, kind: "screenshots",
    groups: [{ id: "mockup", target: target.id as TargetId, boards, spanElements: [] }],
    localization: { baseLocale: DEFAULT_BASE_LOCALE, locales: [] },
  };
  const crop = { left: x - m, top: y - m, width: ew + 2 * m, height: eh + 2 * m };
  return { doc, selection: { targets: [target.id as TargetId], locales: [DEFAULT_BASE_LOCALE] }, crops: shots.map(() => ({ ...crop })) };
}
