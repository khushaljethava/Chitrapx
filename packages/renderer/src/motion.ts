import type { ArtboardElement } from "@chitrapx/document";

/**
 * Default entrance motion for a board nobody animated: texts slide up one after another,
 * then devices and images scale in. Elements with their own animation keep it.
 */
export function defaultAnimations(elements: ArtboardElement[]): ArtboardElement[] {
  if (elements.some((e) => e.animation?.enter)) return elements.map((e) => e);
  let texts = 0;
  const textCount = elements.filter((e) => e.type === "text").length;
  return elements.map((e) => {
    if (e.animation) return e;
    if (e.type === "text") return { ...e, animation: { enter: "slide-up", enterDelay: 0.12 * texts++, enterDuration: 0.6 } };
    if (e.type === "device" || e.type === "image" || e.type === "video-device") {
      return { ...e, animation: { enter: "scale-up", enterDelay: 0.12 * textCount + 0.1, enterDuration: 0.7 } };
    }
    return e;
  });
}
