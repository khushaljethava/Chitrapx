# SP10: Typography & style

**Status:** Not started
**Goal:** Users can bring their own fonts, style single words inside one headline (colour, gradient, weight, italic), pull a brand palette from their screenshots, apply one of 18 named visual themes in one click, start from proven headline formulas, frame CarPlay shots, and pick from a much larger on-demand Google Fonts catalogue.
**Depends on:** SP8 (sizes and export, done): fonts must work in the worker export path and in `.chitrapx` bundles. SP9 (inspector/layers): the rich-text toolbar, palette grid and style picker live in the inspector and need the layer/selection model.
**Gap source:** PixelDeck (rich text, gradient fills, 80+ font catalogue, brand colours), open-screenshot-generator (imported fonts), app-store-screenshots (18 style prompts, copy formulas, CarPlay frame), storeshots (palette extraction and custom font, ideas only), appshots (reference only).

Reference repos are under `/home/khushal/raw_codes/screenly/`. All paths below were checked with `ls`/`grep`.

## Features

### 10.1 Custom font upload

- **What it does:** Upload .ttf/.otf/.woff/.woff2 files per app. They appear in the font picker, render in the editor, render identically in server exports, and travel inside `.chitrapx` bundles.
- **Details:**
  - Asset kind `font` already exists in the DB enum; accepted MIME and sniffing do not.
  - Accept by sniffed bytes, never by extension or client MIME: ttf `font/ttf`, otf `font/otf`, woff `font/woff`, woff2 `font/woff2`. Check that `file-type` actually detects these (it detects woff/woff2/ttf/otf by magic bytes; verify, else add a manual magic check: `00 01 00 00`, `OTTO`, `wOFF`, `wOF2`, `true`).
  - Family name is read from the font's `name` table (not the filename); on collision with a built-in or another upload, suffix it. Store the family on the asset row so the picker does not download the file to list it.
  - Weight/style: one upload = one face. Group faces with the same family into one picker entry with several weights.
  - Documents reference fonts as `fontFamily: "<family>"`; do not embed bytes in the document JSON (5 MB cap, `MAX_DOC_BYTES` in `packages/document/src/bundle.ts:5`).
  - Export: worker emits `@font-face` with a signed URL (or inlined data URL) for each used custom family before `document.fonts.ready` (`packages/renderer/src/ready.ts:12`). `display=block` semantics like Google fonts.
  - Bundle: manifest `assets[].kind` is currently enum `screenshot|image|recording` (`bundle.ts:19`); add `font`, and `extFor` entries (`bundle.ts:63`).
  - Licence reminder shown on upload: user must hold the right to embed/redistribute the font.
- **Acceptance criteria:**
  - Uploading a valid .woff2 shows it in the Font select in the inspector within one refresh; selecting it changes the canvas text.
  - Exporting a project that uses it produces PNGs where glyphs match the editor (no fallback face), verified by an e2e test in `apps/worker/test-e2e`.
  - Export bundle then import into another workspace: font asset restored, text still renders in that font.
  - A renamed .exe or .svg with a `.ttf` extension is rejected `unsupported_type`; a >10 MB font is rejected 413 before bytes are read fully.
  - Deleting a font that is in use is blocked or warns with the list of boards using it.
