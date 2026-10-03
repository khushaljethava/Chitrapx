/** Every export size Chitrapx produces. The only place pixel sizes are defined. */
export type Platform = "ios" | "ipad" | "mac" | "watch" | "tv" | "vision" | "android" | "play" | "preview" | "social";

export type Target = { id: string; platform: Platform; slot: string; label: string; width: number; height: number };

const t = (id: string, platform: Platform, slot: string, label: string, width: number, height: number): Target =>
  ({ id, platform, slot, label, width, height });

/**
 * Order is the order sizes are offered in. `slot` is the place App Store Connect or Play accepts a
 * size; several sizes can fill one slot. vision-pro precedes apple-tv-4k (same pixels) so
 * targetForSize keeps mapping imported 3840x2160 templates to Vision Pro.
 */
export const TARGETS = [
  t("iphone-6.9-1320", "ios", "ios-6.9", 'iPhone 6.9" (1320×2868)', 1320, 2868),
  t("iphone-6.9", "ios", "ios-6.9", 'iPhone 6.9"', 1290, 2796),
  t("iphone-6.5-1284", "ios", "ios-6.5", 'iPhone 6.5" (1284×2778)', 1284, 2778),
  t("iphone-6.5", "ios", "ios-6.5", 'iPhone 6.5"', 1242, 2688),
  t("iphone-6.3-1206", "ios", "ios-6.3", 'iPhone 6.3" (1206×2622)', 1206, 2622),
  t("iphone-6.3", "ios", "ios-6.3", 'iPhone 6.3"', 1179, 2556),
  t("iphone-6.1", "ios", "ios-6.1", 'iPhone 6.1"', 1170, 2532),
  t("iphone-5.5", "ios", "ios-5.5", 'iPhone 5.5"', 1242, 2208),
  t("ipad-13", "ipad", "ipad-13", 'iPad 13"', 2064, 2752),
  t("ipad-12.9", "ipad", "ipad-13", 'iPad Pro 12.9"', 2048, 2732),
  t("ipad-11", "ipad", "ipad-11", 'iPad 11"', 1668, 2388),
  t("mac-2880", "mac", "mac", "Mac 2880x1800", 2880, 1800),
  t("mac-2560", "mac", "mac", "Mac 2560x1600", 2560, 1600),
  t("mac-1440", "mac", "mac", "Mac 1440x900", 1440, 900),
  t("mac-1280", "mac", "mac", "Mac 1280x800", 1280, 800),
  t("watch-ultra", "watch", "watch", "Apple Watch Ultra", 422, 514),
  t("watch-s10", "watch", "watch", "Apple Watch Series 10", 416, 496),
  t("watch-s9", "watch", "watch", "Apple Watch Series 9", 396, 484),
  t("watch-s6", "watch", "watch", "Apple Watch Series 6", 368, 448),
  t("watch-s3", "watch", "watch", "Apple Watch Series 3", 312, 390),
  t("vision-pro", "vision", "vision", "Apple Vision Pro", 3840, 2160),
  t("apple-tv-4k", "tv", "tv", "Apple TV 4K", 3840, 2160),
  t("apple-tv", "tv", "tv", "Apple TV", 1920, 1080),
  t("android-phone", "android", "android-phone", "Android phone", 1080, 1920),
  t("android-tablet-7", "android", "android-tablet-7", 'Android tablet 7"', 1200, 1920),
  t("android-tablet-7-land", "android", "android-tablet-7", 'Android tablet 7" landscape', 1920, 1200),
  t("android-tablet-10", "android", "android-tablet-10", 'Android tablet 10"', 1600, 2560),
  t("android-tablet-10-land", "android", "android-tablet-10", 'Android tablet 10" landscape', 2560, 1600),
  t("play-feature", "play", "play-feature", "Google Play feature graphic", 1024, 500),
  t("app-preview-portrait", "preview", "preview", "App Preview (portrait)", 886, 1920),
  t("app-preview-landscape", "preview", "preview", "App Preview (landscape)", 1920, 886),
  t("instagram-post", "social", "instagram-post", "Instagram post", 1080, 1350),
  t("instagram-story", "social", "instagram-story", "Instagram story", 1080, 1920),
  t("x-post", "social", "x-post", "X post", 1600, 900),
  t("linkedin-post", "social", "linkedin-post", "LinkedIn post", 1200, 627),
  t("product-hunt", "social", "product-hunt", "Product Hunt gallery", 1270, 760),
] as const satisfies readonly Target[];

export type TargetId = (typeof TARGETS)[number]["id"];
export const TARGET_IDS = TARGETS.map((x) => x.id) as [TargetId, ...TargetId[]];

const byId = new Map<string, Target>(TARGETS.map((x) => [x.id, x]));
export const getTarget = (id: string): Target | undefined => byId.get(id);

/** Exact size match first; otherwise the target with the closest aspect ratio. */
export function targetForSize(width: number, height: number): Target {
  const exact = TARGETS.find((x) => x.width === width && x.height === height);
  if (exact) return exact;
  const ratio = width / height;
  return [...TARGETS].sort((a, b) => Math.abs(a.width / a.height - ratio) - Math.abs(b.width / b.height - ratio))[0]!;
}
