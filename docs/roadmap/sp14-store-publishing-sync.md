# SP14: Store publishing & sync

**Status:** Not started
**Goal:** Users connect their App Store Connect and Google Play accounts once, then push a finished export straight into the store listings (screenshots per locale and display type, App Previews) without downloading a ZIP. They can also sync a project and its exports to their own Google Drive or GitHub repo.
**Depends on:** SP8 (store slots, `storeReadiness`, pinned exports: the upload takes the same export plan and files the export ZIP already produces, and refuses what readiness rejects); SP13 (API keys: any public/CLI trigger for publish uses the same key scopes and per-workspace limits). Spec A13 moved store upload into this sub-project.
**Gap source:** open-screenshot-generator (App Store Connect and Google Play upload from the desktop app, Drive and GitHub account sync). PixelDeck, app-store-screenshots and launch have no store upload; storeshots (AGPL-3.0) is ideas only.

## Features

### 14.1 App Store Connect upload

- **What it does:** The user connects an App Store Connect API key, picks an app, an editable version and, per locale, which exported slots go into which App Store display type. Chitrapx replaces the screenshot sets and can upload App Preview videos.
- **Details:**
  - Credentials: Issuer ID, Key ID, `.p8` private key (Apple shows the key once). Team key with App Manager or Developer role. Key ID can be prefilled from the `AuthKey_<KEYID>.p8` filename.
  - Auth: ES256 JWT, header `{alg: ES256, kid: <keyId>, typ: JWT}`, claims `iss: <issuerId>`, `aud: appstoreconnect-v1`, `exp` at most 20 minutes out. Sign in the worker with Node `crypto` (`dsaEncoding: "ieee-p1363"` gives the raw r||s that JWS wants, no DER unpacking).
  - Slot mapping: each export item's pixel size resolves to a `ScreenshotDisplayType` (for example `APP_IPHONE_67`, `APP_IPHONE_65`, `APP_IPAD_PRO_3GEN_129`, `APP_IPAD_PRO_3GEN_11`, `APP_DESKTOP`, `APP_WATCH_ULTRA`, `APP_APPLE_TV`, `APP_APPLE_VISION_PRO`). Resolve from the real pixel size and refuse when no type matches; do not guess. Portrait and landscape share a display type.
  - Screenshots belong to an `appStoreVersionLocalization` (one per version and locale). Map Chitrapx locale codes to App Store locale codes and show unmapped or missing localizations before upload.
  - Limit 10 screenshots per display type per locale. Replace mode deletes the existing screenshots in each target set, then uploads; append mode stops if the total would exceed 10.
  - Version must be editable (for example `PREPARE_FOR_SUBMISSION`, `DEVELOPER_REJECTED`, `REJECTED`, `METADATA_REJECTED`). In review or live: block with a message telling the user to create a new version. Confirm the exact state list against Apple's docs when building.
  - App Previews: videos use `appPreviewSets` with a `PreviewType` that drops the `APP_` prefix (`IPHONE_67`, not `APP_IPHONE_67`). Apple Watch has no preview type. Preview sizes are a separate, smaller table than screenshot sizes (a 6.9-inch preview is 886x1920). The platform of the chosen version disambiguates sizes such as 1920x1080.
  - Upload is a three-step reservation: create the asset (file name, size) and receive `uploadOperations`; PUT each byte range to the returned URL with the returned headers; PATCH the asset with `uploaded: true` and `sourceFileChecksum` (MD5 hex of the whole file). Then poll `assetDeliveryState` until complete or failed (previews also have `videoDeliveryState`).
  - Order is set by PATCHing the set's `relationships/appScreenshots` with the full ordered id list.
- **Acceptance criteria:**
  - With a valid key, the user sees their apps, editable versions and localizations, and can start an upload for a pinned export.
  - Every uploaded screenshot lands in the correct display type set for its locale, in the board order of the export.
  - A file whose pixel size matches no display type is listed as skipped with the reason; the rest still upload.
  - Replace mode leaves exactly the new screenshots; append mode never exceeds 10 per set.
  - An in-review or live version is refused before any file is sent.
  - A processing failure from Apple is shown per file with Apple's reason.
  - A wrong Issuer ID, Key ID or role returns a clear message (401/403 mapped), not a raw status.
