# Sub-project 11: Localization and AI copy

Users manage every language of a project in one table (inline edits, CSV and JSON import and export, AI translation from any language), ship right-to-left layouts that read correctly and can be mirrored, and steer the AI with a remembered brief, app-type presets, AI feature chips for the Google Play feature graphic and an analysed competitor reference board. Feature breakdown and reference code: `docs/roadmap/sp11-localization-ai-copy.md`.

## Decisions

The roadmap's open questions, resolved:

- **Translate source**: any project language can be the source, not only the base. The worker reads the source column from the project document (the job input carries only `sourceLocale`). A text the source language has not translated is sent in the base language.
- **CSV shape**: keyed by element id (`id` column), with `board` and `label` columns for people, then the base column, then one column per language. Chips appear as one row per chip, id `<elementId>#<n>`. UTF-8 with BOM, CRLF line ends, RFC 4180 quoting. An empty cell means "not translated", never "delete". Unknown ids and unknown language columns are listed in the preview, never dropped silently. JSON is `{ "<locale>": { "<id>": "<text>" } }` with the same preview.
- **One row per element id**: element ids repeat across sizes (a size made from another keeps its ids), so the table, the CSV and AI translation all treat one id as one text. A cell edit writes that language on every board holding the id, as `applyTranslations` already does.
- **Where the table lives**: in the editor, as a dialog opened from the toolbar. The project page links to it (`/editor/<id>?translations=1`). Cell edits and imports are editor commands (one undo step each) and are saved by the existing autosave through `PUT /api/projects/[projectId]/doc`.
- **AI jobs that rewrite the document from inside the editor** (translate, regenerate chips): the editor saves first, stays read-only while the job runs, then loads the saved result. Loading it clears undo history, as restoring a version already does.
- **Stale cells**: every writer now records `sourceHash` (the FNV-1a `hash32` the renderer ported from open-screenshot-generator, moved into `packages/document`). Today no Chitrapx writer sets it, so "stale" never shows. Overrides without a hash are never stale.
- **Mirror layout**: opt-in per project (`localization.mirrorRtl`), applied to every right-to-left locale (`ar-SA`, `he`, `fa`, `ur`). It is derived at projection time and never stored. Element x positions are reflected across the board's centre and rotations negated. Content is not flipped, so screenshots, text and images read normally. Not mirrored: an element whose position the user detached for that language, and span elements, which cross board seams.
- **Mirrored views in the editor are preview-only for geometry**: the canvas hides its drag and resize handles there and says to switch to the base language to move things. Editing text and properties still works.
- **RTL and CJK fonts**: use the faces SP10 put in the font catalogue, picked by the existing `fontLanguageMatcher.ts`: Noto Sans Arabic (Arabic, Persian), Noto Nastaliq Urdu (Urdu), Noto Sans Hebrew, and Noto Sans JP, KR, SC and TC. They load from Google Fonts css2 like every catalogue face, which the export browser already allow-lists (`apps/worker/src/export.ts:22`). Nothing is self-hosted.
- **Script leading**: a language that has its own text gets a minimum derived line height: 1.8 for Urdu and 1.3 for Arabic and Persian. A detached `lineHeight` wins. Like auto-shrink, this is never stored.
- **Chips are their own element type** (`chips`). The element holds the list. A language override holds a list of the same length where `""` means "use the base chip". Order and count are shared by every language.
- **Chip limits**: at most 6 chips, each stored up to 24 characters. AI output is filtered to chips of at most 16 characters and 2 words, deduplicated. Fewer than 4 usable chips fails the job, which refunds.
- **Feature graphic in AI design**: when the app ships on Play (`platformHint` is `android` or `both`) and the chosen template has no `play-feature` size, the design job adds one. It uses a feature graphic template that has a chips element: the pick step chooses among those, falling back to the first. Its copy and chips come from the same copy call, so there is no extra charge. Its element ids are prefixed `fg-`, so they never collide with the main template's ids. iOS-only apps are unchanged.
- **Chips templates**: four existing feature graphic templates gain a chips element: `fg-food-delivery`, `fg-habit-tracker`, `fg-music-stream` and `fg-travel-explore`. No new template files.
- **Regenerating chips** replaces the base list and drops every language's chip translations, which belonged to the old chips.
- **One brief per app** (`apps.brief` jsonb): `{ text?, audience?, tone?, keywords?, preset?, competitor? }`. AI design saves what was submitted. AI copy and AI chips read the saved brief.
- **Keywords** go into the prompts as a list only. The roadmap's "ASO keyword fields (SP5)" do not exist in Chitrapx (SP5 shipped readiness checks, not keyword fields), so there is nothing to suggest into.
- **Brief limit**: over 2000 characters is rejected with "Keep the brief under 2000 characters". The textarea no longer has `maxLength`, so a paste is never silently cut.
- **Presets** are data in `packages/document/src/presets.ts` with copy written fresh. Each one links to an SP10 headline bank (app-store-screenshots, MIT, already attributed) for example register. Picking a preset fills only empty fields. Replacing a non-empty brief asks first. A preset's palette reaches the prompts as suggested colours only when the app has no brand colours, and is never written to the brand.
- **Glossary**: `apps.glossary` text[] of at most 50 terms of up to 60 characters, deduplicated without regard to case. The app name is always kept untranslated as well.
- **Competitor images**: only uploaded files, never URLs. Uploading needs a ticked "I have the right to analyse these images" box (`analysisRights: true`). Up to 10 per app, stored as assets of kind `reference`.
- **Competitor analysis retention**: one analysis per reference image in `reference_insights`, keyed by asset id with `on delete cascade`. Deleting the image, or the app, deletes its analysis. It is cached per image, not per workspace hash, so the same file on another app's board is analysed again, and nothing is shared across workspaces.
- **Competitor summary**: stored in `apps.brief.competitor`, shown and editable on the app page, and added to the pick, copy, variants and chips prompts as a labelled section that says not to reuse competitor wording. The summary model never sees competitor headlines. AI design also drops any written slot that contains a competitor headline of 3 or more words verbatim.
- **Prices** (`packages/db/src/pricing.ts` only, Razorpay credit packs, no Stripe):
  - `ai_chips` costs 1 credit when run on its own, and is free inside `ai_design`.
  - `ai_reference` costs 1 credit per image not yet analysed, capped at 10. `priceFor` counts `input.uncached`, and the job settles the number it actually analysed. A run with nothing new is free but counts toward the 30-per-hour free job allowance, so the summary call cannot be looped.
