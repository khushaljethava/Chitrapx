# Sub-project 12: Launch Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One square image becomes every store icon file (ZIP); a seeded starter logo can feed it; screenshots become a collage PNG or a framed-device PNG.

**Architecture:** Four job types. `app_icons`, `logo_starter` and unframed `collage` are pure sharp work in the worker. `mockup` and framed `collage` carry an in-memory document in the job input and reuse the render page plus Playwright (`renderPlan`, extracted from `runExport`). Prices only in `packages/db/src/pricing.ts`.

**Tech Stack:** TypeScript, sharp 0.35, fflate, Playwright, Next.js 16 (read `apps/web/node_modules/next/dist/docs/` before touching Next APIs), Drizzle + Postgres, pg-boss, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-sp12-launch-assets-design.md`

## Global Constraints

- Billing: Razorpay credit packs only, never Stripe. Prices only in `packages/db/src/pricing.ts`: `app_icons` 1, `collage` 1, `logo_starter` 0, `mockup` 0. Free jobs use `FREE_JOBS` and `FREE_JOBS_PER_HOUR`.
- SP13 and SP14 are dropped: add nothing for them.
- No document `schemaVersion` bump, no new document fields, no migration.
- DB tests run against the shared remote database: `--testTimeout=90000 --hookTimeout=90000`.
- Do not start the web dev server, MinIO or e2e suites in this branch. E2E tests are written only.
- Licences: launch is MIT (Copyright (c) 2025 applogo contributors): size tables, Contents.json structure, logo palettes and symbol shapes, collage grid rules are ported with a `NOTICES.md` row. launch's font and device PNGs are not copied.

## Task 1: Job types, prices and stub handlers

**Files:** `packages/db/src/pricing.ts`, `packages/db/src/credits.ts`, `apps/web/src/server/jobs.ts`, `apps/worker/src/handlers.ts`, `apps/web/src/components/jobText.ts`; test `packages/db/test/pricing.test.ts` (append or create).

- [ ] Failing test: `PRICES` has `app_icons: 1, collage: 1, logo_starter: 0, mockup: 0`; `priceFor` returns them.
- [ ] Add prices and expiry; `FREE_JOBS` += `logo_starter`, `mockup`; `DOWNLOAD_EXT` += `app_icons: "zip"`, `collage: "png"`, `mockup: "png"`; handlers registered as `FatalJobError("not_implemented")` stubs; `JOB_LABEL` entries.
- [ ] `pnpm typecheck`, test passes, commit `feat(launch): job types and prices for icons, logo, collage and mockup`.

## Task 2: Icon size tables and Contents.json

**Files:** create `apps/worker/src/icons/sizes.ts`, `apps/worker/src/icons/contentsJson.ts`; test `apps/worker/test/icons.test.ts`.

- [ ] Failing tests: counts iPhone 12, iPad 13, watch 17, mac 10, android 5, stores 2; launch's (size, filename) pairs entry for entry; `iconEntries(["android"], ...)` has no Apple entry; `contentsJson` parses, has `info`, no `expected-size`, every filename an Apple entry's file.
- [ ] Port the tables as data; `contentsJson(entries)`.
- [ ] Tests pass, commit `feat(icons): launch's icon size tables and Contents.json`.

## Task 3: Icon files, alpha rules, Android adaptive, ZIP

**Files:** create `apps/worker/src/icons/resize.ts`, `android.ts`, `index.ts`; test `apps/worker/test/icons.test.ts`.

- [ ] Failing tests on a generated 1024 RGBA PNG with transparency: every `AppIcon.appiconset/*.png` and `appstore.png` has 3 channels; `android/mipmap-*/*.png` and `playstore.png` have 4 and keep transparent pixels; mipmap sizes 48/72/96/144/192; foregrounds 108/162/216/324/432 with transparent corners and the art inside the 66/108 safe zone; round icons have transparent corners; XML references `@mipmap/<name>_foreground` and `@color/<name>_background`; Contents.json lists exactly the PNGs in its folder; only-android has no `Assets.xcassets`; `includeStores: false` omits both store icons; two builds give identical file bytes and identical ZIP bytes; non-square and 63 px sources throw `FatalJobError`; 512 px warns `source_small`; corrupt bytes throw `FatalJobError`.
- [ ] Implement `buildIconFiles`, `iconZip`.
- [ ] Tests pass, commit `feat(icons): build the icon ZIP with Apple, Android legacy and adaptive icons`.

## Task 4: app_icons job and enqueue

**Files:** `apps/worker/src/icons/index.ts` (`runAppIcons`), `apps/worker/src/handlers.ts`; create `apps/web/src/server/launchAssets.ts`, `apps/web/src/app/api/launch-assets/icons/route.ts`; tests `apps/worker/test/launchJobs.test.ts`, `apps/web/test/launchAssets.test.ts`.