- **Chitrapx today:** Nothing uploads to a store. `storeReadiness` in `packages/document/src/readiness.ts` already enforces App Store max 10 and Play size rules, and `storeOf(platform)` maps a size to `"app-store" | "play"`. `apps/worker/src/storeFiles.ts` flattens alpha and flags files over 8 MB, so ZIP contents are already store-clean. Job types live in `PRICES` in `packages/db/src/pricing.ts` (`export`, `video`, `project_bundle`, ...) and are registered through the `handlers` map in `apps/worker/src/handlers.ts`; `apps/worker/src/index.ts` creates a pg-boss queue per handler. There is no credential table and no store connection model. The `jobs` table (`packages/db/src/schema.ts`) has `type`, `input`, `output`, `error`, `attempts`.
- **Chitrapx changes:**
  - Worker: `apps/worker/src/store/appStoreConnect.ts` (client, JWT, reservation/upload/commit, polling), `apps/worker/src/store/appleTargets.ts` (display-type and preview-type tables), job type `store_publish_apple` added to `PRICES` and `handlers`.
  - Web routes: `apps/web/src/app/api/store/apple/apps/route.ts`, `.../versions/route.ts`, `.../localizations/route.ts`, `apps/web/src/app/api/store/apple/publish/route.ts` (creates the job; follow the pattern in `apps/web/src/app/api/jobs/route.ts`).
  - UI: publish dialog on the project export screen (under `apps/web/src/app/dashboard/projects/`): app, version, locale mapping table, replace/append toggle, dry-run preview of slot to display type, progress per file.
  - Data: `store_publish_runs` table (see Data model).
- **Reference code:**
  - `open-screenshot-generator/src/lib/publish/appStoreConnect.ts` (MIT) — endpoints and the whole flow: `/v1/apps`, `/v1/apps/{id}/appStoreVersions`, `/v1/appStoreVersions/{id}/appStoreVersionLocalizations`, `/v1/appStoreVersionLocalizations/{id}/appScreenshotSets`, `POST /v1/appScreenshotSets`, `POST /v1/appScreenshots`, `PATCH`/`DELETE /v1/appScreenshots/{id}`, set reordering via `relationships/appScreenshots`, and the preview equivalents. Read the shared reservation/chunk/checksum function (around line 400) and the replace-versus-append logic (around lines 740 to 870).
  - `open-screenshot-generator/src/lib/publish/storeTargets.ts` (MIT) — `APPLE_DISPLAY_TARGETS` (ordered table; first match wins), `appleTargetForSize`, and the App Preview table with `ApplePreviewTarget.platform`. Lift the tables as data, then re-verify against Apple's current specifications.
  - `open-screenshot-generator/src/lib/publish/jwt.ts` (MIT) — `createAppStoreConnectJwt`, ES256 with raw signature.
  - `open-screenshot-generator/src/lib/publish/md5.ts` (MIT) — MD5 helper; in Node use `crypto.createHash("md5")` instead.
  - `open-screenshot-generator/src/lib/publish/types.ts` (MIT) and `open-screenshot-generator/docs/STORE-UPLOAD.md` (MIT) — credential shape, key creation steps and the 401/403 troubleshooting table, worth adapting into our help text.
- **License note:** MIT: code may be adapted with attribution in `NOTICES.md`. Apple's size tables are Apple's published facts; re-check them rather than trusting the copy. storeshots (AGPL-3.0): ideas only, copy nothing.
- **Size:** L

### 14.2 Google Play upload

