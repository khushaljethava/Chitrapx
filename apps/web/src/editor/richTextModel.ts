import type { ElementLocaleOverride, TextElementProps, TextMark } from "@chitrapx/document";

const ownWording = (base: TextElementProps, ov?: ElementLocaleOverride) => ov?.content !== undefined && ov.content !== base.content;

/** The marks the inspector edits: the base ones, or in a language view that language's own (none if it reworded without any). */
export function marksFor(base: TextElementProps, ov: ElementLocaleOverride | undefined, localized: boolean): TextMark[] {
  if (!localized) return base.marks ?? [];
  if (ov?.marks) return ov.marks;
  return ownWording(base, ov) ? [] : base.marks ?? [];
}

/** True when the base text is styled but this language reworded it without styling of its own. */
export const stylingNotCarried = (base: TextElementProps, ov?: ElementLocaleOverride) =>
  !!base.marks?.length && ownWording(base, ov) && !ov?.marks?.length;
