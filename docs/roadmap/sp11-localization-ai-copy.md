# SP11: Localization and AI copy

**Status:** Not started
**Goal:** Users manage every language in one table (edit, import, export, AI-translate), ship correct right-to-left layouts, and steer AI copy with app-type presets, an optional brief, AI feature chips and an analysed competitor reference board.
**Depends on:** SP8 (done: export of every board in every locale, store sizes incl. `play-feature`). SP10 (fonts: Arabic, Hebrew and CJK faces must be bundled and selectable before RTL and script fonts are reliable).
**Gap source:** storeshots (translations manager, CSV/JSON, feature chips, vertical presets, AI brief; ideas only), open-screenshot-generator (translation table, CSV, RTL), PixelDeck (AI translation, bulk translate), app-store-screenshots (RTL guidance, copy ideas).

## Features

### 11.1 Translations table

- **What it does:** One table with a row per text element and a column per language, base language first. Users edit cells inline, import and export CSV or JSON, and AI-translate from any one language into others.
- **Details:**
  - Rows come from `localizableTextElements` and the row/column model in the renderer's i18n code; grouped by board.
  - Cell states: translated, untranslated, stale (base text changed after the override was written), manual vs automatic. Stale and untranslated cells are highlighted; a per-language completion count shows in the column header.
  - CSV export: one row per element id, one column per locale, plus board and label columns. CSV import previews a diff (added, changed, unchanged, unknown ids) before applying; unknown ids are reported, never silently dropped. UTF-8 with BOM for Excel; quote and newline escaping must round-trip.
  - JSON export/import: `{ locale: { elementId: text } }`. Same preview step.
  - AI-translate: pick a source language (default base language) and target languages. Cells edited manually are never overwritten unless the user ticks "overwrite manual". Charge per language, only for languages that return enough coverage (existing behaviour in `runAiTranslate`).
  - Source other than the base language: the worker today always reads base text; translation from another language needs the source column's text passed in the job input.
  - Glossary: app name is already kept untranslated; add user-editable "do not translate" terms per app.
  - Length guard: warn when a translation exceeds the slot's `maxChars`-style budget; auto-shrink is derived at render time, not stored.
- **Acceptance criteria:**
  - Opening the table on a project with 3 locales shows every text element in every locale, with untranslated cells visibly marked.
  - Editing a cell and reloading keeps the edit and marks it manual.
  - Export CSV, change two cells in a spreadsheet, import: the preview lists exactly two changes and applying updates only those two overrides.
  - Importing a CSV with an unknown element id reports it and imports the rest.
  - Translate ar and de from fr: both columns fill, manual cells are untouched, the ledger shows 2 credits per language that succeeded.
  - A project with insufficient credits cannot start the job; a failed language is not charged.
  - Export (SP8 flow) renders the imported text for each locale.
- **Chitrapx today:**
  - Data model exists: `ElementLocaleOverride`, `localized`, `localization` in `packages/document/src/artboard.ts:365,530`.
  - Rendering/projection and helpers exist: `packages/renderer/src/osg/i18n/localization.ts` (`localeCompletion`, `untranslatedCount`, `isStaleOverride`, `overrideStateFor`), `project.ts` (`projectArtboards`, `resolveLocaleFontSize`), `locales.ts`.
  - AI translate end to end: `apps/web/src/app/api/projects/[projectId]/translate/route.ts`, `apps/web/src/server/ai.ts` (`startTranslate`), `apps/worker/src/ai/jobs.ts` (`runAiTranslate`), prompts in `apps/worker/src/ai/prompts.ts` (`translateSystem`).
  - UI is only a multi-select in `apps/web/src/components/ProjectAi.tsx` ("Translate into (2 credits per language)"). No table, no CSV/JSON, no inline edit.
- **Chitrapx changes:**
  - New `apps/web/src/components/TranslationsTable.tsx` (and CSV/JSON helpers next to it or in `packages/document`), opened from the editor and from `ProjectAi.tsx`.
  - New CSV/JSON import and export helpers in `packages/document/src/` (pure functions, unit tested), reusing renderer i18n logic where possible.
  - Extend `translateInput` in `apps/worker/src/ai/jobs.ts` with `sourceLocale` and `overwriteManual`; extend `startTranslate` in `apps/web/src/server/ai.ts` to validate them.
  - Edits go through the existing document save route `apps/web/src/app/api/projects/[projectId]/doc/route.ts`.
  - Per-app glossary field (see data model).
