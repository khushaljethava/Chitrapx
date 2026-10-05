/** Plain-language job errors (codes come from the worker). */
const MESSAGES: Record<string, string> = {
  ai_not_configured: "AI is not set up on this server yet.",
  no_screenshots: "Upload at least one screenshot first.",
  no_chips: "This project has no feature chips to regenerate.",
  ai_refused: "The AI declined this request. Try a different brief.",
  ai_unknown_template: "The AI picked a template we could not find. Please try again.",
  ai_output_too_long: "The AI answer was too long. Please try again.",
  nothing_to_translate: "There is no text to translate yet.",
  nothing_to_rewrite: "There is no text to rewrite yet.",
  project_is_empty: "This project has no boards yet.",
  ai_incomplete: "The AI answer was incomplete. Please try again.",
  ai_output_invalid: "The AI answer could not be used. Please try again.",
  too_much_text: "There is too much text to send to the AI at once. Shorten or split the project.",
  rate_limited: "Free downloads are limited to 30 per hour.",
  single_export_needs_one_board: "That board no longer exists. Reload and try again.",
  bundle_too_large: "This project's screenshots and recordings are over 500 MB, too large for one project file.",
  bundle_invalid: "This is not a Chitrapx project file, or it is damaged.",
  bundle_asset_mismatch: "A screenshot or recording in this project file is damaged.",
  bundle_version_unsupported: "This project file was made by a newer version of Chitrapx.",
  plan_limit: "Your plan's project limit is reached.",
  project_missing: "This project was deleted.",
  abandoned: "The job stopped unexpectedly.",
};
export function jobError(error: string | null | undefined): string {
  if (!error) return "Something went wrong.";
  const code = error.split(/[:\s]/)[0]!;
  return MESSAGES[code] ?? (code.startsWith("asset_missing") ? "A screenshot this design uses was removed." : "Something went wrong. Your credits were refunded.");
}
export const JOB_LABEL: Record<string, string> = { ai_design: "AI design", ai_translate: "Translation", ai_copy: "Copy ideas", ai_chips: "Feature chips", export: "Export", export_single: "PNG", project_bundle: "Project file", project_import: "Import" };
