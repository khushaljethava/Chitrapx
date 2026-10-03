import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { exportPlan, storeReadiness, type ChitrapxDoc } from "@chitrapx/document";
import { finishPng, reportText } from "../src/storeFiles.ts";

const png = (alpha: number) => sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 10, g: 20, b: 30, alpha } } }).png().toBuffer();

describe("finishPng", () => {
  it("removes the alpha channel and warns when pixels were transparent", async () => {
    const out = await finishPng(await png(0), "ios/x/en-US/01-a.png");
    expect(await sharp(out.png).metadata()).toMatchObject({ channels: 3, hasAlpha: false, width: 4, height: 4 });
    expect(out.issues).toEqual([expect.objectContaining({ code: "transparent_pixels", severity: "warning", file: "ios/x/en-US/01-a.png" })]);
  });

  it("keeps an opaque image's pixels and reports nothing", async () => {
    const out = await finishPng(await png(1), "f.png");
    expect(out.issues).toEqual([]);
    const { data } = await sharp(out.png).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([10, 20, 30]);
  });
});

describe("reportText", () => {
  it("lists store issues, file issues and derived sizes", () => {
    const b = { id: "a", name: "a", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, elements: [], backgroundColor: "#fff", zoom: 1 };
    const doc = { schemaVersion: 1, kind: "screenshots", groups: [{ id: "g1", target: "iphone-6.9", boards: [b], spanElements: [] }],
      localization: { baseLocale: "en-US", locales: [] } } as unknown as ChitrapxDoc;
    const plan = exportPlan(doc, { targets: ["iphone-6.9", "iphone-5.5"], locales: ["en-US"] });
    const text = reportText(doc, plan, storeReadiness(plan, doc), [{ file: plan[0]!.file, severity: "warning", code: "transparent_pixels", message: "filled" }]);
    expect(text).toContain("2 PNGs");
    expect(text).toContain("[warning] App Store:");
    expect(text).toContain(`[warning] ${plan[0]!.file}: filled`);
    expect(text).toContain('iPhone 5.5": from iPhone 6.9" (letterboxed)');
  });

  it("says when there is nothing to report", () => {
    expect(reportText({ groups: [] } as unknown as ChitrapxDoc, [], [], [])).toContain("Store readiness\n- No issues");
  });
});
