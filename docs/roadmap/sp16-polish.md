# SP16: Polish

**Status:** Built (spec `docs/superpowers/specs/2026-10-06-sp16-polish-design.md`, plan `docs/superpowers/plans/2026-10-06-sp16-polish.md`). Migration `0013_sp16_community_analytics` must be applied before the community feed and analytics work.
**Goal:** Users get told when a new deploy is live, can read what changed, can opt in to privacy-friendly analytics, and can share templates with each other; plus a batch of small cleanups from earlier sub-projects.
**Depends on:** SP8 sizes/export (ExportDialog, export jobs and the `project_versions` rows they pin); the existing `templates` table and template seed for the community feed. No other hard dependency, so this can be built any time.
**Gap source:** storeshots (update banner, changelog page, consent-gated Umami, CSP) and open-screenshot-generator (community "Discover" feed). All paths below were checked with `ls`/`grep` on 2026-10-04.

## Features

### 16.1 "New version available" banner

- **What it does:** a long-open tab notices that a new deploy has gone out and shows a small banner with a Refresh button, instead of failing on stale JS chunks or server-action ids.
- **Details:**
  - Build id is baked into the client bundle at build time (e.g. `NEXT_PUBLIC_BUILD_ID` from the git SHA or a timestamp, set in `next.config.ts` `env`).
  - `GET /api/version` returns `{ buildId }` with `Cache-Control: no-store`; excluded from the auth proxy matcher like `api/health`.
  - Client polls about 30 s after load, every 5 min, and on `visibilitychange` to visible; stops polling once an update is detected; ignores network errors.
  - Banner is non-blocking and dismissible per build id. Never auto-reloads. In the editor, refresh must not lose unsaved edits: show the banner only, and make Refresh first await the pending save (or warn if the save is dirty/failed).
  - Optional second signal: treat a failed dynamic chunk load or "Failed to find Server Action" error as an update-needed trigger.
- **Acceptance criteria:**
  - Deploying a build with a new id makes an already-open tab show the banner within 5 min of becoming visible.
  - Same build id: no banner. Offline or `/api/version` failing: no banner, no console error.
  - Refresh in the editor with unsaved changes does not discard them.
  - `/api/version` is reachable signed out and returns a different value per build.
- **Chitrapx today:** nothing. `apps/web/next.config.ts` only sets `serverExternalPackages`; `apps/web/src/app/layout.tsx` has no client-side shell; `apps/web/src/proxy.ts` matcher excludes only `api/health` and `api/billing/webhook` (add `api/version`). A health route exists at `apps/web/src/app/api/health`.
- **Chitrapx changes:** create `apps/web/src/app/api/version/route.ts`; create `apps/web/src/components/UpdateBanner.tsx` (client, poll hook inside) and mount it in `apps/web/src/app/layout.tsx`; modify `apps/web/next.config.ts` (inject build id); modify `apps/web/src/proxy.ts` matcher; add a unit test for the version route in `apps/web/test/`.
- **Reference code:**
  - `storeshots/app/composables/useUpdateAvailable.ts` (AGPL-3.0) — the polling cadence (30 s first check, 5 min interval, visibilitychange) and "stop once detected" logic; ideas only.
  - `storeshots/server/api/version.get.ts` (AGPL-3.0) — tiny endpoint returning the baked-in build id with revalidate headers; ideas only.
- **License note:** storeshots is AGPL-3.0: ideas only, copy nothing. Write from scratch.
- **Size:** S

### 16.2 Changelog page

- **What it does:** a public `/changelog` page showing release notes, so users can see what shipped.
- **Details:**
  - Source of truth is a `CHANGELOG.md` at the repo root (Keep a Changelog style: `## [x.y.z] - date`, Added/Changed/Fixed).
  - Page is a server component that reads and renders the file at build time (static); links from the landing page footer and, optionally, from the update banner ("See what's new").
  - Rendered HTML must be sanitised even though the file is repo-controlled (a PR could slip raw HTML in).
  - Has its own title, description and OG metadata; no auth required (add to the proxy allow path; `/changelog` is already not protected since only `/dashboard` and `/editor` are gated).
  - Optional later: `/changelog.xml` RSS feed.
