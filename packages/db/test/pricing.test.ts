import { describe, expect, it } from "vitest";
import { PRICES, priceFor } from "../src/pricing.ts";

describe("SP12 launch asset prices", () => {
  it("charges one credit for an icon ZIP and a collage; the logo and quick mockup are free", () => {
    expect(PRICES).toMatchObject({ app_icons: 1, collage: 1, logo_starter: 0, mockup: 0 });
    expect(priceFor("app_icons", { platforms: ["iphone", "android"] })).toBe(1);
    expect(priceFor("collage", { images: [1, 2, 3] })).toBe(1);
    expect(priceFor("logo_starter", {})).toBe(0);
    expect(priceFor("mockup", {})).toBe(0);
  });
});
