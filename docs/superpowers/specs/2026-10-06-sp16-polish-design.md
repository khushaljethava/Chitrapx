# Sub-project 16: Polish

An open tab learns that a new build is live and offers a safe refresh. Users can read a public changelog and opt in to first-party, cookieless analytics. They can share a project to a community feed that others browse and import from. A batch of SP8/SP9 leftovers is closed. Feature breakdown and acceptance criteria: `docs/roadmap/sp16-polish.md`.

## Decisions

The roadmap's open questions, resolved, plus the calls made while building:

- **Build id**: `next.config.ts` sets `env.NEXT_PUBLIC_BUILD_ID` to `BUILD_ID` from the environment (the deploy platform can pass the git SHA), or else a base-36 build timestamp. Every build gets a new id, and the id says nothing about the branch, the commit message or the environment.
- **Update check**: `GET /api/version` returns `{ buildId }` with `Cache-Control: no-store`. The proxy skips it. The client checks 30 s after load, then every 5 min, and again whenever the tab becomes visible. It stops once it sees a different id. A failed fetch is ignored and logs nothing. A failed chunk load or a "Failed to find Server Action" error triggers an immediate check; it never shows the banner on its own.
- **Banner**: non-blocking, at the bottom of the page. Dismissing it is remembered per build id in `localStorage`. It never reloads by itself. In the editor, Refresh first awaits the editor's `flush()` through a small refresh-guard registry (`lib/refreshGuard.ts`). If the save fails it asks "Your latest changes are not saved. Refresh anyway?"; the IndexedDB draft survives a refresh either way.
- **Changelog**: hand-written `CHANGELOG.md` at the repo root (Keep a Changelog layout), seeded with SP1 to SP16 in Chitrapx's own words. `/changelog` is a static server component (`dynamic = "force-static"`) that reads the file at build time. It parses a small markdown subset (release headings, section headings, bullets, `code`, **bold**) into data and renders it with React. No HTML string is ever produced, so raw `<script>` or `onerror=` show as text. This needs no markdown or sanitiser dependency. No RSS for now.
- **Analytics is first-party and cookieless**: there is no Umami, Plausible or any third party. Events go to `POST /api/events` and are stored in our own `analytics_events` table. A row holds `name`, a normalised `path` (query and hash dropped, UUIDs replaced by `:id`), allow-listed `props` and `created_at`. There is no user id, session id, IP address, user agent or referrer, so nothing can identify a visitor and no tracking cookie exists.
- **Consent is still asked** (the roadmap requires it). It is stored in a first-party cookie, `chitrapx_consent=<version>.<granted|denied>`, valid for 180 days. `CONSENT_VERSION = 1`; bumping it asks everyone again. Do Not Track or Global Privacy Control counts as "denied" without a prompt. Accept and Reject are the same size, side by side.
- **Analytics switch**: `NEXT_PUBLIC_ANALYTICS=on`. When it is off, no banner and no "Cookie settings" link show, and `track()` does nothing. When it is on and the visitor has not consented, nothing is sent. Revoking takes effect immediately: `track()` reads a module-level flag that the consent component sets.
- **Events** (allow-list in `lib/analyticsEvents.ts`, shared by client and server):
  - `page_view` (no props);
  - `sign_up` (no props), sent once on the dashboard when the auth callback created a new workspace (`?welcome=1`);
  - `project_created` with `source: template | blank | community`;
  - `export_started` with `kind: zip`;
  - `community_published` and `community_imported` (no props).

  The server drops unknown names, props and values. It caps the body at 1 KB and the path at 200 characters.
- **CSP**: sent as `Content-Security-Policy-Report-Only` from `proxy.ts` on every page the proxy matches. It is built by a pure `cspHeader()` in `lib/csp.ts`. Allowed sources:
  - `'self'` everywhere;
  - Supabase (connect);
  - the S3 endpoint origin (img, media, connect);
  - Google Fonts (style, font);
  - Razorpay checkout (script, frame, connect).

  `script-src` keeps `'unsafe-inline'`, because nonces would force every page to render dynamically and would break the static changelog. It has no analytics host, because analytics is same-origin. It also sets `frame-ancestors 'none'`, `object-src 'none'` and `base-uri 'self'`. Enforcing it is a later step, once reports are clean.
- **Privacy page**: `/privacy` (static). It names Chitrapx itself as the only processor of analytics data, lists exactly what is stored, says Supabase session cookies are strictly necessary, and links to cookie settings.
- **Community moderation is post-moderation**: a post is visible as soon as it is published. Three reports from different users (`REPORT_HIDE_THRESHOLD`) set it to `hidden`, and it goes to the staff queue. Staff can restore it (which clears its reports) or remove it. Every staff action writes a `community_actions` row (the audit log).
- **Staff** are the users whose email is in `STAFF_EMAILS` (comma separated, matched case-insensitively). There is no role column and no Supabase role.
- **Author identity is not shown**: there is no public profile concept. Cards show only "Yours" on your own posts, never a name or an email.
- **Who can publish and import**: any signed-in user can. Importing costs no credits, but it creates a project, so the plan's project limit applies. Sign-in is by magic link or OAuth, so every account's email is verified; there is no separate check.
- **Limits**:
  - 5 publishes per user per rolling 24 h (429 `publish_limit`);
  - 20 reports per user per 24 h (429);
  - 20 assets and 40 MB of assets per post;
  - the document must fit `MAX_DOC_BYTES`;
  - title 3–80 characters, description up to 500, plain text (`<` and `>` refused).