- **Reference code:**
  - `open-screenshot-generator/src/components/open-screenshot-generator/TranslationTableDialog.tsx` (MIT) — table UI, row/column layout.
  - `open-screenshot-generator/src/lib/i18n/translationCsv.ts` (MIT) — `toCsv`, `planCsvImport`, `applyCsvImport`, `buildTranslationRows`; the closest thing to the import-preview flow. Chitrapx's i18n folder was already ported from this repo, so check what is already present before porting.
  - `open-screenshot-generator/src/lib/i18n/translate.ts` (MIT) — `translateIntoLocale`, engine selection.
  - `open-screenshot-generator/src/components/open-screenshot-generator/LanguageManagerDialog.tsx` (MIT) — add/remove/promote languages.
  - `PixelDeck/src/pages/localization/BulkTranslateBar.tsx`, `TextOverrideCell.tsx`, `SlideGroupSection.tsx` (MIT) — bulk translate UX and per-cell state.
  - `PixelDeck/src/ai/features/translateText.ts` (MIT) — batch translate, response parsing and retry (`parseBatchTranslationResponse`). Its bring-your-own-key transport is out of scope for Chitrapx.
  - `storeshots/app/components/TranslationsManager.vue` and `storeshots/server/api/translate.post.ts` (AGPL-3.0) — idea only: per-language import/export buttons and "translate from existing" with a label/headline structure.
- **License note:** MIT files may be ported with attribution in `NOTICES.md`; storeshots is ideas only, copy nothing.
- **Size:** L

### 11.2 Right-to-left languages

- **What it does:** Arabic, Hebrew (and Persian, Urdu) render with correct text direction, alignment and script fonts; users can choose whether a board's layout is mirrored for RTL locales.
- **Details:**
  - Text direction: each text element picks direction from its content so punctuation sits on the correct side and left-set captions align to the right edge.
  - Layout mirroring: positions of elements are mirrored horizontally per locale as an opt-in per board (devices, badges and overlays are not mirrored by default; the user must verify each board). Mirroring is derived at projection time, not stored.
  - Fonts: automatic substitution of an Arabic/Hebrew-capable face for RTL locales (the matcher exists); falls back to a bundled face from SP10, not a system font, so server renders match the editor.
  - Line height: Arabic and Urdu need more leading than Latin at the same size; per-locale detached `lineHeight` is supported by the data model.
  - Export: SP8 export and `/render` must produce identical output to the editor for RTL locales.
  - Preview: locale switcher in the editor shows the RTL projection.
- **Acceptance criteria:**
  - An Arabic headline with a trailing question mark or number displays punctuation on the left end, in editor and in exported PNG.
  - A left-aligned caption in the base language is right-aligned in `ar` and `he`.
  - With "mirror layout" on, a board with a device on the left and text on the right shows them swapped in `ar` only; base language is unchanged.
  - Arabic and Hebrew glyphs render with the bundled font in the worker export (no tofu boxes, no system fallback).
  - Mixed Latin brand name inside an Arabic string stays readable.
- **Chitrapx today:**
  - `dir="auto"` already set on text in `packages/renderer/src/osg/elements/TextElement.tsx:192` with direction-aware alignment (lines 157, 170).
  - `rtl` and `script` flags on locales in `packages/renderer/src/osg/i18n/locales.ts`; `getRecommendedFontForLanguage` used in `packages/renderer/src/osg/i18n/project.ts:26,194-198`; matcher in `packages/renderer/src/osg/lib/fontLanguageMatcher.ts`.
  - No layout mirroring; no verification that the worker renderer has RTL/CJK fonts; no UI to see or toggle direction.