- **Acceptance criteria:**
  - `/changelog` renders each release as a heading with its date and bullet list, signed out.
  - Raw `<script>` or `onerror=` in `CHANGELOG.md` does not execute in the rendered page (test with a fixture).
  - Page is statically generated (no runtime file read in production).
  - Adding a new entry to `CHANGELOG.md` and rebuilding shows it with no code change.
- **Chitrapx today:** nothing. No `CHANGELOG.md` at the repo root (`ls` fails); no `/changelog` route under `apps/web/src/app/` (routes are `api`, `auth`, `dashboard`, `editor`, `login`, `render`, plus `page.tsx`). No markdown dependency in `apps/web`.
- **Chitrapx changes:** create `CHANGELOG.md` (seed with SP1 to SP8 entries); create `apps/web/src/app/changelog/page.tsx`; add a markdown renderer plus sanitiser dependency (e.g. `marked` + `sanitize-html` or `rehype-sanitize`) to `apps/web/package.json`; link in `apps/web/src/app/page.tsx` footer; test in `apps/web/test/`.
- **Reference code:**
  - `storeshots/app/pages/changelog.vue` (AGPL-3.0) — bundles `CHANGELOG.md` as a raw string at build time, renders with `marked` and sanitises the output; ideas only.
  - `storeshots/CHANGELOG.md` (AGPL-3.0) — shows the Keep a Changelog layout with `[Unreleased]` on top; ideas only.
- **License note:** storeshots is AGPL-3.0: ideas only, copy nothing, including changelog text.
- **Size:** S

### 16.3 Privacy-friendly analytics with cookie consent

- **What it does:** Chitrapx measures page views and key funnel events (sign-up, project created, export started) with a cookieless, privacy-first tool, loaded only after the visitor opts in, with a banner and a way to change the choice later.
- **Details:**
  - Tool: Umami (cloud or self-hosted) or Plausible; script URL and site id come from env (`NEXT_PUBLIC_ANALYTICS_HOST`, `NEXT_PUBLIC_ANALYTICS_SITE_ID`); with no site id set, nothing loads and no banner shows.
  - Consent is stored in a small first-party cookie with a version number; bumping the version re-asks. Choices: necessary (always on) and analytics. Reject is as easy as accept.
  - Script is injected only after consent; revoking removes it and stops further events.
  - Respect Do Not Track / Global Privacy Control: treat as "no" without prompting.
  - Never send project content, file names, emails or user ids as event properties; only event name plus coarse props (e.g. export format).
  - A "Cookie settings" link in the footer reopens the banner. Privacy policy page text must name the processor.
  - Session cookies from Supabase auth are strictly necessary and stay outside the consent gate.
- **Acceptance criteria:**
  - Fresh visitor: banner shows, zero requests to the analytics host until Accept.
  - After Accept: script loads and a page view is recorded; after Reject or DNT/GPC: no analytics requests, banner not shown again for the consent version.
  - Revoking via footer link stops events without a full reload being required for correctness.
  - CSP (see below) allows only the configured analytics host.
  - No analytics event payload contains user content or PII (test on the event helper).
