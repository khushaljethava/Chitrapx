// Style names and numeric values from app-store-screenshots (MIT), skills/app-store-screenshots/style-prompts/
// 01–18. Descriptions are our own. Only what the renderer draws today: background, fonts, colours, text and device treatment.
import { produce } from "immer";
import type { ElementShadow } from "./artboard.ts";
import type { BrandToken } from "./brand.ts";
import type { ChitrapxDoc } from "./doc.ts";
import type { Gradient } from "./gradient.ts";

export type TextCase = "none" | "upper" | "lower";
type Align = "left" | "center" | "right";
export type StyleDef = {
  id: string; name: string; description: string;
  fonts: { heading: string; body: string };
  palette: Record<BrandToken, string>;
  background: { color: string } | { gradient: Gradient };
  headline: { sizePct: [number, number]; weight: number; tracking: number; lineHeight: number; case: TextCase; align: Align };
  body: { weight: number; lineHeight: number; case: TextCase; align: Align };
  device: { rotation: number; shadow: ElementShadow | null; frameStyle: "solid" | "outline" };
};

const lin = (angle: number, from: string, to: string): { gradient: Gradient } => ({ gradient: { kind: "linear", angle, stops: [{ color: from, at: 0 }, { color: to, at: 1 }] } });
const pal = (primary: string, secondary: string, accent: string, surface: string, text: string, muted: string) => ({ primary, secondary, accent, surface, text, muted });
const shadow = (x: number, y: number, blur: number, color: string): ElementShadow => ({ x, y, blur, color });

