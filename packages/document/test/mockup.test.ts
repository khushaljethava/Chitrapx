import { describe, expect, it } from "vitest";
import { checkExportable, getTarget, migrate, MOCKUP_DEVICE_IDS, MOCKUP_DEVICES, mockupDoc, needsFitChoice, screenAspect } from "../src/index.ts";

type Device = { deviceType: string; size: { width: number; height: number }; position: { x: number; y: number }; screenshotSrc: string; screenshotObjectFit: string; styleType: string };

describe("mockup devices", () => {
  it("cover every device type but custom", () => {
    expect(MOCKUP_DEVICE_IDS).toHaveLength(20);
    expect(MOCKUP_DEVICE_IDS).not.toContain("custom");
  });

  it("screen aspect comes from the native aspect and width-relative insets", () => {
    const d = MOCKUP_DEVICES["iphone-15"];
    const w = 1, h = 1 / d.nativeAspect;
    expect(screenAspect("iphone-15")).toBeCloseTo((w - (d.screen.left + d.screen.right) / 100) / (h - (d.screen.top + d.screen.bottom) / 100), 6);
  });

  it("asks for fit or fill only when the screenshot's shape differs from the screen's", () => {
    const a = screenAspect("iphone-15");
    expect(needsFitChoice("iphone-15", 1000, Math.round(1000 / a))).toBe(false);
    expect(needsFitChoice("iphone-15", 1200, 900)).toBe(true);
    expect(needsFitChoice("macbook", 2880, 1800)).toBe(false); // a 16:10 Mac screenshot fits the MacBook screen
    expect(needsFitChoice("macbook", 1000, 1000)).toBe(true);
  });
});

describe("mockupDoc", () => {
  it("builds one exportable board per shot with the device centred at its native aspect", () => {
    const { doc, selection, crops } = mockupDoc([{ src: "asset:a" }, { src: "asset:b", fit: "fit" }], { deviceType: "iphone-15" });
    expect(migrate(doc)).toEqual(doc);
    const check = checkExportable(doc, selection);
    expect(check.ok && check.plan.length).toBe(2);
    const g = doc.groups[0]!;
    const t = getTarget(g.target)!;
    expect(t.id).toBe("iphone-6.9-1320");
    const [d1, d2] = g.boards.map((b) => b.elements[0] as unknown as Device);
    expect(d1).toMatchObject({ deviceType: "iphone-15", styleType: "normal", screenshotSrc: "asset:a", screenshotObjectFit: "cover" });
    expect(d2!.screenshotObjectFit).toBe("contain");
    expect(d1!.size.width / d1!.size.height).toBeCloseTo(MOCKUP_DEVICES["iphone-15"].nativeAspect, 2);
    expect(d1!.position.x * 2 + d1!.size.width).toBeCloseTo(t.width, -1);
    expect(d1!.position.y * 2 + d1!.size.height).toBeCloseTo(t.height, -1);
    expect(g.boards[0]!.backgroundColor).toBe("transparent");
    const m = Math.round(d1!.size.width * 0.06);
    expect(crops[0]).toEqual({ left: d1!.position.x - m, top: d1!.position.y - m, width: d1!.size.width + 2 * m, height: d1!.size.height + 2 * m });
  });

  it("puts landscape devices on a landscape board, takes a background and a zero margin", () => {
    const { doc, crops } = mockupDoc([{ src: "asset:a" }], { deviceType: "macbook", background: "#112233", margin: 0 });
    const b = doc.groups[0]!.boards[0]!;
    expect(doc.groups[0]!.target).toBe("mac-2880");
    expect(b.backgroundColor).toBe("#112233");
    const d = b.elements[0] as unknown as Device;
    expect(crops[0]).toEqual({ left: d.position.x, top: d.position.y, width: d.size.width, height: d.size.height });
    for (const c of crops) {
      expect(c.left).toBeGreaterThanOrEqual(0);
      expect(c.left + c.width).toBeLessThanOrEqual(b.size.width);
    }
  });
});
