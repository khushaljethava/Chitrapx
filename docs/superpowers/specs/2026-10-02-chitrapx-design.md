# Chitrapx: Design Spec

**Date:** 2026-10-02
**Status:** Approved in brainstorming, pending written-spec review
**Scope of this document:** Part A is the architecture for all of v1. Part B is the detailed spec for sub-project 1 (Foundation), the first thing to plan and build. Sub-projects 2 to 7 each get their own spec, written when they start, and must conform to Part A.

---

## 0. Intent

**What the user said**
- Build a commercial SaaS product in `Chitrapx/` that combines the features and templates of six existing open-source screenshot tools (open-screenshot-generator, PixelDeck, app-store-screenshots, storeshots, launch, appshots) into a better product.
- Differentiators: **(A) AI does the work**, **(B) best editor**, **(E) store-performance (ASO) tooling**.
- Stack: TypeScript, Next.js, Postgres.
- v1 scope: everything, including all store platforms, App Preview videos, and social formats.
- AI cost: Chitrapx pays; customers spend credits and plan quotas.
- Approach: hybrid (new app; reuse OSG's document format and renderers; port assets from the MIT repos).

**Assumptions (correct these if wrong)**
- The customer is an indie developer, small studio, or marketer shipping iOS/Android apps.
- Success for v1 = a customer uploads raw screenshots, gets a finished, translated, store-compliant set in under 5 minutes, adjusts it in the editor, and exports every required size.
- Team features (C) and pipeline automation (D) come after v1.

## 1. Licensing constraints (hard rules)

| Source | License | Rule |
|---|---|---|
| open-screenshot-generator | MIT | Code and templates reusable with attribution. Check `THIRD-PARTY-ASSETS.md` per asset before shipping it. |
| PixelDeck | MIT | Reusable with attribution. |
| app-store-screenshots | MIT | Reusable with attribution. |
| launch | MIT | Device frames and assets reusable with attribution. |
| appshots | MIT per README, no LICENSE file | Treat as reference only until a LICENSE file exists. Copy nothing. |
| storeshots | **AGPL-3.0** | **No code, text, or assets copied.** Ideas may be re-implemented from scratch. |
| Remotion (used by OSG promo/video) | Company license required for orgs over 3 people | Not used. Video is rendered with headless Chromium + ffmpeg. |

All reused MIT material is listed in `NOTICES.md` at the repo root with its copyright line. CI fails if a file under `packages/assets/third-party/` has no entry in `NOTICES.md`.

---

# Part A: v1 Architecture

## A1. System overview

```
apps/web (Next.js 16, App Router, deployed on Vercel)
  - marketing, dashboard, editor UI
  - route handlers / server actions: auth -> workspace membership -> plan limits -> validate -> act
  - @chitrapx/renderer for in-browser preview

Supabase
  - Auth (email magic link, Google, GitHub)
  - Postgres with RLS (accessed through Drizzle ORM)
  - Storage (uploads, exports, template assets)

apps/worker (Node container on Fly.io, Railway, or a VPS)
  - consumes pg-boss jobs from the same Postgres
  - export: headless Chromium renders /render/[jobId] using @chitrapx/renderer
  - video: Chromium frame stepping -> ffmpeg (H.264)
  - ai: Claude calls (analyze, plan, translate, variants)
```

The worker is a separate process because Chromium and ffmpeg need long-running, memory-heavy execution that serverless functions do not reliably provide.

## A2. Repository layout (pnpm workspace)

```
Chitrapx/
  apps/web          Next.js app
  apps/worker       job runner
  packages/document ChitrapxDoc types (wrapping OSG ArtboardState), Zod schemas, migrations
  packages/renderer React renderers (lifted from OSG elements/), no store or editor dependencies
  packages/assets   templates, device frames, styles, fonts, third-party/ + NOTICES entries
  packages/db       Drizzle schema, migrations, RLS policy SQL, seed scripts
  docs/             specs and plans
  NOTICES.md
```

## A3. Key technology choices

- **Supabase** for auth, Postgres, and storage: one vendor, RLS for workspace isolation. All DB access goes through Drizzle on plain Postgres, so leaving Supabase means replacing auth and storage only.
- **pg-boss** queue on the same Postgres. Ceiling: a few hundred jobs per second; move to Redis/BullMQ if that is ever reached.
- **Claude via the Vercel AI SDK.** Models: `claude-haiku-4-5-20251001` for analyze and translate, `claude-sonnet-5-5` for plan and variants. All model calls go through one `ai` module in the worker.
- **Append-only credit ledger.** Balance is `SUM(delta)`. No mutable balance column.
- **Razorpay** for billing (sub-project 7): subscriptions for plans, one-time orders for credit packs, webhooks verified by signature. Chosen by the user over Stripe.

## A4. Data model

All tables carry `workspace_id` (except `profiles` and `templates`). RLS: rows are **read-only** to members of their workspace; users hold a JWT that reaches PostgREST directly, so every write goes through the server's checks (plan limits, upload validation, billing fields), never through RLS. The worker uses the service role and checks `workspace_id` explicitly on every job.

```
profiles         id (= auth.users.id), name, avatar_url, created_at
workspaces       id, name, slug unique, plan ('free'|'pro'|'studio'), razorpay_customer_id null, created_at
memberships      workspace_id, user_id, role ('owner'|'member'), created_at; PK (workspace_id, user_id)
apps             id, workspace_id, name, platform_hint ('ios'|'android'|'both'), description, brand jsonb, created_at
projects         id, workspace_id, app_id, name, kind ('screenshots'|'video'|'social'),
                 doc jsonb, doc_schema_version int, revision int default 0,
                 thumbnail_asset_id null, updated_by, created_at, updated_at
project_versions id, workspace_id, project_id, revision, doc jsonb, label null, created_by, created_at
assets           id, workspace_id, app_id null, kind ('screenshot'|'recording'|'image'|'font'|'export'|'thumbnail'),
                 storage_path, mime, width null, height null, bytes, sha256, created_at;
                 unique (workspace_id, app_id, sha256) NULLS NOT DISTINCT
                 -- bytes are stored once per workspace at <workspace_id>/<sha256>; rows are per app
jobs             id, workspace_id, project_id null, type, status ('queued'|'running'|'done'|'failed'),
                 input jsonb, output jsonb null, error text null, credits_reserved int,
                 attempts int default 0, created_at, started_at null, finished_at null
credit_ledger    id, workspace_id, delta int, reason ('plan_grant'|'purchase'|'reserve'|'settle'|'refund'|'adjust'),
                 job_id null, note null, created_at
templates        id, slug unique, category, platforms text[], kind, doc jsonb, preview_path,
                 source ('osg'|'ass'|'pixeldeck'|'chitrapx'), license_note, created_at
```

Rules:
- **Save** = `UPDATE projects SET doc=$1, revision=revision+1 WHERE id=$2 AND revision=$3`. Zero rows updated = conflict, returned to the client as HTTP 409 with the current revision.
- **Auto-snapshot:** every 20th revision is copied into `project_versions` (constant `AUTO_SNAPSHOT_EVERY = 20`).
- **Uploads** go browser -> Supabase Storage via a signed upload URL. The server then records the `assets` row after verifying size, MIME, and sha256.
- **Credit reservation** happens inside the transaction that inserts the job: take a per-workspace advisory lock, insert a `reserve` row with negative delta, then check `SUM(delta) >= 0` for the workspace; roll back if negative. The worker writes `settle` (difference between reserved and actual, usually 0) or `refund` (full reserved amount on fatal failure).

## A5. Document format

```ts
interface ChitrapxDoc {
  schemaVersion: 1;
  kind: 'screenshots' | 'video' | 'social';
  groups: BoardGroup[];
  localization: ProjectLocalization; // OSG type, unchanged
  brand?: { appId: string };         // tokens resolve against apps.brand at render time
}

interface BoardGroup {
  id: string;
  target: TargetId;
  boards: ArtboardState[];           // OSG type, unchanged
  spanElements: ArtboardElement[];   // strip coordinates, may cross board seams
}
```

- `TargetId` and pixel sizes live in one registry, `packages/document/src/targets.ts`, merged from OSG `deviceRegistry`/`socialFormats`, PixelDeck `canvasFormats`, and app-store-screenshots size tables. It covers iPhone, iPad, Mac, Apple Watch, Apple TV, Vision Pro, Android phone, Android 7" and 10" tablet, Play feature graphic, and social formats (Instagram post/story, X post, LinkedIn post, Product Hunt gallery).
- **Retargeting** a group to a new size scales elements to fit, preserving relative layout; per-element manual adjustment remains possible.
- **Brand tokens:** colour and font fields accept `brand:<token>` (e.g. `brand:primary`, `brand:heading`), resolved at render time.
- **Migrations:** `packages/document/src/migrate.ts` exports `migrate(doc: unknown): ChitrapxDoc`, a chain of pure `vN -> vN+1` functions. Every load runs it.
- **Template import:** a seed script wraps each OSG template JSON into one group, infers `target` from board size, validates with Zod, and reports failures instead of skipping silently.

## A6. Renderer

- `packages/renderer` exports `<BoardView doc groupId boardIndex locale scale time? />`. Pure React, no global state.
- Element renderers are lifted from OSG `src/components/open-screenshot-generator/elements/` and adapted to take props only.
- Span elements: each board renders the group's `spanElements` translated by the board's strip offset and clipped to its bounds (PixelDeck `panoGeometry` approach).
- **Server export:** worker opens `/render/[jobId]?token=…` (single-use signed token) in headless Chromium, mounts `BoardView` at scale 1, waits for `document.fonts.ready` and every `<img>` `decode()`, then captures each board at exact target size. Missing font or image = job fails with a named error; never ship a PNG with gaps.
- **Export plan:** pure function enumerating locale x target x board with deterministic filenames (PixelDeck `exportPlan` logic), output zipped as `<platform>/<target>/<locale>/<NN>-<board-name>.png`.
- **Video:** `BoardView` takes `time` in ms; worker steps frames at 30 fps, encodes with ffmpeg to H.264 matching App Preview specs.
- **Golden tests:** a fixed set of reference templates rendered server-side in CI, compared to committed PNGs with a pixel-difference threshold.

## A7. AI pipeline

The model never edits document JSON. It returns a typed plan; deterministic code applies it.

| Step | Job type | Output | Model |
|---|---|---|---|
| Analyze | `ai_analyze` | `ScreenInsight` per screenshot, cached by sha256 | Haiku 4.5 |
| Plan | `ai_design` (steps plan+apply) | `DesignPlan`: template, slide order, copy per slide, feature chips | Sonnet 5.5 |
| Apply | (code, inside `ai_design`) | `ChitrapxDoc` | none |
| Translate | `ai_translate` | `localization` entries per locale; glossary terms never translated | Haiku 4.5 |
| Variants | `ai_copy` | 3 copy alternatives; layout untouched | Sonnet 5.5 |

- Prices per job type live in `packages/db/src/pricing.ts`, the only place they are defined.
- The template catalog given to the model is generated from `packages/assets` at build time; CI fails if it is stale.
- Actual token usage is stored in `jobs.output.usage` for later price tuning.

## A8. ASO tools

Re-implemented from scratch (no storeshots code):
- Headline linter: words per line, line count, per-locale character limits, minimum legible size at store-thumbnail scale, text/background contrast.
- Fold markers: first 3 slides (iOS), first 2 (Play).
- Store listing preview: App Store and Google Play search and product page mockups, light and dark, per locale.
- A/B variant sets: copy variants of a group exported separately for App Store Product Page Optimization and Play store listing experiments.
- Competitor reference board: user-uploaded competitor screenshots analysed by the Analyze step to inform the brief. No scraping.

## A9. Editor

- Single Zustand store: `doc`, `selection`, `viewport`, `activeLocale`. All mutations go through `apply(command)`; undo/redo via Immer patches.
- Layout: left (groups, boards, palette), centre (infinite canvas, whole strip, seams marked), right (inspector), top (target switcher, locale tabs, AI and ASO panels).
- Interaction layer wraps `BoardView`: select, move, resize, rotate, snapping, multi-select, z-order, keyboard shortcuts. Pointer events only.
- Autosave: 1.5 s debounce, full doc with `revision`; 409 opens a reload-or-overwrite dialog; unsaved edits buffered in IndexedDB until the server acknowledges.
- Locale tabs edit OSG `ElementLocaleOverride`s; overridden fields marked, "reset to base" available.

## A10. Errors and limits

- Zod validation at every API boundary. Order of checks: authenticated, workspace member, plan limit, input valid.
- Jobs: transient errors retry up to 3 times with pg-boss exponential backoff starting at 2 s. Fatal errors fail immediately and refund.
- Upload limits: images 25 MB, recordings 500 MB, fonts 10 MB. SVG uploads sanitized. MIME sniffed server-side, not trusted from the client.

## A11. Testing

- Vitest unit tests: migrations, template import, retargeting, export plan, credit ledger, ASO rules.
- Golden render tests in CI.
- Playwright E2E: sign up -> AI design -> edit -> export ZIP -> credits deducted.
- RLS tests against local Supabase: workspace A cannot read or write workspace B.

## A12. Sub-project order

1. **Foundation** (Part B)
2. Document model, renderer, templates, server export
3. Editor
4. AI pipeline
5. ASO tools
6. Video previews and social formats
7. Billing launch (Razorpay subscriptions for plans, one-time payments for credit packs)

Gap-closing sub-projects, agreed 2026-10-03 after comparing Chitrapx with the six source tools:

8. Sizes and export (missing store sizes, derived sizes at export, free single PNG, store-readiness report, `.chitrapx` project file)
9. Editor essentials (layers panel, grouping, layout presets, apply-to-all, drop and folder import, version restore, status bar)
10. Typography and style (custom fonts, rich text, palette from screenshots, named styles, headline formulas, CarPlay frame)
11. Localization and AI copy (translations table with CSV/JSON, RTL, feature chips, vertical presets, competitor board)
12. Launch assets (icon generator, logo starter, collage)
13. Developer automation (public API and keys, CLI with render/verify/capture/record, MCP server)
14. Store publishing and sync (App Store Connect and Google Play upload, Google Drive and GitHub sync)
15. Collaboration (share a copy, team roles, live co-editing)
16. Polish (update banner, changelog, analytics consent, community template feed)

## A13. Out of scope

Desktop app, browser extension, bring-your-own AI key (conflicts with credits), text-to-speech and video title cards. The public API/CLI/MCP, store upload, collaboration and team roles moved into sub-projects 13–15.

---

# Part B: Sub-project 1, Foundation

## B1. Goal

A deployed, empty-but-real SaaS shell: a user can sign up, gets a workspace with free credits, creates an app and a project, uploads screenshots, and sees the project list. A dummy job proves the queue, the worker, and credit reserve/refund end to end. No editor, renderer, or AI yet.

## B2. Deliverables

1. pnpm monorepo per A2 with TypeScript strict mode, shared `tsconfig`, Vitest, and ESLint (flat config) across all packages. Only `apps/web`, `apps/worker`, and `packages/db` are created in this sub-project; the other packages are created by the sub-project that first needs them.
2. `packages/db`: Drizzle schema for every table in A4, generated SQL migrations, RLS policies as SQL migrations, and a seed script (no templates yet).
3. Supabase local dev via `supabase start`; documented in `README.md`.
4. `apps/web`:
   - Auth pages: email magic link, Google, GitHub (Supabase Auth).
   - On first sign-in: create `profiles` row, a workspace named "<name>'s workspace", an owner membership, and a `plan_grant` ledger row of the free plan's monthly credits. Done in one transaction in the auth callback route; idempotent on repeat.
   - Dashboard: list of apps; create, rename, delete app (with brand fields: name, description, platform_hint, primary/secondary colour, heading/body font, logo upload).
   - Per app: list of projects; create (name, kind), rename, delete. `doc` initialised to `{ schemaVersion: 1, kind, groups: [], localization: { locales: [] } }` validated by a minimal Zod schema in `packages/db` (moved to `packages/document` in sub-project 2).
   - Upload: drag-and-drop screenshots to an app; signed upload URL flow; dedupe by sha256; thumbnail grid.
   - Credits badge in the header showing the current balance.
   - Health route `/api/health` returning DB and queue status.
5. `apps/worker`: pg-boss consumer with a `noop` job type that sleeps 1 s and either succeeds (settle 0) or fails fatally when `input.fail = true` (refund). Graceful shutdown on SIGTERM.
6. Credit service in `packages/db/src/credits.ts`: `balance(db, workspaceId)`, `reserveAndEnqueue(tx, boss, { workspaceId, projectId, type, input })`, `settle(db, jobId, actual)`, `refund(db, jobId)`. Uses a per-workspace advisory lock. Prices from `pricing.ts` (`noop: 1`).
7. Plans in `packages/db/src/plans.ts` with these launch values (business-tunable, single source of truth):
   - free: 50 credits/month, 1 app, 3 projects
   - pro: 1,000 credits/month, 10 apps, unlimited projects
   - studio: 5,000 credits/month, unlimited apps and projects
   Plan limits are enforced in server actions. Monthly grants are applied by a daily pg-boss cron job (`grant_monthly_credits`) keyed on workspace creation day; idempotent per workspace per calendar month. Unused credits do not roll over: the grant tops the plan allowance up, it does not add to leftovers.
8. CI (GitHub Actions): install, typecheck, lint, unit tests, RLS tests against Supabase in Docker.
9. Deploy docs: Vercel for `apps/web`, a Dockerfile for `apps/worker`, environment variable list in `.env.example`.
10. `NOTICES.md` created (empty table, ready for sub-project 2).

## B3. Acceptance criteria

- New user signs up via magic link and lands on a dashboard with a workspace and 50 credits.
- Signing in again does not create a second workspace or grant credits twice.
- Free user cannot create a second app; the UI shows the limit and the server rejects a direct request with HTTP 403.
- Uploading the same image twice creates one `assets` row.
- Uploads over 25 MB or with a non-image MIME are rejected server-side.
- Triggering a `noop` job from a dev-only button lowers balance by 1, and the job shows `done`. A `noop` with `fail: true` shows `failed` and the balance returns to its prior value.
- With balance 0, enqueueing a job fails with "insufficient credits" and no job row exists.
- RLS test: a user of workspace A gets zero rows when reading, an error when inserting, and zero affected rows when updating or deleting, for every table, when targeting workspace B.
- Two concurrent `reserveAndEnqueue` calls on a balance of 1 result in exactly one job.
- CI is green.

## B4. Out of scope for Foundation

Editor, renderer, templates, AI, ASO, video, billing, team invites, email beyond Supabase's auth emails.