- **No document `schemaVersion` bump**: every new field is optional; the element type enum gains `chips`. Documents saved before SP11 pass `migrate` unchanged.
- **Two migrations**: 0010 adds `apps.brief` and `apps.glossary`. 0011 adds the `reference` asset kind and the `reference_insights` table with its read policy.

## 1. App brief (11.5)

- `packages/document/src/brief.ts`:
  - `briefSchema`: `text` (trimmed, max 2000, message above), `audience` (max 200), `tone` (one of `friendly`, `professional`, `playful`, `bold`, `calm`, `premium`, or `""` to clear), `keywords` (up to 10 of 1–40 chars, deduplicated without regard to case). `preset` and `competitor` join it in sections 2 and 6.
  - `briefText(brief)` serialises the brief for prompts: free text, then `Audience: …`, `Tone: …` and `Keywords: a, b, c` lines, leaving out empty fields.
  - `glossarySchema`.
- DB: `apps.brief jsonb not null default '{}'`, `apps.glossary text[] not null default '{}'`. `PATCH /api/apps/[appId]` accepts `brief` (merged field by field into the stored brief, like `brand`) and `glossary` (replaced).
- `startAiDesign` accepts `brief`, `audience`, `tone`, `keywords` (and `preset`). It saves the fields sent into `apps.brief`, then queues `ai_design` with `{ appId, brief: briefText(saved) }`. A body of just `{ brief }` behaves exactly as before.
- Worker: `ai_design` uses the submitted brief text. `ai_copy` reads the app's saved brief, and `variantsPrompt` gains a `Brief:` line.
- UI:
  - `AiDesignCard.tsx` prefills from the saved brief and adds Audience, Tone and Keywords (comma separated) fields, plus a character count that turns red over 2000.
  - `ProjectAi.tsx` shows the first line of the stored brief with an "Edit" link to the app page (`#ai-brief`).

