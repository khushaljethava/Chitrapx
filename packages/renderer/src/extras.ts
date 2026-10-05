import type { FontFormat } from "@chitrapx/document";

/** An uploaded font face as a render page needs it: a signed URL it may load (from the uploads bucket, allow-listed for exports). */
export type CustomFontFace = { family: string; weight: number; italic: boolean; format: FontFormat; url: string };
/** Workspace data a board needs beyond its document. Every render surface (canvas, previews, export, video) receives the same value. */
export type RenderExtras = { faces?: CustomFontFace[] };