- **What it does:** The user connects a Google Play service account and a package name, maps export slots to Play image types per listing locale, and Chitrapx stages and commits the images through one Android Publisher edit.
- **Details:**
  - Credentials: service account JSON (`client_email`, `private_key`, `private_key_id`, `token_uri`) plus package name. The account must be invited in Play Console under Users and permissions with access to the app and store presence; no Cloud project linking is needed.
  - Auth: RS256 JWT bearer grant (RFC 7523): claims `iss: client_email`, `scope: https://www.googleapis.com/auth/androidpublisher`, `aud: token_uri`, 1 hour max; POST to `https://oauth2.googleapis.com/token` with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` to get an access token. Cache until expiry.
  - Flow: `POST /androidpublisher/v3/applications/{pkg}/edits` to open; for each listing language and image type, `DELETE .../edits/{id}/listings/{language}/{imageType}` (replace) then `POST https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/{pkg}/edits/{id}/listings/{language}/{imageType}?uploadType=media` per image (raw bytes, `Content-Type: image/png`); then `POST .../edits/{id}:validate`, then `POST .../edits/{id}:commit`.
  - Image types: `phoneScreenshots` (2 to 8), `sevenInchScreenshots`, `tenInchScreenshots`, `wearScreenshots`, `tvScreenshots` (up to 8 each), `featureGraphic` (1024x500 exactly), `icon` (512x512), `tvBanner` (1280x720).
  - Screenshot rules: each side 320 to 3840 px, long side at most 2x short side, max 8 MB (matches `playSidesOk` in `packages/document/src/readiness.ts`). An iPhone 1290x2796 image is too tall for Play, so Android slots must come from Android targets.
  - All locales go in a single edit and a single commit (n locales x m types would otherwise be n x m commits, each a review round).
  - Commit may fail because the account does not allow automatic review submission; retry with `?changesNotSentForReview=true` and tell the user to finish in Play Console.
  - An app must have had at least one release before the listing API works (404 otherwise).
- **Acceptance criteria:**
  - A valid service account and package name passes the connection test (opens and deletes an edit) and lists the app's listing languages.
  - After publish, the Play listing for each selected language has exactly the uploaded images per image type.
  - Images that violate size rules are skipped with a reason; the commit still happens for the rest.
  - 403, 404 and the review-submission commit error each produce a distinct, actionable message.
  - A failure before commit leaves the live listing untouched (the edit is never committed).
- **Chitrapx today:** Nothing uploads. Readiness already knows Play phone count and side rules (`packages/document/src/readiness.ts`), and exports flatten alpha and cap bytes at 8 MB (`apps/worker/src/storeFiles.ts`).
- **Chitrapx changes:**
  - Worker: `apps/worker/src/store/googlePlay.ts` (token exchange, edit lifecycle, upload), `apps/worker/src/store/playTargets.ts` (image-type table), job type `store_publish_play`.
  - Web routes: `apps/web/src/app/api/store/play/listings/route.ts`, `apps/web/src/app/api/store/play/publish/route.ts`.
  - UI: Play tab in the same publish dialog as 14.1, with language mapping and image-type selector per slot.
- **Reference code:**
  - `open-screenshot-generator/src/lib/publish/googlePlay.ts` (MIT) — the edit lifecycle, `API_BASE`/`UPLOAD_BASE` (lines 36-37), the per-slot upload path (around line 365), validate then commit (around lines 403 to 422), the `changesNotSentForReview` retry, and the single-edit-for-all-languages batching comment (around line 310).
  - `open-screenshot-generator/src/lib/publish/jwt.ts` (MIT) — `createServiceAccountAssertion` (RS256 assertion for the Google token endpoint).
  - `open-screenshot-generator/src/lib/publish/storeTargets.ts` (MIT) — `PLAY_IMAGE_TARGETS`, `validatePlayImage`, size-to-image-type suggestion (around lines 479 to 545).
  - `open-screenshot-generator/docs/STORE-UPLOAD.md` (MIT) — service account setup steps and the 403/404 troubleshooting table.
- **License note:** MIT: adapt with attribution in `NOTICES.md`. storeshots (AGPL-3.0): ideas only.
- **Size:** M

### 14.3 Secure credential storage, connection test, revocation

- **What it does:** Store credentials (App Store `.p8` and IDs, Play service account JSON, Drive and GitHub OAuth tokens) encrypted per workspace, test them on demand, and let an owner delete them.
- **Details:**
  - The reference app saves credentials unencrypted in browser `localStorage` under `open-screenshot-generator.store-credentials` (`src/lib/publish/credentials.ts`). That is acceptable for a local desktop tool and not for a SaaS, so Chitrapx stores them server-side only.
  - Envelope encryption: AES-256-GCM per secret with a random 12-byte nonce; per-workspace data key derived (HKDF) from a server master key held outside the database (`CREDENTIAL_MASTER_KEY`); key version stored on each row to allow rotation. Workspace id is bound as AAD so a row copied to another workspace will not decrypt.
  - Secrets are write-only: the API returns only metadata (provider, label, Key ID or `client_email`, last tested at, status). The browser never receives the `.p8` or private key back.
  - Only the worker decrypts, at job start, and keeps plaintext in memory for the job only. Never log credentials, JWTs or access tokens; redact `Authorization` in error output.
  - Roles: only workspace owner/admin can create, test or delete a connection (use the `memberships` role); members with publish rights can use it without seeing it.
  - Connection test: Apple `GET /v1/apps?limit=1`; Play open and delete an empty edit for the package; Drive `GET /drive/v3/about?fields=user`; GitHub `GET /user` plus repo access check. Store result and timestamp.
  - Revocation: delete the row and cancel queued publish jobs that use it. For OAuth providers also call the provider revoke endpoint (Google `https://oauth2.googleapis.com/revoke`). Tell the user that Apple and Play keys must also be revoked at the store, since Chitrapx cannot do that.
  - Audit log row for create, test, use and delete.