export const STYLES: StyleDef[] = [
  { id: "retro-rubberhose-mascot", name: "Retro Rubberhose", description: "Warm cream paper, chunky soft serif headlines in dark brown ink, like a 1930s cartoon poster.",
    fonts: { heading: "Fraunces", body: "Nunito" }, palette: pal("#F2BB46", "#F19A8E", "#C0392B", "#F4E6CC", "#2A2118", "#5C3A1E"), background: { color: "#F4E6CC" },
    headline: { sizePct: [6.8, 7.7], weight: 900, tracking: -0.01, lineHeight: 1.05, case: "none", align: "left" }, body: { weight: 700, lineHeight: 1.3, case: "none", align: "left" },
    device: { rotation: 0, shadow: shadow(0, 24, 48, "rgba(92,58,30,0.25)"), frameStyle: "solid" } },
  { id: "moody-curated-dating", name: "Moody Curated", description: "Candle-lit near-black grounds with a large cream serif headline and warm tungsten accents.",
    fonts: { heading: "Playfair Display", body: "Inter" }, palette: pal("#C99566", "#8A5A33", "#E8B97A", "#0A0A0B", "#F4EBDD", "#B8AFA2"), background: lin(180, "#1F1C1A", "#0A0A0B"),
    headline: { sizePct: [11, 13.5], weight: 400, tracking: -0.005, lineHeight: 1.08, case: "none", align: "center" }, body: { weight: 400, lineHeight: 1.3, case: "none", align: "center" },
    device: { rotation: 0, shadow: shadow(0, 30, 60, "rgba(0,0,0,0.6)"), frameStyle: "solid" } },
  { id: "paper-sticker-skeuomorphic", name: "Paper Sticker", description: "A mint corkboard with hand-lettered marker headlines in deep navy and sticker-bright accents.",
    fonts: { heading: "Permanent Marker", body: "Nunito" }, palette: pal("#3E8FD6", "#8FBE7C", "#F25C8E", "#F8F0E2", "#1F2A44", "#2B3A55"), background: { color: "#8FBE7C" },
    headline: { sizePct: [10.6, 12.1], weight: 400, tracking: -0.01, lineHeight: 1, case: "none", align: "center" }, body: { weight: 600, lineHeight: 1.3, case: "none", align: "center" },
    device: { rotation: 2, shadow: shadow(6, 18, 24, "rgba(60,40,20,0.30)"), frameStyle: "solid" } },
  { id: "dreamy-pastel-couples", name: "Dreamy Pastel", description: "A soft sky-to-peach wash with centred navy headlines and lilac accents.",
    fonts: { heading: "Inter", body: "Inter" }, palette: pal("#9B87E8", "#F3B6CC", "#DDEBFA", "#F5E0F0", "#1B2240", "#5D6380"), background: lin(180, "#DDEBFA", "#FCEFD6"),
    headline: { sizePct: [8, 9.5], weight: 600, tracking: -0.01, lineHeight: 1.05, case: "none", align: "center" }, body: { weight: 500, lineHeight: 1.4, case: "none", align: "center" },
    device: { rotation: 0, shadow: shadow(0, 20, 40, "rgba(27,34,64,0.18)"), frameStyle: "solid" } },
  { id: "hand-drawn-editorial-tasks", name: "Editorial Tasks", description: "Flat deep-navy slides, confident medium sans headlines, coral accents and boldly tilted phones.",
    fonts: { heading: "Inter", body: "Inter" }, palette: pal("#F26A50", "#7B61FF", "#F5EFDF", "#0E1018", "#FFFFFF", "#B8C0D3"), background: { color: "#1B2336" },
    headline: { sizePct: [7.5, 9.5], weight: 500, tracking: -0.01, lineHeight: 1.1, case: "none", align: "left" }, body: { weight: 400, lineHeight: 1.35, case: "none", align: "left" },
    device: { rotation: 12, shadow: shadow(0, 36, 60, "rgba(184,86,64,0.30)"), frameStyle: "solid" } },
  { id: "glossy-3d-kbeauty-creator", name: "Glossy K-Beauty", description: "Saturated violet grounds, heavy white headlines and sunny yellow highlights.",
    fonts: { heading: "Inter", body: "Inter" }, palette: pal("#FBE254", "#7B3FE4", "#FFE16B", "#2A1B4A", "#FFFFFF", "#E9E1FF"), background: lin(180, "#7B3FE4", "#3B1C7A"),
    headline: { sizePct: [8, 10], weight: 900, tracking: -0.02, lineHeight: 1, case: "none", align: "center" }, body: { weight: 600, lineHeight: 1.25, case: "none", align: "center" },
    device: { rotation: 0, shadow: shadow(0, 24, 48, "rgba(40,10,80,0.45)"), frameStyle: "solid" } },
  { id: "liquid-glass-aurora", name: "Liquid Glass Aurora", description: "Pale lavender-to-apricot aurora light behind crisp, tightly tracked ink headlines.",
    fonts: { heading: "Inter Tight", body: "Inter Tight" }, palette: pal("#CDBBFF", "#AFD5FF", "#F7ECF3", "#F4F1FB", "#16131F", "#4A4660"), background: lin(160, "#EFE9FD", "#FDEBDF"),
    headline: { sizePct: [11.4, 13.3], weight: 700, tracking: -0.032, lineHeight: 0.98, case: "none", align: "center" }, body: { weight: 500, lineHeight: 1.28, case: "none", align: "center" },
    device: { rotation: 0, shadow: shadow(0, 40, 80, "rgba(90,60,180,0.25)"), frameStyle: "solid" } },
  { id: "swiss-grid-bold", name: "Swiss Grid Bold", description: "Off-white paper, giant flush-left heavy grotesk, upright phones and one orange signal.",
    fonts: { heading: "Inter Tight", body: "Inter Tight" }, palette: pal("#FF4F00", "#0E0E0C", "#F2F1EC", "#F2F1EC", "#0E0E0C", "#5E5D57"), background: { color: "#F2F1EC" },
    headline: { sizePct: [12.1, 14.4], weight: 800, tracking: -0.045, lineHeight: 0.9, case: "none", align: "left" }, body: { weight: 500, lineHeight: 1.15, case: "none", align: "left" },
    device: { rotation: 0, shadow: shadow(0, 22, 34, "rgba(14,14,12,0.14)"), frameStyle: "solid" } },
  { id: "neon-athletic-night", name: "Neon Athletic Night", description: "Stadium-night black, huge condensed uppercase headlines, one electric volt accent and tilted phones.",
    fonts: { heading: "Anton", body: "Barlow" }, palette: pal("#D4FF3A", "#A3A8AF", "#FF6A1A", "#0A0B0D", "#F4F5F0", "#A3A8AF"), background: lin(180, "#17191D", "#0A0B0D"),
    headline: { sizePct: [17.4, 22], weight: 400, tracking: -0.005, lineHeight: 0.88, case: "upper", align: "left" }, body: { weight: 500, lineHeight: 1.3, case: "none", align: "left" },
    device: { rotation: 8, shadow: shadow(0, 30, 60, "rgba(0,0,0,0.6)"), frameStyle: "solid" } },
  { id: "magazine-cover-editorial", name: "Magazine Cover", description: "Uncoated-paper grounds, a big high-contrast serif cover line and an oxblood accent.",
    fonts: { heading: "Fraunces", body: "Fraunces" }, palette: pal("#7A2320", "#2F4A3A", "#5E1917", "#F1EBE1", "#1A1714", "#4A423A"), background: { color: "#F1EBE1" },
    headline: { sizePct: [15.2, 16.3], weight: 400, tracking: -0.02, lineHeight: 1, case: "none", align: "left" }, body: { weight: 400, lineHeight: 1.2, case: "none", align: "left" },
    device: { rotation: 0, shadow: shadow(0, 28, 50, "rgba(122,35,32,0.22)"), frameStyle: "solid" } },
  { id: "candy-pop-social", name: "Candy Pop", description: "One loud flat colour per slide, chunky lowercase display type and hard offset shadows.",
    fonts: { heading: "Bricolage Grotesque", body: "Rubik" }, palette: pal("#FF5FA8", "#2B44F0", "#C6F135", "#FFFFFF", "#16121F", "#16121F"), background: { color: "#FF5FA8" },
    headline: { sizePct: [15.2, 18.2], weight: 800, tracking: -0.035, lineHeight: 0.9, case: "lower", align: "left" }, body: { weight: 700, lineHeight: 1.18, case: "none", align: "left" },
    device: { rotation: 6, shadow: shadow(18, 18, 0, "#D63D86"), frameStyle: "solid" } },
  { id: "soft-clay-wellness", name: "Soft Clay Wellness", description: "Warm oat grounds, a soft serif headline and terracotta clay accents for calm, tactile apps.",
    fonts: { heading: "Fraunces", body: "DM Sans" }, palette: pal("#C7765A", "#A9B79C", "#9A4B31", "#EFE7DA", "#3A2E26", "#6B5E52"), background: lin(180, "#F6F0E6", "#E6DACA"),
    headline: { sizePct: [12.1, 14.4], weight: 400, tracking: -0.025, lineHeight: 1, case: "none", align: "left" }, body: { weight: 400, lineHeight: 1.3, case: "none", align: "left" },
    device: { rotation: 0, shadow: shadow(0, 30, 60, "rgba(148,73,47,0.22)"), frameStyle: "solid" } },
  { id: "midnight-glow-pro", name: "Midnight Glow Pro", description: "A deep blue-black void, semibold tight headlines and a soft violet glow behind the phone.",
    fonts: { heading: "Inter Tight", body: "Inter" }, palette: pal("#8B7CFF", "#B4B9C6", "#5EE6FF", "#07080B", "#F4F5F8", "#B4B9C6"), background: lin(180, "#0B0D13", "#050608"),
    headline: { sizePct: [10.6, 12.1], weight: 600, tracking: -0.03, lineHeight: 1, case: "none", align: "center" }, body: { weight: 400, lineHeight: 1.35, case: "none", align: "center" },
    device: { rotation: 0, shadow: shadow(0, 40, 90, "rgba(120,110,255,0.30)"), frameStyle: "solid" } },
  { id: "risograph-zine", name: "Risograph Zine", description: "Newsprint paper, condensed uppercase headlines in riso blue and a fluorescent pink accent.",
    fonts: { heading: "Anton", body: "Archivo" }, palette: pal("#FF48B0", "#3255A4", "#FFE800", "#F4F0E6", "#3255A4", "#321871"), background: { color: "#F4F0E6" },
    headline: { sizePct: [18.2, 21.2], weight: 400, tracking: -0.005, lineHeight: 0.9, case: "upper", align: "left" }, body: { weight: 600, lineHeight: 1.18, case: "none", align: "left" },
    device: { rotation: -2, shadow: shadow(0, 16, 24, "rgba(50,24,113,0.30)"), frameStyle: "solid" } },
  { id: "bento-keynote-grid", name: "Bento Keynote", description: "A light keynote ground, clean bold sans headlines and one saturated brand accent.",
    fonts: { heading: "Inter Tight", body: "Inter" }, palette: pal("#B4441C", "#1D1D1F", "#F6EBE1", "#FFFFFF", "#1D1D1F", "#5E5E63"), background: { color: "#F5F5F7" },
    headline: { sizePct: [9.1, 10.6], weight: 700, tracking: -0.03, lineHeight: 1, case: "none", align: "left" }, body: { weight: 500, lineHeight: 1.3, case: "none", align: "left" },
    device: { rotation: 0, shadow: shadow(0, 24, 48, "rgba(0,0,0,0.12)"), frameStyle: "solid" } },
  { id: "toybox-primary", name: "Toybox Primary", description: "Warm cream with rounded chunky headlines in deep ink and bright primary toy colours.",
    fonts: { heading: "Baloo 2", body: "Nunito" }, palette: pal("#FF4B3E", "#3FA9F5", "#FFC940", "#FFF6E6", "#1F1A4D", "#5B5480"), background: { color: "#FFF6E6" },
    headline: { sizePct: [12.1, 14.4], weight: 800, tracking: -0.02, lineHeight: 0.95, case: "none", align: "center" }, body: { weight: 800, lineHeight: 1.2, case: "none", align: "center" },
    device: { rotation: 5, shadow: shadow(0, 20, 0, "rgba(31,26,77,0.35)"), frameStyle: "solid" } },
  { id: "quiet-japandi", name: "Quiet Japandi", description: "Washi-paper calm, a refined mincho headline and natural oak accents with plenty of air.",
    fonts: { heading: "Shippori Mincho", body: "Zen Kaku Gothic New" }, palette: pal("#C9A97E", "#7A5A34", "#E9D6B4", "#F3F0EA", "#1E1D1B", "#4E4B46"), background: lin(180, "#FCFAF6", "#E2DBCF"),
    headline: { sizePct: [11.5, 12.5], weight: 500, tracking: -0.012, lineHeight: 1.05, case: "none", align: "left" }, body: { weight: 400, lineHeight: 1.35, case: "none", align: "left" },
    device: { rotation: 0, shadow: shadow(0, 18, 40, "rgba(30,29,27,0.12)"), frameStyle: "solid" } },
  { id: "vintage-travel-poster", name: "Vintage Travel Poster", description: "Dusk-plum poster bands, tall uppercase display headlines in cream and mustard accents.",
    fonts: { heading: "Bebas Neue", body: "Zilla Slab" }, palette: pal("#D9622B", "#E8B04A", "#1F5C5B", "#4B2E4F", "#F1E4C8", "#F2CF8C"), background: { color: "#4B2E4F" },
    headline: { sizePct: [21.2, 24.2], weight: 400, tracking: 0.01, lineHeight: 0.9, case: "upper", align: "center" }, body: { weight: 700, lineHeight: 1.2, case: "upper", align: "center" },
    device: { rotation: 0, shadow: shadow(0, 24, 40, "rgba(28,26,23,0.4)"), frameStyle: "solid" } },
];