## 2. Quick-start presets (11.4)

- `packages/document/src/presets.ts`: `PRESETS` holds nine presets: SaaS / Productivity, Game / Entertainment, Finance / Fintech, Health / Wellness, Education, Travel, Social, E-commerce and Utilities. Each has `key, label, description, audience, tone, aiBrief, voice, palette (six brand tokens), chips (example chips), bankId?`. Also `PRESET_KEYS`, `presetFor`, and `applyPreset(form, key, replaceText)`, which fills empty fields only.
- `briefSchema.preset`: a preset key, or `""` for None.
- `startAiDesign` saves the preset and puts it in the job input. The worker validates it against `PRESET_KEYS`.
- Prompts:
  - `pickPrompt` and `copyPrompt` add a `Vertical: <label>. <voice>` line, followed by three example headlines from the linked bank marked "register only, never copy".
  - When the app has no brand colours, `pickPrompt` adds `Suggested colours for this vertical: …`.
  - No preset: the prompts are unchanged.
- `AiDesignCard.tsx`: an app type select (None plus the nine presets) above the brief. Picking one runs `applyPreset`. A non-empty brief that differs from the preset text is replaced only after `confirm`.

## 3. Translations table (11.1)

### 3.1 Model (`packages/document/src/translations.ts`)

- `translationRows(doc)`: one row per localizable text, deduplicated by element id, in board order of the first size that has it. Fields: `{ id, elementId, chip?, board, boardId, label, base, source }`, where `label` is the layer name or the first 40 characters of the text. Empty texts are not rows. Chips add one row per chip, with `source` = all base chips joined by `\n`.
- `cellFor(doc, row, locale)` returns `{ text, state }`, where `state` is one of `untranslated | auto | manual | stale-auto | stale-manual`. An override without `origin` counts as manual. Stale means `sourceHash` is set and differs from `hash32(row.source)`.
- `localeProgress(doc, locale)` returns `{ translated, total, stale }` for the column header.
- `writeTranslations(doc, writes)` is the single writer for typed and imported text:
  - It writes `origin: "manual"` and `sourceHash = hash32(source)` on every board holding the id.
  - Writing `""` clears back to the base.
  - The language's own marks are remapped to the new wording.
  - Unknown languages and the base language are ignored.
  - It returns the same document when nothing changes.
- `lengthWarning(row, text)`: a text longer than 1.5 times the source plus 4 characters gets "Longer than the source; it may shrink or wrap". A chip over 16 characters gets "Chips fit best at 16 characters or fewer". This is advice only; auto-shrink stays derived at render time.
- `textsIn(doc, locale)`: `allTexts` as that language reads it, with the base text where the language has none. AI translation uses it to read its source.

### 3.2 Files (`packages/document/src/translationFiles.ts`)

- The CSV parser and field quoting are ported from open-screenshot-generator `src/lib/i18n/translationCsv.ts` (MIT, attributed in `NOTICES.md`). Columns, matching and the plan are Chitrapx's own.
- `toCsv(doc)`: BOM, CRLF, header `id,board,label,<base>,<locales…>`.
- `toJson(doc)`: the base language plus every translated cell.
- `planCsvImport(doc, text)` and `planJsonImport(doc, text)` return `{ changes: [{ locale, id, text, from, label, kind: "added" | "changed" }], unchanged, unknownIds, unknownLocales }`:
  - Rows are matched by id only.
  - An empty cell is skipped.
  - A CSV without an `id` column throws `ImportError("no_id_column")`, and a JSON file of the wrong shape throws `ImportError("not_json")`.
