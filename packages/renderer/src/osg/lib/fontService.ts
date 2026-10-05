// Ported from open-screenshot-generator (MIT), src/services/fontService.ts
import { FONT_CATALOG, SYSTEM_FAMILIES, type FontScript } from '@chitrapx/document';
import { googleFontsHref } from '../../fonts.tsx';
import { GoogleFont } from './fonts';

export type { FontScript } from '@chitrapx/document';

export interface AppFont extends Omit<GoogleFont, 'script'> {
  script?: FontScript;
}

const FALLBACK: Record<string, string> = { serif: 'serif', monospace: 'monospace', handwriting: 'cursive', display: 'sans-serif', 'sans-serif': 'sans-serif' };

// The Google families the picker offers: the generated catalogue (packages/document/src/fontCatalog.json).
export const GOOGLE_FONTS: AppFont[] = FONT_CATALOG.map((f) => ({
  family: f.family, variants: f.weights.map(String), category: f.category, fallback: FALLBACK[f.category], script: f.scripts[0],
}));

// Default system fonts to include along with Google fonts
export const SYSTEM_FONTS: AppFont[] = SYSTEM_FAMILIES.map((f) => ({ family: f.family, category: f.category, script: 'latin' as const }));

// All available fonts
export const ALL_FONTS = [...SYSTEM_FONTS, ...GOOGLE_FONTS];

const requested = new Set<string>();
/**
 * Loads one face on demand (font picker previews, a family just picked) and resolves once the
 * browser has it. One small css2 link per face; nothing is fetched until something asks.
 */
export async function ensureFont(family: string, weight = 400, italic = false): Promise<void> {
  if (typeof document === 'undefined') return;
  const href = googleFontsHref([{ family, faces: [{ weight, italic }] }]);
  if (href && !requested.has(href)) {
    requested.add(href);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    const loaded = new Promise<void>((resolve) => { link.onload = () => resolve(); link.onerror = () => resolve(); });
    document.head.appendChild(link);
    await loaded;
  }
  await document.fonts.load(`${italic ? 'italic ' : ''}${weight} 32px ${cssFontFamily(family)}`).catch(() => []);
}

// Get font options for select components
export function getFontOptions() {
  return ALL_FONTS.map(font => ({
    value: font.family,
    label: font.family,
    category: font.category || 'sans-serif',
    // What a preview should fall back to before the face has loaded. The
    // category is not usable for this: 'display' and 'handwriting' are not CSS
    // generic families.
    fallback: font.fallback || 'sans-serif',
    script: font.script || 'latin',
  }));
}

// Get fonts by script
export function getFontsByScript(script: FontScript) {
  return ALL_FONTS.filter(font => font.script === script);
}

// Get grouped font options by script. Latin splits again by category, because
// the decorative faces are what people scroll for and a flat 30-item list
// buries them among the UI sans.
export function getGroupedFontOptions() {
  const fonts = getFontOptions();
  const isSystem = (family: string) => SYSTEM_FONTS.some(sf => sf.family === family);
  const isDecorative = (category: string) => category === 'display' || category === 'handwriting';
  const latin = fonts.filter(font => font.script === 'latin' && !isSystem(font.value));
  return {
    system: fonts.filter(font => isSystem(font.value)),
    display: latin.filter(font => isDecorative(font.category)),
    latin: latin.filter(font => !isDecorative(font.category)),
    arabic: fonts.filter(font => font.script === 'arabic'),
    urdu: fonts.filter(font => font.script === 'urdu'),
    hebrew: fonts.filter(font => font.script === 'hebrew'),
    cjk: fonts.filter(font => font.script === 'cjk'),
    thai: fonts.filter(font => font.script === 'thai'),
    devanagari: fonts.filter(font => font.script === 'devanagari'),
    bengali: fonts.filter(font => font.script === 'bengali'),
    multilingual: fonts.filter(font => font.script === 'multilingual'),
  };
}

// Generic CSS families are keywords, not names: quoting one would ask for a
// face literally called "sans-serif" and lose the fallback.
const CSS_GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded',
  'math', 'emoji', 'fangsong',
  'inherit', 'initial', 'revert', 'unset',
]);

// The generic to stand in while a face is still arriving. A display or
// handwriting family maps to sans-serif rather than its own category, because
// `cursive` and `fantasy` resolve to Comic Sans and Impact on Windows, which is
// a far bigger break from the intended face than the platform sans.
function genericFor(family: string): string | null {
  const font = ALL_FONTS.find(f => f.family === family);
  if (!font) return null;
  switch (font.category) {
    case 'serif': return 'serif';
    case 'monospace': return 'monospace';
    default: return 'sans-serif';
  }
}

/**
 * A stored family name turned into a legal CSS `font-family` value.
 *
 * An unquoted family is parsed as a list of CSS identifiers, and an identifier
 * may not start with a digit, so `font-family: Baloo 2` is invalid and the
 * browser drops the whole declaration: the text silently renders in the
 * artboard's default face instead, on canvas and in every export. Quoting keeps
 * names with digits, spaces or punctuation intact, user-imported fonts included.
 *
 * A registered family also gets its generic appended. Google serves these with
 * `display=swap` and the export path does not wait for a face to arrive, so the
 * gap between "the family is legal" and "the family is loaded" is real, and
 * without a fallback it renders in the document default (a serif) instead of
 * something in the same key as the design.
 */
export function cssFontFamily(family: string): string {
  const name = (family || '').trim();
  if (!name) return '';
  if (CSS_GENERIC_FAMILIES.has(name.toLowerCase())) return name;
  if (/^["'].*["']$/.test(name)) return name;
  const quoted = `"${name.replace(/["\\]/g, '\\$&')}"`;
  const generic = genericFor(name);
  return generic ? `${quoted}, ${generic}` : quoted;
}
