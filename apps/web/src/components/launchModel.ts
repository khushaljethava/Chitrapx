import { MIN_ICON_SOURCE, RECOMMENDED_ICON_SOURCE, type CollageRequest, type MockupDeviceId, type MockupFit } from "@chitrapx/document";

/** An image the launch panels can use (an app upload of kind screenshot or image). */
export type LaunchImage = { id: string; url: string; width: number | null; height: number | null };

/** Why an image cannot be an icon source (blocking), or a warning that it will look soft. */
export function iconSourceIssue(width: number | null, height: number | null): { blocking: boolean; message: string } | null {
  if (!width || !height) return { blocking: true, message: "This image's size could not be read." };
  if (width !== height) return { blocking: true, message: `Icons need a square image; this one is ${width}×${height}.` };
  if (width < MIN_ICON_SOURCE) return { blocking: true, message: `Icons need an image of at least ${MIN_ICON_SOURCE}×${MIN_ICON_SOURCE}.` };
  if (width < RECOMMENDED_ICON_SOURCE) return { blocking: false, message: `Smaller than ${RECOMMENDED_ICON_SOURCE}×${RECOMMENDED_ICON_SOURCE}: large icons may look blurry.` };
  return null;
}

/** The list with item `i` moved one place by `delta` (-1 up, +1 down); the same list when it cannot move. */
export function moveItem<T>(list: T[], i: number, delta: -1 | 1): T[] {
  const j = i + delta;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** Picks or unpicks `id`; new picks go to the end, and nothing is added past `max`. */
export function toggleItem(list: string[], id: string, max: number): string[] {
  if (list.includes(id)) return list.filter((x) => x !== id);
  return list.length >= max ? list : [...list, id];
}

/** The collage request the panel sends. */
export function collageBody(s: { ids: string[]; padding: number | null; from: string; to: string | null; device: MockupDeviceId | null; fit: MockupFit | null }): Partial<CollageRequest> {
  return {
    assetIds: s.ids,
    ...(s.padding === null ? {} : { padding: s.padding }),
    background: s.to ? { from: s.from, to: s.to } : { from: s.from },
    ...(s.device ? { frame: { deviceType: s.device, ...(s.fit ? { fit: s.fit } : {}) } } : {}),
  };
}