export const getStyle = (id: string) => STYLES.find((s) => s.id === id);

/** Every field applyStyle may write; nothing else is ever touched. */
export const STYLE_FIELDS = {
  board: ["backgroundType", "backgroundColor", "backgroundGradient"],
  text: ["fontFamily", "fontWeight", "fontSize", "color", "letterSpacing", "lineHeight", "textTransform", "textAlign", "gradient"],
  device: ["rotation", "shadow", "frameStyle"],
};

const CASE: Record<TextCase, "uppercase" | "lowercase" | undefined> = { none: undefined, upper: "uppercase", lower: "lowercase" };
const round2 = (n: number) => Math.round(n * 100) / 100;
/** Writes only what differs (undefined deletes), so re-applying a style changes nothing and adds no undo step. */
function put(o: Record<string, unknown>, k: string, v: unknown) {
  if (v === undefined) { if (k in o) delete o[k]; return; }
  if (JSON.stringify(o[k]) !== JSON.stringify(v)) o[k] = typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v;
}

/**
 * Applies a named style to every board of a group: background, text fonts/colours/weights/tracking/line
 * height/case/alignment, device rotation/shadow/frame. Never content, marks, sources or translations.
 * The headline is each board's top-most text (smallest y), so the choice never depends on a previous style.
 */
