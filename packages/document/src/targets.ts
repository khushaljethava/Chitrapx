/** Every export size Chitrapx produces. The only place pixel sizes are defined. */
export type Platform = "ios" | "ipad" | "mac" | "watch" | "tv" | "vision" | "android" | "play" | "preview" | "social";

export type Target = { id: string; platform: Platform; label: string; width: number; height: number };

const t = (id: string, platform: Platform, label: string, width: number, height: number): Target => ({ id, platform, label, width, height });

export const TARGETS = [
  t("iphone-6.9", "ios", 'iPhone 6.9"', 1290, 2796),
  t("iphone-6.5", "ios", 'iPhone 6.5"', 1242, 2688),
  t("iphone-6.3", "ios", 'iPhone 6.3"', 1179, 2556),
  t("iphone-5.5", "ios", 'iPhone 5.5"', 1242, 2208),
  t("ipad-13", "ipad", 'iPad 13"', 2064, 2752),
  t("ipad-12.9", "ipad", 'iPad Pro 12.9"', 2048, 2732),
  t("mac-2880", "mac", "Mac 2880x1800", 2880, 1800),
  t("mac-2560", "mac", "Mac 2560x1600", 2560, 1600),
  t("mac-1440", "mac", "Mac 1440x900", 1440, 900),
  t("mac-1280", "mac", "Mac 1280x800", 1280, 800),
  t("watch-ultra", "watch", "Apple Watch Ultra", 422, 514),
  t("watch-s10", "watch", "Apple Watch Series 10", 416, 496),
  t("apple-tv", "tv", "Apple TV", 1920, 1080),
  t("vision-pro", "vision", "Apple Vision Pro", 3840, 2160),
  t("android-phone", "android", "Android phone", 1080, 1920),
  t("android-tablet-7", "android", 'Android tablet 7"', 1200, 1920),
  t("android-tablet-10", "android", 'Android tablet 10"', 1600, 2560),
  t("play-feature", "play", "Google Play feature graphic", 1024, 500),
  t("app-preview-portrait", "preview", "App Preview (portrait)", 886, 1920),
  t("instagram-post", "social", "Instagram post", 1080, 1350),
  t("instagram-story", "social", "Instagram story", 1080, 1920),
  t("x-post", "social", "X post", 1600, 900),
  t("linkedin-post", "social", "LinkedIn post", 1200, 627),
  t("product-hunt", "social", "Product Hunt gallery", 1270, 760),
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
