// Size tables ported from launch (MIT, Copyright (c) 2025 applogo contributors), src/config.rs:25-171.

export const ICON_PLATFORMS = ["iphone", "ipad", "watch", "mac", "android"] as const;
export type IconPlatform = (typeof ICON_PLATFORMS)[number];

export const APPICONSET = "Assets.xcassets/AppIcon.appiconset/";

export type IconEntry = {
  platform: IconPlatform | "store";
  /** Points in Contents.json ("60x60"). */
  size: string;
  /** Pixel width and height of the PNG. */
  pixels: number;
  filename: string;
  /** ZIP folder, ending in "/", or "" for the root. */
  folder: string;
  idiom: string;
  scale: string;
  role?: string;
  subtype?: string;
  /** Composited onto white and written without alpha (Apple rejects transparent icons). */
  flatten: boolean;
  store?: boolean;
};

type Row = [size: string, pixels: number, idiom: string, scale: string, role?: string, subtype?: string];
const apple = (platform: IconPlatform, rows: Row[]): IconEntry[] => rows.map(([size, pixels, idiom, scale, role, subtype]) => ({
  platform, size, pixels, filename: `${pixels}.png`, folder: APPICONSET, idiom, scale, flatten: true,
  ...(role ? { role } : {}), ...(subtype ? { subtype } : {}),
}));

const IPHONE: Row[] = [
  ["60x60", 180, "iphone", "3x"], ["40x40", 80, "iphone", "2x"], ["40x40", 120, "iphone", "3x"], ["60x60", 120, "iphone", "2x"],
  ["57x57", 57, "iphone", "1x"], ["29x29", 58, "iphone", "2x"], ["29x29", 29, "iphone", "1x"], ["29x29", 87, "iphone", "3x"],
  ["57x57", 114, "iphone", "2x"], ["20x20", 40, "iphone", "2x"], ["20x20", 60, "iphone", "3x"], ["1024x1024", 1024, "ios-marketing", "1x"],
];
const IPAD: Row[] = [
  ["40x40", 80, "ipad", "2x"], ["72x72", 72, "ipad", "1x"], ["76x76", 152, "ipad", "2x"], ["50x50", 100, "ipad", "2x"],
  ["29x29", 58, "ipad", "2x"], ["76x76", 76, "ipad", "1x"], ["29x29", 29, "ipad", "1x"], ["50x50", 50, "ipad", "1x"],
  ["72x72", 144, "ipad", "2x"], ["40x40", 40, "ipad", "1x"], ["83.5x83.5", 167, "ipad", "2x"], ["20x20", 20, "ipad", "1x"],
  ["20x20", 40, "ipad", "2x"],
];
const WATCH: Row[] = [
  ["86x86", 172, "watch", "2x", "quickLook", "38mm"], ["40x40", 80, "watch", "2x", "appLauncher", "38mm"],
  ["44x44", 88, "watch", "2x", "appLauncher", "40mm"], ["51x51", 102, "watch", "2x", "appLauncher", "45mm"],
  ["54x54", 108, "watch", "2x", "appLauncher", "49mm"], ["46x46", 92, "watch", "2x", "appLauncher", "41mm"],
  ["50x50", 100, "watch", "2x", "appLauncher", "44mm"], ["98x98", 196, "watch", "2x", "quickLook", "42mm"],
  ["108x108", 216, "watch", "2x", "quickLook", "44mm"], ["117x117", 234, "watch", "2x", "quickLook", "45mm"],
  ["129x129", 258, "watch", "2x", "quickLook", "49mm"], ["24x24", 48, "watch", "2x", "notificationCenter", "38mm"],
  ["27.5x27.5", 55, "watch", "2x", "notificationCenter", "42mm"], ["33x33", 66, "watch", "2x", "notificationCenter", "45mm"],
  ["29x29", 87, "watch", "3x", "companionSettings"], ["29x29", 58, "watch", "2x", "companionSettings"],
  ["1024x1024", 1024, "watch-marketing", "1x"],
];
const MAC: Row[] = [
  ["128x128", 128, "mac", "1x"], ["256x256", 256, "mac", "1x"], ["128x128", 256, "mac", "2x"], ["256x256", 512, "mac", "2x"],
  ["32x32", 32, "mac", "1x"], ["512x512", 512, "mac", "1x"], ["16x16", 16, "mac", "1x"], ["16x16", 32, "mac", "2x"],
  ["32x32", 64, "mac", "2x"], ["512x512", 1024, "mac", "2x"],
];

/** Legacy launcher icon sizes per density (48 dp). */
export const ANDROID_DENSITIES = [["mdpi", 48], ["hdpi", 72], ["xhdpi", 96], ["xxhdpi", 144], ["xxxhdpi", 192]] as const;

export const ICON_TABLES: Record<IconPlatform, (androidName: string) => IconEntry[]> = {
  iphone: () => apple("iphone", IPHONE),
  ipad: () => apple("ipad", IPAD),
  watch: () => apple("watch", WATCH),
  mac: () => apple("mac", MAC),
  android: (name) => ANDROID_DENSITIES.map(([density, px]) => ({
    platform: "android", size: `${px}x${px}`, pixels: px, filename: `${name}.png`, folder: `android/mipmap-${density}/`,
    idiom: "android", scale: "1x", flatten: false,
  })),
};

const STORES: IconEntry[] = [
  { platform: "store", size: "1024x1024", pixels: 1024, filename: "appstore.png", folder: "", idiom: "ios-marketing", scale: "1x", flatten: true, store: true },
  { platform: "store", size: "512x512", pixels: 512, filename: "playstore.png", folder: "", idiom: "other", scale: "1x", flatten: false, store: true },
];

/** Every icon for the chosen platforms (each once, in the order given), then the store icons unless skipped. */
export function iconEntries(platforms: readonly IconPlatform[], androidName: string, includeStores: boolean): IconEntry[] {
  return [...new Set(platforms)].flatMap((p) => ICON_TABLES[p](androidName)).concat(includeStores ? STORES : []);
}

export const isApple = (p: IconEntry["platform"]) => p === "iphone" || p === "ipad" || p === "watch" || p === "mac";
