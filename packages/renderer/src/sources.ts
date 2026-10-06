import { stockUrl, type ArtboardElement, type ArtboardState } from "@chitrapx/document";

/** Maps a document source (`asset:<id>`, https, data:) to a URL the browser can load; null if unavailable. */
export type ResolveSrc = (src: string) => string | null;

const ELEMENT_SRC_KEYS = ["screenshotSrc", "imageSrc", "posterSrc", "customFrameSrc", "videoSrc"] as const;

/** Replaces every source on a board with a loadable URL. Unresolvable sources are dropped and reported. */
export function resolveBoardSources(board: ArtboardState, resolveSrc: ResolveSrc, missing: Set<string>): ArtboardState {
  const fix = (src: unknown): string | undefined => {
    if (typeof src !== "string" || !src) return undefined;
    // Stock template photos are app files, the same for every workspace: resolved here, once, for every caller.
    const url = src.startsWith("stock:") ? stockUrl(src) : resolveSrc(src);
    if (!url) missing.add(src);
    return url ?? undefined;
  };
  const elements = board.elements.map((el) => {
    const out: Record<string, unknown> = { ...el };
    for (const key of ELEMENT_SRC_KEYS) if (key in out) out[key] = fix(out[key]);
    return out as unknown as ArtboardElement;
  });
  return { ...board, elements, ...(board.backgroundImage !== undefined && { backgroundImage: fix(board.backgroundImage) }) };
}

/** Passes through URLs the browser can load directly; everything else needs the caller's resolver. */
export const passthroughSrc: ResolveSrc = (src) => (/^(https?:|data:|blob:)/.test(src) ? src : null);
