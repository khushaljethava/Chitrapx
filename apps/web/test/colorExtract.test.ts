import { describe, expect, it } from "vitest";
import { paletteFromPixels } from "@/lib/colorExtract.ts";

/** An RGBA image made of [r, g, b, count] runs. */
const image = (runs: Array<[number, number, number, number]>) => {
  const total = runs.reduce((n, [, , , c]) => n + c, 0);
  const data = new Uint8ClampedArray(total * 4);
  let i = 0;
  for (const [r, g, b, c] of runs) for (let k = 0; k < c; k++) { data.set([r, g, b, 255], i); i += 4; }
  return { data };
};

describe("paletteFromPixels", () => {
  const shots = [
    image([[224, 48, 48, 500], [255, 255, 255, 900], [10, 10, 10, 400], [128, 128, 128, 300], [40, 90, 220, 300]]),
    image([[40, 90, 220, 100], [30, 160, 90, 250], [228, 51, 51, 20]]),
  ];
  it("ranks colourful buckets by frequency, skipping white, black and grey", () => {
    expect(paletteFromPixels(shots)).toEqual(["#e03030", "#285adc", "#1ea05a"]);
  });
  it("is deterministic", () => {
    expect(paletteFromPixels(shots)).toEqual(paletteFromPixels(shots));
  });
  it("merges near-identical shades into one swatch", () => {
    expect(paletteFromPixels([image([[224, 48, 48, 100], [230, 52, 52, 90]])])).toHaveLength(1);
  });
  it("finds nothing in greyscale screenshots", () => {
    expect(paletteFromPixels([image([[255, 255, 255, 100], [0, 0, 0, 100], [120, 120, 120, 100], [200, 205, 200, 50]])])).toEqual([]);
  });
  it("returns at most six", () => {
    const many = image(Array.from({ length: 10 }, (_, i) => [i * 25, 255 - i * 25, (i * 80) % 256, 10 + i] as [number, number, number, number]));
    expect(paletteFromPixels([many]).length).toBeLessThanOrEqual(6);
  });
});
