import type { CatalogEntry, ScreenInsight, SlotText, TextSlot } from "@chitrapx/document";

export type AppBrief = {
  name: string;
  description: string;
  platform: string;
  brief: string;
  brand: { primaryColor?: string; secondaryColor?: string };
};

const STYLE = `Write like the best App Store screenshot copy: short, concrete benefits a shopper understands at a glance.
Headlines are 2 to 5 words per line. Use the app's own vocabulary from the screenshots. No hype words like "revolutionary" or "ultimate", no exclamation marks, no em or en dashes, no emoji unless the original slot used them.`;

export const ANALYZE_SYSTEM = `You look at one mobile app screenshot and describe it for a designer who will turn it into an App Store marketing screenshot. Be specific about what is visible. Do not invent features that are not on screen.`;

export const PICK_SYSTEM = `You are an expert App Store and Google Play screenshot designer. Choose the template that best fits the app and decide the order of its screenshots.

Order screenshots for conversion: the first slot is the hero (the core value), then the main feature, then what makes the app different, then trust or delight. Pick a template whose number of device screens fits the number of screenshots and whose style suits the app's category and brand. Answer with a template slug that exists in the catalog below.`;

export const catalogContext = (catalog: CatalogEntry[]) =>
  `Template catalog (JSON). Each board lists how many screenshots (devices) and text slots it has.\n${JSON.stringify(catalog)}`;

export function pickPrompt(app: AppBrief, insights: ScreenInsight[]): string {
  return `App: ${app.name} (${app.platform})
Description: ${app.description || "(none)"}
Brief from the team: ${app.brief || "(none)"}
Brand colours: ${[app.brand.primaryColor, app.brand.secondaryColor].filter(Boolean).join(", ") || "(none)"}

Screenshots, by index:
${insights.map((s, i) => `${i}. ${s.summary} Feature: ${s.feature}. Mood: ${s.mood}.`).join("\n")}`;
}

export const COPY_SYSTEM = `You write the text for every text slot of an App Store screenshot template.
${STYLE}
Each slot has an id, a role (its name in the design), the template's sample text and a maximum length. Keep the shape of the sample: if a headline is split across several slots (for example an accent word in its own slot), split yours the same way so the design still reads naturally. Ratings, badges and small labels stay short and plausible; never invent statistics, awards or press quotes, and replace sample ones with neutral, truthful wording. Return text for every slot.`;

/** `perBoard[i]` lists positions in `order` shown on board i (none, one, or several devices). */
export function copyPrompt(app: AppBrief, insights: ScreenInsight[], order: number[], perBoard: number[][], slots: TextSlot[][]): string {
  return `App: ${app.name}
Description: ${app.description || "(none)"}
Brief: ${app.brief || "(none)"}

Boards in order, with the screenshots each one shows.
${slots.map((board, i) => {
    const shots = (perBoard[i] ?? []).map((k) => insights[order[k] ?? -1]).filter((s): s is ScreenInsight => !!s);
    return `Board ${i}${shots.length ? ` shows: ${shots.map((s) => `${s.summary} (feature: ${s.feature})`).join("; ")}` : " shows no screenshot"}
${board.map((s) => `  - id "${s.id}", role "${s.role}", max ${s.maxChars} chars, sample: ${JSON.stringify(s.text)}`).join("\n")}`;
  }).join("\n\n")}`;
}

export function translateSystem(localeName: string, glossary: string[]) {
  return `Translate App Store screenshot text into ${localeName}. Keep it as short and punchy as the source; a translation may be shorter but should not be much longer. Keep line breaks where the source has them. Keep these terms exactly as written, untranslated: ${glossary.length ? glossary.map((g) => JSON.stringify(g)).join(", ") : "(none)"}. Keep numbers, symbols and emoji. Return one translation for every id.`;
}

export const translatePrompt = (texts: SlotText[]) => JSON.stringify(texts);

export const VARIANTS_SYSTEM = `You rewrite App Store screenshot copy in three tones: confident (bold, assured), warm (friendly, human), punchy (shortest, rhythmic).
${STYLE}
Keep each slot's role and roughly its length. Return all three tones, each with text for every id.`;

export const variantsPrompt = (appName: string, texts: SlotText[]) => `App: ${appName}\nCurrent copy (id and text):\n${JSON.stringify(texts)}`;