- **Acceptance criteria:**
  - After saving, no API response or database dump contains the plaintext secret; the column holds ciphertext, nonce and key version.
  - A ciphertext row copied to another workspace fails to decrypt.
  - Test returns pass/fail with the store's reason within 15 seconds and updates the stored status.
  - Deleting a connection makes publish jobs referencing it fail fast with `connection_revoked` and removes the secret.
  - A non-admin member cannot read, replace or delete a connection.
  - Rotating the master key version re-encrypts rows via a script without downtime.
- **Chitrapx today:** No credential storage exists. Workspaces and memberships exist in `packages/db/src/schema.ts` (`workspaces`, `memberships`); the worker uses a Supabase service-role client (`apps/worker/src/handlers.ts`). SP13 API keys are hashed and not reversible, so they are not a model for this feature.
- **Chitrapx changes:**
  - Data: `store_connections` table (see Data model) in `packages/db/src/schema.ts` plus a migration; RLS so the browser role cannot select secret columns.
  - Shared crypto: `packages/db/src/credentialCrypto.ts` (encrypt/decrypt, AAD, key version) with unit tests.
  - Web: `apps/web/src/app/api/store/connections/route.ts` (list, create), `.../connections/[id]/route.ts` (delete), `.../connections/[id]/test/route.ts`; settings UI `apps/web/src/app/dashboard/settings/connections/page.tsx` with file pick for `.p8` and JSON (read in the browser, sent once over TLS).
  - Worker: `apps/worker/src/store/connection.ts` to load and decrypt for a job.
- **Reference code:**
  - `open-screenshot-generator/src/lib/publish/credentials.ts` (MIT) — the credential shape and the change flow; also shows what not to copy (plaintext localStorage).
  - `open-screenshot-generator/src/lib/publish/types.ts` (MIT) — `StoreCredentials` fields per store.
  - `open-screenshot-generator/src/lib/account/providers/googleDrive.ts` (MIT) — revoke call (`oauth2.googleapis.com/revoke`, around line 506) and insufficient-scope error mapping (around line 311).
  - `open-screenshot-generator/docs/STORE-UPLOAD.md` (MIT) — "Where the keys are stored" section, which confirms the unencrypted local model.
- **License note:** MIT for credential shapes only; the encryption design is new work.
- **Size:** M

### 14.4 Sync to the user's Google Drive

- **What it does:** The user connects Google Drive and Chitrapx writes the project file and exports into a Chitrapx folder in their Drive, manually or automatically after an export.
- **Details:**
  - Scope `https://www.googleapis.com/auth/drive.file` only: the app sees only files it created. This avoids Google's sensitive/restricted scope verification; keep it that way.
  - Server-side OAuth authorization-code flow with `access_type=offline` and `prompt=consent` to get a refresh token (the reference web build uses a short-lived browser token; a worker sync needs a refresh token). While the OAuth consent screen is in Testing, refresh tokens expire after 7 days.
  - Layout: `Chitrapx/<project name>/project.chitrapx` (the `.chitrapx` bundle) and `exports/<export id>/<locale>/<file>.png`. Each project folder carries `appProperties` (`chitrapxProjectId`) so it is found again after a rename (the reference does the same with `absProjectId`).
  - Endpoints: `GET https://www.googleapis.com/drive/v3/files?q=...&fields=files(id,name,modifiedTime,appProperties)`, `POST https://www.googleapis.com/drive/v3/files` (folder), `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart|resumable`, `PATCH .../files/{id}`, `DELETE .../files/{id}`. Use resumable uploads for anything over 5 MB.
  - Conflict check: before writing, compare the remote `modifiedTime` with the last synced one; if changed elsewhere, stop and ask rather than overwrite.
  - Automatic sync is opt-in per project and debounced (the reference waits about 8 seconds after edits).