- **Chitrapx changes:**
  - Add optional `mirrorRtl` to `ProjectLocalization` (`packages/document/src/artboard.ts`, near line 530) and apply it in `projectArtboards` (`packages/renderer/src/osg/i18n/project.ts:360`) by reflecting element x positions for locales where `rtl` is true.
  - Bundle the Arabic/Hebrew/CJK fonts (coordinate with SP10 font loading in `packages/renderer/src/osg/lib/fontService.ts` and `fonts.ts`) and make the worker render path wait for them.
  - Locale switcher and board inspector toggle in `apps/web` editor; RTL badge on locale columns in the translations table.
  - Renderer tests: golden images for `ar` and `he`.
- **Reference code:**
  - `app-store-screenshots/skills/app-store-screenshots/SKILL.md` (MIT, line ~633) — RTL notes: `dir="auto"`, layouts and devices are not mirrored, ask the user to verify each slide. Use as the default-behaviour reference.
  - `open-screenshot-generator/src/components/open-screenshot-generator/elements/TextElement.tsx` (MIT, lines ~156-191) — the same `dir="auto"` approach Chitrapx already has.
  - `open-screenshot-generator/src/lib/i18n/locales.ts` (MIT) — `rtl` and `script` metadata per locale.
  - No reference repo mirrors layout; this part is original design.
- **License note:** MIT sources as above, with attribution; nothing from storeshots or appshots.
- **Size:** M

### 11.3 AI feature chips (Play feature graphic and key features)

- **What it does:** The AI proposes 4 to 6 short feature chips (1 to 2 words) from the screenshots and app info, shown as pills on the Google Play feature graphic (1024x500) and reusable as a key-features list.
- **Details:**
  - A chips element type renders pills with wrap width and position set by the element; content is a list of strings.
  - Chips are produced by the AI-design job and can be regenerated alone from the editor.
  - Chips are localizable: each locale has its own list (an override on the chips element, or one entry per chip id).
  - Chip text budget: max ~16 characters, max 6 chips; the renderer wraps or drops overflow rather than overlapping.
  - Edit, reorder, add and delete chips manually.
- **Acceptance criteria:**
  - Running AI design on an app with Play selected yields a feature graphic with 4 to 6 chips, each 1 to 2 words, no duplicates.
  - "Regenerate chips" replaces only chips, leaves other text intact, and charges once.
  - Translating the project to `de` produces a German chip list; chips render without overflow at 1024x500.
  - Editing a chip, reloading and exporting shows the edit.
- **Chitrapx today:** nothing. `grep` finds no chips element in `packages/`. The `play-feature` target exists in `packages/document/src/targets.ts:43` and `packages/document/src/aso.ts` handles store listings, but there is no chips element and the AI plan schemas in `packages/document/src/ai.ts` have no feature list.
- **Chitrapx changes:**
  - New element type in `packages/document/src/artboard.ts` and a renderer element in `packages/renderer/src/osg/elements/` (a `ChipsElement`).
  - Add `features: z.array(z.string())` to the design plan schema in `packages/document/src/ai.ts` and a chips applier; update `COPY_SYSTEM`/`copyPrompt` in `apps/worker/src/ai/prompts.ts`.
  - New job or flag `ai_chips` (or fold into `ai_copy`) in `apps/worker/src/ai/jobs.ts`, `apps/web/src/server/ai.ts`, and a route under `apps/web/src/app/api/projects/[projectId]/`.
  - Add the chips element to the Play feature graphic template(s) in `packages/assets/catalog.json` / template sources.
  - Include chips in `allTexts`/`textSlots` so the translations table and `ai_translate` cover them.
- **Reference code:**
  - `storeshots/app/utils/types.ts` (AGPL-3.0, `ChipsElement`, lines ~97-105, and `features: string[]`, line ~132) — idea only: chips as an element driven by a features list.
  - `storeshots/server/api/generate-copy.post.ts` (AGPL-3.0, prompt lines ~34 and ~87) — idea only: chips derived from screenshots plus app info, in priority order.
  - No MIT reference implements chips; write from scratch.
- **License note:** storeshots is ideas only; do not copy its prompt text or element code.
- **Size:** M

### 11.4 Quick-start presets by app type