- **Snapshot, not a link**: publishing copies the project document at that moment, migrated and validated with `migrate`, and makes these changes:
  - `brand` (the app id) is dropped;
  - every source field (`*Src`, `backgroundImage`, including per-language overrides) must be empty, `data:image/…`, or `asset:<id>` of a screenshot or image asset in the author's workspace. Anything else (an http URL, a recording, a font, a reference image, another workspace's asset) is refused with a message naming what to remove.
  - the referenced image bytes are copied to `community/<postId>/<sha256>` in the uploads bucket, so a later delete by the author never breaks the post.
  - uploaded fonts are not carried, because their licences are unknown; the text falls back to the default face. Fonts from the catalogue work everywhere.
- **Import**:
  - copies each post asset into the importer's workspace at the normal `<workspaceId>/<sha256>` path (skipped if it already exists);
  - adds `assets` rows for the chosen app;
  - rewrites `asset:<authorAssetId>` to `asset:<importerAssetId>`;
  - creates a project named after the post.

  The copy is the importer's own and never references the author's workspace. `import_count` goes up once per user per post (`community_imports` primary key).
- **Removal**: an author deletes their post outright (the row and its copied files). Imported copies are unaffected. Staff "remove" keeps the row as `removed` for the audit log. Removed posts are invisible to everyone, and hidden posts are invisible to everyone except their author and staff. A single SQL helper, `visibleTo(userId, staff)`, is used by every query, and an invisible post is a 404, direct links included.
- **Previews** are rendered in the browser with the existing `BoardThumb` and signed URLs for the post's copied assets. There is no render job and no stored preview image.
- **"Share to community"** lives on the project page in the dashboard, next to Store preview, not inside the editor: the share dialog needs the saved document anyway.
- **One migration, `0013_*`** (0012 is reserved for another branch). It holds `community_posts`, `community_reports`, `community_imports`, `community_actions` and `analytics_events`, with RLS:
  - `community_posts`: an authenticated user reads posts that are `published` or their own;
  - reports and imports: a user reads only their own rows;
  - `community_actions` and `analytics_events`: no policies, so the server role only.

  No user can write any of these tables. **It is not applied here.** Tests that need these tables run against a throwaway local Supabase Postgres; the coordinator applies the migration after merging.
- **No document `schemaVersion` bump.** The editor gains one command, `addElements`. Documents saved before SP16 pass `migrate` unchanged.

## 16.5 and SP9 leftovers

- **Dialogs**: a shared `useDialog(ref, { onClose, canClose })` hook (`components/useDialog.ts`) does the following:
  - moves focus into the dialog on open;
  - cycles Tab and Shift+Tab inside it (pure `nextFocusIndex` helper, unit-tested);
  - closes on Escape and on a backdrop click (`onBackdrop`), except while `canClose` is false (an export request is in flight);
  - returns focus to the element that had it before opening.

  `ExportDialog` and `VersionsDialog` use it.
- **Unused deps**: `file-type` and `image-size` are removed from `apps/web/package.json`; grep found no import. `packages/db` keeps them.
- **Named-version cap**: at most `NAMED_VERSIONS_MAX = 50` named versions per project. A 51st is refused with 409 `named_limit` ("You can keep 50 named versions. Restore or ignore older ones; automatic versions are kept for you."). The list is all named versions plus the newest 100 others, so a named version never drops off the list.
- **e2e log**: the round-trip pixel diff goes into the assertion message instead of `console.log`.
- **Restore when saving is stuck**: when autosave is in the rejected `error` state (a 4xx), Restore in Versions shows "Discard unsaved changes and restore". That loads the server document first (`adoptServerDoc`), then restores.
- **One undo step for multi-image add**: a new `addElements` command; `useIntake.addImages` applies it once.
- **Group click and hidden members**: a canvas click on a group member selects only the visible, unlocked members (the clicked one always), matching ⌘A and keyboard nudges.
- **Layer rename** commits on blur. Escape still cancels.
- **VersionsDialog preview ordering**: a slower earlier preview fetch can no longer replace a later one (a request counter).
- **Versions routes' body error** says "Request too large", not "This project is too large to save".
- **Deferred**:
  - the ⌘G no-op notice (in `editor/shortcuts.ts`, which another branch is editing);
  - the status-bar golden for other platforms;
  - the real-browser keyboard-drag test.

## Out of scope

Umami or Plausible, RSS, an enforced CSP with nonces, comments on posts, author profiles, per-user publish bans (staff can remove posts; bans wait for a profile concept), stored preview images, and anything for SP13 or SP14.
