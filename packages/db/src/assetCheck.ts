import { fileTypeFromBuffer } from "file-type";
import { imageSize } from "image-size";

export type AssetKind = "screenshot" | "image" | "recording";

const MB = 1024 * 1024;
export const UPLOAD_LIMITS = { screenshot: 25 * MB, image: 25 * MB, recording: 500 * MB, font: 10 * MB } as const;
// ponytail: SVG stays out until it is sanitized; fonts arrive with their sub-project.
export const ACCEPTED: Record<AssetKind, readonly string[]> = {
  screenshot: ["image/png", "image/jpeg", "image/webp"],
  image: ["image/png", "image/jpeg", "image/webp"],
  recording: ["video/mp4", "video/quicktime", "video/x-m4v"],
};
/** Bytes kept for type sniffing and image dimensions (JPEG headers can sit after a large EXIF block). */
export const HEAD_BYTES: Record<AssetKind, number> = { screenshot: 512 * 1024, image: 512 * 1024, recording: 64 * 1024 };

/** The real type of uploaded bytes (never the client's claim) and, for images, their size. */
export async function sniffAsset(kind: AssetKind, head: Uint8Array):
  Promise<{ ok: true; mime: string; width?: number; height?: number } | { ok: false; code: "unsupported_type" | "unreadable_image" }> {
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