- **What it does:** When creating an AI design, the user picks an app type (SaaS / Productivity, Game / Entertainment, Finance, Health / Wellness and more); the preset pre-fills the brief with that vertical's audience and tone, suggested colours and example feature chips, and steers the AI.
- **Details:**
  - A preset is data: `key`, label, description, `aiBrief` seed, suggested palette, suggested chips. No code per preset.
  - Initial set: SaaS / Productivity, Game / Entertainment, Finance / Fintech, Health / Wellness, plus Education, Travel, Social, E-commerce, Utilities (write original copy for all).
  - Selecting a preset only fills empty fields in the brief; the user can edit afterwards. It never overwrites uploaded screenshots or brand colours the user has set.
  - The chosen preset key is stored on the AI job input for later analysis and passed into prompts as a vertical hint.
  - Presets are shown on the app's AI design card; "None" is allowed.
- **Acceptance criteria:**
  - Picking "Finance" fills the brief textarea with the preset text; editing it persists through submit.
  - Submitting without a preset behaves exactly as today.
  - A preset never replaces a non-empty brief without confirmation.
  - The job input and prompt contain the preset key and brief; two runs with different presets give different tone in `pickPrompt`/`copyPrompt` output (unit test on the prompt builders).
  - Brand colours already set on the app are not overwritten.
- **Chitrapx today:** nothing. `apps/web/src/components/AiDesignCard.tsx` has only a free-text brief; `apps/web/src/server/ai.ts` `designInput` accepts `brief` only.
- **Chitrapx changes:**
  - New `packages/document/src/presets.ts` (preset data and type), exported from `packages/document/src/index.ts`.
  - `apps/web/src/components/AiDesignCard.tsx`: preset picker above the brief.
  - `designInput` in `apps/web/src/server/ai.ts`: optional `preset` key (validated against the list); pass through `enqueue` to the job.
  - `AppBrief` and `pickPrompt`/`copyPrompt` in `apps/worker/src/ai/prompts.ts`: add `preset` and use its tone line.
- **Reference code:**
  - `storeshots/app/utils/templates.ts` (AGPL-3.0, `START_TEMPLATES`, fields `label`, `description`, `colors`, `copy`, `features`, `aiBrief`) — idea only: vertical presets that seed the AI brief.
  - `PixelDeck/src/utils/templates.ts` and `PixelDeck/src/components/panels/TemplatesModal.tsx` (MIT) — template picker UX; these are layout templates, not vertical presets, so use for UI only.
  - `app-store-screenshots/skills/app-store-screenshots/copy-ideas.md` and `skills/app-store-screenshots/template/src/lib/copy-ideas.ts` (MIT) — headline formulas by deck slot and per-category banks; a good source for per-preset example copy and prompt guidance, with attribution.
- **License note:** write preset text yourself; copy-ideas may be adapted with attribution; storeshots is ideas only.
- **Size:** S

### 11.5 Free-text AI brief (audience, tone, keywords)

- **What it does:** A free-text brief that the AI weights when picking the template and writing copy.
- **Details:**
  - **Already present in basic form.** `apps/web/src/components/AiDesignCard.tsx:30-31` has a labelled textarea (max 2000 chars, placeholder "Audience, tone, the features that matter most") posting `brief` to `/api/apps/${appId}/ai-design`; `apps/web/src/server/ai.ts` validates it (`designInput`, trimmed, max 2000) and the worker passes it as `AppBrief.brief` into prompts (`apps/worker/src/ai/prompts.ts`).
  - Gaps to close: it is only on first AI design, not remembered per app; `ProjectAi.tsx` (translate and copy variants) has no brief, so `ai_copy` ignores it (`variantsPrompt` takes only app name and texts); there are no structured fields for audience, tone and keywords.
  - Add optional structured inputs (audience, tone select, keywords list) that are serialised into the brief text; free text stays.
  - Persist the last brief on the app so it prefills and is reused by copy variants and chips.
  - Keywords feed the ASO keyword fields (SP5) as suggestions only.
