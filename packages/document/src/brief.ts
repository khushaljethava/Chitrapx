import { z } from "zod";
import { PRESET_KEYS, type PresetKey } from "./presets.ts";

/** SP11: one brief per app. Free text plus optional structured fields, all serialised into the prompts by briefText. */
export const BRIEF_MAX = 2000;
export const BRIEF_TOO_LONG = `Keep the brief under ${BRIEF_MAX} characters`;
export const BRIEF_TONES = ["friendly", "professional", "playful", "bold", "calm", "premium"] as const;
export type BriefTone = (typeof BRIEF_TONES)[number];

/** Case-insensitive de-duplication that keeps the first spelling and the order. */
export function uniqueTerms(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((w) => {
    const k = w.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Field rules shared by the app PATCH and the AI design start. */
export const briefFields = {
  text: z.string().trim().max(BRIEF_MAX, BRIEF_TOO_LONG),
  audience: z.string().trim().max(200, "Keep the audience under 200 characters"),
  /** "" clears the tone. */
  tone: z.enum(BRIEF_TONES).or(z.literal("")),
  keywords: z.array(z.string().trim().min(1).max(40, "Keywords can be up to 40 characters"))
    .max(10, "Up to 10 keywords").transform(uniqueTerms),
};

export const briefSchema = z.object({
  text: briefFields.text.optional(),
  audience: briefFields.audience.optional(),
  tone: briefFields.tone.optional(),
  keywords: briefFields.keywords.optional(),
  competitor: z.string().trim().max(3000, "Keep the competitor notes under 3000 characters").optional(),
  preset: z.enum(PRESET_KEYS).or(z.literal("")).optional(),
}).strict();

/** What `apps.brief` holds. Every field is optional; a new app has `{}`. */
export type AppBriefFields = {
  text?: string;
  audience?: string;
  tone?: BriefTone | "";
  keywords?: string[];
  /** A preset key, or "" for none. */
  preset?: PresetKey | "";
  /** The editable summary of the analysed competitor images. */
  competitor?: string;
};

/** The brief as every prompt reads it: free text, then one line per structured field. Empty fields are left out. */
export function briefText(b: AppBriefFields | null | undefined): string {
  if (!b) return "";
  const lines = [b.text?.trim() ?? ""];
  if (b.audience?.trim()) lines.push(`Audience: ${b.audience.trim()}`);
  if (b.tone) lines.push(`Tone: ${b.tone}`);
  if (b.keywords?.length) lines.push(`Keywords: ${b.keywords.join(", ")}`);
  return lines.filter(Boolean).join("\n");
}

export const GLOSSARY_MAX = 50;
/** Terms AI translation keeps exactly as written. The worker always adds the app name. */
export const glossarySchema = z.array(z.string().trim().min(1).max(60, "Glossary terms can be up to 60 characters"))
  .max(GLOSSARY_MAX, `Up to ${GLOSSARY_MAX} glossary terms`).transform(uniqueTerms);
