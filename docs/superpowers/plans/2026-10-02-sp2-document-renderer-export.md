# Sub-project 2 Implementation Plan: Document, Renderer, Templates, Export

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Templates in, filled projects rendered, store-size ZIP out.
**Architecture:** Port OSG's static renderer into `packages/renderer`; types and pure document logic into `packages/document`; worker renders the web `/render/[jobId]` page in headless Chromium.
**Tech Stack:** React 19, three.js, Playwright (chromium), fflate, pixelmatch + pngjs (golden tests).
**Spec:** `docs/superpowers/specs/2026-10-02-sp2-document-renderer-export-design.md`

## Global Constraints

- Ported OSG files keep a header line `// Ported from open-screenshot-generator (MIT), <original path>` and are listed in `NOTICES.md`.
- No file under OSG `public/` is copied into Chitrapx.
- Renderer components take props only: no global stores, no Next imports, no network calls.
- Element positions and sizes are in board pixels; `BoardView` scales with a CSS transform.

## Review Focus

1. **Asset missing at export:** a doc points at a deleted asset; export must fail by name and refund, never ship a hollow PNG. Pinned in Task 6.
2. **Board pixel size:** every PNG must be exactly the target size even with fractional scale or DPR. Pinned in Task 6 by reading PNG headers.
3. **Render page abuse:** a guessed or expired `sig`, or a job not `running`, must get 404 and reveal nothing. Pinned in Task 5.
4. **Fill with fewer screenshots than devices:** remaining devices keep placeholders; never index past the list. Pinned in Task 1.
5. **Locale without overrides:** falls back to base text, never blank. Pinned in Task 2.

---

### Task 1: packages/document
- [ ] Port `types/artboard.ts`; add `ChitrapxDoc`, `BoardGroup`, Zod schema (`docSchema`, permissive per element type), `migrate()` (v1 docs from Foundation lacking `baseLocale` get `en-US`).
- [ ] `targets.ts` registry (all store and social sizes) + `targetForSize(w, h)`.
- [ ] `retarget(group, target)` and `fillScreenshots(doc, assetIds)`.
- [ ] Tests: schema accepts all imported templates; retarget keeps elements inside and relative positions within 1 px; fill with fewer/more screenshots than devices.

### Task 2: packages/renderer
- [ ] Port StaticArtboard, element renderers (text, shape, image, device flat + 3D, background, background image), and their lib deps; replace editor-only deps with props or static stubs; video/gesture/audio render statically.
- [ ] Port i18n projection (`projectArtboards`) and locale defs.
- [ ] `<BoardView doc groupId boardIndex locale scale resolveSrc />`, `useFonts(doc)` (Google Fonts link), readiness tracker.
- [ ] Tests (vitest + jsdom): BoardView renders text content, applies locale override, falls back to base text, renders placeholder for empty device screen.

### Task 3: Template import + seed
- [ ] `packages/document/scripts/import-osg.ts`: read OSG JSON, strip artwork references, wrap into ChitrapxDoc with inferred target, write `packages/assets/templates/<slug>.json` + `report.json`.
- [ ] `packages/db` seed script upserts templates by slug; `pnpm db:seed`.
- [ ] Tests: no output contains `/data/projects` or `/elements/`; 101 templates written.

### Task 4: Web: gallery, project from template, project page
- [ ] `GET /api/templates`, `POST /api/apps/[appId]/projects` accepts `templateSlug` (fills screenshots).
- [ ] Gallery page with live first-board previews (visible-only 3D); project page rendering all boards with locale switcher.
- [ ] Tests: createProject from template stores migrated doc with filled screenshots; unknown template 400.

### Task 5: Render page + signing
- [ ] `renderSig(jobId, expiry)` / `verifyRenderSig`; `/render/[jobId]` server page loads job + project, signs asset URLs, renders every group x board x locale with `data-board` attributes and readiness.
- [ ] Tests: valid sig ok; tampered, expired, or non-running job gives 404.

### Task 6: Worker export job
- [ ] `export` price 1; `exports` bucket; handler launches Chromium, opens render page, waits for readiness, screenshots each `[data-board]`, zips, uploads, returns `{ path, files }`.
- [ ] `POST /api/projects/[id]/export`, `GET /api/jobs/[id]/download`, export button + history on project page.
- [ ] Tests: export of a template project yields PNGs of exact target size; missing asset fails `asset_missing` and refunds.

### Task 7: Golden tests + CI
- [ ] `pnpm test:golden`: export 3 reference templates, compare to committed PNGs with pixelmatch (<0.5% differing pixels); `--update` rewrites references.
- [ ] CI installs Playwright Chromium, starts web, runs golden tests.