- **Acceptance criteria:**
  - Submitting a brief on AI design still works unchanged (regression).
  - Reopening the app shows the last brief prefilled.
  - Generating copy variants uses the stored brief (prompt builder test asserts the brief text appears).
  - Brief above 2000 chars is rejected with a message, not truncated.
  - Keywords entered appear in the prompt as a keyword list.
- **Chitrapx today:** basic free-text brief exists, as above. `apps/web/src/components/ProjectAi.tsx` has translate and copy-variants UI but no brief. `apps` table (`packages/db/src/schema.ts:64`) has `name`, `description`, `brand` and no brief column.
- **Chitrapx changes:**
  - `apps.brief` jsonb (or text) column plus migration under `packages/db`; update `apps/web/src/app/api/apps/[appId]/route.ts` (PATCH) to save it.
  - `AiDesignCard.tsx`: prefill, structured fields, save on submit.
  - `startCopyVariants` in `apps/web/src/server/ai.ts` and `runAiCopy`/`variantsPrompt` in the worker: read the app brief.
  - `ProjectAi.tsx`: show the stored brief with an edit link.
- **Reference code:**
  - `storeshots/server/api/generate-copy.post.ts` (AGPL-3.0, `buildUserPrompt`, line ~69) — idea only: brief "weighted heavily" next to name, description, features, slide count and locale.
  - `storeshots/server/api/copy-variants.post.ts` (AGPL-3.0) — idea only: variants that honour the brief.
  - No MIT reference; the Chitrapx implementation is already ahead for basic use.
- **License note:** storeshots is ideas only.
- **Size:** S

### 11.6 Competitor reference board

- **What it does:** Users upload competitor screenshots to a reference board on the app; the AI analyses them and the findings (messaging angles, layout patterns, claims to differentiate from) are added to the brief for AI design and copy. No scraping: only files the user uploads.
- **Details:**
  - Board holds up to 10 images per app, uploaded through the existing assets flow, tagged as `reference`, never exported or placed in projects.
  - One analysis per image, cached by content hash in the workspace (as `screen_insights` does for app screenshots), so re-running is free for images already analysed.
  - Analysis output (strict schema): headline text verbatim, claimed benefit, layout pattern, colour mood, what to differentiate on. A single summary "competitive angle" is produced per board.
  - The summary is shown to the user, editable, and appended to the AI context as a labelled section; the model is told not to copy competitor wording.
  - Explicit user-upload only; no URL fetch, no store scraping. Show a notice that the user must have the right to analyse the images.
  - Reference images are deleted with the app; analysis text is not shared across workspaces.
- **Acceptance criteria:**
  - Uploading 3 competitor screenshots and pressing "Analyse" produces a per-image insight and a summary; the cost is charged once per new image.
  - Re-running with the same images charges nothing for cached ones.
  - An AI design run with the board attached has the competitor summary in its prompt (prompt-builder test) and the generated copy does not contain competitor headlines verbatim (check in an eval fixture).
  - Reference images never appear in exported ZIPs or in the `.chitrapx` bundle's boards.
  - No endpoint accepts a URL to fetch.
- **Chitrapx today:** nothing built. Specified in `docs/superpowers/specs/2026-10-02-chitrapx-design.md:176` ("user-uploaded competitor screenshots analysed by the Analyze step to inform the brief. No scraping") and deferred as a paid feature in `docs/superpowers/specs/2026-10-02-sp5-aso-design.md:22`. The Analyze step and its cache exist: `screenInsights` table (`packages/db/src/schema.ts:147`), `ANALYZE_SYSTEM` and `screenInsightSchema` in `apps/worker/src/ai/prompts.ts` and `packages/document/src/ai.ts`, `runAiDesign` in `apps/worker/src/ai/jobs.ts:86`.
- **Chitrapx changes:**
  - Asset `kind` or tag `reference` in `assets` (`packages/db/src/schema.ts:100`); upload via `apps/web/src/app/api/apps/[appId]/assets`.
  - New job type `ai_reference` in `packages/db/src/pricing.ts`, `apps/worker/src/ai/jobs.ts`, `apps/web/src/server/ai.ts` and a route `apps/web/src/app/api/apps/[appId]/reference/route.ts`.
  - New `COMPETITOR_SYSTEM` prompt and schema in `apps/worker/src/ai/prompts.ts` and `packages/document/src/ai.ts`.
  - `AppBrief` gains `competitorSummary`; `pickPrompt` and `copyPrompt` use it.
  - New `apps/web/src/components/ReferenceBoard.tsx` on the app page under `apps/web/src/app/dashboard/apps`.
