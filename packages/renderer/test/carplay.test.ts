import { describe, expect, it } from "vitest";
import { DEVICE_PICKER_GROUPS, DEVICE_REGISTRY, getDeviceDescriptor, swapTargetFor } from "../src/osg/lib/deviceRegistry";
import { getFlatDeviceChrome, getFlatFrameStyles } from "../src/osg/elements/deviceChrome";

describe("CarPlay device", () => {
  it("is a landscape iOS vehicle frame with no counterpart", () => {
    expect(getDeviceDescriptor("carplay")).toMatchObject({ label: "CarPlay", platform: "ios", category: "vehicle", nativeAspect: 800 / 480 });
    expect(DEVICE_REGISTRY.carplay.screen!.paddingPercent).toEqual({ top: 1.6, right: 1.6, bottom: 1.6, left: 1.6 });
    expect(swapTargetFor("carplay", "android")).toBeNull();
    expect(swapTargetFor("carplay", "ios")).toBeNull();
  });
  it("appears in its own Vehicle picker group and in no other", () => {
    const vehicle = DEVICE_PICKER_GROUPS.find((g) => g.label === "Vehicle")!;
    expect(vehicle.devices.map((d) => d.id)).toEqual(["carplay"]);
    expect(DEVICE_PICKER_GROUPS.filter((g) => g.devices.some((d) => d.id === "carplay"))).toHaveLength(1);
  });
  it("draws a near-black head unit with proportional corners and a soft shadow", () => {
    const chrome = getFlatDeviceChrome("carplay", 800);
    expect(chrome).toMatchObject({ outerBorderRadius: "2.2% / 3.6%", screenBorderRadius: "1.4% / 2.3%", bodyColor: "#0B0B0D" });
    const { frame, screen } = getFlatFrameStyles(chrome, 800, {});
    expect(frame.boxShadow).toBe("0 20px 60px rgba(0,0,0,0.40), inset 0 0 0 1px rgba(255,255,255,0.07)");
    expect(screen.top).toBe("12.8px"); // 1.6% of 800
  });
  it("leaves the other devices as they were", () => {
    expect(getFlatDeviceChrome("iphone-15", 400).outerBorderRadius).toBe(`${400 * 0.14}px`);
    expect(getFlatFrameStyles(getFlatDeviceChrome("iphone-15", 400), 400, {}).frame.boxShadow).toBe("0 4px 12px rgba(0,0,0,0.3)");
  });
});
