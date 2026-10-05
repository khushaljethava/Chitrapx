// Token resolution ported from PixelDeck (MIT), src/utils/brandColors.ts (isBrandToken, parseBrandToken,
// resolveBrandColor, resolveFill), extended to every colour field, gradient stops and rich text marks.
export const BRAND_TOKENS = ["primary", "secondary", "accent", "surface", "text", "muted"] as const;
export type BrandToken = (typeof BRAND_TOKENS)[number];
export type BrandPalette = Partial<Record<BrandToken, string>>;

const TOKEN = /^brand:(primary|secondary|accent|surface|text|muted)$/;
export const isBrandToken = (v: unknown): v is string => typeof v === "string" && TOKEN.test(v);
export const parseBrandToken = (v: string): BrandToken | null => (TOKEN.exec(v)?.[1] as BrandToken | undefined) ?? null;
export const toBrandToken = (t: BrandToken) => `brand:${t}`;

/** The app's palette by token; primaryColor/secondaryColor fill those two slots until a palette is saved. */
export function brandPalette(brand: { palette?: Array<{ token: BrandToken; color: string }>; primaryColor?: string; secondaryColor?: string } | null | undefined): BrandPalette {
  if (!brand) return {};
  if (brand.palette?.length) return Object.fromEntries(brand.palette.map((p) => [p.token, p.color])) as BrandPalette;
  return { ...(brand.primaryColor ? { primary: brand.primaryColor } : {}), ...(brand.secondaryColor ? { secondary: brand.secondaryColor } : {}) };
}

const DROP = Symbol("unresolved brand colour");
const isFill = (o: object) => "stops" in o || "color1" in o || "color2" in o || ("at" in o && "color" in o);

function walk(v: unknown, palette: BrandPalette, key: string): unknown {
  if (typeof v === "string") {
    const t = parseBrandToken(v);
    return t ? (palette[t] ?? DROP) : v;
  }
  if (Array.isArray(v)) {
    const out = v.map((x) => walk(x, palette, key));
    if (!out.includes(DROP)) return out;
    return key === "stops" ? DROP : out.filter((x) => x !== DROP);
  }
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    let dropped = false;
    for (const [k, x] of Object.entries(v)) {
      const r = walk(x, palette, k);
      if (r === DROP) { dropped = true; continue; }
      out[k] = r;
    }
    // A gradient (or one of its stops) missing a colour is dropped whole: half a gradient is not a design.
    return dropped && isFill(v) ? DROP : out;
  }
  return v;
}

/**
 * Replaces brand:<token> with the palette colour anywhere in `value`. A token the palette lacks
 * drops its field (so the element default applies); a gradient with such a stop is dropped whole.
 * Returns `value` itself when it holds no token.
 */
export function resolveBrand<T>(value: T, palette: BrandPalette | undefined): T {
  if (!JSON.stringify(value)?.includes('"brand:')) return value;
  const out = walk(value, palette ?? {}, "");
  return (out === DROP ? undefined : out) as T;
}

/** Every token a document uses. */
export function docBrandTokens(doc: unknown): BrandToken[] {
  const found = new Set<BrandToken>();
  JSON.stringify(doc, (_k, v) => { if (typeof v === "string") { const t = parseBrandToken(v); if (t) found.add(t); } return v; });
  return [...found];
}
