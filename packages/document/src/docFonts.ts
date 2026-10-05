/**
 * Every fontFamily the document names, wherever it is (elements, span elements, per-locale
 * overrides), trimmed and unique. Walks plain JSON so it also works on raw stored documents.
 */
export function docFontFamilies(doc: unknown): string[] {
  const out = new Set<string>();
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (k === "fontFamily" && typeof x === "string" && x.trim()) out.add(x.trim());
      else visit(x);
    }
  };
  visit(doc);
  return [...out];
}