- **Acceptance criteria:**
  - After connecting, "Sync to Drive" creates the folder and uploads the bundle; the file imports back into Chitrapx.
  - Re-syncing updates the same files, with no duplicate folders after a project rename.
  - If the remote changed since last sync, the user is asked before anything is overwritten.
  - Revoking the connection stops syncs and a later sync reports "reconnect needed".
  - An export with "sync to Drive" ends with its PNGs in `exports/` and a link to the folder.
- **Chitrapx today:** Nothing for Drive. The `project_bundle` and `project_import` job types already produce and consume a `.chitrapx` file (`apps/worker/src/bundle.ts`, `PRICES` in `packages/db/src/pricing.ts`), and `export` produces ZIPs (`apps/worker/src/export.ts`, `apps/worker/src/zip.ts`).
- **Chitrapx changes:**
  - Web: `apps/web/src/app/api/sync/google/start/route.ts` and `.../callback/route.ts` (OAuth), `apps/web/src/app/api/projects/[projectId]/sync/route.ts` (trigger).
  - Worker: `apps/worker/src/sync/drive.ts` (folder lookup, upload, refresh-token handling), job type `sync_drive` (reuses `project_bundle` output and the latest export).
  - Data: `sync_targets` table (see Data model).
  - UI: Sync panel in project settings and an option on the export dialog.
- **Reference code:**
  - `open-screenshot-generator/src/lib/account/providers/googleDrive.ts` (MIT) — `DRIVE_API`/`DRIVE_UPLOAD` constants (lines 87-88), `drive.file` scope rationale (top of file), folder lookup by `appProperties` (around line 543), insufficient-scope mapping, token refresh and revoke.
  - `open-screenshot-generator/src/lib/account/projectBundle.ts` (MIT) — manifest as `project.json` plus one file per blob; compare with our `.chitrapx` format.
  - `open-screenshot-generator/src/lib/account/autoSync.ts` (MIT) — debounce and remote-changed checks.
  - `open-screenshot-generator/src/lib/account/store.ts` and `open-screenshot-generator/src/lib/account/types.ts` (MIT) — provider interface and connection state.
  - `open-screenshot-generator/docs/ACCOUNT-SYNC.md` (MIT) — behaviour description and the Testing-mode 7-day token note.
- **License note:** MIT: adapt with attribution in `NOTICES.md`. The reference runs in the browser; ours runs in the worker, so only the Drive request shapes and conflict logic transfer.
- **Size:** M

### 14.5 Sync to the user's GitHub repo

- **What it does:** The user connects GitHub and picks a repo and branch; Chitrapx commits the project file and the latest exports there.
- **Details:**
  - The reference uses secret gists (device flow, scope `gist`). Our spec calls for a repo, so use a GitHub App (preferred: installed on chosen repos, `contents: write`, short-lived installation tokens) or an OAuth App with `repo` scope. Prefer the GitHub App to avoid broad scope.
  - Layout: `chitrapx/<project slug>/project.chitrapx`, `chitrapx/<project slug>/exports/<locale>/<file>.png`, optional `README.md`.
  - Commit many files atomically with the Git Data API: `GET /repos/{o}/{r}/git/ref/heads/{branch}`, `POST /repos/{o}/{r}/git/blobs` (base64), `POST /repos/{o}/{r}/git/trees` (with `base_tree`), `POST /repos/{o}/{r}/git/commits`, `PATCH /repos/{o}/{r}/git/refs/heads/{branch}`. For one small file `PUT /repos/{o}/{r}/contents/{path}` is enough. The gist-specific limits in the reference (about 7.5 MB raw per file) do not apply to repos.
  - Large binaries: warn above 50 MB per file (GitHub warns at 50 MB, blocks at 100 MB); offer a "project file only" mode; Git LFS out of scope for v1.
  - Conflicts: if the branch ref moved between read and update, re-read and retry once; otherwise fail with a clear message. Never use `force: true`.
  - Rate limits: authenticated REST allows 5,000 requests/hour per user (installation tokens scale with repo count); secondary limits throttle bursts of writes. The reference writes at most once a minute; do the same and honor `Retry-After` and `x-ratelimit-reset`.