export function applyStyle(doc: ChitrapxDoc, groupId: string, styleId: string): ChitrapxDoc {
  const style = getStyle(styleId);
  if (!style || !doc.groups.find((g) => g.id === groupId)?.boards.length) return doc;
  return produce(doc, (d) => {
    const g = d.groups.find((x) => x.id === groupId)!;
    if (g.styleId !== style.id) g.styleId = style.id;
    for (const b of g.boards) {
      const board = b as unknown as Record<string, unknown>;
      if ("gradient" in style.background) {
        const { stops, angle } = style.background.gradient;
        put(board, "backgroundType", "gradient");
        put(board, "backgroundColor", stops[0]!.color);
        put(board, "backgroundGradient", { color1: stops[0]!.color, color2: stops.at(-1)!.color, angle: angle ?? 180 });
      } else {
        put(board, "backgroundType", "solid");
        put(board, "backgroundColor", style.background.color);
        put(board, "backgroundGradient", undefined);
      }
      const texts = b.elements.filter((e) => e.type === "text");
      const headline = texts.reduce<(typeof texts)[number] | undefined>((best, e) => (!best || e.position.y < best.position.y ? e : best), undefined);
      for (const t of texts) {
        const o = t as unknown as Record<string, unknown>;
        const isHead = t === headline;
        const rules = isHead ? style.headline : style.body;
        put(o, "fontFamily", isHead ? style.fonts.heading : style.fonts.body);
        put(o, "fontWeight", String(rules.weight));
        put(o, "color", isHead ? style.palette.text : style.palette.muted);
        put(o, "lineHeight", rules.lineHeight);
        put(o, "textTransform", CASE[rules.case]);
        put(o, "textAlign", rules.align);
        put(o, "gradient", undefined);
        if (isHead) {
          const [lo, hi] = style.headline.sizePct;
          const fontSize = round2(((b.size.width * (lo + hi)) / 2 / 100) * 0.3); // rendered px = fontSize / 0.3
          put(o, "fontSize", fontSize);
          put(o, "letterSpacing", style.headline.tracking ? round2(style.headline.tracking * fontSize) : undefined); // tracking em, in fontSize units
        }
      }
      for (const e of b.elements) {
        if (e.type !== "device" && e.type !== "video-device") continue;
        const o = e as unknown as Record<string, unknown>;
        put(o, "rotation", style.device.rotation);
        put(o, "shadow", style.device.shadow ?? undefined);
        put(o, "frameStyle", style.device.frameStyle);
      }
    }
  });
}