- **Chitrapx today:** `UPLOAD_LIMITS.font = 10 MB` exists but `ACCEPTED`, `HEAD_BYTES`, `AssetKind` have no font entry (`packages/db/src/assetCheck.ts:5-15`, comment "fonts arrive with their sub-project"). `assetKindEnum` includes `font` (`packages/db/src/schema.ts:12`). Upload pipeline: `apps/web/src/server/uploads.ts` (size check line 45, MIME check 46, streaming size check 79, insert ~95). Fonts are Google-only: `packages/renderer/src/fonts.tsx` builds one Google Fonts stylesheet URL for used families. Brand type has `headingFont`/`bodyFont` strings (`packages/db/src/schema.ts:33-39`). Inspector font select is built from `ALL_FONTS` (`apps/web/src/editor/ui/Inspector.tsx:11,117`).
- **Chitrapx changes:**
  - `packages/db/src/assetCheck.ts`: add `font` to `AssetKind`, `ACCEPTED.font`, `HEAD_BYTES.font`, and a `sniffAsset` branch that validates with a font parser (e.g. `fontkit`/`opentype.js`) instead of `imageSize`; return `family`, `weight`, `italic`.
  - `apps/web/src/server/uploads.ts`: `uploadKind` enum and sign/complete handlers accept `font`; store parsed metadata on the asset row.
  - `apps/web/src/components/UploadGrid.tsx` / a new `FontUpload` in the app page and inspector.
  - `packages/renderer/src/fonts.tsx`: add `customFontFaceCss(fonts)` and render `<style>` beside the Google `<link>`; extend `fontFamiliesOf`.
  - `apps/worker/src/*` export path: resolve font assets into the render page (see how `apps/worker/src/bundle.ts` handles assets).
  - `packages/document/src/bundle.ts`: manifest kind enum, `extFor`, asset refs (fonts are referenced by family, see Data model).
  - `apps/web/src/editor/ui/Inspector.tsx`: merge custom families into `FONT_OPTIONS`.
- **Reference code:**
  - `open-screenshot-generator/src/services/customFonts.ts` (MIT) — 361 lines: `FONT_FILE_ACCEPT` (line 27), format table, `importFontFile` (255-299: extension check, empty/size check, register before persist so a bad file leaves no dead row), `getCustomFontRows`/`installCustomFont` (301-345: carrying fonts with a project).
  - `open-screenshot-generator/src/lib/fontEmbed.ts` (MIT) — `resolveFontEmbedCss` (line 292): how fonts are embedded into raster export; Chitrapx's equivalent is server-side `@font-face`.
  - `open-screenshot-generator/src/lib/account/projectBundle.ts` (MIT) — how fonts ride in a project bundle (header comment lines 6-22).
  - `PixelDeck/src/utils/fonts.ts` (MIT) — `loadCustomFont` (248), `registerCustomFonts` (274), `generateCustomFontFamily` (295), `unregisterCustomFont` (305).
  - `storeshots/app/utils/fonts.ts` (AGPL-3.0, ideas only) — single custom slot, extension allow-list and 2 MB cap (lines 37-40); notes only.
