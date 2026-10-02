/** Plain-language job errors (codes come from the worker). */
const MESSAGES: Record<string, string> = {
  ai_not_configured: "AI is not set up on this server yet.",
  no_screenshots: "Upload at least one screenshot first.",
  ai_refused: "The AI declined this request. Try a different brief.",
  ai_unknown_template: "The AI picked a template we could not find. Please try again.",
  ai_output_too_long: "The AI answer was too long. Please try again.",
  nothing_to_translate: "There is no text to translate yet.",
  nothing_to_rewrite: "There is no text to rewrite yet.",
  project_is_empty: "This project has no boards yet.",
};
export function jobError(error: string | null | undefined): string {
  if (!error) return "Something went wrong.";
  const code = error.split(/[:\s]/)[0]!;
  return MESSAGES[code] ?? (code.startsWith("asset_missing") ? "A screenshot this design uses was removed." : "Something went wrong. Your credits were refunded.");
}
export const JOB_LABEL: Record<string, string> = { ai_design: "AI design", ai_translate: "Translation", ai_copy: "Copy ideas", export: "Export" };
