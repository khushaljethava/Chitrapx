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
  /** One App Preview or social video. */
  video: 3,
} as const;

export type JobType = keyof typeof PRICES;

/** What a job costs to reserve. Translation is charged per language; everything else is flat. */
export function priceFor(type: JobType, input: unknown): number {
  if (type === "ai_translate") {
    const locales = (input as { locales?: unknown[] } | null)?.locales;
    return PRICES.ai_translate * Math.max(1, Array.isArray(locales) ? locales.length : 1);
  }
  return PRICES[type];
}
