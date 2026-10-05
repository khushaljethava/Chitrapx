import { describe, expect, it } from "vitest";
import { MOCKUP_DEVICE_IDS, MOCKUP_DEVICES } from "@chitrapx/document";
import { DEVICE_REGISTRY } from "../src/osg/lib/deviceRegistry";

describe("SP12 mockup device geometry", () => {
  it("matches the renderer's device registry for every device but custom", () => {
    const drawn = Object.keys(DEVICE_REGISTRY).filter((id) => id !== "custom").sort();
    expect([...MOCKUP_DEVICE_IDS].sort()).toEqual(drawn);
    for (const id of MOCKUP_DEVICE_IDS) {
      const r = DEVICE_REGISTRY[id];
      expect(MOCKUP_DEVICES[id].nativeAspect, id).toBeCloseTo(r.nativeAspect, 9);
      expect(MOCKUP_DEVICES[id].screen, id).toEqual(r.screen!.paddingPercent);
      expect(MOCKUP_DEVICES[id].label, id).toBe(r.label);
    }
  });
});