- Applying a plan is one `setTranslations` command containing its changes.

### 3.3 Editor UI

- New `apps/web/src/editor/ui/TranslationsTable.tsx`, a dialog opened from a "Translations" toolbar button, or with `?translations=1` on the editor URL:
  - **Columns**: the base language, then each language with its native name, code, an `RTL` badge for right-to-left languages, and `translated/total` plus a stale count.
  - **Rows**: grouped by board.
  - **Cells**: `dir="auto"` textareas that write on blur. Untranslated cells are amber, stale cells orange, hand-written cells have an indigo border, and machine-translated cells a neutral one. Each state also has a title.
  - **Length warnings**: shown under a cell.
  - **Filter**: "Only missing or stale".
  - **Files**: Export CSV and Export JSON. Import CSV or JSON shows a preview (added, changed, unchanged, unknown ids, unknown languages, and a from→to list), with Apply and Cancel.
- Pure view model `apps/web/src/editor/translationsModel.ts` (`tableModel`) does the grouping and headers and is unit tested.

### 3.4 AI translation from the table

- `POST /api/projects/[projectId]/translate` takes `{ locales, sourceLocale?, overwriteManual? }`.
  - The source must be the base language or a project language, and must not be a target (`unknown_source_locale`, `source_in_targets`).
  - The price is unchanged: 2 credits per language, charged only for languages with at least 80% coverage.
- Worker:
  - It reads source texts with `textsIn`. The glossary is the app name plus `apps.glossary`.
  - `translateSystem(target, glossary, source)` names the source language.
  - `applyTranslations(doc, locale, texts, { sources, sourceLocale, overwriteManual })`:
    - Without `overwriteManual`, manual cells are kept.
    - A slot whose source text changed while the job ran is skipped.
    - Every write records `sourceHash`.
- The table's AI section has:
  - a source select, defaulting to the base language;
  - target checkboxes;
  - an "Overwrite hand-written translations" box;
  - a cost label;
  - a glossary editor that sends `PATCH /api/apps/[appId] { glossary }`, with a note that the app name is always kept.

## 4. Right-to-left languages (11.2)

- `ProjectLocalization.mirrorRtl?: boolean`, validated in `doc.ts`.
- Renderer (`packages/renderer/src/osg/i18n/project.ts`):
  - `mirrorsLocale(localization, locale)` and `mirrorElement(el, boardWidth)`.
  - `projectArtboards` mirrors every board in a mirrored locale (boards without overrides included), except detached positions.
  - `resolveElementForLocale` applies the minimum leading.
  - `unprojectArtboards` refuses a mirrored view and returns the base (it is unused by the web app, and the guard keeps it from writing mirrored coordinates).
- Text direction and alignment already work: `dir="auto"` and logical alignment in `TextElement.tsx:174-208`. The tests pin that a left-aligned caption renders `text-align: start` in a `dir="auto"` box, so Arabic and Hebrew align right and punctuation sits at the logical end.
- Editor:
  - The toolbar's language buttons show `RTL` on right-to-left languages.
  - A "Mirror layout in RTL languages" checkbox appears when the project has one (command `setMirrorRtl`).
  - The canvas in a mirrored view hides its handles and shows the preview note.
- Exports go through `boardFor`, so the export, the video, previews and the canvas all agree.
- Goldens: Arabic unmirrored, Arabic mirrored and Hebrew. The Arabic headline has a trailing question mark, digits and the Latin brand "Bloom". A check that the Arabic face differs from a no-auto-font render proves the bundled face is used rather than a fallback.

## 5. AI feature chips (11.3)

