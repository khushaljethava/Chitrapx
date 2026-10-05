import sharp from "sharp";

/**
 * Resizes one source to icon sizes, each `(size, flatten)` pair once (launch/src/resize.rs:85-100).
 * Flattened icons are composited on white and written RGB; the rest are always RGBA.
 * sharp's default kernel is Lanczos3, as in launch.
 */
export function iconResizer(src: Buffer) {
  const cache = new Map<string, Promise<Buffer>>();
  return (size: number, flatten: boolean): Promise<Buffer> => {
    const key = `${size}:${flatten}`;
    let out = cache.get(key);
    if (!out) {
      const img = sharp(src);
      out = (flatten ? img.flatten({ background: "#ffffff" }).removeAlpha() : img.ensureAlpha())
        .resize(size, size, { kernel: "lanczos3", fit: "fill" }).png().toBuffer();
      cache.set(key, out);
    }
    return out;
  };
}
