# SP8: Sizes and export

**Status:** Done (branch `sp8-sizes-export`, not merged)
**Goal:** Every App Store and Play slot is covered, one design exports to every size, a single board downloads as a free PNG, exports carry a store-readiness report, and a project can be saved to and restored from a portable `.chitrapx` file.
**Depends on:** The existing document model (`packages/document`), the job queue and worker (`apps/worker`), the `project_versions` table and the private `uploads` and `exports` buckets. SP8 reuses them rather than adding new storage.
**Gap source:** storeshots (store size presets, locale-aware export), PixelDeck (export plan, per-size export, project bundle), open-screenshot-generator (`verify` gate, size presets), app-store-screenshots (size and slot tables), launch (opaque icon output, zip layout).

Sources: spec `docs/superpowers/specs/2026-10-03-sp8-sizes-export-design.md`, plan `docs/superpowers/plans/2026-10-03-sp8-sizes-export.md`. Paths below are relative to `Chitrapx/` unless they start with a reference repo name (all under `/home/khushal/raw_codes/screenly/`).

## Features

### 8.1 Store slots and 12 new sizes

- **What it does:** Every size Chitrapx can export now belongs to a named store slot, and the size list covers the current iPhone, iPad, Android tablet, Apple TV, Watch and app-preview slots.
- **Details:**
  - `Target` gains `slot: string`; existing targets get one (`iphone-6.9` is `ios-6.9`, `ipad-12.9` is `ipad-13`, and so on). Existing ids and pixel sizes are unchanged, so saved projects keep working.
  - Twelve new targets: `iphone-6.9-1320` (1320×2868), `iphone-6.5-1284` (1284×2778), `iphone-6.3-1206` (1206×2622), `iphone-6.1` (1170×2532), `ipad-11` (1668×2388), `android-tablet-7-land` (1920×1200), `android-tablet-10-land` (2560×1600), `apple-tv-4k` (3840×2160), `watch-s9` (396×484), `watch-s6` (368×448), `watch-s3` (312×390), `app-preview-landscape` (1920×886).
  - `iphone-6.9-1320` is listed first among iPhone sizes. Template boards stay at 1290×2796 (`iphone-6.9`), which stays valid in the same `ios-6.9` slot.
  - CarPlay is not a size (App Store Connect takes it in the iPhone slot); it moves to SP10 as a device frame.
  - Plan task 1 required checking every size and rule against Apple's and Google's current help pages before coding.
- **Acceptance criteria:**
  - Each new target id resolves through `getTarget` with the pixel size above and a slot.
  - Every pre-SP8 target id still resolves with unchanged width and height.
  - "Add a store size" and the export dialog list `iphone-6.9-1320` first among iPhone sizes.