### 5.1 Element

- `ChipsElementProps`: `type: 'chips'`, `chips: string[]`, `fontSize` (same units as text, drawn at `fontSize / 0.3`), `fontFamily`, `fontWeight?`, `color` (chip text), `fillColor` (chip background), `align?: 'left' | 'center' | 'right'` (logical), `gap?` (board px).
- `ElementLocaleOverride.chips?: string[]`, parallel to the base list.
- `doc.ts`: the type enum gains `chips`. Base lists go through `normalizeChips` (trim, collapse spaces, cap at 24 characters, drop empty items and case-insensitive duplicates, at most 6). Override lists go through `normalizeChipOverride` (same caps, keeps `""`, cut to the base length, trailing `""` dropped, removed when empty).
- `packages/document/src/chips.ts`:
  - Limits: `CHIP_MAX = 6`, `CHIP_MIN = 4`, `CHIP_MAX_CHARS = 24`, `CHIP_BUDGET = 16`.
  - Ids: `chipId`, `parseChipId`.
  - Normalisers: `normalizeChips`, `normalizeChipOverride`, `aiChips` (at most 16 characters and 2 words, deduplicated, at most 6).
  - Helpers: `chipsSource`, `applyChips(doc, chips)`, `hasChips`, `remapChipOverride(list, from)`.
- AI copy and translation:
  - `allTexts` emits chips as `<id>#<n>`.
  - `applyTexts` and `applyTranslations` write them back. A chip translation is an automatic override list that keeps the language's manual chip lists.
- `retarget` scales `fontSize` and `gap` for chips too.

### 5.2 Rendering

- `packages/renderer/src/osg/elements/ChipsElement.tsx`: a `dir="auto"` flex-wrap row of pills, height `fontPx × 1.9`. The container is cut to the whole number of rows the box fits (`chipRows`), so a chip that would wrap past the box is dropped whole, never overlapped or half drawn. A single chip wider than the box ends in an ellipsis.
- Projection: an override list fills its non-empty entries over the base list. Auto font substitution applies to chips as it does to text. `fontUsesOf` requests chip faces.

### 5.3 Editor and templates

- The left panel gains a "Chips" adder.
- The inspector gets a chips section (`ChipsEditor.tsx`):
  - In the base language: edit, reorder, add (up to 6) and delete, through command `setChips { ref, chips, from }`. `from` remaps every language's list to the new order.
  - In another language: edit text only, through `setTranslations`.
  - Font, size, weight, both colours and alignment.
  - "Regenerate chips (1 credit)".
- Templates: chips elements in the four feature graphics listed in Decisions. `buildCatalog` reports `chips` per board when there are any, and the catalogue is regenerated.

### 5.4 AI

- `ai_chips` (1 credit), started from `POST /api/projects/[projectId]/chips`:
  - It refuses a project without a chips element (`no_chips`).
  - The worker reads cached screenshot insights (no new vision calls), the app brief and the project's texts, asks the writer model at low effort (`CHIPS_SYSTEM`, `chipsPrompt`), filters the answer with `aiChips`, and replaces only chips (`applyChips`).
- `ai_design`:
  - `templateChoiceSchema.featureGraphicSlug?`.
  - `slotCopySchema.features?` and `featureGraphic?`.
  - `copyPrompt` adds the feature graphic slots and asks for 4–6 chips when Play is targeted or the template has chips.
  - `withFeatureGraphic` appends the size with prefixed ids, and `applyChips` fills every chips element.

## 6. Competitor reference board (11.6)

- DB:
  - `asset_kind` gains `reference`.
  - `reference_insights (id, workspace_id, asset_id unique references assets on delete cascade, insight jsonb, model, created_at)`, with RLS enabled and a member read policy. Writes stay server-only, as for every table since migration 0002.
