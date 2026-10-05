import { fileTypeFromBuffer } from "file-type";
import { imageSize } from "image-size";
import type { FontFormat } from "@chitrapx/document";

export type AssetKind = "screenshot" | "image" | "recording" | "font" | "reference";

const MB = 1024 * 1024;
export const UPLOAD_LIMITS = { screenshot: 25 * MB, image: 25 * MB, recording: 500 * MB, font: 10 * MB, reference: 25 * MB } as const;
// ponytail: SVG stays out until it is sanitized.
export const ACCEPTED: Record<AssetKind, readonly string[]> = {
  screenshot: ["image/png", "image/jpeg", "image/webp"],
  image: ["image/png", "image/jpeg", "image/webp"],
  recording: ["video/mp4", "video/quicktime", "video/x-m4v"],
  font: ["font/ttf", "font/otf", "font/woff", "font/woff2"],
  reference: ["image/png", "image/jpeg", "image/webp"],
};
/** Bytes kept for type sniffing and image dimensions (JPEG headers can sit after a large EXIF block). Fonts are parsed whole. */
export const HEAD_BYTES: Record<AssetKind, number> = { screenshot: 512 * 1024, image: 512 * 1024, recording: 64 * 1024, font: UPLOAD_LIMITS.font, reference: 512 * 1024 };

/** A font's real format from its first four bytes; the client's MIME type and file name are never used. */
export function sniffFontType(head: Uint8Array): { mime: string; format: FontFormat } | null {
  if (head.length < 4) return null;
  const tag = String.fromCharCode(head[0]!, head[1]!, head[2]!, head[3]!);
  if (tag === "\0\x01\0\0" || tag === "true") return { mime: "font/ttf", format: "ttf" };
  if (tag === "OTTO") return { mime: "font/otf", format: "otf" };
  if (tag === "wOFF") return { mime: "font/woff", format: "woff" };
  if (tag === "wOF2") return { mime: "font/woff2", format: "woff2" };
  return null;
}

/** The real type of uploaded bytes (never the client's claim) and, for images, their size. */
export async function sniffAsset(kind: AssetKind, head: Uint8Array):
  Promise<{ ok: true; mime: string; width?: number; height?: number } | { ok: false; code: "unsupported_type" | "unreadable_image" }> {
  if (kind === "font") {
    const f = sniffFontType(head);
    return f ? { ok: true, mime: f.mime } : { ok: false, code: "unsupported_type" };
  }
  const type = await fileTypeFromBuffer(head);
  if (!type || !ACCEPTED[kind].includes(type.mime)) return { ok: false, code: "unsupported_type" };
  if (kind === "recording") return { ok: true, mime: type.mime };
  try {
    const { width, height } = imageSize(head);
    return { ok: true, mime: type.mime, width, height };
  } catch {
    return { ok: false, code: "unreadable_image" };
  }
}
