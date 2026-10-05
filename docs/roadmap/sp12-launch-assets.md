# SP12: Launch assets

**Status:** Built on a branch, awaiting review. Spec: `docs/superpowers/specs/2026-10-06-sp12-launch-assets-design.md`.
**Goal:** Users turn one 1024x1024 image (uploaded, or generated as a starter logo) into every app icon file a store submission needs, and turn their screenshots into a single collage image or a single framed-device PNG.
**Depends on:** SP8 (done): the job and export infrastructure (`apps/worker/src/runJob.ts`, `apps/worker/src/handlers.ts`, `apps/web/src/server/jobs.ts`), the `exports` storage bucket, ZIP output and the free-job hourly quota (`FREE_JOBS_PER_HOUR`, `FREE_JOBS` in `apps/web/src/server/jobs.ts:33-34`).
**Gap source:** `launch` (icon ZIP, logo generator, collage, mockup). The icon set also matches what appicon.co produces, which `launch/src/config.rs:145` names as its reference behaviour.

All reference paths are relative to `/home/khushal/raw_codes/screenly/`. Chitrapx paths are relative to `/home/khushal/raw_codes/screenly/Chitrapx/`.

## Features

### 12.1 App icon generator

- **What it does:** The user gives one square image (1024x1024 or larger) and downloads a ZIP containing the icon files for iPhone, iPad, Apple Watch, macOS, Android (legacy and adaptive), the App Store 1024 icon and the Play Store 512 icon, in the folder layout Xcode and Android Studio expect.
- **Details:**
  - Input: PNG, JPEG or WebP, at most 10 MB. The source must be square. Non-square input is rejected (launch only warns and stretches it, `launch/src/resize.rs:14-16`; Chitrapx should not ship stretched icons). A source under 1024 px is accepted with a "may look blurry" warning, as in `launch/src/resize.rs:17-19`.
  - Platforms are selectable: iphone, ipad, watch, mac, android, default all (`launch/src/config.rs:173-191`). A "skip store icons" option omits `appstore.png` and `playstore.png` (`launch/src/main.rs:748-757`).
  - Apple icons: composited onto an opaque white background and written as RGB PNG with no alpha, because the App Store rejects icons with transparency. Android icons and `playstore.png` keep alpha (`launch/src/config.rs:145-153`, `launch/src/resize.rs:26-62`, `launch/src/output_image.rs`).
  - Apple layout: all PNGs under `Assets.xcassets/AppIcon.appiconset/` plus `Contents.json` in the same folder (`launch/src/config.rs:195`, `launch/src/main.rs:788-797`). `appstore.png` (1024) and `playstore.png` (512) sit at the ZIP root (`launch/src/config.rs:120-143`).
  - Android legacy layout: `mipmap-mdpi/48`, `mipmap-hdpi/72`, `mipmap-xhdpi/96`, `mipmap-xxhdpi/144`, `mipmap-xxxhdpi/192`, file name `ic_launcher.png` by default and configurable (`launch/src/config.rs:97-118`).
  - Android adaptive icons are new work: launch has none. Output `mipmap-anydpi-v26/ic_launcher.xml` and `ic_launcher_round.xml` (adaptive-icon XML referencing `@mipmap/ic_launcher_foreground` and a background) plus foreground PNGs at 108 dp per density (mdpi 108, hdpi 162, xhdpi 216, xxhdpi 324, xxxhdpi 432 px) with the artwork scaled into the 66 dp safe zone. Background is a user-picked solid colour (default: the source's dominant corner colour). Also emit a round legacy `ic_launcher_round.png` per density.
  - Sizes are deduplicated on `(pixel size, fill-white?)` so each unique size is resized once (`launch/src/main.rs:740-760`, `launch/src/resize.rs:85-100`). ZIP paths are also deduplicated (`launch/src/zip.rs:23-27`).
  - Resampling is Lanczos3 (`launch/src/resize.rs:51`); sharp's default `lanczos3` kernel matches it.
  - The result is one job; the output is a ZIP in the `exports` bucket and a download link, reusing `apps/web/src/components/useJobDownload.ts`.
- **Acceptance criteria:**
  - A 1024x1024 PNG with transparency, platforms = all, yields a ZIP whose iPhone, iPad, watch and mac entries match the size tables in `launch/src/config.rs:25-95` entry for entry (same pixel sizes and file names).
  - Every PNG under `AppIcon.appiconset/` and `appstore.png` has no alpha channel (colour type RGB); every `mipmap-*` PNG and `playstore.png` keeps alpha when the source has it.
  - `Contents.json` parses as JSON, lists exactly the files present in the folder, and each `filename` exists in the ZIP.
  - Android mipmap PNGs have the exact pixel sizes 48, 72, 96, 144, 192; adaptive foreground PNGs are 108/162/216/324/432.
  - A non-square or tiny (under 64 px) image is rejected with a clear error; 512 px input succeeds with a warning in the result.
  - Selecting only `android` produces no `Assets.xcassets` folder and no `Contents.json`.
  - Same input and options always produce byte-identical file contents (excluding ZIP timestamps, which are fixed to a constant).
  - The job refunds credits on failure (existing `runJob` behaviour) and a corrupt image fails with a `FatalJobError`, not retries.
- **Chitrapx today:** Nothing generates icons. `grep` for "icon" in `apps` and `packages` only hits UI glyphs (`apps/web/src/components/StorePreview.tsx`, `packages/renderer/src/osg/shims/icons.tsx`) and the favicon `apps/web/src/app/icon.svg`. The worker already has `sharp` (`apps/worker/package.json`, `^0.35.5`) and `fflate` for ZIPs (used in `apps/worker/src/export.ts:1`), but sharp is only used for PNG finishing in `apps/worker/src/storeFiles.ts`. Jobs can be project-less: `jobs.projectId` is nullable (`packages/db/src/schema.ts:119`) and `process_recording` already runs without a project.
- **Chitrapx changes:**
  - New `packages/db/src/pricing.ts` entry `app_icons` (see Data model).
  - New `apps/worker/src/icons/sizes.ts`: the size tables as typed data (`IconEntry { size, expectedSize, filename, folder, idiom, scale, role?, subtype? }`), ported from `launch/src/config.rs:25-143`.
  - New `apps/worker/src/icons/contentsJson.ts`: builds `Contents.json` from the Apple entries (port of `launch/src/contents_json.rs:5-55`).
  - New `apps/worker/src/icons/resize.ts`: sharp pipeline (`flatten({ background: "#ffffff" })` then `resize(size, size, { kernel: "lanczos3" })` then `png({ palette: false })`; for no-alpha output call `removeAlpha()` and check `metadata().channels === 3`).
  - New `apps/worker/src/icons/android.ts`: adaptive foreground, round legacy and XML files.
  - New `apps/worker/src/icons/index.ts`: `runAppIcons(input, job)` that loads the source from the `uploads` bucket (same download helper pattern as `apps/worker/src/handlers.ts:46-58`), builds entries, zips with `zipSync` (level 6 for the small JSON/XML, PNGs stored) and uploads to `exports`.
  - `apps/worker/src/handlers.ts`: register `app_icons: runAppIcons` in `handlers` (the `Record<JobType, JobHandler>` forces this once `PRICES` gains the key).
  - `apps/web/src/server/jobs.ts`: new `enqueueAppIcons(ctx, boss, raw)` with a zod body `{ assetId, platforms, androidFilename, includeStores, adaptiveBackground }`; add `app_icons: "zip"` to `DOWNLOAD_EXT` (`apps/web/src/server/jobs.ts:140`).
  - New route `apps/web/src/app/api/launch-assets/icons/route.ts` (POST) that calls `enqueueAppIcons`; job status and download reuse `apps/web/src/app/api/jobs/[jobId]/`.
  - New UI `apps/web/src/app/dashboard/apps/[appId]/launch-assets/page.tsx` (the dashboard already has an `apps` folder) with an `IconGeneratorPanel.tsx` in `apps/web/src/components/`: upload, platform checkboxes, Android filename, adaptive background colour, preview of the 1024 icon with iOS and Android mask overlays, Generate button, then download.
  - Add `app_icons` label to `JOB_LABEL` in `apps/web/src/components/jobText.ts:29`.
  - Tests: `apps/worker/src/icons/*.test.ts` for table parity (counts: iPhone 12, iPad 13, watch 17, mac 10, android 5), alpha rules, Contents.json shape, ZIP paths.
- **Reference code:**
  - `launch/src/config.rs:25-143` (MIT) — the exact size tables: iPhone 12 entries (25-40), iPad 13 (42-58), watch 17 incl. quickLook, appLauncher, notificationCenter and companionSettings roles with mm subtypes (60-80), mac 10 (82-95), Android 5 mipmap densities (97-118), store icons (120-143). Port as data.
  - `launch/src/config.rs:145-171` (MIT) — alpha policy per platform and Apple-platform predicate. Port the rule.
  - `launch/src/contents_json.rs:5-55` (MIT) — Contents.json shape (`size`, `expected-size`, `filename`, `idiom`, `scale`, optional `role`, `subtype`). Port; also add the standard `"info": {"version": 1, "author": "xcode"}` block that launch omits, and drop the non-standard `expected-size` key unless Xcode is verified to tolerate it (it ignores unknown keys, but keep the file clean).
  - `launch/src/resize.rs:26-100` (MIT) — white-flatten then Lanczos3 resize and the `(size, fill_white)` dedupe map. Re-implement with sharp, do not port line by line.
  - `launch/src/main.rs:673-805` (MIT) — `run_icon` flow: collect size requests, resize once, assemble ZIP entries, add Contents.json only if an Apple platform is selected.
  - `launch/src/zip.rs:10-36` (MIT) — ZIP entry list with duplicate-path skip. Chitrapx already has `fflate`; port only the dedupe.
- **License note:** launch is MIT: tables and logic may be ported with attribution in `NOTICES.md` (add a row for `launch`: size tables and Contents.json structure, copyright line from `launch/LICENSE`, "Copyright (c) 2025 applogo contributors"). Android adaptive icon support is original work, not from any reference repo.
- **Size:** M

### 12.2 Logo starter

- **What it does:** The user clicks "Generate logo", optionally types a 1 to 4 character wordmark such as initials, and gets a 1024x1024 starter logo (gradient, soft shapes, one of five symbols). The seed is shown so the same logo can be regenerated, and one click sends it into the icon generator (12.1).
- **Details:**
  - Deterministic from `(seed, text)`: the seed picks one of 8 palettes, one of 5 symbol styles (orbit, stack, bolt, diamond, node) and all shape jitter (`launch/src/generate_logo.rs:20-30`, `54-75`, `97-209`).
  - Wordmark is trimmed, whitespace removed and cut to 4 characters; empty means no text (`launch/src/generate_logo.rs:244-256`). Font size 620 px for 1 to 2 characters, 460 px for 3 to 4, centred, with a soft dark shadow (`launch/src/generate_logo.rs:211-242`).
  - Render at 3x (3072 px) then downscale to 1024 for anti-aliasing (`launch/src/generate_logo.rs:15-17`, `67-72`). In sharp, render the SVG at density for 3072 then `resize(1024, { kernel: "lanczos3" })`.
  - Seed is a 64-bit integer; when omitted the server picks one and returns it. JS numbers lose precision above 2^53, so use a 32-bit or 53-bit seed and a small PRNG (mulberry32 or the xorshift-style generator in `launch/src/generate_logo.rs:323-365`).
  - Output: a 1024 PNG (opaque) stored as an upload asset in the workspace and returned for preview. "Use for icons" enqueues `app_icons` (12.1) with that asset.
  - Regenerate button gives a new seed; "Copy seed" and a seed input allow reproduction.
  - Generation is cheap (one sharp render), so it is a free job under the hourly quota rather than a credit charge.
- **Acceptance criteria:**
  - The same `(seed, text)` returns an identical PNG (byte equal) across runs and across worker restarts.
  - Different seeds across 50 runs produce all 8 palettes and all 5 styles at least once.
  - Output is exactly 1024x1024, opaque, PNG.
  - Text `"  ab c d "` renders as `abcd` (4 characters); text of only whitespace renders no wordmark; non-Latin text such as `"功能"` renders with no missing-glyph boxes (see Open questions on font).
  - The result includes the seed that was used.
  - Over the free quota the API returns 429 `rate_limited`, as for `export_single`.
  - Feeding the logo into 12.1 works end to end with no re-upload.
- **Chitrapx today:** Nothing. `export_single` is the only free image job (`apps/web/src/server/jobs.ts:34`).
- **Chitrapx changes:**
  - New `apps/worker/src/icons/logo.ts`: `renderLogo(seed, text)` building an SVG (linearGradient background, blurred circles for soft shapes, polylines and polygons for the five symbols, `<text>` for the wordmark) and rasterising with sharp.
  - New `apps/worker/src/icons/prng.ts` with the seeded generator and `rangeInt`, `rangeFloat`, `nextBool` mirroring `launch/src/generate_logo.rs:323-365`.
  - Bundled font file under `apps/worker/assets/fonts/` plus fontconfig setup (see Open questions); until decided, use a permissively licensed font such as Inter or Noto Sans (SIL OFL), not launch's bundled font.
  - `PRICES.logo_starter = 0` and add `"logo_starter"` to `FREE_JOBS` in `apps/web/src/server/jobs.ts:34`.
  - Handler `logo_starter` in `apps/worker/src/handlers.ts` that stores the PNG as an asset row (`packages/db/src/schema.ts` `assets`, kind `image`) and returns `{ assetId, seed }`.
  - Route `apps/web/src/app/api/launch-assets/logo/route.ts` (POST `{ text?, seed? }`).
  - UI `apps/web/src/components/LogoStarterPanel.tsx` inside the same launch-assets page, with preview, seed field, wordmark input, "Regenerate" and "Use for icons".
  - Tests: determinism test (same seed twice, equal buffers), `cleanLogoText` cases, size and opacity check.
- **Reference code:**
  - `launch/src/generate_logo.rs:15-30` (MIT) — constants and the 8 RGB palettes (background top, background bottom, foreground). Port the palette values as data.
  - `launch/src/generate_logo.rs:54-75` (MIT) — `render_logo` order: palette, style, gradient, soft shapes, symbol, optional text, downscale. Port the sequence.
  - `launch/src/generate_logo.rs:83-130` (MIT) — gradient and soft-shape generation, and `draw_symbol` dispatch (112-129).
  - `launch/src/generate_logo.rs:131-209` (MIT) — the five symbol drawings (orbit 131, stack 141, bolt 155, diamond 169, node 186). Re-express as SVG paths; the raster helpers (`draw_polyline`, `draw_thick_line`, `ellipse_points`, 273-317) become SVG stroke primitives.
  - `launch/src/generate_logo.rs:211-256` (MIT) — wordmark sizing, shadow offsets and `clean_logo_text`.
  - `launch/src/generate_logo.rs:323-365` (MIT) — the PRNG. Do not port exactly: a 64-bit seed is awkward in JS. Output will differ from launch for the same seed; that is acceptable (state this in the UI only if users ask).
  - `launch/src/main.rs:689-760` (MIT) — how launch chains logo generation into the icon ZIP.
- **License note:** launch code is MIT (attribute in `NOTICES.md`). The bundled font `launch/resources/YouSheBiaoTiHei.ttf` has no license file in the repo; do not copy it into Chitrapx.
- **Size:** M

### 12.3 Collage

- **What it does:** The user picks 2 or more screenshots and gets one PNG with them arranged in an automatic grid, with adjustable padding and optionally each screenshot inside a device frame.
- **Details:**
  - Grid: `cols = ceil(sqrt(n))`, `rows = ceil(n / cols)`; images fill left to right, top to bottom (`launch/src/collage.rs:50-53`, `90-97`).
  - Cell size comes from the first image; all others are resized to it (`launch/src/collage.rs:55-81`). Chitrapx improves this: scale each image to fit inside the cell preserving aspect ratio (centred) so mixed sizes are not stretched.
  - Padding defaults to 3% of cell width, scaled by `1 + (max(cols, rows) - 1) * 0.4`; the user can override in pixels (`launch/src/collage.rs:59-65`). Canvas is `cols*cellW + (cols+1)*padding` by `rows*cellH + (rows+1)*padding` (`launch/src/collage.rs:83-85`).
  - Background: launch uses a vertical gradient (`launch/src/screenshot.rs:87-102`); Chitrapx offers a solid colour or a two-stop gradient, default light.
  - Optional device frame per screenshot: same pipeline as 12.4. Images that are already framed are not framed twice (launch marks its own PNGs in metadata, `launch/src/mockup.rs:10-11`, `157-186`); Chitrapx does not need the marker because inputs are user uploads, but exposes a "frame" toggle.
  - Limits: 2 to 12 images, each at most 10 MB and 8000 px on the long side; output at most 8192 px on the long side (downscale the whole canvas to fit, to bound memory).
  - Output: opaque PNG, stored in `exports`, downloaded through the standard job link.
- **Acceptance criteria:**
  - 4 images yield a 2x2 grid, 5 images yield 3 columns by 2 rows with the last cell empty, 9 images yield 3x3.
  - With padding p, the canvas equals `cols*cellW + (cols+1)*p` by `rows*cellH + (rows+1)*p` when under the 8192 cap.
  - Mixed aspect ratios are not stretched (each image's aspect ratio is preserved within its cell).
  - With "frame" on, every screenshot is inside the chosen device; with it off, raw screenshots are placed.
  - Fewer than 2 images, an unsupported file type or an image over the limits is rejected before any credits are reserved.
  - Credits are reserved on enqueue and refunded when the job fails.
- **Chitrapx today:** No collage. Uploads and the asset library exist (`apps/web/src/components/UploadGrid.tsx`, `apps/web/src/server/uploads.ts`). Device frames exist only inside the editor renderer (`packages/renderer/src/osg/elements/DeviceFrameElement.tsx`, `packages/renderer/src/osg/lib/deviceRegistry.ts`, `DeviceType` in `packages/document/src/artboard.ts:155`), rendered by Chromium, not as flat PNG templates.
- **Chitrapx changes:**
  - `PRICES.collage = 1` in `packages/db/src/pricing.ts`.
  - New `apps/worker/src/collage.ts`: `runCollage(input, job)`; loads asset images, lays out the grid with sharp `composite`, optional frame via `framedScreenshot` (12.4), saves PNG.
  - New `apps/worker/src/collageLayout.ts`: pure layout function `layoutGrid(n, cellW, cellH, padding)` returning cell origins and canvas size, unit-tested.
  - `apps/worker/src/handlers.ts`: register `collage`.
  - `apps/web/src/server/jobs.ts`: `enqueueCollage` with zod body `{ assetIds: string[2..12], frame: { deviceId?: string }, padding?, background }`; add `collage: "png"` to `DOWNLOAD_EXT`.
  - Route `apps/web/src/app/api/launch-assets/collage/route.ts`.
  - UI `apps/web/src/components/CollagePanel.tsx` on the launch-assets page: multi-select from uploads, drag to reorder, padding slider, background picker, frame toggle and device select, live CSS-grid preview, Generate.
  - `JOB_LABEL` entry "Collage" in `apps/web/src/components/jobText.ts:29`.
- **Reference code:**
  - `launch/src/collage.rs:50-65` (MIT) — grid maths and the padding heuristic. Port directly.
  - `launch/src/collage.rs:83-97` (MIT) — canvas size and cell placement. Port directly.
  - `launch/src/collage.rs:23-48` (MIT) — frame-or-not decision per image. Port the idea.
  - `launch/src/screenshot.rs:87-102` (MIT) — gradient canvas helper; Chitrapx uses sharp or an SVG background instead.
  - `launch/src/main.rs:1286-1330` (MIT) — directory scan, supported extensions (png, jpg, jpeg, webp), sorting by name; for Chitrapx the order is user-chosen instead.
- **License note:** launch is MIT, attribute in `NOTICES.md`. The grid maths is simple enough that attribution covers it; no assets are involved unless device frames are copied (see 12.4).
- **Size:** M

### 12.4 Device mockup export

- **What it does:** The user drops in one screenshot, chooses a device, and downloads a single PNG of the screenshot inside that device frame with a transparent (or chosen) background.
- **Details:**
  - The editor already frames screenshots: a board with a `DeviceFrameElement` exports through `export_single` (free, one board PNG). So the product need is a one-step entry point that does not require building a project, not a second renderer.
  - Recommended approach (default): "Quick mockup" creates a hidden one-board project in the app with one device frame holding the uploaded screenshot, then enqueues `export_single` on it. Output size is the board size; background is transparent when the board has no background fill.
  - Fallback approach (only if the Chromium path is too slow or unsuitable for transparent output): flat PNG templates as launch does, composited in the worker with sharp. Launch fits the screenshot to the device's display resolution, then keeps frame pixels where the template alpha is above 0.99, shows the screenshot where the template is transparent and the mask is opaque, and blends semi-transparent frame edges over the screenshot (`launch/src/mockup.rs:64-155`). Portrait and landscape per device, screenshot auto-rotated to match for phones, scaled to 85% with a wallpaper for laptops (`launch/src/mockup.rs:17-56`, `78-97`).
  - Device list for the flat path comes from `launch/src/device.rs:37` onward (9 devices, each with portrait/landscape or front orientation, `display_resolution` and a `screen_coord` offset). Chitrapx's own device set is `DeviceType` (20 entries) in `packages/document/src/artboard.ts:155`; the editor path already supports all of them.
  - Screenshot is fitted with letterboxing on black when the aspect ratio differs (`launch/src/mockup.rs:17-56`); Chitrapx should instead warn and offer "fill" or "fit".
- **Acceptance criteria:**
  - Uploading one screenshot and choosing a device produces a PNG within one job; the screen area shows the screenshot and the frame is intact.
  - Output is a valid PNG; with no background chosen the area outside the device is transparent (alpha 0).
  - A screenshot with the wrong aspect ratio shows the fit/fill choice instead of silently stretching.
  - The job counts against the free hourly quota (30 per hour) like `export_single`; the 31st in an hour returns 429.
  - The hidden helper project does not appear in the user's project list and is deleted (or reused) afterwards.
  - If a recording-based asset is selected the request is rejected (images only).
- **Chitrapx today:** Largely covered by the editor. `DeviceFrameElement` renders phones, tablets, watch, laptops (`packages/renderer/src/osg/elements/DeviceFrameElement.tsx`, 3D variants in `Device3DRenderer.tsx`), `export_single` exports one board as PNG (`apps/worker/src/export.ts:81-88`, `apps/web/src/server/jobs.ts:74-76`). Missing: a standalone "screenshot in, framed PNG out" entry that skips project setup.
- **Chitrapx changes:**
  - Default path: new `apps/web/src/server/quickMockup.ts` that builds a minimal `ProjectDoc` (one group, one board, one device frame element, screenshot image) using helpers from `packages/document`, saves it as a project flagged `hidden` (new nullable column or `meta` flag on `projects`), then calls `enqueueExport(..., { kind: "single" })`. Route `apps/web/src/app/api/launch-assets/mockup/route.ts`. UI `apps/web/src/components/QuickMockupPanel.tsx`.
  - Fallback path only: `apps/worker/src/mockup.ts` with `framedScreenshot(assetBuffer, device, orientation)` using sharp composite (template, mask, screenshot), device PNG templates under `packages/assets/third-party/launch/`, and a `mockup` job type priced at 0 and in `FREE_JOBS`. Also reused by 12.3 for framed collages.
  - No pricing change on the default path (reuses `export_single`).
- **Reference code:**
  - `launch/src/mockup.rs:64-155` (MIT) — the template-plus-mask compositing rules. Port only if the fallback path is chosen.
  - `launch/src/mockup.rs:17-56` (MIT) — fit-to-display with auto-rotate and fill ratio.
  - `launch/src/device.rs:25-60` (MIT) — device config shape (id, name, colour, display resolution, per-orientation screen corners, template and mask).
  - `launch/resources/templates/` and `launch/resources/masks/` (15 template PNGs, same count of masks) — device frame artwork, fallback path only.
  - `packages/renderer/src/osg/lib/deviceRegistry.ts` and `packages/renderer/src/osg/elements/DeviceFrameElement.tsx` (Chitrapx, already ported from open-screenshot-generator, MIT) — the existing frame implementation the default path uses.
- **License note:** launch code is MIT. The device frame images are product artwork (Apple, Samsung devices) and launch's LICENSE only covers its own code; do not copy the PNGs into Chitrapx without confirming their provenance (compare how `open-screenshot-generator`'s images were excluded in `NOTICES.md`). The default path avoids the question by using the editor renderer.
- **Size:** S on the default path (reuse of editor and `export_single`); M if the flat-template fallback is built.

## Data model and API changes

- `packages/db/src/pricing.ts`: add `app_icons: 1` (one run, whole ZIP), `logo_starter: 0` (free, quota-limited), `collage: 1`. `JobType` is derived from `PRICES`, so `handlers` and `DOWNLOAD_EXT` must be extended or the type check fails. Quick mockup reuses `export_single`.
- `apps/web/src/server/jobs.ts`: `FREE_JOBS` gains `logo_starter`; `DOWNLOAD_EXT` gains `app_icons: "zip"` and `collage: "png"`.
- `jobs.input` JSON shapes (no migration needed, the column is `jsonb`): `app_icons { assetId, platforms[], androidFilename, includeStores, adaptiveBackground }`, `logo_starter { text?, seed? }`, `collage { assetIds[], frame?, padding?, background }`.
- Job output shapes: `{ path, files, bytes }` for ZIP and PNG results (same as `runExport`), `{ assetId, seed }` for the logo.
- Optional migration: a `hidden` flag on `projects` for the quick-mockup helper project.
- New routes under `apps/web/src/app/api/launch-assets/` (`icons`, `logo`, `collage`, `mockup`); status and download reuse `apps/web/src/app/api/jobs/[jobId]/`.
- Storage: results go to the existing `exports` bucket under `${workspaceId}/${jobId}.zip|png`; the logo goes to the `uploads` bucket as an asset.
- `NOTICES.md`: add a `launch` row for the size tables, Contents.json structure, logo palettes and symbol designs, and the collage grid rules.

## Open questions

- Credit prices: is 1 credit for `app_icons` and `collage` right, or should icons be free under the quota like `export_single` (cost to us is a few hundred ms of sharp)? Logo is proposed free; confirm.
- Contents.json scope: launch puts iPhone, iPad, watch and mac icons into a single `AppIcon.appiconset`, matching appicon.co. Real Xcode projects usually keep macOS in its own asset set. Keep launch's single set, or emit one set per platform?
- Modern Xcode (14+) accepts a single 1024 universal icon. Add a "single-size (Xcode 14+)" output mode alongside the legacy table?
- Android adaptive defaults: how to choose the background colour automatically, and do we also emit a monochrome themed-icon layer (Android 13+)?
- Logo wordmark font: launch bundles a Chinese title font with no license in the repo. Which OFL font do we ship, and how do we make it available to sharp's SVG renderer (librsvg uses fontconfig; the worker image needs the font installed or a fontconfig file pointing at `apps/worker/assets/fonts/`)? Alternative: convert glyphs to paths at build time with opentype.js.
- Seed reproducibility versus launch: our PRNG differs, so seeds are not interchangeable with the Rust CLI. Acceptable?
- Quick mockup: build the hidden-project path or the flat-template path? The first needs a `hidden` flag and Chromium time (a few seconds per job); the second is faster but needs licensed device artwork.
- Upload limits and abuse: 10 MB per image and 12 collage images are proposed; check against current `apps/web/src/server/uploads.ts` limits and worker memory.
- Should generated icon ZIPs be saved to the app's asset library for re-download, or follow export retention?

## Suggested build order

1. Pricing keys, `DOWNLOAD_EXT`, `JOB_LABEL` and handler registration with stub handlers, so the type system is consistent (small).
2. `icons/sizes.ts`, `contentsJson.ts`, `resize.ts` and `runAppIcons` for the Apple and Android legacy sets plus store icons, with table-parity tests (12.1 core).
3. Enqueue function, route and `IconGeneratorPanel` (12.1 UI), so the feature is usable end to end. Then Android adaptive and round icons.
4. `prng.ts`, `logo.ts` and the `logo_starter` job; decide the font first (12.2), then the panel with "Use for icons" chaining into 12.1.
5. `collageLayout.ts` and `runCollage` without frames, then the panel (12.3).
6. Quick mockup on the default editor path (12.4), then add the frame option to the collage using the same mockup helper.
7. `NOTICES.md` update, then decide whether the flat-template fallback is needed at all.
