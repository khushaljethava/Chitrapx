import { describe, expect, it } from "vitest";
import { layoutFor } from "../src/index.ts";

const phone = { size: { width: 600, height: 1200 }, scale: 1 };
const text = { size: { width: 500, height: 200 }, scale: 1 };
const portrait = { width: 1290, height: 2796 };

describe("layoutFor", () => {
  it("text presets: 88% width, centred, 6% margins, height kept", () => {
    expect(layoutFor("text-top", portrait, text)).toEqual({ position: { x: 77.4, y: 167.76 }, size: { width: 1135.2, height: 200 }, rotation: 0 });
    expect(layoutFor("text-middle", portrait, text).position.y).toBeCloseTo((2796 - 200) / 2);
    expect(layoutFor("text-bottom", portrait, text).position.y).toBeCloseTo(2796 - 200 - 167.76);
  });

  it("phone presets keep the device aspect and place it per the table", () => {
    const c = layoutFor("phone-center", portrait, phone);
    expect(c.size).toEqual({ width: 1118.4, height: 2236.8 }); // 80% of 2796, width under the 90% cap
    expect(c.position.x + c.size.width / 2).toBeCloseTo(645);
    expect(c.position.y + c.size.height / 2).toBeCloseTo(1398);
    expect(layoutFor("phone-hero", portrait, phone).position.y).toBeCloseTo(2796 * 0.28);
    const bleed = layoutFor("phone-bleed", portrait, phone);
    expect(bleed.position.y + bleed.size.height).toBeGreaterThan(2796);
    const tilt = layoutFor("phone-tilt", portrait, phone);
    expect(tilt.rotation).toBe(-12);
    expect(tilt.position.x + tilt.size.width / 2).toBeCloseTo(645 + 1290 * 0.04);
  });

  it("caps device width at 90% of the board", () => {
    const wide = { size: { width: 2000, height: 1000 }, scale: 1 }; // 80% of 1600 tall would be 2560 wide
    const out = layoutFor("phone-center", { width: 2560, height: 1600 }, wide);
    expect(out.size.width).toBeCloseTo(2560 * 0.9);
    expect(out.size.width / out.size.height).toBeCloseTo(2);
  });

  it("accounts for element scale and is idempotent", () => {
    const scaled = { size: { width: 300, height: 600 }, scale: 2 };
    const once = layoutFor("phone-center", portrait, scaled);
    expect(once.size.height * 2).toBeCloseTo(2796 * 0.8);
    expect(layoutFor("phone-center", portrait, { ...scaled, size: once.size })).toEqual(once);
  });
});
