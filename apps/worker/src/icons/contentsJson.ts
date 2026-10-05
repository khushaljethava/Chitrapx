// Structure ported from launch (MIT, Copyright (c) 2025 applogo contributors), src/contents_json.rs:5-55.
import { isApple, type IconEntry } from "./sizes.ts";

/**
 * Xcode's asset catalog index for the Apple entries. launch's non-standard `expected-size` is left
 * out and Xcode's own `info` block added, so the file matches what Xcode writes.
 */
export function contentsJson(entries: IconEntry[]): string {
  const images = entries.filter((e) => isApple(e.platform)).map((e) => ({
    size: e.size, filename: e.filename, idiom: e.idiom, scale: e.scale,
    ...(e.role ? { role: e.role } : {}), ...(e.subtype ? { subtype: e.subtype } : {}),
  }));
  return `${JSON.stringify({ images, info: { version: 1, author: "xcode" } }, null, 2)}\n`;
}