- **License note:** MIT sources may be ported with attribution in `NOTICES.md`; storeshots ideas only, copy nothing.
- **Security notes:**
  - Sniff magic bytes server-side; ignore client `mime` (existing pattern in `sniffAsset`).
  - Size: keep 10 MB (`UPLOAD_LIMITS.font`), enforced at sign time and again while streaming; reject empty files. Consider a per-workspace quota (e.g. 20 fonts / 50 MB).
  - Parsing untrusted fonts is a parser attack surface: parse in a size-limited worker/subprocess with a timeout; use parsed output only for family/weight/style.
  - Serve fonts from the uploads bucket with `Content-Type: font/*`, `X-Content-Type-Options: nosniff`, signed short-lived URLs; CORS limited to app and worker origins.
  - Sanitise the family name before it goes into CSS (the document `cssSafe` check in `packages/document/src/doc.ts:45-55` blocks `url()`/fetch in style values; family names must be quoted with `"`, `\`, `;`, `{`, `}` stripped). Never interpolate raw name-table text into `<style>`.
  - Ignore name-table fields other than family/subfamily; never render licence URLs.
- **Size:** L

### 10.2 Rich text spans

- **What it does:** Inside one text element, style ranges of characters with their own colour, gradient fill, weight and italic (e.g. "Track habits. **Keep streaks.**" with the second part in a gradient).
- **Details:**
  - Marks over a plain `content` string: `{ start, end, color?, gradient?, fontWeight?, italic? }`, start inclusive, end exclusive; normalise (merge, drop empty, clamp) on every edit.
  - Gradient fill on text: linear/radial stops; renders with `background-clip: text` in HTML. Whole-element gradient is the same data without a range.
  - Marks must survive translation: `content` is localizable per locale (`Inspector.tsx:97`); offsets are meaningless after translation, so a locale override carries its own marks or drops them with a visible note.
  - Marks must survive device/size retargeting (`packages/document/src/retarget.ts`) and auto-fit (`packages/renderer/src/osg/lib/textFit.ts`): font size scales the whole element, marks stay relative.
  - Weight marks use the same family; if the family lacks that weight, use the nearest (no synthetic bold surprises in export).
  - Colours/gradients go through the same `cssSafe` validator (`doc.ts:36-56`); mark fields are not in `TEXT_KEYS`, so they are scanned.
- **Acceptance criteria:**
  - Select a word in the editor, set colour/gradient/bold/italic, others unchanged; undo restores in one step.
  - Export PNG matches the editor, including line wrapping with mixed weights.
  - Editing text before a mark shifts mark offsets correctly; deleting a marked range removes the mark.
  - Zod rejects or normalises overlapping/out-of-range marks and rejects `url(`-style values.
  - Existing documents (no marks) load unchanged.
- **Chitrapx today:** Text element is plain: one `color`, `fontWeight`, `fontStyle`, `fontSize` for the whole box, rendered in a `contenteditable` div (`packages/renderer/src/osg/elements/TextElement.tsx:195-239`, style block ~205-225). Inspector has single Font/Size/Weight fields (`apps/web/src/editor/ui/Inspector.tsx:117-121`). Elements are `.passthrough()` objects in the doc schema (`packages/document/src/doc.ts:60-67`), so extra fields pass validation but are untyped beyond `cssSafe`.
- **Chitrapx changes:**
  - `packages/document/src/doc.ts`: typed `textMark` schema, optional `marks` on text elements; `cssSafe` coverage.
  - New `packages/document/src/richText.ts` (normalise, apply, clear, range-style query) with unit tests.
  - `packages/renderer/src/osg/elements/TextElement.tsx`: render segments as `<span>`s; keep edit mode in sync (editing uses a frozen `editSeed`, so commit must be marks-aware).
  - `packages/renderer/src/osg/lib/textFit.ts`: measure with segments.
  - `apps/web/src/editor/ui/Inspector.tsx` + new `RichTextToolbar.tsx`; `commands.ts`, `store.ts` for selection range and undo.
  - `packages/document/src/retarget.ts`, `packages/renderer/src/osg/i18n/localization.ts` for per-locale marks.
- **Reference code:**
  - `PixelDeck/src/types/index.ts` (MIT) — `TextSpan` (lines 333-348, legacy) and `TextMark` (range-based, start inclusive/end exclusive, just after it); `FillValue`/`GradientStop` at lines 3-21.
  - `PixelDeck/src/utils/richText.ts` (MIT, 519 lines) — `segmentMarks` (124), `normalizeMarks` (201), `applyMarkStyle` (212), `clearMarkStyle` (238), `getRangeStyle` (266): port the pure mark algebra.
  - `PixelDeck/src/utils/textRendering.ts` (MIT) — `layerToLines` (84), `wrapFragmentLines` (204), `renderSpansToCanvas` (283), `spansToMarks` (436): wrapping of mixed styles (canvas based; Chitrapx is DOM, use for logic ideas).
  - `PixelDeck/src/utils/gradients.ts` (MIT) — `fillToCss` (111), `angleToPoints` (42), `parseColorAlpha` (4): gradient to CSS.
  - `PixelDeck/src/utils/richText.test.ts` (MIT) — test cases to adapt.
- **License note:** PixelDeck MIT, port with attribution in `NOTICES.md`.
- **Size:** L

### 10.3 Brand palette from screenshots and manual palette grid

- **What it does:** One click extracts up to 6 dominant colours from the app's uploaded screenshots (client-side, no AI) and fills a palette; users can also edit a 6-swatch grid by hand. Colours are usable anywhere a colour is accepted via `brand:<token>`.
- **Details:**
  - Palette: 6 named slots (e.g. `primary`, `secondary`, `accent`, `surface`, `text`, `muted`) stored on `apps.brand`; fields accept `brand:primary` etc. (spec `docs/superpowers/specs/2026-10-02-chitrapx-design.md:139`).
  - Extraction: downscale each screenshot to ~64 px on a canvas, bucket pixels, drop near-white, near-black, near-grey, rank by frequency, merge near neighbours; show swatches for the user to accept or edit. Deterministic; no network.
  - Check WCAG contrast of `text` vs `surface` and warn.
  - Palette grid: 6 swatches, hex input + picker, reset button.
  - Existing `primaryColor`/`secondaryColor` stay as the first two slots for back-compat.
- **Acceptance criteria:**
  - "Extract from screenshots" on an app with 3 screenshots yields 3-6 swatches in under 1 s, same result on repeat.
  - Saving persists to `apps.brand`; reopening shows it; `brand:accent` in a shape/text colour resolves to that hex in editor and export.
  - Changing a palette slot recolours every field that uses the token (the token stays in the doc).
  - Greyscale-only screenshots give a clear "no distinct colours found" message and the manual grid still works.
- **Chitrapx today:** `Brand` type has only `primaryColor`, `secondaryColor`, `headingFont`, `bodyFont`, `logoAssetId` (`packages/db/src/schema.ts:33-39`); `apps.brand` is jsonb (`schema.ts:11`). Brand form: `apps/web/src/components/BrandForm.tsx`. The doc stores `brand: { appId }` (`packages/document/src/doc.ts:95`), set in `apps/web/src/server/projects.ts:38` and `apps/worker/src/bundle.ts:176`. No quantiser exists.
- **Chitrapx changes:**
  - `packages/db/src/schema.ts`: extend `Brand` with `palette?: Array<{ token: string; color: string }>` (max 6).
  - `apps/web/src/server/apps.ts`: validate palette (hex only, max 6, token regex).
  - New `apps/web/src/lib/colorExtract.ts` (client-only canvas code) + unit tests.
  - `apps/web/src/components/BrandForm.tsx` + new `PaletteGrid.tsx`; editor colour fields (`apps/web/src/editor/ui/fields.tsx`) get a "Brand" swatch row.
  - Token resolution at render time: confirm where `brand:<token>` is resolved today (a grep of `packages/renderer` found no resolver); implement in `packages/document` or the renderer's board prep if missing.
- **Reference code:**
  - `storeshots/app/utils/color-extract.ts` (AGPL-3.0, ideas only; do not copy) — idea: small offscreen canvas, 32-step RGB bucketing (lines 1-17), skip near-white/near-black/near-grey, `extractPalette` (91) across several images, `lightenForText` for a readable text colour. Write our own implementation.
  - `PixelDeck/src/utils/brandColors.ts` (MIT) — `isBrandToken` (5), `toBrandToken` (9), `parseBrandToken` (13), `resolveBrandColor` (19), `resolveFill` (26): token resolution including inside gradient stops; port.
  - `PixelDeck/src/utils/brandColors.test.ts` (MIT) — tests to adapt.
  - `PixelDeck/src/types/index.ts:31` (MIT) — `BrandColor` shape; `brandColors?` on the project at line 525.
- **License note:** storeshots AGPL-3.0: ideas only, copy nothing. PixelDeck MIT.
- **Size:** M

### 10.4 Eighteen named visual styles as one-click themes

- **What it does:** A "Style" picker with 18 named looks (e.g. Swiss Grid Bold, Liquid Glass Aurora, Quiet Japandi). One click applies background, fonts, colours, text treatment and device treatment to the current project's boards, as one undo step.
- **Details:**
  - A theme is data, not AI: `{ id, name, description, fonts: {heading, body}, palette, background (solid/gradient), text rules (size range, weight, tracking, line height, case, align), device rules (tilt, shadow, crop) }`.
  - The source prompts are prose rules for an AI generator; translate each into concrete token values. Example from `08-swiss-grid-bold.md`: flat paper/ink backgrounds, Inter Tight 800 at 160-190 px, line-height 0.88-0.92, tracking -0.045em, one `#FF4F00` accent, phone tilt 0.
  - Themes reference only fonts in the curated catalogue (10.7) or built-ins, loaded on demand.
  - Applying a theme keeps text content, screenshots and locale overrides; it rewrites style fields only. Palette tokens: write theme colours into the app palette (10.3) only after a confirm, else apply literal colours.
  - Decorative parts some prompts require (hairline grid, mascots, SVG illustration) are out of scope for v1; list which of the 18 are fully achievable with existing elements (shapes, gradients) and ship those first; mark the rest "partial".
  - Store `styleId` on the group for display; applied values live in elements so exports stay deterministic.
- **Acceptance criteria:**
  - All 18 styles are listed with a preview; applying one changes background, fonts and text colours on every board of the target group in one undo step.
  - Content and locale overrides unchanged after apply; applying twice is idempotent; applying another style leaves no leftovers.
  - Each theme's fonts load in the worker export; headline vs background contrast is at least 4.5:1 (unit test over the 18 definitions).
- **Chitrapx today:** nothing. Templates exist (`fillScreenshots` in `apps/web/src/server/projects.ts:38`, `packages/document/src/fill.ts`, `catalog.ts`) but no named style system. Board backgrounds use `backgroundColor` (`packages/document/src/doc.ts:75`) and `packages/renderer/src/osg/lib/artboardBackground.ts`.
- **Chitrapx changes:**
  - New `packages/document/src/styles.ts` (18 typed definitions) and `applyStyle(doc, groupId, styleId)`.
  - `apps/web/src/editor/commands.ts`: undoable `applyStyle`; new `apps/web/src/editor/ui/StylePicker.tsx` in `LeftPanel.tsx` or `Inspector.tsx`.
  - Preview thumbnails: render with the board renderer over a fixed sample doc, generated at build time.
- **Reference code:**
  - `app-store-screenshots/skills/app-store-screenshots/style-prompts/` (MIT) — 18 files `01-retro-rubberhose-mascot.md` through `18-vintage-travel-poster.md` (others: moody-curated-dating, paper-sticker-skeuomorphic, dreamy-pastel-couples, hand-drawn-editorial-tasks, glossy-3d-kbeauty-creator, liquid-glass-aurora, swiss-grid-bold, neon-athletic-night, magazine-cover-editorial, candy-pop-social, soft-clay-wellness, midnight-glow-pro, risograph-zine, bento-keynote-grid, toybox-primary, quiet-japandi). Each has front matter (name, description, inspiration, feel) and "Hard quality rules" with numeric values to lift into tokens.
  - `app-store-screenshots/skills/app-store-screenshots/style-prompts/_QUALITY_BAR.md` (MIT) — universal rules (section 5 typography contrast, 6 headline composition, 7 phone treatment, 8 background): use as test checks.
  - `open-screenshot-generator/src/lib/theme.ts` (MIT) — existing theme structure; read before designing the theme type.
  - `PixelDeck/src/utils/backgroundAccents.ts` (MIT) — decorative background accents, useful for the "partial" styles.
- **License note:** app-store-screenshots MIT: style names and numeric values may be reused with attribution in `NOTICES.md`. Write our own short descriptions rather than copying prose.
- **Size:** L

### 10.5 Headline formula library

- **What it does:** A "Headline ideas" panel offering fill-in formulas by slide role (Hero, Differentiator, Feature, Proof, Closer) and example banks per app category. One click inserts the formula into the selected headline for editing.
- **Details:**
  - Static data, offline, no credits. Separate from the existing AI "Suggest copy (3 credits)" (`CopyIdeas.tsx`), shown next to it.
  - Role from slide position (first = Hero, last = Closer) or user choice; category from a picker (later from `apps.description`).
  - Placeholders `[verb]`, `[noun]`, `[pain]`, `[outcome]` stay visible in the inserted text; flag leftovers in readiness checks.
  - Show character count against store text limits.
- **Acceptance criteria:**
  - Panel lists formulas grouped by the five roles with a worked example each; choosing a category shows 5+ example lines.
  - Clicking inserts into the selected text element as one undo step; with no selection it says so.
  - Leftover `[...]` placeholders trigger a readiness warning before export.
  - Data is bundled, works offline, keyed for later localisation.
- **Chitrapx today:** AI-only: `apps/web/src/editor/ui/CopyIdeas.tsx` (calls `/api/projects/${projectId}/copy-variants`, 3 credits). `packages/document/src/readiness.ts` and `apps/web/src/editor/ui/Checks.tsx` exist for pre-export checks. No static formulas.
- **Chitrapx changes:**
  - New `packages/document/src/copyFormulas.ts` (typed data: roles, formulas, examples, category banks).
  - New `apps/web/src/editor/ui/HeadlineIdeas.tsx`, mounted in `Inspector.tsx` for text elements near `CopyIdeas`.
  - `packages/document/src/readiness.ts`: placeholder check.
- **Reference code:**
  - `app-store-screenshots/skills/app-store-screenshots/copy-ideas.md` (MIT, 228 lines) — "How to use this file" (line 9), "Formulas by slot" (line 19: Hero 23, Differentiator 35, Feature 45, Proof 57, Closer 67; each a formula/example table) and "Category banks" (line 81 on: Productivity & tasks 85, Notes & writing 92, Finance 98, Fitness 105, Health 112, Food 119, Social 126, Dating 132, Learning 138, Photo/video 144, Travel 150, and more).
- **License note:** MIT; reuse with attribution in `NOTICES.md`.
- **Size:** S

### 10.6 CarPlay device frame

- **What it does:** A landscape dashboard head-unit frame in the device picker for CarPlay apps. Exports go into the iPhone slot.
- **Details:**
  - CarPlay has no App Store Connect screenshot slot; it ships inside the iPhone app, so the shot is submitted at an iPhone size. The export plan must map a CarPlay board to an iPhone target, not a new store target.
  - Frame: 800:480 default ratio, near-black bezel (~1.6%), rounded corners (~2.2% / 3.6%), inner screen radius (~1.4% / 2.3%), soft shadow. Apple's simulator presets: 748x456, 800x480, 1920x720, 900x1200, 1920x1080; ship Standard 800x480 first, optionally Widescreen 1920x720.
  - Landscape frame inside a portrait iPhone-size board fits by width and is centred.
  - Set `nativeAspect` so screenshots auto-fit via the existing device pipeline.
- **Acceptance criteria:**
  - "CarPlay" appears in the device picker; adding it creates a landscape frame with an empty-screen placeholder; an 800x480 screenshot fills the screen exactly.
  - Frame renders identically in editor and worker export.
  - Exporting a board with it passes the iPhone size check (`packages/document/src/exportPlan.ts`, `targets.ts`); no new store slot offered.
  - Existing device types and counterparts unaffected (registry tests pass).
- **Chitrapx today:** nothing named CarPlay (grep over `packages/*/src` finds no match). Device registry: `packages/renderer/src/osg/lib/deviceRegistry.ts` (`DeviceCategory` at line 5: `phone|tablet|watch|desktop|custom`; e.g. `apple-watch` line 54, `macbook`/`imac` below, each with `nativeAspect` and `screen.paddingPercent`). Rendering: `packages/renderer/src/osg/elements/DeviceFrameElement.tsx`, `deviceChrome.tsx`.
- **Chitrapx changes:**
  - `deviceRegistry.ts`: add a `carplay` descriptor (category `desktop` or new `vehicle`; platform `ios`; `nativeAspect: 800/480`; ~1.6% padding; radius factor; no counterpart).
  - `deviceChrome.tsx` / `DeviceFrameElement.tsx`: draw the head-unit chrome.
  - `DeviceType` union and the editor device picker; `packages/document/src/targets.ts` / `exportPlan.ts` if device-aware.
- **Reference code:**
  - `app-store-screenshots/skills/app-store-screenshots/template/src/components/editor/device-frames.tsx` (MIT) — `CarPlayScreen` (line 448 on): proportional bezel/radius/shadow CSS to port.
  - `app-store-screenshots/skills/app-store-screenshots/template/src/lib/constants.ts` (MIT) — `CARPLAY_RATIO = 800 / 480` (line 110) with the five Apple presets in the comment above it; the explanation that CarPlay has no display type and ships in an iPhone slot (lines 56-62); `carplay: { w: 2868, h: 1320 }` (line 15); `carPlayW` sizing helper (151); platform list (460).
  - `app-store-screenshots/skills/app-store-screenshots/template/src/lib/defaults.ts` (MIT) — `carplayStarter` (line 97): starter slide ("Eyes on the road.").
  - `app-store-screenshots/skills/app-store-screenshots/template/src/lib/types.ts:6` (MIT) — device union with `"carplay"`.
  - `launch` (MIT): a grep for carplay over `launch/src` and `launch/resources` finds nothing, so it has no CarPlay frame. PixelDeck and open-screenshot-generator have none either.
- **License note:** MIT, port with attribution in `NOTICES.md`.
- **Size:** S

### 10.7 Larger curated Google Fonts catalogue, loaded on demand

- **What it does:** The font picker offers a large curated Google Fonts list (target 150-300 families, grouped by category and script) with search. Faces download only when selected or used on a board, not on editor load.
- **Details:**
  - Catalogue is a static JSON generated at build from Google Fonts metadata (family, category, weights, italics, scripts), filtered to a curated set; no runtime Fonts API key.
  - Picker previews load a family only on hover/scroll-in; board render loads only families used (as `googleFontsHref` does today).
  - Export determinism: worker uses the same URL builder with `display=block` and waits on `document.fonts.ready` (`packages/renderer/src/ready.ts:12`). Fonts used by 10.4 themes are all included.
  - The URL builder requests `wght@<variants>` only; extend to the italic axis (`ital,wght@`) for 10.2.
  - Keep script groups (latin, arabic, urdu, multilingual) used by `fontLanguageMatcher.ts` so locale overrides pick correct families.
  - Search, category filter, recent/used fonts pinned.
- **Acceptance criteria:**
  - Opening the editor makes no `fonts.googleapis.com` request until a font is used or previewed.
  - Selecting a new family renders within ~1 s and persists across reload; export matches.
  - At least 150 families with category and weights; each round-trips through `googleFontsHref`.
  - Locale override for Japanese/Arabic still resolves to a script-correct family.
- **Chitrapx today:** `packages/renderer/src/osg/lib/fonts.ts` (18 lines: `GoogleFont` interface, `FONT_CATEGORIES`, ported from open-screenshot-generator) and `packages/renderer/src/osg/lib/fontService.ts` (287 lines): `GOOGLE_FONTS` (line 32), `SYSTEM_FONTS` (126), `ALL_FONTS` (138), `createGoogleFontsUrl` (141, eager), `preloadGoogleFonts` (171, eager), `getFontOptions` (200), `getFontsByScript` (214), `getGroupedFontOptions` (221). `packages/renderer/src/fonts.tsx` builds the per-board stylesheet from used families only. Inspector lists `ALL_FONTS` in a flat select (`apps/web/src/editor/ui/Inspector.tsx:11`).
- **Chitrapx changes:**
  - New `packages/renderer/src/osg/lib/fontCatalog.json` (+ generator script under `scripts/`), consumed by `fontService.ts` (replace or extend `GOOGLE_FONTS`).
  - `fontService.ts`: make `preloadGoogleFonts`/`createGoogleFontsUrl` lazy in the editor; add `ensureFont(family)` using `document.fonts.load`.
  - `fonts.tsx`: italic axis in `googleFontsHref`.
  - New `FontPicker.tsx` (searchable, virtualised, grouped) replacing the plain `SelectField` for font in `Inspector.tsx`; Brand form heading/body font use it too.
- **Reference code:**
  - `PixelDeck/src/utils/fonts.ts` (MIT) — `FONT_LIST` (line 26, 80+ families with weights), `getFontWeights` (119), `ensureFontReady` (134), `loadGoogleFonts` (156), `loadFont` (200), `preloadFont` (234): on-demand loading pattern. `PixelDeck/ARCHITECTURE.md:286` confirms "80+ Google Fonts".
  - `open-screenshot-generator/src/types/fonts.ts` (MIT) — the type Chitrapx already ported.
  - `storeshots/app/utils/fonts.ts` (AGPL-3.0, ideas only) — `BUILTIN_FONTS` list with sans/serif category (lines 7-28); idea only.
- **License note:** PixelDeck/OSG MIT with attribution; storeshots ideas only. Font families are OFL/Apache from Google and fetched from Google Fonts.
- **Size:** M

## Data model and API changes

- **Document (`packages/document/src/doc.ts`; `schemaVersion` stays 1 because every addition is optional and `migrate` already defaults missing fields):**
  - Text element: optional `marks: Array<{ start: int, end: int, color?: string, gradient?: { type: 'linear'|'radial', angle?: number, stops: [{ offset: number, color: string }] }, fontWeight?: number, italic?: boolean }>`; per-locale `marks` override beside `content`/`fontFamily` overrides.
  - Optional `styleId?: string` per group (display only).
  - Colours and fonts may be `brand:<token>`; fonts may be a custom family name.
  - Update `cssSafe` and `TEXT_KEYS` handling so mark values are scanned and `fontFamily` is sanitised.
- **DB (`packages/db`):**
  - Asset kind `font` is already in the enum; add `ACCEPTED.font`, `HEAD_BYTES.font`; asset metadata gains `family`, `weight`, `italic`, `format`.
  - `Brand` type: add `palette?: Array<{ token: string; color: string }>`; keep `primaryColor`, `secondaryColor`, `headingFont`, `bodyFont`. jsonb, so no migration.
- **Bundle (`packages/document/src/bundle.ts`):** manifest `assets[].kind` adds `font` (plus `family`), `extFor` adds font MIME types; the manifest also needs an app-level font list because the doc stores family names, not asset ids. Entry cap stays 500, total 500 MB.
- **API:**
  - Upload sign/complete accept `kind: "font"` (`apps/web/src/server/uploads.ts`); new `GET /api/apps/:id/fonts` listing families; delete with in-use check.
  - Worker export receives the resolved font face list (family, weight, style, signed URL) with the render job.
  - App update accepts a palette.

## Open questions

- Per-app or per-workspace fonts? Per-app matches the `assets` uniqueness key (`workspaceId, appId, sha256`) but forces re-upload for each app.
- Font licensing: require an explicit "I have the right to embed this font" checkbox, and reject fonts whose OS/2 `fsType` forbids embedding?
- Per-locale marks vs dropping marks on translation: which is acceptable for translators?
- Is `background-clip: text` reliable in the worker's Chromium for all exports (including video frames)? Needs an e2e check.
- Where is `brand:<token>` resolved today? No resolver was found in `packages/renderer`; is it SP10 work or SP8 work not yet landed?
- Theme scope: how many of the 18 styles are achievable without new decorative elements (grid lines, mascots, SVG art)? Ship a subset first?
- CarPlay: which presets beyond Standard 800x480 are worth shipping?
- Catalogue source: commit a generated JSON snapshot, or generate it in CI from the Google Fonts Developer API?
- Font quota per workspace (count and total bytes).

## Suggested build order

1. 10.7 Larger Google Fonts catalogue and `FontPicker` (no schema change; sets the lazy-load pattern and italic axis).
2. 10.1 Custom font upload (sniffing, parser sandbox, export `@font-face`, bundle support); builds on the picker from step 1.
3. 10.2 Rich text marks (schema, pure mark algebra, renderer, toolbar); italics need step 1's italic axis.
4. 10.3 Brand palette and extraction (independent; token resolution is also needed by 10.4).
5. 10.5 Headline formula library (small, data-only; can run in parallel with step 3).
6. 10.6 CarPlay frame (small, independent; can run in parallel with step 4).
7. 10.4 Named styles last (consumes fonts, palette tokens, gradients, rich text).