- Uploads: `kind: "reference"`, which needs `analysisRights: true` (`analysis_rights_required`).
  - It accepts the screenshot image types up to 25 MB, sniffed as today.
  - An app holds at most 10 (`reference_limit`). `MAX_REFERENCES_PER_APP` lives in `packages/document`, so the dashboard can use it without the DB package. `pricing.ts` imports it as its price cap.
  - The same file cannot be both a reference and an ordinary upload of one app (`asset_kind_conflict`, 409). A sibling link from another app takes the requested kind.
- Isolation: reference assets never appear in `listAssets` (so not in the editor, the dashboard upload grids or the AI design inputs), in `assetUrlMap` (a document pointing at one fails export as `asset_missing`), or in project bundles.
- Routes:
  - `GET /api/apps/[appId]/reference` lists the images with signed URLs and insights.
  - `POST /api/apps/[appId]/reference` starts the analysis.
  - `DELETE /api/apps/[appId]/reference/[assetId]` removes the row and its analysis, and the bytes when no other asset row uses them.
  - None accepts a URL.
- `ai_reference`, with input `{ appId, uncached: assetId[] }`:
  - Each paid, uncached image is analysed with the fast vision model (`COMPETITOR_SYSTEM`, `competitorInsightSchema`: verbatim headline, claimed benefit, layout pattern, colour mood, what to differentiate on), and the result is cached in `reference_insights`.
  - Then one summary call (`COMPETITOR_SUMMARY_SYSTEM`, writer at low effort) runs on everything except the headlines, and its result is written to `apps.brief.competitor`.
  - It settles 1 credit per image analysed.
- Prompts: `AppBrief.competitor` adds a "Competitor notes … never reuse their wording" section to the pick, copy, variants and chips prompts. `competitorEchoes(text, headlines)` drops echoed design copy.
- UI: `apps/web/src/components/ReferenceBoard.tsx` on the app page:
  - the rights notice and checkbox;
  - an upload area (remaining slots shown);
  - a grid of images with their analysis and a delete button;
  - "Analyse (N credits)", or "Refresh summary (free)" when every image is analysed;
  - the summary in an editable textarea with Save, which sends `PATCH brief.competitor`.
  - `AiDesignCard` notes when competitor notes are included.

## 7. Errors

- Brief over 2000: 400 with "Keep the brief under 2000 characters". Unknown preset or tone: 400 `invalid_input`.
- Translate: `base_locale`, `unknown_source_locale`, `source_in_targets`, `too_much_text`, `insufficient_credits` (402). A language under 80% coverage is skipped and not charged. No usable language: `ai_incomplete`, refunded.
- Import:
  - `no_id_column` and `not_json` are shown inline in the table.
  - Unknown ids and unknown language columns are listed in the preview, and the rest still imports.
- Chips:
  - `no_chips` when the project has no chips element.
  - `ai_incomplete` when fewer than 4 usable chips come back, refunded.
- Reference:
  - Upload errors: `analysis_rights_required`, `reference_limit`, `asset_kind_conflict`, `unsupported_type`, `too_large`.
  - Analysis errors: `no_references`, `rate_limited` (429, free runs over the hourly allowance).
- Job error texts are added to `apps/web/src/components/jobText.ts`.

## 8. Testing

- **Unit (document)**:
  - brief schema and `briefText`;
  - presets data and `applyPreset`;
  - `hash32` parity with the renderer;
  - rows, cell states, progress and `writeTranslations` (manual, hash, clear, marks, no-op identity);
  - `applyTranslations` (hash, overwrite manual, source-locale stale check, chips);
  - CSV and JSON round trips: quotes, commas, newlines, BOM, CRLF. The two-cell edit gives exactly two changes, and an unknown id is reported while the rest imports;
  - chips normalisation and texts, `applyChips`, `remapChipOverride`, `withFeatureGraphic`, `competitorEchoes`;
  - SP11 schema (documents saved before SP11 unchanged, `mirrorRtl` kept, chips normalised).