- **Chitrapx today:** nothing. No analytics, consent or CSP code anywhere in `apps/web` (grep for `umami`, `consent`, `Content-Security-Policy` finds nothing). `apps/web/next.config.ts` sets no headers.
- **Chitrapx changes:** create `apps/web/src/lib/consent.ts` (cookie read/write, version, DNT/GPC check); create `apps/web/src/components/ConsentBanner.tsx` and `apps/web/src/components/Analytics.tsx` (conditional script), mount in `apps/web/src/app/layout.tsx`; create `apps/web/src/lib/track.ts` (allow-listed event names and props); add `headers()` with CSP to `apps/web/next.config.ts` or generate a per-request nonce in `apps/web/src/proxy.ts`; add `.env.example` entries; privacy policy page.
- **Reference code:**
  - `storeshots/app/composables/useCookieConsent.ts` (AGPL-3.0) — versioned first-party consent cookie, categories, re-ask on version bump, one-time legacy migration, Do Not Track check; ideas only.
  - `storeshots/app/app.vue` (AGPL-3.0) — Umami loaded only when a website id is configured, host overridable for self-hosting; ideas only.
  - `storeshots/nuxt.config.ts` (AGPL-3.0, around lines 150 to 165) — CSP with nonce, `strict-dynamic`, and the Umami hosts added to `script-src` and `connect-src`; ideas only.
  - `storeshots/.env.example` (AGPL-3.0) — env naming for the website id and host; ideas only.
- **License note:** storeshots is AGPL-3.0: ideas only, copy nothing.
- **Size:** M

### 16.4 Community template feed

- **What it does:** signed-in users publish a template made from one of their projects to a public feed; others browse, preview and import it into their own workspace as a new project; staff can hide or remove posts.
- **Details:**
  - Publish flow: from a project, "Share to community" with title, description, category/platform tags; server snapshots the project doc (not a live link), strips workspace-private data (asset references to private storage, app ids, AI prompts and credits info) and re-hosts or inlines only the assets that are allowed.
  - Feed: paginated, filter by platform/category, sort by newest and most imported; each card shows author handle, preview image and import count.
  - Import: copies the snapshot into a new project in the importer's workspace using the existing template-to-project path; increments an import counter once per user per post.
  - Authors can unpublish or delete their post; imported copies are unaffected.
  - Moderation: user report button with reason; a post hidden by staff vanishes for everyone except its author (OSG treats it as "deleted" to others, not as a moderation notice); an `is_staff`/admin-only review queue of reported and new posts.
  - Limits: rate limit publishes per user per day, cap doc size and asset count, require a verified email, cap reports per user.
  - Posts must carry a licence statement from the author (they own or may share the content); fonts and stock imagery in the doc must be checked against allowed sources.
  - Bundled templates (`source` in `osg`, `ass`, `pixeldeck`, `chitrapx`) stay separate from user posts; do not mix user content into the `templates` seed table without a new `community` source.
- **Acceptance criteria:**
  - A user can publish a project; it appears in the feed with preview within one request cycle (or after approval, if pre-moderation is chosen).
  - Another user can import it; the new project opens in the editor and exports without referencing the author's private assets.
  - Reporting a post three times (configurable) auto-hides it pending review; staff can restore or delete.
  - A hidden post returns 404 to non-authors, including direct links.
  - Exceeding the daily publish limit returns a clear 429-style error and publishes nothing.
  - RLS tests prove a user cannot read another user's private projects through the feed and cannot edit someone else's post.
