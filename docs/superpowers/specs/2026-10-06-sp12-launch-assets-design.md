# Sub-project 12: Launch assets

Users turn one square image (uploaded, or a generated starter logo) into every app icon file a store submission needs, and turn screenshots into one collage PNG or one framed-device PNG. Feature breakdown, acceptance criteria and reference code: `docs/roadmap/sp12-launch-assets.md`.

## Decisions

The roadmap's open questions, resolved:

- **Prices** (`packages/db/src/pricing.ts` only, Razorpay credit packs, no Stripe): `app_icons` 1 credit (whole ZIP), `collage` 1 credit, `logo_starter` 0 and `mockup` 0. Both free jobs join `FREE_JOBS`, so they share the 30-per-hour allowance with `export_single`.
- **No migration.** `jobs.type` is text and `jobs.input` is jsonb; the logo is stored as an asset of the existing kind `image`. Nothing touches the schema.
- **Quick mockup has no hidden project.** The roadmap's default path needs a `hidden` flag on `projects` (a migration) and a helper project to clean up. Instead the web app builds the one-board document in memory and stores it in the `mockup` job's input; the render page and the worker read it from there (`launchSource` in `packages/db`). Same renderer, same Chromium path, nothing to hide or delete. The flat-template fallback (launch's device PNGs) is not built: the artwork's licence is unclear and the renderer already draws every device.
- **Mockup output** is cropped to the device plus a margin of 6% of its width; transparent around the device unless a background colour is chosen. Devices: every `DeviceType` except `custom`, flat (`styleType: "normal"`).
- **Mockup board size**: the device sits on a board of an existing target chosen by category (phone: iPhone 6.9" 1320×2868; tablet: iPad 13"; watch: Instagram post 1080×1350; Mac, desktop and CarPlay: Mac 2880×1800), scaled to 88% of it. `checkExportable`'s board-size rule stays true.
- **Fit or fill**: device geometry (native aspect and screen insets) is mirrored in `packages/document/src/mockup.ts` as `MOCKUP_DEVICES`; a renderer test pins it to `DEVICE_REGISTRY`. When the screenshot's aspect differs from the screen's by more than 3%, the request must say `fit` (contain) or `fill` (cover); without it the API answers 400 `fit_required` and the panel shows the choice.
- **Collage frames** reuse the mockup document: one board per screenshot, all rendered in one Chromium page, each cropped tightly to its device, then laid out with sharp. Without frames the collage never starts Chromium.
- **Collage layout** follows launch (`cols = ceil(sqrt(n))`, padding heuristic, canvas formula) except that each image is fitted inside its cell keeping its aspect ratio, centred. Over 8192 px on the long side, cells and padding are scaled down together before compositing (memory stays bounded). Reordering is with up/down buttons, not drag and drop.
- **Collage background**: one colour, or two colours as a vertical gradient. Colours are `#rrggbb` only (they go into an SVG).
- **Icon set**: launch's single `AppIcon.appiconset` (iPhone, iPad, watch and mac together, matching appicon.co). No Xcode 14 single-size mode; the 1024 entries already cover it. `Contents.json` has `images` (size, filename, idiom, scale, role?, subtype?) and `info: { version: 1, author: "xcode" }`; the non-standard `expected-size` is dropped.
- **Android**: legacy `android/mipmap-<density>/<name>.png` (48–192), round legacy `<name>_round.png` (circle mask, same sizes), adaptive foreground `<name>_foreground.png` (108 dp per density: 108–432 px, artwork scaled into the 66 dp safe zone, transparent around it), `android/mipmap-anydpi-v26/<name>.xml` and `<name>_round.xml`, and `android/values/<name>_background.xml` holding the background colour. The background defaults to the average of the four corner pixels of the source flattened on white. No monochrome layer. `<name>` defaults to `ic_launcher` and must be a valid Android resource name (`[a-z][a-z0-9_]{0,40}`).
- **Alpha**: Apple PNGs and `appstore.png` are flattened on white and written RGB (3 channels). Android PNGs and `playstore.png` keep alpha (RGBA, 4 channels, always, so the rule is checkable).
- **Determinism**: sizes are resized once per `(size, flatten)`; the ZIP is written with a fixed timestamp (2025-01-01), PNGs stored and text deflated at level 6.
- **Input checks** happen twice: at enqueue from the asset row (kind `screenshot` or `image`, at most 10 MB, square, at least 64 px) so nothing is reserved for a bad request, and in the worker from the decoded image (`FatalJobError`, which fails without retry and refunds). Under 1024 px the job succeeds with `warnings: ["source_small"]`.
- **Logo font**: Noto Sans Bold, with Noto Sans CJK as fallback, through fontconfig (librsvg renders the SVG). The worker image installs `fonts-noto-core` and `fonts-noto-cjk`; nothing is bundled into the repo. launch's font is not used.
- **Logo PRNG**: mulberry32 on a 32-bit seed (0 to 4294967295). Seeds are not interchangeable with launch's CLI. The server picks a seed when none is sent and returns it.
- **Logo storage**: the PNG goes into the uploads bucket as an `image` asset of the app (deduplicated by hash, so the same seed and text reuse one row). "Use for icons" queues `app_icons` with that asset id.
- **Icon ZIPs and collages** follow export retention (the `exports` bucket); they are not added to the asset library.
- **Where**: a new page `/dashboard/apps/[appId]/launch-assets` with four panels, linked from the app page. API routes under `/api/launch-assets/` (`icons`, `logo`, `collage`, `mockup`); status and download reuse `/api/jobs/[jobId]`.

## 1. Plumbing

- `PRICES` gains `app_icons: 1`, `logo_starter: 0`, `collage: 1`, `mockup: 0`; `EXPIRE_SECONDS` gains entries for them.
- `FREE_JOBS` gains `logo_starter` and `mockup`. `DOWNLOAD_EXT` gains `app_icons: "zip"`, `collage: "png"`, `mockup: "png"`.
- `JOB_LABEL` and job error messages for the new codes.
- `handlers` registers the four types.

## 2. App icons (12.1)

- `apps/worker/src/icons/sizes.ts`: the tables (iPhone 12, iPad 13, watch 17, mac 10, Android 5, stores 2) ported from launch as data; `iconEntries(platforms, name, includeStores)`.
- `apps/worker/src/icons/contentsJson.ts`: `contentsJson(entries)`.
- `apps/worker/src/icons/resize.ts`: `resizeIcon(src, size, flatten)`, with a per-call cache keyed `(size, flatten)`.
- `apps/worker/src/icons/android.ts`: foreground, round and XML files.
- `apps/worker/src/icons/index.ts`: `buildIconFiles(source, options)` (pure, returns ZIP entries and warnings), `iconZip(files)` and `runAppIcons(input, job, deps)`.
- Web: `enqueueAppIcons(ctx, boss, raw)` with body `{ assetId, platforms, androidName, includeStores, adaptiveBackground? }`.

## 3. Logo starter (12.2)

- `apps/worker/src/icons/prng.ts` (mulberry32, `rangeInt`, `rangeFloat`, `nextBool`), `apps/worker/src/icons/logo.ts` (`cleanLogoText`, `logoPlan(seed)`, `logoSvg(seed, text)`, `renderLogo(seed, text)`).
- `runLogo(input, job, deps)` stores the PNG and the asset row and returns `{ assetId, seed }`.
- Web: `enqueueLogo(ctx, boss, raw)` with body `{ appId, text?, seed? }`.

## 4. Quick mockup (12.4)

- `packages/document/src/mockup.ts`: `MOCKUP_DEVICES`, `screenAspect`, `needsFitChoice`, `mockupDoc(shots, { deviceType, background?, margin })` returning `{ doc, selection, crops }`.
- `packages/db`: `launchSource(job)` reads `{ doc, selection }` from a `mockup` or `collage` job's input.
- Render page accepts `mockup` and `collage` jobs and renders them on a transparent page. `RenderSheet` gains `transparent`.
- `apps/worker/src/export.ts`: the Chromium loop is extracted into `renderPlan(job, doc, plan, { transparent })`; `runExport` uses it unchanged.
- `apps/worker/src/mockup.ts`: `runMockup` renders, crops and stores the PNG.
- Web: `enqueueMockup(ctx, boss, raw)` with body `{ assetId, deviceType, fit?, background? }`.

## 5. Collage (12.3)

- `apps/worker/src/collageLayout.ts`: `gridSize(n)`, `defaultPadding`, `layoutGrid`, `fitInside`, `capLayout`.
- `apps/worker/src/collage.ts`: `runCollage(input, job, deps)`.
- Web: `enqueueCollage(ctx, boss, raw)` with body `{ assetIds (2–12), padding?, background: { from, to? }, frame?: { deviceType, fit? } }`.

## 6. UI

- `apps/web/src/app/dashboard/apps/[appId]/launch-assets/page.tsx` lists the app's image uploads and renders `LogoStarterPanel`, `IconGeneratorPanel`, `QuickMockupPanel` and `CollagePanel`.
- The app page links to it ("Launch assets").

## Testing

- Worker unit tests (no Chromium): icon table parity and file names, alpha rules, `Contents.json` shape, Android sizes, only-android, determinism, input rejection; logo determinism, palettes and styles over 50 seeds, text cleaning, size and opacity, CJK; collage layout maths, aspect preservation, cap; job runs through `runJob` with in-memory storage deps (refund on failure, `FatalJobError` for a corrupt image).
- Document tests: `mockupDoc` geometry and `needsFitChoice`; renderer test pins `MOCKUP_DEVICES` to `DEVICE_REGISTRY`.
- Web DB tests: each enqueue validates before reserving, charges the right price, and the free ones hit the hourly quota.
- Worker e2e (`apps/worker/test-e2e/launch.test.ts`, needs the web server): mockup PNG with transparent corners and the screenshot inside the screen, framed collage. Written, not run in this branch.
