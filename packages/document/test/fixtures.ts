import type { ArtboardElement, ArtboardState, BoardGroup, ChitrapxDoc } from "../src/index.ts";

export const device = (id: string, x: number, screenshotSrc = ""): ArtboardElement =>
  ({ id, type: "device", name: id, position: { x, y: 400 }, size: { width: 600, height: 1200 }, rotation: 0, scale: 1, deviceType: "iphone-15", screenshotSrc } as unknown as ArtboardElement);
export const text = (id: string, x: number, y: number): ArtboardElement =>
  ({ id, type: "text", name: id, position: { x, y }, size: { width: 800, height: 200 }, rotation: 0, scale: 1, content: "Hello", fontSize: 120, fontFamily: "Inter", fontWeight: "700", color: "#000", textAlign: "center" } as unknown as ArtboardElement);
export const board = (id: string, elements: ArtboardElement[], width = 1290, height = 2796): ArtboardState =>
  ({ id, name: id, position: { x: 0, y: 0 }, size: { width, height }, elements, backgroundColor: "#fff", zoom: 1 });
export const doc = (groups: BoardGroup[]): ChitrapxDoc =>
  ({ schemaVersion: 1, kind: "screenshots", groups, localization: { baseLocale: "en-US", locales: [] } });
export const group = (boards: ArtboardState[], spanElements: ArtboardElement[] = []): BoardGroup =>
  ({ id: "g1", target: "iphone-6.9", boards, spanElements });