- **Chitrapx today:** only bundled templates. `packages/db/src/schema.ts:187` defines `templates` (slug, name, description, category, platforms, kind, doc, previewPath, source, licenseNote) with `templateSourceEnum` at line 17 (`osg`, `ass`, `pixeldeck`, `chitrapx`); `apps/web/src/server/templates.ts` reads them; `packages/assets` holds the bundled files. No user-published content, reports, moderation or staff role exist.
- **Chitrapx changes:** new tables in `packages/db/src/schema.ts` plus a migration and RLS tests in `packages/db/test/rls.test.ts`: `community_posts` (id, author user id, workspace id, title, description, platforms, kind, doc snapshot, preview path, status `pending|published|hidden|removed`, import_count, created_at), `community_reports` (post id, reporter id, reason, created_at, unique per reporter and post), `community_imports` (post id, user id, unique); new server module `apps/web/src/server/community.ts` (publish, list, get, import, report, moderate) reusing `apps/web/src/server/templates.ts` import path and `apps/web/src/server/uploads.ts` for assets; routes `apps/web/src/app/api/community/...`; UI `apps/web/src/app/dashboard/community/page.tsx` and a "Share" action in the editor; a preview render job via `apps/web/src/server/jobs.ts` and the worker; staff queue page.
- **Reference code:**
  - `open-screenshot-generator/src/types/discover.ts` (MIT) — the post/author/surface data shapes of the feed; also documents the design decision to hide the transport behind one interface.
  - `open-screenshot-generator/src/lib/discover/api.ts` (MIT) — the `DiscoverApi` interface and the error types (`DiscoverDisabledError`, `DiscoverSignInRequiredError`) for a feed that degrades when the backend is off.
  - `open-screenshot-generator/src/components/open-screenshot-generator/discover/` (MIT) — `DiscoverDialog.tsx`, `PostCard.tsx`, `PostDetailView.tsx`, `SharePostView.tsx`, `CommunityStartPanel.tsx`: UI flow for browsing, sharing and starting from a community post.
  - `open-screenshot-generator/infra/vps/pb-hooks/050_discover.pb.js` (MIT) — server-side rules: hidden posts show as deleted to non-authors (around line 289), per-action rate limits, comment and post creation.
  - `open-screenshot-generator/infra/vps/pb-hooks/lib/openscreengen.js` (MIT) — shared `VISIBLE` filter (`hidden = false || hidden = null`), `decorate`, and the rate-limit helper (around line 893).
  - `open-screenshot-generator/infra/vps/pb-hooks/dash/views/risk.js`, `comments.js`, `feed.js` (MIT) — operator dashboard views for abuse, comment moderation and feed oversight; use as a checklist of what moderators need.
- **License note:** OSG is MIT: code may be adapted with attribution in `NOTICES.md`, but its backend is PocketBase hooks and its client uses a PocketBase API, so expect to rewrite for Postgres/Supabase rather than copy. Community post content itself is user-owned; do not seed OSG's `public/data/projects/*.json` into the feed without checking `THIRD-PARTY-ASSETS.md`.
- **Size:** L

### 16.5 Small leftovers

- **What it does:** closes four small gaps left by earlier sub-projects.
- **Details:**
  - **Export dialog Escape key and focus trap.** `apps/web/src/components/ExportDialog.tsx:77` renders `role="dialog" aria-modal="true"` but has no `keydown` handler (grep for `Escape|keydown` finds nothing). Add: Escape calls `onClose` (not while a request is mid-flight, or with confirm); focus moves into the dialog on open, Tab and Shift+Tab cycle within it, focus returns to the trigger on close; backdrop click closes. Prefer a small shared `useDialog` hook or the native `<dialog>` so other dialogs can reuse it.
  - **Remove unused `file-type` and `image-size` from apps/web.** They are listed in `apps/web/package.json` lines 19 to 20 and also in `packages/db/package.json` lines 20 to 21, where `packages/db/src/assetCheck.ts` actually imports them. Grep found no import in `apps/web/src`; the only mention in `apps/web/test/uploads.test.ts:149` is a comment. Remove from `apps/web` only (keep in `packages/db`), run `pnpm install`, typecheck and tests. If the web app needs them transitively, it gets them through `@chitrapx/db`.
  - **Pruning of pinned `project_versions`.** `packages/db/src/schema.ts:89` defines `project_versions` with only an index on `project_id`; rows are inserted on save (`apps/web/src/server/projects.ts:148`) and per export job (`apps/web/src/server/jobs.ts:48-55`, which reuses the row for the current revision), and export reads them by id (`packages/db/src/exportSource.ts:13`). Nothing deletes them, so they grow without bound. Add a pruning job (pg-boss, in the worker like the sweep in `apps/worker/src/index.ts:28`) that deletes versions older than N days, keeping the latest K per project and never deleting a version referenced by a job that is queued, running, or whose output is still downloadable. Find references through `jobs.input->>'versionId'` (export jobs store `{ selection, versionId }` in the `input` jsonb; there is no separate column, so add an expression index if the query is slow) and, optionally, a `pinned` boolean for user-labelled versions (`label` already exists).
  - **e2e console.log cleanup.** `apps/worker/test-e2e/export.test.ts:340` logs round-trip pixel diffs with `console.log`. Replace with a vitest-friendly report (assert a threshold, or attach to test output via `task.meta`/`expect` message) so the run is quiet by default. The `console.log` calls in `apps/worker/src/index.ts` (lines 21, 28, 31) are operational logs, not test noise; leave them or move to a logger separately.