- **Reference code:**
  - None of the six repos implements competitor analysis. Reuse Chitrapx's own Analyze step (`apps/worker/src/ai/jobs.ts`, `runAiDesign`) as the pattern.
  - `storeshots/server/api/generate-copy.post.ts` (AGPL-3.0) — idea only: analysing screenshots and combining them with a brief in one prompt.
- **License note:** nothing to copy; storeshots ideas only.
- **Size:** M

## Data model and API changes

- `apps.brief` (jsonb: `{ text, audience?, tone?, keywords?, preset? }`) and `apps.glossary` (text[]); migration in `packages/db`; PATCH on `apps/web/src/app/api/apps/[appId]/route.ts`.
- `assets`: a `reference` kind or tag (check `packages/db/src/schema.ts:100` for the existing kind column before adding).
- `screen_insights`: reuse for reference images, with a `kind` column (`app` | `reference`) if the existing unique key `(workspace_id, sha256)` must hold separate insight shapes; otherwise a new `reference_insights` table with the same key.
- `ProjectLocalization.mirrorRtl` in `packages/document/src/artboard.ts`; new chips element type; document schema version bump if the document is versioned (check `packages/document/src/doc.ts`).
- Job inputs: `ai_translate` adds `sourceLocale`, `overwriteManual`; `ai_design` adds `preset`; new `ai_chips` and `ai_reference` types.
- New routes: `/api/projects/[projectId]/chips`, `/api/apps/[appId]/reference`; CSV/JSON import is client-side parsing followed by the existing doc save route, so no new import route.
- Credit pricing in `packages/db/src/pricing.ts` (the only place prices live; billing is Razorpay credit packs, so no Stripe work):

| Feature | Job | Price | Basis |
|---|---|---|---|
| 11.1 AI-translate | `ai_translate` | 2 per language (unchanged) | per language that succeeds |
| 11.2 RTL | none | free | no AI |
| 11.3 AI chips | `ai_chips` | 1 per run (proposal: small Sonnet call); free when produced inside `ai_design` (10) | flat |
| 11.4 Presets | none | free | data only |
| 11.5 Brief | none | free (included in `ai_design` 10 and `ai_copy` 3) | no extra call |
| 11.6 Competitor board | `ai_reference` | 1 per newly analysed image, cap 10 images; cached images free | per image, `priceFor` counts only uncached |

Prices for 11.3 and 11.6 are proposals; confirm against model cost per call from `apps/worker/src/ai/model.ts` before fixing them.

## Open questions

- Translations table source language: allow any language as source, or base language plus "from this column" only?
- Should CSV columns be keyed by element id (stable) or by board and label (readable)? Likely both: id column hidden but present.
- Mirror layout: opt-in per board, per project, or automatic for all RTL locales? Reference repos do not mirror; product decision needed.
- SP10 font set: which Arabic, Hebrew and CJK families, and how are they loaded in the worker (needed before RTL acceptance can pass)?
- Chips: separate element type or a text element with a list property? Affects the translations table rows.
- Competitor images: confirm the legal wording and a retention period; allow the user to delete analysis text separately from images?
- Is a single brief per app right, or per project (a project may target a different audience)?
- Should `ai_chips` be sold separately at all, or only inside `ai_design`?

## Suggested build order

1. 11.5 brief persistence and `ai_copy` using it (S, unblocks 11.4 and 11.6).
2. 11.4 presets (S, data plus picker, depends on 11.5 brief field).
3. 11.1 translations table with inline edit and CSV/JSON (L; AI-translate extension last within it).
4. 11.2 RTL, after SP10 fonts land (M).
5. 11.3 AI feature chips (M; its text goes into the table from step 3).
6. 11.6 competitor reference board (M; adds a paid job, so do it last once pricing is confirmed).
