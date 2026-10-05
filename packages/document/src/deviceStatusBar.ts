/**
 * Simulated status bar per device type, as a percentage of the screen height. Values follow
 * PixelDeck's mockup specs (MIT): Dynamic Island 59 / 852 pt, Android punch-hole 48 / 820.
 */
const SPECS: Record<string, { platform: "ios" | "android"; heightPct: number }> = {
  "iphone-15": { platform: "ios", heightPct: 6.9 },
  "iphone-15-pro": { platform: "ios", heightPct: 6.9 },
  "iphone-17-pro-max": { platform: "ios", heightPct: 6.9 },
  "android-punch-hole": { platform: "android", heightPct: 5.9 },
  "android-notch": { platform: "android", heightPct: 5.9 },
  "android-bar": { platform: "android", heightPct: 5.9 },
};

export function statusBarSpec(deviceType: string): { platform: "ios" | "android"; heightPct: number } | null {
  return SPECS[deviceType] ?? null;
}
