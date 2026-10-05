import { competitorInsightSchema, MAX_REFERENCES_PER_APP, type CompetitorInsight } from "@chitrapx/document";

export type ReferenceRow = { id: string; url: string; insight: unknown };

/** An image's analysis, or null while it is not analysed (or the stored shape is outdated, which re-analyses). */
export function insightOf(raw: unknown): CompetitorInsight | null {
  const p = competitorInsightSchema.safeParse(raw);
  return p.success ? p.data : null;
}
/** Matches the server: only images with no analysis row are charged (F5). */
export const analyseCost = (rows: ReferenceRow[]) => Math.min(MAX_REFERENCES_PER_APP, rows.filter((r) => r.insight == null).length);
export const slotsLeft = (rows: ReferenceRow[]) => Math.max(0, MAX_REFERENCES_PER_APP - rows.length);
export function analyseLabel(rows: ReferenceRow[]): string {
  const n = analyseCost(rows);
  return n ? `Analyse (${n} credit${n === 1 ? "" : "s"})` : "Refresh summary (free)";
}
