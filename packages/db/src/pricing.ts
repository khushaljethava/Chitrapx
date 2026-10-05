import { MAX_REFERENCES_PER_APP } from "@chitrapx/document";

/** Credits charged per job type. The only place prices are defined. */
export const PRICES = {
  noop: 1,
  /** One run renders every board in every locale into a ZIP. */
  export: 1,
  /** Analyse screenshots, pick a template, write the copy, build the set. */
  ai_design: 10,
  /** Per requested language. */
  ai_translate: 2,
  /** Three alternative copy sets. */
  ai_copy: 3,
  /** SP11: new feature chips for a project (free when AI design writes them). */
  ai_chips: 1,
  /** SP11: per competitor image not yet analysed (at most MAX_REFERENCES_PER_APP per run). Cached images are free. */
  ai_reference: 1,
  /** One App Preview or social video. */
  video: 3,
  /** Converting an uploaded screen recording for playback. Free. */
  process_recording: 0,
  /** One board as a PNG. Free, limited per hour (FREE_JOBS_PER_HOUR in the web app). */
  export_single: 0,
  /** Download the project as a .chitrapx file. Free, limited per hour. */
  project_bundle: 0,
  /** Create a project from a .chitrapx file. Free. */
  project_import: 0,
} as const;

export type JobType = keyof typeof PRICES;

/** What a job costs to reserve. Translation is charged per language; everything else is flat. */
export function priceFor(type: JobType, input: unknown): number {
  if (type === "ai_translate") {
    const locales = (input as { locales?: unknown[] } | null)?.locales;
    return PRICES.ai_translate * Math.max(1, Array.isArray(locales) ? locales.length : 1);
  }
  if (type === "ai_reference") {
    const uncached = (input as { uncached?: unknown[] } | null)?.uncached;
    return PRICES.ai_reference * Math.min(MAX_REFERENCES_PER_APP, Array.isArray(uncached) ? uncached.length : 0);
  }
  return PRICES[type];
}