- **Unit (renderer)**: mirroring (base and non-RTL locales returned by reference, device and text swapped in `ar-SA` only, rotation negated, detached position kept, unproject refuses); script leading; Arabic and Hebrew faces in the stylesheet URL; `dir="auto"` and `start` alignment; chips markup, row cut, projection, fonts.
- **Unit (web)**: commands (`setTranslations`, `setChips` order remap, `setMirrorRtl`); `tableModel`; `followJob`; the reference board model.
- **Integration (Supabase project from `.env`)**:
  - app brief and glossary save, merge and limits;
  - AI starters: brief saved and in the job input, legacy body, preset validation, translate source checks, chips refusal and price, reference price, free allowance;
  - uploads of references: rights, limit, kind conflict, isolation from `listAssets` and `assetUrlMap`, delete removes the analysis;
  - RLS on `reference_insights`;
  - worker jobs with a scripted model: copy variants use the stored brief; translate `ar-SA` and `de-DE` from `fr-FR` keeps the manual cell and charges per succeeded language; chips replace only chips and charge 1; a Play app gets a feature graphic with 4–6 chips; reference analysis charges per new image, re-runs free, and leaves headlines out of the summary prompt; echoed competitor headlines are dropped from design copy.
- **Prompt builders** (worker, pure): brief, keywords, presets (different text per preset), competitor section, chips prompt.
- **Worker e2e and goldens**: `rtl-ar.png`, `rtl-ar-mirrored.png`, `rtl-he.png` and `chips-de.png`. Existing goldens are unchanged.

## 9. Build order

1. 11.5 brief: schema, migration, validation, AI flows and UI.
2. 11.4 presets.
3. 11.1 translations: model and writer, then files, then the table UI, then AI translation with source, overwrite and glossary.
4. 11.2 RTL: projection, then editor and goldens.
5. 11.3 chips: document, renderer, editor and templates, then `ai_chips`, then the feature graphic in AI design.
6. 11.6 competitor board: storage and isolation, then `ai_reference`, then the board UI.

## Roadmap corrections

- Line numbers that moved after SP10:
  - `ElementLocaleOverride` is at `artboard.ts:389`, `ProjectLocalization` at `:461` and `localized` at `:556`, not 365 and 530.
  - `projectArtboards` is at `project.ts:372`, not 360. `getRecommendedFontForLanguage` is used at `:199`.
  - `dir="auto"` is at `TextElement.tsx:208`, and the logical alignment at `:174` and `:185`, not 192, 157 and 170.
  - `apps` is at `schema.ts:74`, `assets` at `:111` and `screen_insights` at `:158`, not 64, 100 and 147.
- `ProjectAi.tsx` has translate only. Copy variants live in the editor (`apps/web/src/editor/ui/CopyIdeas.tsx`).
- `apps/web/src/app/api/apps/[appId]/assets` only lists assets. Uploads go through `/api/uploads/sign` and `/api/uploads/complete`.
- No ASO keyword fields exist to feed.
- `sourceHash` is never written today, so the stale state the roadmap lists does not exist until this sub-project.
- The editor already has a locale switcher (`Toolbar.tsx`), so it is not new work.
- `packages/assets/catalog.json` is generated (`pnpm --filter @chitrapx/document gen-catalog`), never edited by hand.
- SP10 did not bundle font files. It catalogued Arabic, Hebrew, Urdu and CJK Google families, which load from Google Fonts at render time in the editor and the export browser alike.

## Out of scope

- Per-project briefs; sharing competitor analyses across apps or workspaces.
- Mirroring span elements, background images or gradients; flipping device perspective styles.
- Translating text that differs between A/B variant groups sharing an element id (the table, like AI translation, uses the first occurrence's text).
- Store keyword research, store upload, Drive or GitHub sync, any public API, CLI or MCP (SP13 and SP14 are dropped).
- URL fetching or store scraping for competitor screenshots.