- **Chitrapx today:** `packages/document/src/targets.ts:14-51` (`TARGETS` list, each entry with `slot`), `:4` (`Target` type), `:57` (`getTarget`), `:60` (`targetForSize`). Test: `packages/document/test/targets.test.ts`.
- **Chitrapx changes:** Done. Modified `targets.ts`; no data migration because ids are additive.
- **Reference code:**
  - `storeshots/app/utils/canvas.ts:68-100` (AGPL-3.0) — `STORE_PRESETS` (App Store, Play Store, Everything) built from per-device size tables. Ideas only: how sizes group into store presets.
  - `open-screenshot-generator/src/lib/sizePresets.ts:44-50` (MIT) — `CANVAS_SIZE_PRESET_GROUPS`, with notes on which size satisfies which slot (the 6.9" 1320×2868 note).
  - `app-store-screenshots/skills/app-store-screenshots/SKILL.md:664-667` (MIT) — device/slot table and the rule that CarPlay shots go in the iPhone slot.
  - `PixelDeck/src/utils/canvasFormats.ts:18` (MIT) — iPhone 6.9" 1320×2868 entry; `PixelDeck/src/assets/mockups/specs.ts` for device specs.
- **License note:** MIT sources may be reused with attribution in `NOTICES.md`. storeshots: ideas only, copy nothing. The size numbers are store facts, not code.
- **Size:** S

### 8.2 Export selection with derived and letterboxed sizes, and presets

- **What it does:** Users choose which sizes and languages to export. A size with no editable group is rendered from the closest group, retargeted in memory, and never saved into the project. Presets fill the selection in one click.
- **Details:**
  - `ExportSelection` is `{ targets, locales, board? }`; `ExportItem` records `sourceGroupId`, `derived`, `letterboxed`, pixel size, `threeD` and the file path `<platform>/<target>[-variant]/<locale>/<NN>-<board-name>.png`.
  - Source group per selected target, first match wins: exact target (including its A/B variant groups), then nearest aspect ratio on the same platform, then nearest aspect ratio on any platform. Derived items are letterboxed when aspect ratios differ by more than 5% (`LETTERBOX_TOLERANCE`).
  - A/B variant groups are never the source of a derived size, so a B variant cannot leak into another size's folder.
  - `resolveGroup(doc, item, cache)` retargets the source group, cached per (group, target).
  - Order stays locale-major and stable. `MAX_EXPORT_ITEMS = 200` and `exportBatches` are unchanged; `checkExportable` keeps `board_size_mismatch`, `export_too_large`, `nothing_to_export`.
  - Presets: `app-store`, `play`, `everything` via `presetSelection`; `suggestedSelection` picks the default for the project's platforms.
- **Acceptance criteria:**
  - A project with only an iPhone 6.9" group, exporting 6.5" and iPad, gets derived items with the iPad item marked letterboxed.
  - ZIP contents and every PNG's pixel size match `exportPlan` exactly.
  - More than 200 items returns `export_too_large`.
- **Chitrapx today:** `packages/document/src/exportPlan.ts:7` (`ExportSelection`), `:20` (`ExportItem`), `:43-45` (limits), `:58` (`sourcesFor`), `:73` (`exportPlan`), `:100` (`resolveGroup`), `:111` (`exportBatches`), `:125` (`checkExportable`), `:137-159` (presets). Tests: `packages/document/test/exportPlan.test.ts`; end-to-end in `apps/worker/test-e2e/export.test.ts`.
- **Chitrapx changes:** Done. `exportPlan.ts` rewritten around selections; the worker and `apps/web/src/app/render/[jobId]/page.tsx` call the same planner.
- **Reference code:**
  - `PixelDeck/src/utils/exportPlan.ts:83` (MIT) — `buildExportPlan`, scope (`current-group` or `project`), `buildExportFileTarget` path building and `safeExportSegment`. Compare naming and batching.
  - `PixelDeck/src/utils/multiFormatExport.ts` (MIT) — exporting one project into several formats.
  - `storeshots/app/utils/canvas.ts:68-100` (AGPL-3.0) — preset keys and descriptions to match in UX wording. Ideas only.
  - `launch/src/resize.rs:87` (`resize_all`, MIT) — one source rendered to many output sizes.
- **License note:** MIT: reuse with attribution. storeshots: ideas only.
- **Size:** L

### 8.3 Pinned export versions

- **What it does:** An export runs against a snapshot of the document taken when the job is queued, so editing during an export cannot change what is in the ZIP.
- **Details:**
  - On enqueue the API reuses the `project_versions` row for the current `revision`, else inserts one, and stores `{ selection, versionId }` in the job input.
  - The worker and `/render/[jobId]` both load that version row, never `projects.doc`. This fixes the old bug where both sides planned against the live document.
  - Jobs queued before the release (`{ locales }`, no `versionId`) still run against the live project with each group's own target.
  - Pinned rows are never pruned (see Open follow-ups).
- **Acceptance criteria:**
  - Editing the project after queuing leaves the ZIP unchanged (e2e).
  - A legacy job without `versionId` still exports.
- **Chitrapx today:** `apps/web/src/server/jobs.ts:47` (`pinVersion`), `:60` (`enqueueExport`); `packages/db/src/exportSource.ts:9` (`exportSource`, handles legacy input); `apps/web/src/app/render/[jobId]/page.tsx`. Tests: `apps/web/test/jobs.test.ts`.
- **Chitrapx changes:** Done. Reads and writes the existing `project_versions` table; no new table.
- **Reference code:**
  - `PixelDeck/src/store/projects.ts:257-272` (MIT) — `exportProjectBundle` resolves the project and assets at a point in time; contrast with the server-side pin.
  - `open-screenshot-generator/cli/src/commands/render.ts` (MIT) — how the CLI renders from a fixed project input.
- **License note:** MIT: ideas and code with attribution. No competitor snapshots server-side; this is original design.
- **Size:** M

### 8.4 Store-readiness rules

- **What it does:** Before export, the dialog shows App Store and Play rule results for the planned set, and after export the worker adds file-level checks. Rules report and never block.
- **Details:**
  - `storeReadiness(plan, doc)` returns `ReadinessIssue[]` with `store`, `severity`, `code`, `message` and optional target, locale, group, board.
  - Errors: `iphone_slot_missing` (needs `ios-6.9` or `ios-6.5`), `ipad_slot_missing` (needs `ipad-13`), `count_out_of_range` (over 10 per size/locale/variant), `phone_count_out_of_range` (not 2-8 per locale on Play), `feature_graphic_missing` (no 1024×500), `dimension_out_of_range` (side outside 320-3840 or long side over 2× short).
  - Warnings: `promo_ineligible` (fewer than 4 phone shots at 1080 px or more), `letterboxed`, `design_issues` (`lintBoard` totals per size).
  - Worker per-PNG checks: `transparent_pixels` (warning), `file_too_large` (error, over 8 MB), pixel size from IHDR must equal the plan.
  - Clicking an issue in the dialog opens that board and selects the element, as `Checks` does.
- **Acceptance criteria:**
  - Each rule has a passing and a failing unit test.
  - A selection with iPad but no 13" slot shows `ipad_slot_missing` and still exports.
  - A PNG over 8 MB yields `file_too_large` in the report.
- **Chitrapx today:** `packages/document/src/readiness.ts:7` (`ReadinessIssue`), `:13` (`storeOf`), `:23` (`playSidesOk`), `:35` (`storeReadiness`); `apps/worker/src/storeFiles.ts:4-10` (`FileIssue`, `MAX_STORE_BYTES`). Tests: `packages/document/test/readiness.test.ts`, `apps/worker/test/storeFiles.test.ts`.
- **Chitrapx changes:** Done. New `readiness.ts`; worker issues returned in job output (`issues: number`).
- **Reference code:**
  - `open-screenshot-generator/cli/src/commands/verify.ts:1-30` (MIT) — the "gate" design: per-file and per-set findings, warnings never fail the run, a 9 MB PNG is a warning. Header comment explains the grouping by pixel size.
  - `open-screenshot-generator/cli/src/verify/rules.ts`, `verify/png.ts`, `verify/mp4.ts` (MIT) — store tables and header reads.
  - `app-store-screenshots/skills/app-store-screenshots/SKILL.md:637-667` (MIT) — slot rules and counts.
  - `PixelDeck/cli/export.mjs` (MIT) — CLI export flow, for comparison of export-time checks.
- **License note:** MIT: reuse with attribution. Rule values come from store docs, which the plan verified.
- **Size:** M

### 8.5 Free single-PNG export with an hourly limit

- **What it does:** Any board downloads as one PNG at 0 credits, rendered by the same server pipeline as the ZIP so it is pixel-identical, with a rolling hourly cap.
- **Details:**
  - Single export uses job type `export_single` (price 0); `runExport(input, job, "single")` skips the ZIP and uploads `<workspace>/<jobId>.png`.
  - One POST route with a Zod discriminated union on `kind: "zip" | "single"`.
  - Limit: `FREE_JOBS_PER_HOUR = 30` across `export_single`, `project_bundle` and `project_import`, counted from `jobs.created_at` per workspace. Over the limit: HTTP 429, `rate_limited`, no job row.
  - `/api/jobs/:id/download` picks extension and `Content-Disposition` by job type (`DOWNLOAD_EXT`).
  - No ledger rows (price 0).
- **Acceptance criteria:**
  - The 31st free job in an hour returns 429.
  - The POST route rejects any `kind` other than `zip` or `single`.
  - The single PNG equals its golden image and the matching ZIP entry.
- **Chitrapx today:** `apps/web/src/server/jobs.ts:33-45` (`FREE_JOBS_PER_HOUR`, `FREE_JOBS`, `assertFreeQuota`), `:140` (`DOWNLOAD_EXT`), `:143` (`exportDownloadUrl`); `apps/web/src/app/api/projects/[projectId]/export/route.ts`; `apps/web/src/app/api/jobs/[jobId]/download/route.ts`; `apps/worker/src/export.ts:44` (`runExport`); `packages/db/src/pricing.ts:2` (`PRICES`). Tests: `apps/web/test/jobs.test.ts`.
- **Chitrapx changes:** Done. New job type and price; shared quota helper; `rate_limited` text in `apps/web/src/components/jobText.ts`.
- **Reference code:**
  - `PixelDeck/cli/export.mjs` and `PixelDeck/src/utils/export.ts` (MIT) — single-image export path for comparison (browser-side there; Chitrapx deliberately renders server-side).
  - `launch/src/screenshot.rs`, `launch/src/output_image.rs` (MIT) — single image output flow.
- **License note:** MIT: ideas only needed; the rate limit is original.
- **Size:** M

### 8.6 Opaque PNGs and `report.txt`

- **What it does:** Every exported PNG is flattened to RGB with no alpha channel (App Store Connect rejects transparency), and the ZIP root carries a `report.txt` listing readiness issues and derived or letterboxed sizes.
- **Details:**
  - `finishPng` runs `sharp(png).flatten({ background: "#ffffff" }).removeAlpha().png()` after reading `stats()`; a non-opaque source yields a `transparent_pixels` warning naming the file.
  - `report.txt` contains pre-export issues, post-export issues, and each derived or letterboxed size with its source size.
  - Single PNG is flattened but gets no report.
  - Job output gains `issues: number`.
- **Acceptance criteria:**
  - Every PNG in the ZIP has color type RGB (no alpha).
  - `report.txt` lists each derived size with its source and each worker issue.
  - A job with warnings still completes; the history row reads "Download N PNGs · M warnings".
- **Chitrapx today:** `apps/worker/src/storeFiles.ts:10` (`finishPng`), `:24` (`reportText`); wired in `apps/worker/src/export.ts`. Tests: `apps/worker/test/storeFiles.test.ts`.
- **Chitrapx changes:** Done. New `storeFiles.ts`; ZIP assembly in `export.ts` adds the report.
- **Reference code:**
  - `launch/src/resize.rs:26-65` (MIT) — `resize_icon(.., fill_white_bg)` and `blend`: alpha composited on white, the same intent as `flatten`. Port the idea, not the Rust.
  - `open-screenshot-generator/cli/src/commands/verify.ts:90-139` (MIT) — reads PNG header size and bytes per file to report.
  - `PixelDeck/src/utils/exportZip.ts:10-22` (MIT) — ZIP build and file naming.
- **License note:** MIT: reuse with attribution.
- **Size:** M

### 8.7 Export dialog and Download PNG

- **What it does:** A single dialog replaces the old export panel: presets, a size grid showing which sizes are designed, auto-derived or letterboxed, language checkboxes, a live PNG count, readiness summary and the credit price. Each board's menu gets a free Download PNG item.
- **Details:**
  - Presets: App Store required, Play required, Everything, Custom. Each size is tagged Designed, Auto from `<size>`, or Letterboxed; letterboxed sizes offer "Add as editable size" (`addGroupFromTarget`).
  - Footer: PNG count (error above 200), per-store readiness count, **Export ZIP (1 credit)**.
  - Opens with the project's latest export selection (`jobs.input.selection`), else the preset for the project's platforms.
  - Export history lives in the dialog.
  - Download PNG: flush autosave (`save.ts`), POST `kind: "single"`, poll every 1 s, download `<jobId>.png`; spinner on the item; refuses when the save fails. Over the limit: "Free downloads are limited to 30 per hour. Use Export ZIP for full sets."
- **Acceptance criteria:**
  - Changing presets updates the PNG count and readiness live.
  - Editing a board then clicking Download PNG immediately yields what is on screen.
  - The 31st free download shows the limit message.
- **Chitrapx today:** `apps/web/src/components/ExportDialog.tsx`; opened from `apps/web/src/editor/ui/Toolbar.tsx` and the project dashboard; Download PNG in `apps/web/src/editor/ui/LeftPanel.tsx`; autosave flush in `apps/web/src/editor/save.ts` (used by `apps/web/src/editor/Editor.tsx`). `apps/web/src/components/ExportPanel.tsx` is the old panel and still exists in the tree. Tests: `apps/web/test/save.test.ts`.
- **Chitrapx changes:** Done. New `ExportDialog.tsx`; export button and board menu wired; `jobText.ts` error copy.
- **Reference code:**
  - `PixelDeck/src/pages/ExportApp.tsx` (MIT) — export UI flow and options layout.
  - `storeshots/app/utils/canvas.ts:68-100` (AGPL-3.0) — preset labels and descriptions. Ideas only.
  - `open-screenshot-generator/src/lib/sizePresets.ts:44-50` (MIT) — preset group labels and per-size notes.
- **License note:** MIT: reuse with attribution. storeshots: ideas only.
- **Size:** L

### 8.8 `.chitrapx` project file download

- **What it does:** A project downloads as one `.chitrapx` file holding the document and every referenced original, for backup or moving between accounts. Costs 0 credits.
- **Details:**
  - Zip, version 1: `manifest.json` (`format: "chitrapx-project"`, `version`, `docSchema`, `appName`, `exportedAt`, `assets[]` of sha256/kind/mime), `doc.json` with every `asset:<uuid>` rewritten to `bundle:<sha256>`, and `assets/<sha256>.<ext>`.
  - Recordings ship as the uploaded original, not the converted `.webm`; import re-queues `process_recording`.
  - Public paths and Google Font URLs are kept; fonts join in SP10.
  - Job `project_bundle`: free, shares the hourly limit; `bundle_too_large` over 500 MB of assets; a document still referencing a deleted asset fails with `asset_missing`.
  - Output `<workspace>/<jobId>.chitrapx` in the `exports` bucket, downloaded through `/api/jobs/:id/download`.
- **Acceptance criteria:**
  - `asset:` to `bundle:` and back round-trips the document.
  - Bundle then import into a second app then export both gives byte-identical PNGs (e2e).
  - A deleted referenced asset fails with `asset_missing`, not a broken file.
- **Chitrapx today:** `packages/document/src/bundle.ts:5-66` (constants, `bundleManifestSchema`, `toBundleDoc`, `fromBundleDoc`, `extFor`); `apps/worker/src/bundle.ts:26` (`packBundle`), `:35` (`runBundle`); `apps/web/src/server/jobs.ts:155` (`enqueueBundle`); route `apps/web/src/app/api/projects/[projectId]/bundle/route.ts`. Tests: `packages/document/test/bundle.test.ts`, `apps/worker/test/bundle.test.ts`.
- **Chitrapx changes:** Done. New job type `project_bundle` (price 0); no schema migration.
- **Reference code:**
  - `PixelDeck/src/store/projects.ts:257-272` (MIT) — `exportProjectBundle` and `buildProjectExportBundle`: project JSON plus assets resolved by key. PixelDeck inlines data URLs as JSON; Chitrapx uses a zip of originals.
  - `open-screenshot-generator/src/lib/cloud/autoSave.ts`, `src/lib/cloud/api.ts` (MIT) — project save and sync payload shape.
  - `launch/src/zip.rs:15` (`build_zip`, MIT) — zip writing.
- **License note:** MIT: reuse with attribution. The bundle format and sha256 addressing are original.
- **Size:** L

### 8.9 `.chitrapx` import (untrusted-input checks)

- **What it does:** Users import a `.chitrapx` file on an app page and get a new project. The file is treated as hostile: it is checked before and after extraction and nothing is created on failure.
- **Details:**
  - Plan project limit is checked first (HTTP 403 `plan_limit`, no upload); the worker re-checks under the workspace lock.
  - Upload goes to `<workspace>/staging/<uploadId>` in the private `uploads` bucket (500 MB limit).
  - Job `project_import` (free): central-directory check of at most 500 entries and 500 MB uncompressed before extracting (`bundle_too_large`); supported `format` and `version` (`bundle_version_unsupported`); `doc.json` passes `migrate`, Zod and `MAX_DOC_BYTES` (5 MB) (`bundle_invalid`); each asset's sha256 equals its filename and kind and sniffed MIME match the manifest, SVG rejected as for uploads (`bundle_asset_mismatch`); every `bundle:` source has a file.
  - Assets insert with dedupe on `(workspace, app, sha256)`, sources rewrite back to `asset:<id>`, and the project is created in one transaction.
  - The staged upload is deleted on success and failure (`cleanupFailedImport`).
  - Asset checks moved from `uploads.ts` into the shared `assetCheck.ts`.
- **Acceptance criteria:**
  - Tests reject a zip bomb, a sha256 mismatch, a dangling `bundle:` source, an unknown version and an oversized document.
  - A workspace at its project limit gets `plan_limit` and no project.
  - Failed import leaves no assets or project rows and no staged file.
- **Chitrapx today:** `apps/worker/src/zip.ts:18` (`readZipDirectory` with entry and byte limits), `:51` (`extractZipEntry`); `apps/worker/src/bundle.ts:138` (`runImport`), `:191` (`cleanupFailedImport`); `packages/db/src/assetCheck.ts:7-18` (`UPLOAD_LIMITS`, `ACCEPTED`, `sniffAsset`); `apps/web/src/server/imports.ts:21` (`signImport`), `:31` (`enqueueImport`); routes `apps/web/src/app/api/apps/[appId]/imports/route.ts` and `.../imports/sign`; UI `apps/web/src/components/ImportProjectButton.tsx` on `apps/web/src/app/dashboard/apps/[appId]/page.tsx`. Tests: `apps/worker/test/bundle.test.ts`, `apps/web/test/uploads.test.ts`.
- **Chitrapx changes:** Done. New job type `project_import`; error codes `bundle_invalid`, `bundle_too_large`, `bundle_asset_mismatch`, `bundle_version_unsupported` in `jobText.ts`.
- **Reference code:**
  - `PixelDeck/src/store/projects.ts:274-293` (MIT) — `importProjectFromJson`: bundle detection, fresh project id, and reporting `missing` asset keys. Chitrapx instead fails closed on missing assets.
  - `PixelDeck/SECURITY.md` (MIT) — their stated trust assumptions, for comparison.
- **License note:** MIT: ideas and code with attribution. The checks are original to Chitrapx.
- **Size:** L

## Data model and API changes

- Document package: `Target.slot`; new exports `ExportSelection`, `exportSelectionSchema`, `ExportItem`, `exportPlan`, `resolveGroup`, `presetSelection`, `suggestedSelection`, `storeReadiness`, and the bundle schema and helpers.
- `packages/db`: `PRICES` gains `export_single`, `project_bundle`, `project_import` at 0; `exportSource` reads the pinned `project_versions` row; `assetCheck.ts` shared by uploads and import. Existing tables only, no migration.
- Job input: export jobs store `{ selection, versionId }`.
- API: `POST /api/projects/:projectId/export` accepts `kind: "zip" | "single"`; `/api/projects/:projectId/bundle`; `/api/apps/:appId/imports`; `/api/jobs/:jobId/download` selects extension by job type. 429 `rate_limited` for the free-job cap.
- Error codes added to `jobText.ts`: `rate_limited`, `bundle_invalid`, `bundle_too_large`, `bundle_asset_mismatch`, `bundle_version_unsupported`.

## Open questions

- Should pinned versions created by exports be pruned, and on what schedule?
- Should `ExportPanel.tsx` be deleted now that `ExportDialog.tsx` replaces it?

## Open follow-ups

Manual browser checks not yet run (the six listed for the branch):

1. Open the export dialog from the editor toolbar and from the project dashboard; confirm presets, size tags and live PNG count.
2. Download PNG from a board menu, including clicking immediately after an edit.
3. Hit the 30 per hour free limit and confirm the message.
4. Export a ZIP with a derived and a letterboxed size; open `report.txt` and check an extracted PNG has no alpha.
5. Download a `.chitrapx` file and import it into another app.
6. Import a corrupt or oversized `.chitrapx` and confirm the error text and that nothing is created.

Deferred minors:

- `apps/web/src/components/ExportDialog.tsx` has no Escape-to-close and no focus trap.
- `apps/worker/test-e2e/export.test.ts:340` leaves a `console.log` in the round-trip test.
- Some edge cases are untested.
- Pinned `project_versions` rows grow without pruning.
- Pre-existing typecheck error at `billing.ts:61` on `main`, unrelated to SP8.