- [ ] Failing worker test: a queued `app_icons` job with in-memory storage ends `done`, ZIP in `exports:<ws>/<job>.zip`, credit settled; a corrupt source fails without retry and refunds.
- [ ] Failing web test: non-square, tiny, recording and other-workspace assets are rejected before any credit is reserved; a valid request reserves 1 credit and stores the normalised input.
- [ ] Implement, tests pass, commit `feat(icons): app_icons job, API and enqueue checks`.

## Task 5: Logo starter

**Files:** create `apps/worker/src/icons/prng.ts`, `apps/worker/src/icons/logo.ts`; `apps/worker/src/handlers.ts`; `apps/web/src/server/launchAssets.ts`, route `apps/web/src/app/api/launch-assets/logo/route.ts`; `apps/worker/Dockerfile` (fonts); tests in `apps/worker/test/logo.test.ts`, `launchJobs.test.ts`, `apps/web/test/launchAssets.test.ts`.

- [ ] Failing tests: `cleanLogoText("  ab c d ")` is `abcd`, whitespace only is null, 5 chars cut to 4; same `(seed, text)` gives equal buffers; 1024×1024, 3 channels, PNG; seeds 1–50 cover 8 palettes and 5 styles; `"功能"` renders differently from two missing-glyph code points; the job stores an `image` asset and returns `{ assetId, seed }`; enqueue picks a seed when none is given and the 31st free job in an hour is 429.
- [ ] Implement, tests pass, commit `feat(logo): seeded starter logo stored as an app image`.

## Task 6: Mockup document

**Files:** create `packages/document/src/mockup.ts` (+ index export); tests `packages/document/test/mockup.test.ts`, `packages/renderer/test/mockupDevices.test.ts`.

- [ ] Failing tests: `MOCKUP_DEVICES` matches `DEVICE_REGISTRY` (aspect and paddings) for every device but `custom`; `mockupDoc` builds a doc that passes `migrate` and `checkExportable`, one board per shot, the device centred with the native aspect, `screenshotObjectFit` from `fit`, transparent board without a background; crops are the device rect plus the margin, inside the board; `needsFitChoice` true for a 4:3 shot in an iPhone, false for a matching one.
- [ ] Implement, tests pass, commit `feat(mockup): one-board device mockup documents`.

## Task 7: Render path for in-memory documents and the mockup job

**Files:** `packages/db/src/exportSource.ts` (`launchSource`), `apps/web/src/app/render/[jobId]/page.tsx`, `apps/web/src/components/RenderSheet.tsx`, `apps/worker/src/export.ts` (`renderPlan`), create `apps/worker/src/mockup.ts`; `apps/web/src/server/launchAssets.ts`, route `mockup`; tests `packages/db/test/exportSource.test.ts` (append or create), `apps/web/test/launchAssets.test.ts`; e2e `apps/worker/test-e2e/launch.test.ts`.

- [ ] Failing tests: `launchSource` returns the parsed doc and selection for a `mockup` job and null for others or for an invalid doc; enqueue rejects recordings, unknown devices and a mismatched aspect without `fit` (400 `fit_required`), counts toward the free quota and builds a doc referencing `asset:<id>`.
- [ ] Implement; e2e written (not run): a mockup job ends `done` with a PNG whose corners are transparent.
- [ ] Commit `feat(mockup): quick device mockup through the render page`.

## Task 8: Collage

**Files:** create `apps/worker/src/collageLayout.ts`, `apps/worker/src/collage.ts`; handlers; `apps/web/src/server/launchAssets.ts`, route `collage`; tests `apps/worker/test/collage.test.ts`, `launchJobs.test.ts`, `apps/web/test/launchAssets.test.ts`; e2e framed collage in `apps/worker/test-e2e/launch.test.ts`.

- [ ] Failing tests: 4 → 2×2, 5 → 3×2, 9 → 3×3; canvas equals the formula; default padding heuristic; a 1:2 image in a 1:1 cell keeps its aspect; a layout over 8192 is scaled to fit; an unframed job composes the PNG and settles 1 credit; enqueue rejects 1 image, 13 images, recordings and over-8000 px images before reserving.
- [ ] Implement, commit `feat(collage): grid collage of screenshots, optionally framed`.

## Task 9: Launch assets page

**Files:** create `apps/web/src/app/dashboard/apps/[appId]/launch-assets/page.tsx`, `apps/web/src/components/IconGeneratorPanel.tsx`, `LogoStarterPanel.tsx`, `QuickMockupPanel.tsx`, `CollagePanel.tsx`, `apps/web/src/components/launchModel.ts` (pure helpers, tested in `apps/web/test/launchModel.test.ts`); link from the app page.

- [ ] Failing tests for `launchModel`: source warnings (non-square, small), grid preview columns, move up/down.
- [ ] Implement panels, typecheck, lint, commit `feat(launch): launch assets page`.

## Task 10: Notices and roadmap

- [ ] `NOTICES.md` row for launch; roadmap status for SP12; commit `docs: SP12 notices and roadmap status`.
- [ ] `pnpm typecheck`, `pnpm lint`, touched unit tests.
