import { describe, expect, it } from "vitest";
import { acceptImages, IMAGE_MAX_BYTES, INTAKE_MAX, naturalSort } from "@/editor/intake.ts";

const f = (name: string, type = "image/png", size = 10) => new File([new Uint8Array(size)], name, { type });

describe("intake", () => {
  it("sorts names naturally", () => {
    expect(["shot10.png", "shot2.png", "Shot1.png"].sort(naturalSort)).toEqual(["Shot1.png", "shot2.png", "shot10.png"]);
  });
  it("keeps PNG, JPEG and WebP; reports others; skips dotfiles silently", () => {
    const out = acceptImages([f("b.jpg", "image/jpeg"), f(".DS_Store", ""), f("notes.txt", "text/plain"), f("a.webp", "image/webp"), f("clip.mov", "video/quicktime")]);
    expect(out.accepted.map((x) => x.name)).toEqual(["a.webp", "b.jpg"]);
    expect(out.rejected).toEqual(["notes.txt: not a PNG, JPEG or WebP image", "clip.mov: not a PNG, JPEG or WebP image"]);
  });
  it("rejects images over 25 MB", () => {
    const out = acceptImages([f("big.png", "image/png", IMAGE_MAX_BYTES + 1), f("ok.png")]);
    expect(out.accepted.map((x) => x.name)).toEqual(["ok.png"]);
    expect(out.rejected).toEqual(["big.png: larger than 25 MB"]);
  });
  it("takes at most 20 per drop", () => {
    const out = acceptImages(Array.from({ length: 23 }, (_, i) => f(`s${i + 1}.png`)));
    expect(out.accepted).toHaveLength(INTAKE_MAX);
    expect(out.accepted.at(-1)!.name).toBe("s20.png");
    expect(out.rejected).toEqual(["3 more files skipped: at most 20 per drop"]);
  });
});
