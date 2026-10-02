# Sub-project 4: AI Pipeline

**Date:** 2026-10-02
**Status:** Derived from the approved architecture (main spec, section A7); built on the user's instruction "continue".
**Parent spec:** `2026-10-02-chitrapx-design.md`

## Goal

From an app's uploaded screenshots, description and an optional brief, Chitrapx produces a finished, on-brand screenshot set in one click, translates it into chosen store languages, and offers alternative copy. The model never edits document JSON: it returns small typed plans and our code applies them, so every result is a valid, undoable document.

## Decisions

1. **SDK and models.** `@anthropic-ai/sdk` in the worker. Screenshot analysis and translation: `claude-haiku-4-5`. Template choice, copywriting and variants: `claude-sonnet-5-5` with adaptive thinking (default) and server-side refusal fallbacks (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). Structured outputs through `client.beta.messages.parse` with Zod schemas.
2. **Images.** Screenshots are downloaded by the worker, resized with `sharp` to at most 1568 px on the long edge, re-encoded as JPEG, and sent inline as base64 (signed storage URLs are not reachable by Anthropic from private deployments).
3. **Insight cache.** `screen_insights (workspace_id, sha256)` stores each screenshot's analysis; a screenshot is analysed once per workspace.
4. **Design = pick, then write.** Call 1 picks a template and the screenshot order from a compact template catalog (`packages/assets/catalog.json`, generated from the templates, sent as a cached system block). Call 2 receives the chosen template's text slots (element id, role, current text, length) per board and returns new text per slot. Code applies: screenshots into device screens in the chosen order, text into the named slots (unknown ids ignored, length capped at twice the original), brand colours untouched.
5. **Translate.** For each requested locale, all base text slots go to the model with a glossary (app name, brand terms) that must stay verbatim; results become locale overrides with `origin: "auto"`. Existing manual overrides are never overwritten.
6. **Copy variants.** Three alternatives (confident, warm, punchy) for every slot, returned in the job output; the editor applies one as a single undoable step.
7. **Pricing** (in `pricing.ts`): `ai_design` 10 credits, `ai_translate` 2 credits per locale, `ai_copy` 3 credits. Reserved up front, refunded on failure.
8. **Writes to projects.** Worker jobs update the project document in a transaction with `select ... for update` and increment the revision, so an open editor gets a conflict dialog instead of a silent overwrite.
9. **Errors.** Rate limits, overload, 5xx and connection errors retry through pg-boss. Bad requests, refusals, invalid output after one repair attempt, and unknown template choices fail the job and refund.
10. **Usage.** Every job stores token usage (input, output, cache read, cache write per model) in `jobs.output.usage` for price tuning.

## Acceptance criteria

- A design job for an app with 3 screenshots produces a document from a catalog template, device screens filled in the planned order, planned text in the named slots, charges 10 credits; any failure refunds.
- A second design for the same screenshots does not re-analyse them.
- A translate job for `de-DE` and `fr-FR` writes overrides for both, adds both languages, keeps a manual override untouched, and charges 4 credits.
- A copy job returns three tone variants covering the project's text slots; applying one in the editor is one undo step.
- The catalog is regenerated from templates in CI and the build fails if it is stale.
- With `ANTHROPIC_API_KEY` set, a live smoke run designs a project end to end.
