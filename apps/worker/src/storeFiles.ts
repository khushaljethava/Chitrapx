import sharp from "sharp";
import { getTarget, type ChitrapxDoc, type ExportItem, type ReadinessIssue } from "@chitrapx/document";

export type FileIssue = { file: string; severity: "error" | "warning"; code: "transparent_pixels" | "file_too_large"; message: string };

/** Google Play's per-screenshot limit; App Store Connect allows more. */
export const MAX_STORE_BYTES = 8 * 1024 * 1024;

/** Both stores reject screenshots with an alpha channel: flatten onto white and drop it. */
export async function finishPng(png: Buffer, file: string): Promise<{ png: Buffer; issues: FileIssue[] }> {
  const issues: FileIssue[] = [];
  const { isOpaque } = await sharp(png).stats();
  if (!isOpaque) issues.push({ file, severity: "warning", code: "transparent_pixels", message: "Transparent pixels were filled with white. The stores reject transparency." });
  const out = await sharp(png).flatten({ background: "#ffffff" }).removeAlpha().png().toBuffer();
  if (out.byteLength > MAX_STORE_BYTES) {
    issues.push({ file, severity: "error", code: "file_too_large", message: `${(out.byteLength / 1024 / 1024).toFixed(1)} MB. Google Play takes up to 8 MB per screenshot.` });
  }
  return { png: out, issues };
}

const STORE_NAME = { "app-store": "App Store", play: "Google Play" } as const;

/** report.txt at the root of every export ZIP. */
export function reportText(doc: ChitrapxDoc, plan: ExportItem[], pre: ReadinessIssue[], post: FileIssue[]): string {
  const lines = ["Chitrapx export report", `${plan.length} PNGs`, "", "Store readiness"];
  lines.push(...(pre.length ? pre.map((i) => `- [${i.severity}] ${STORE_NAME[i.store]}: ${i.message}`) : ["- No issues"]));
  lines.push("", "Files");
  lines.push(...(post.length ? post.map((i) => `- [${i.severity}] ${i.file}: ${i.message}`) : ["- No issues"]));
  const derived = [...new Map(plan.filter((i) => i.derived).map((i) => [i.targetId, i])).values()];
  if (derived.length) {
    lines.push("", "Sizes made from another size");
    for (const i of derived) {
      const from = getTarget(doc.groups.find((g) => g.id === i.sourceGroupId)!.target)!;
      lines.push(`- ${getTarget(i.targetId)!.label}: from ${from.label}${i.letterboxed ? " (letterboxed)" : ""}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
