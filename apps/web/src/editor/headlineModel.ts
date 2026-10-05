import type { ChitrapxDoc } from "@chitrapx/document";
import { findElement, type Command, type Ref } from "./commands.ts";

/** The one command that puts `text` into the single selected text element (its language's own text in a language view), or null. */
export function insertHeadline(state: { doc: ChitrapxDoc; selection: Ref[]; locale: string }, text: string): Command | null {
  const ref = state.selection.length === 1 ? state.selection[0]! : null;
  if (!ref || findElement(state.doc, ref)?.type !== "text") return null;
  if (state.locale !== state.doc.localization.baseLocale && ref.boardId) return { type: "setOverride", ref, locale: state.locale, props: { content: text } };
  return { type: "updateElement", ref, props: { content: text } as never };
}
