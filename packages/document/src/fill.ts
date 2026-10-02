import type { ArtboardElement } from "./artboard.ts";
import type { ChitrapxDoc } from "./doc.ts";

export const assetSrc = (assetId: string) => `asset:${assetId}`;
export const assetIdFromSrc = (src: string | undefined | null): string | null =>
  src?.startsWith("asset:") ? src.slice("asset:".length) : null;

const isScreen = (el: ArtboardElement) => el.type === "device" || el.type === "video-device";

/**
 * Puts screenshots into empty device screens in reading order (group, board, then left to right).
 * Devices that already show something are left alone; extra screenshots are ignored.
 */
export function fillScreenshots(doc: ChitrapxDoc, assetIds: string[]): ChitrapxDoc {
  let next = 0;
  const groups = doc.groups.map((g) => ({
    ...g,
    boards: g.boards.map((b) => {
      const order = b.elements
        .map((el, i) => ({ el, i }))
        .filter(({ el }) => isScreen(el) && !(el as { screenshotSrc?: string }).screenshotSrc)
        .sort((a, z) => a.el.position.x - z.el.position.x);
      const elements = [...b.elements];
      for (const { el, i } of order) {
        if (next >= assetIds.length) break;
        elements[i] = { ...el, screenshotSrc: assetSrc(assetIds[next++]!) } as ArtboardElement;
      }
      return { ...b, elements };
    }),
  }));
  return { ...doc, groups };
}