- **Acceptance criteria:**
  - Connecting lists only repos the user granted; the user picks repo and branch.
  - One sync produces exactly one commit containing the project file and exports.
  - Re-sync with no changes creates no new commit.
  - A moved branch ref triggers one automatic retry, then a visible error; no force push ever.
  - Disconnecting removes the stored token and stops syncs.
- **Chitrapx today:** Nothing. Same bundle and export job foundations as 14.4.
- **Chitrapx changes:**
  - Web: `apps/web/src/app/api/sync/github/install/route.ts` and `.../callback/route.ts`, `apps/web/src/app/api/sync/github/repos/route.ts`; the trigger route is shared with 14.4.
  - Worker: `apps/worker/src/sync/github.ts` (Git Data API commit), job type `sync_github`.
  - Data: `sync_targets` rows with `provider = "github"`, `config: {owner, repo, branch, path}`.
  - UI: repo and branch picker in the same Sync panel.
- **Reference code:**
  - `open-screenshot-generator/src/lib/account/providers/github.ts` (MIT) — device flow endpoints and scope (around lines 268 to 304), rate-limit error handling (around line 139), per-file blob layout for large images, HEAD sha used as the remote version for conflict detection (around line 634). The gist endpoints differ from repo endpoints; reuse the error and conflict handling, not the URLs.
  - `open-screenshot-generator/docs/ACCOUNT-SYNC.md` (MIT) — GitHub limits (300 files per gist, 10 MB read limit, write-rate policy), and why recordings are excluded.
  - `open-screenshot-generator/src/lib/account/autoSync.ts` (MIT) — GitHub debounce (about 15 seconds, at most once a minute).
- **License note:** MIT: adapt with attribution in `NOTICES.md`. The reference targets gists; the repo commit flow is new work.
- **Size:** M

## Data model and API changes

- `store_connections` (workspace-scoped): `id`, `workspace_id`, `provider` (`apple` | `play` | `google_drive` | `github`), `label`, `public_meta` jsonb (Issuer ID, Key ID, `client_email`, package name, repo), `secret_ciphertext` bytea, `nonce` bytea, `key_version` int, `status` (`untested` | `ok` | `failed` | `revoked`), `last_tested_at`, `last_error`, `created_by`, `created_at`. RLS: members read metadata; secret columns never exposed to the browser role.
- `store_publish_runs`: `id`, `workspace_id`, `project_id`, `job_id`, `connection_id`, `store`, `export_id` (the pinned export from SP8), `plan` jsonb (slot to display type or image type, per locale), `mode` (`replace` | `append`), `results` jsonb (per file: `uploaded` | `skipped` | `failed` with reason), `state` (`queued` | `running` | `partial` | `done` | `failed`), timestamps.
- `sync_targets`: `id`, `project_id`, `connection_id`, `provider`, `config` jsonb, `remote_ref` (Drive folder id or last commit sha), `last_synced_at`, `auto` boolean.
- `PRICES` in `packages/db/src/pricing.ts`: add `store_publish_apple`, `store_publish_play`, `sync_drive`, `sync_github` (proposal: 0 credits and rate limited, since the user supplies the store account; decide with billing). Add handlers in `apps/worker/src/handlers.ts`; `apps/worker/src/index.ts` registers a queue per handler, so no extra wiring.
- Web endpoints: `/api/store/connections` (GET, POST), `/api/store/connections/[id]` (DELETE), `/api/store/connections/[id]/test` (POST), `/api/store/apple/{apps,versions,localizations,publish}`, `/api/store/play/{listings,publish}`, `/api/sync/{google,github}/*`, `/api/projects/[projectId]/sync`.
- Env: `CREDENTIAL_MASTER_KEY`, `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`, `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY`/`GITHUB_APP_CLIENT_ID`/`GITHUB_APP_CLIENT_SECRET`.
- Store API surface:
  - Apple (base `https://api.appstoreconnect.apple.com`): `GET /v1/apps`; `GET /v1/apps/{id}/appStoreVersions`; `GET /v1/appStoreVersions/{id}/appStoreVersionLocalizations`; `GET|POST /v1/appStoreVersionLocalizations/{id}/appScreenshotSets` and `/appPreviewSets`; `GET /v1/appScreenshotSets/{id}/appScreenshots`; `POST /v1/appScreenshots`; `PATCH|DELETE /v1/appScreenshots/{id}`; `PATCH /v1/appScreenshotSets/{id}/relationships/appScreenshots`; same for `appPreviews` and `appPreviewSets`.
  - Google Play (base `https://androidpublisher.googleapis.com/androidpublisher/v3`, uploads under `/upload/androidpublisher/v3`): `POST /applications/{pkg}/edits`; `GET /applications/{pkg}/edits/{id}/listings`; `DELETE|POST /applications/{pkg}/edits/{id}/listings/{language}/{imageType}`; `POST /applications/{pkg}/edits/{id}:validate`; `POST /applications/{pkg}/edits/{id}:commit`; `DELETE /applications/{pkg}/edits/{id}`.
  - Google Drive v3 and GitHub REST as listed in 14.4 and 14.5.
