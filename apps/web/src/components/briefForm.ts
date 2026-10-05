import type { AppBriefFields, BriefTone, PresetKey } from "@chitrapx/document";

export type BriefForm = { text: string; audience: string; tone: string; keywords: string };

const keywordList = (s: string) => s.split(",").map((k) => k.trim()).filter(Boolean);

/** The AI card's fields as the app's brief: what "Save brief" PATCHes and what a design starts with. */
export function briefPatch(form: BriefForm, preset: PresetKey | ""): AppBriefFields {
  return { text: form.text, audience: form.audience, tone: form.tone as BriefTone | "", keywords: keywordList(form.keywords), preset };
}