- **Acceptance criteria:**
  - Escape closes the export dialog; Tab never leaves it while open; focus returns to the Export button; covered by a component or e2e test.
  - `grep -n "file-type\|image-size" apps/web/package.json` returns nothing; `pnpm -r typecheck` and `pnpm -r test` pass; `packages/db` still validates uploads.
  - Pruning job leaves exports in flight and the latest K versions intact (tested with fixtures), and deletes the rest past the cutoff; running twice is a no-op.
  - `pnpm test:e2e` output contains no stray `round-trip diff` lines on a passing run.
- **Chitrapx today:** see the paths above; all four items are present and unaddressed.
- **Chitrapx changes:** modify `apps/web/src/components/ExportDialog.tsx` (and possibly `ExportPanel.tsx`); modify `apps/web/package.json` and the lockfile; modify `packages/db/src/schema.ts` (optional `pinned` column, partial index) plus a migration; add `apps/worker/src/jobs/pruneVersions.ts` (or the equivalent in the worker's handler layout) and schedule it in `apps/worker/src/index.ts`; modify `apps/worker/test-e2e/export.test.ts`.
- **Reference code:**
  - None needed; these are internal cleanups. For dialog behaviour, the competitor repos are not a better source than the native `<dialog>` element.
- **License note:** nothing external is reused.
- **Size:** S (dialog, deps, e2e); M (pruning, because of the in-use check and migration)

## Data model and API changes

- New: `GET /api/version` (public, no-store).
- New: `/changelog` page and root `CHANGELOG.md`.
- New env vars: `NEXT_PUBLIC_BUILD_ID` (or derived at build), `NEXT_PUBLIC_ANALYTICS_HOST`, `NEXT_PUBLIC_ANALYTICS_SITE_ID`.
- New cookie: versioned first-party consent cookie (analytics yes/no).
- New tables: `community_posts`, `community_reports`, `community_imports`; a staff role or flag; optional `community` value in `template_source` if curated posts are promoted to the bundled catalog. All tables need RLS and tests in `packages/db/test/rls.test.ts`.
- New API: `/api/community` (list, publish), `/api/community/[id]` (get, delete), `.../import`, `.../report`, plus staff moderation endpoints.
- `project_versions`: optional `pinned` column; pruning job in the worker.
- Remove `file-type` and `image-size` from `apps/web/package.json`.

## Security notes

- **CSP (16.3):** Chitrapx sends no CSP today. Introduce one with a per-request nonce (set in `apps/web/src/proxy.ts`) and `strict-dynamic`; start in `Content-Security-Policy-Report-Only` to find breakage from Supabase, Razorpay (use Razorpay, never Stripe), fonts, and the render route. `script-src` and `connect-src` list only the configured analytics host; `img-src` must include Supabase storage for community previews; `frame-ancestors 'none'` except where `/render/[jobId]` needs to be loaded by the worker.
- **Analytics:** allow-listed event names and props only; no user content or ids; honour DNT/GPC.
- **Version endpoint:** returns only the build id; do not leak commit message, env or branch names.
- **Changelog:** sanitise rendered markdown; never render with `dangerouslySetInnerHTML` on unsanitised output.
- **Community abuse:** published docs are untrusted input that other users import and the worker renders. Validate the doc with the same schema and migration (`migrate`) the editor uses, reject unknown element types, cap size and element count, and block remote URLs in image and font fields (SSRF and tracking pixels when the worker renders). Re-host assets through `apps/web/src/server/uploads.ts` so `packages/db/src/assetCheck.ts` verifies file type. Escape all text on cards; no HTML in titles or descriptions.
- **Moderation:** rate limits on publish, report and import; one report per user per post; auto-hide after a threshold and queue for staff review; hide rather than delete so decisions are reversible; keep an audit log of staff actions; ban or suspend publish rights per user; a takedown contact for copyright claims. Ensure hidden posts are excluded by every query (OSG uses one shared `VISIBLE` filter for this; do the same with a single view or helper).
- **Privacy of source projects:** the snapshot must not include other tenants' assets, AI prompts, app store credentials or workspace ids; test that import into another workspace works with RLS on.
- **Pruning:** only delete versions with no live job reference; run inside a transaction under workspace-scoped RLS or a service role with explicit checks.

## Open questions

- Pre-moderation (approve before visible) or post-moderation (visible, hide on report)? Pre is safer but needs staff time from day one.
- Who counts as staff: a column on the user/profile, a Supabase role, or an env allow-list of emails?
- Do community posts carry a visible author identity (handle, avatar) or stay anonymous? Needs a public profile concept Chitrapx lacks.
- Can free-plan users publish, and does importing cost credits? Interacts with the Razorpay plan model.
- Analytics vendor: Umami Cloud, self-hosted Umami, or Plausible; is a consent banner still wanted if fully cookieless (many jurisdictions would allow it, but the roadmap item says with consent)?
- Build id source on the deploy platform (git SHA env var versus build timestamp); does the host serve old assets after a deploy (skew protection)?
- Version retention policy numbers: N days and K per project; should users be able to pin a version from the UI?
- Should the changelog be hand-written, or generated from commits or SP plan docs under `docs/superpowers/plans`?
- Licence: does Chitrapx's terms page give users a licence to share and let others remix a published template?

## Suggested build order

1. 16.5 leftovers (dialog Escape/focus trap, unused deps, e2e log): small, independent, immediate wins.
2. 16.1 update banner: small and gives a safe way to ship the rest.
3. 16.2 changelog page (seed it with SP1 to SP8 and link it from the banner).
4. 16.5 version pruning: needs a migration; do it before the feed multiplies stored docs.
5. 16.3 analytics with consent, together with the CSP work (start report-only, then enforce).
6. 16.4 community feed last: largest, depends on CSP, rate limiting, staff role and moderation decisions from the open questions. Ship in stages: schema and RLS, publish and import with a staff-only flag, then public feed, then reports and auto-hide.

## Carried over from SP9 review (deferred)

Note: SP9 already shipped version pruning (keep last 50 automatic + all named, protect versions used by queued/running exports), so 16.5 version pruning shrinks to the named-version cap below.

- **Restore when saving is stuck:** if autosave keeps failing with a 4xx (doc too large, invalid value), Versions → Restore says "Save your changes first" and there is no way out. Offer "Discard unsaved changes and restore". `apps/web/src/editor/ui/VersionsDialog.tsx:54`
- **One undo step for multi-image add:** "Add here as images" with N files applies N `addElement` commands. Add an `addElements` command. `apps/web/src/editor/useIntake.ts`
- **Group click and hidden members:** clicking a group selects its hidden members too (as Figma does), so Delete/⌘D affect them, unlike ⌘A. Decide and align. `apps/web/src/editor/selection.ts:21`
- **No-op notice for ⌘G:** grouping fewer than 2 elements (or across lists) silently does nothing; the SP9 spec §7 asks for a notice.
- **Named-version cap:** named versions are never pruned and unthrottled; past 100 rows the oldest drop out of the list (`LIST_LIMIT`, `apps/web/src/server/versions.ts:11`). Cap per project or list named separately.
- **Small SP9 leftovers:** commit layer rename on blur (currently discards); VersionsDialog focus trap and ordering guard on preview fetches; `readJsonLimited` error says "project too large" on the versions routes; status-bar golden covers only iOS/dark/solid (battery cropped by template bleed); add a real-browser test of a keyboard drag in the layers panel.