- Security: encrypted secrets (14.3); the only fixed hostnames called are the store APIs, but Apple `uploadOperations` URLs are server-supplied, so only PUT to `https` URLs and refuse private IP ranges; never echo upstream error bodies that may contain tokens; one running publish per store connection to avoid racing sets or edits; `state` and PKCE on all OAuth callbacks.
- Rate limits and partial failure:
  - Apple: no fixed numeric quota is documented in the reference; the API returns 429, so retry 429 and 5xx with capped exponential backoff and jitter, honoring `Retry-After`. Upload chunks in sequence per file and files with limited parallelism (3 to 4).
  - Apple partial failure: uploads are per file and not transactional. Record per-file results in `store_publish_runs.results`. The reference warns that a naive retry uploads screenshots twice (comment near line 841 of `appStoreConnect.ts`), so retries must resume from stored results, skipping files already recorded as uploaded (match by file name and checksum). In replace mode, delete old assets only once the new ones are reserved.
  - Play: all-or-nothing by design; nothing is live until `:commit`, so a failure before commit needs only edit deletion (abandoned edits expire on their own). Retry transient 5xx and 429 per image; a commit failure leaves staged data discarded.
  - Drive: back off on 403 `userRateLimitExceeded` and 429; resumable uploads continue from the session URI.
  - GitHub: one atomic commit via the Git Data API; back off on 403/429 using `Retry-After` or `x-ratelimit-reset`.
  - Job retry: use the existing `attempts` counter on `jobs`; treat bad credentials, forbidden and validation errors as fatal (`FatalJobError` in `apps/worker/src/runJob.ts`), transient network and 5xx as retryable.

## Open questions

- Apple's current rate-limit headers and 429 behaviour need confirming before setting worker concurrency.
- Which Apple display types do SP8 slots already carry? If SP8 targets are fewer than Apple's table, does SP14 own the missing mappings or does SP8 extend first?
- Should publishing cost credits, or be free because the user supplies their own store account? This affects `PRICES` and refunds on partial failure.
- Locale mapping: Chitrapx locale codes versus App Store locale codes and Play language codes; where does the mapping table live and can users override it?
- GitHub: GitHub App versus OAuth App, and whether to support Git LFS for large exports.
- Google OAuth verification for `drive.file` is lighter than restricted scopes but still needs a consent-screen review; allow lead time before launch.
- App Previews: confirm that the `video` job output (`apps/worker/src/video.ts`) matches Apple's exact preview sizes and duration limits before offering upload.
- Where does the master key live in production (env, Supabase Vault, or a KMS), and who rotates it?
- Auto-sync after every export, or manual only in v1?
- Should an SP13 API key be able to trigger a store publish, and with which scope?

## Suggested build order

1. 14.3 credential storage and connection test (`store_connections`, `credentialCrypto`, settings UI). Everything else depends on it.
2. 14.2 Google Play upload. Smallest surface (one edit, all-or-nothing), so it proves the publish job, run table and progress UI.
3. 14.1 App Store Connect screenshots (display-type table, reservation upload, replace/append, resume on retry), then App Preview upload once the base path is stable.
4. 14.4 Google Drive sync (reuses `project_bundle` and `export` outputs).
5. 14.5 GitHub repo sync (shares `sync_targets` and the trigger route with 14.4).
6. Hardening: mock-based rate-limit and backoff tests, key rotation script, audit log, help text for creating store keys.
