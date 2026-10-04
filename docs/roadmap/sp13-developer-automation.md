# SP13: Developer automation

**Status:** Not started
**Goal:** Developers and coding agents can drive Chitrapx without the browser: a workspace-scoped public API, a CLI that renders, verifies, fills and syncs projects, captures and records from simulators/emulators, an MCP server for coding agents, and a CI recipe that regenerates store screenshots on every build.
**Depends on:** SP8 (`packages/document` planner `exportPlan`/`storeReadiness` and the `.chitrapx` bundle format are pure and reusable by a CLI); SP4 (AI design pipeline, job + credit flow); SP6b (screen recording upload and processing); SP7 (credits, Razorpay plans); A13 in the master spec (`docs/superpowers/specs/2026-10-02-chitrapx-design.md`, line 223) moved public API/CLI/MCP into this sub-project.
**Gap source:** open-screenshot-generator (CLI with doctor/init/fill/render/verify/install, MCP server, skills, plugin marketplace), PixelDeck (headless export, YAML batch), launch (Simulator/ADB/window capture, watch, record, frame-video), app-store-screenshots (agent skill). storeshots and appshots are not used as code sources.

## Features

### 13.1 Public API + API keys

- **What it does:** A workspace owner creates API keys in settings and calls the same project/export/AI/upload endpoints with `Authorization: Bearer <key>` instead of a browser session.
- **Details:**
  - Key format `cpx_live_<random>`; shown once at creation; only a SHA-256 hash and an 8-char prefix are stored.
  - Each key belongs to one workspace, has a name, scopes, optional expiry, `last_used_at`, and `revoked_at`.
  - Scopes: `projects:read`, `projects:write`, `export`, `ai`, `uploads`, `credits:read`. Each route declares the scope it needs.
  - Rate limit per key (default 60 req/min, lower for `ai` and `export` enqueue) returning 429 with `Retry-After`; limits keyed by key id, not IP.
  - API calls consume credits exactly like UI calls (`reserveAndEnqueue` in `packages/db/src/credits.ts`); a 402 `insufficient_credits` is returned unchanged.
  - Keys never grant billing routes (`/api/billing/*`) or key management itself.
  - Versioned prefix `/api/v1/...` is an alias of the existing handlers, not a copy; documented via an OpenAPI file generated from the zod inputs.
- **Acceptance criteria:**
  - A key created for workspace A cannot read, write or export any project, app, asset or job of workspace B (404, not 403).
  - A revoked or expired key returns 401 on the next request (no caching longer than 60 s, documented).
  - A key with only `projects:read` gets 403 `insufficient_scope` on `POST /api/projects/:id/export`.
  - The raw key is not recoverable from the database or logs; a test greps logs/DB rows for the key string.
  - Exceeding the limit returns 429 with `Retry-After`; a second key is unaffected.
  - Credits are reserved and refunded identically for API and UI-initiated jobs (ledger rows identical in shape).
- **Chitrapx today:** Auth is Supabase cookie only. `apps/web/src/server/context.ts:14` `requireContext()` calls `currentUser()` (Supabase server client) and resolves one workspace via `memberships`; returns `Ctx = { userId, workspaceId, plan }`. `apps/web/src/server/http.ts` has the `route()` wrapper, `HttpError`, `readJsonLimited`. `apps/web/src/proxy.ts` refreshes the session cookie and only redirects for `/dashboard` and `/editor`, so API routes are not blocked by it. All routes under `apps/web/src/app/api` (projects, apps, jobs, uploads, credits, billing) call `requireContext()`. No API key table, no rate limiting, no `/api/v1`.
- **Chitrapx changes:**
  - `packages/db/src/schema.ts`: new `api_keys` table (id, workspace_id, created_by, name, prefix, key_hash unique, scopes text[], expires_at, last_used_at, revoked_at, created_at); new migration `0009_api_keys.sql` with RLS (members of the workspace can list; writes via server only, matching `0002_lock_down_writes.sql`).
  - `apps/web/src/server/apiKeys.ts` (create/hash/verify/revoke) and `apps/web/src/server/rateLimit.ts` (Postgres-backed token bucket, or Redis if introduced).
  - `apps/web/src/server/context.ts`: `requireContext(scope?)` first checks the `Authorization` header; when it is a `cpx_` key, resolves `Ctx` from the key's workspace with `userId` = key creator and `via: "api_key"`; otherwise falls back to the Supabase session. Handlers that need a scope pass it.
  - Settings UI page for key create/list/revoke under `apps/web/src/app/dashboard/`.
  - `apps/web/src/app/api/v1/...` thin re-exports; `docs/api/openapi.json` generation script.
  - CSRF: cookie-authenticated mutating routes stay as is; when a bearer header is present, cookies are ignored entirely.
- **Reference code:**
  - `open-screenshot-generator/cli/src/commands/upload.ts` (MIT) — how a CLI pushes assets to a hosted service; client side only.
  - `open-screenshot-generator/cli/src/config.ts` (MIT) — where a CLI stores config; reuse the location convention.
- **License note:** MIT code may be adapted with attribution in `NOTICES.md`; the key hashing and scope model is original to Chitrapx.
- **Size:** L

### 13.2 CLI: render/export, verify, fill, project push/pull

- **What it does:** `chitrapx` CLI (npm package) with `login`, `doctor`, `init`, `render`, `verify`, `fill`, `push`, `pull`, `export`. `render`/`verify` can run fully offline against a `.chitrapx` file; `fill`, `push`, `pull` talk to the API.
- **Details:**
  - `login --key` stores the key in `~/.config/chitrapx/config.json` (0600) or reads `CHITRAPX_API_KEY`; the key is never printed back.
  - `doctor` checks Node version, Chromium availability, API reachability, key validity and scopes, ffmpeg presence, and prints credit balance.
  - `init` writes `chitrapx.config.yaml` and a project skeleton, selecting app and project ids from the API.
  - `render <file.chitrapx> --targets ios-6.9,play-phone --out dir` builds the plan with `exportPlan` and renders locally via `packages/renderer` in headless Chromium (no credits). `export <projectId>` instead enqueues the server `export` job and downloads the zip (credits apply as in the UI).
  - `verify` runs `storeReadiness` over the plan and prints findings per store, exit code 1 on any `fail`, `--strict` also fails on warnings; also checks rendered PNG dimensions/alpha and MP4 specs.
  - `fill <projectId> --screens dir --locale es` uploads screenshots, runs `fillScreenshots` (deterministic) or the AI design job (`--ai`, credits), then prints the job result.
  - `push`/`pull` sync a project doc using `revision` for optimistic concurrency; a stale push fails with the 409 `conflict` and the `current` revision unless `--force`.
  - `--json` output; stable exit codes (0 ok, 1 verify failed, 2 usage, 3 auth, 4 insufficient credits, 5 conflict).
- **Acceptance criteria:**
  - `chitrapx verify project.chitrapx` produces the same issue list as the editor's readiness panel for the same document (shared function, snapshot test).
  - `chitrapx render` output for a fixture project has the same files and dimensions as the zip from the server `export` job.
  - `chitrapx push` after a concurrent web edit exits 5 and shows the server revision; `pull` then `push` succeeds.
  - Running with a revoked key exits 3 with a message naming the key prefix, not the key.
  - `--json` output validates against a published schema.
- **Chitrapx today:** `packages/document/src` is pure: `exportPlan.ts` (`exportPlan`, `checkExportable`, `presetSelection`), `readiness.ts` (`storeReadiness`), `fill.ts` (`fillScreenshots`), `bundle.ts` (`toBundleDoc`/`fromBundleDoc`). Server endpoints exist: `apps/web/src/app/api/projects/[projectId]/doc/route.ts`, `.../export/route.ts`, `.../bundle/route.ts`, `apps/web/src/app/api/apps/[appId]/ai-design/route.ts`, `apps/web/src/app/api/uploads/sign/route.ts` and `complete/route.ts`. Rendering lives in `packages/renderer`; the worker (`apps/worker/src/export.ts`) drives it. No `packages/cli`.
- **Chitrapx changes:**
  - New `packages/cli` (bin `chitrapx`, TypeScript, depends on `@chitrapx/document`, `@chitrapx/renderer`); `src/commands/{login,doctor,init,render,export,verify,fill,push,pull}.ts`, `src/api.ts` (fetch client using the same error codes as `apps/web/src/server/api.ts`), `src/config.ts`.
  - Confirm `packages/renderer` runs outside the worker (no Supabase/storage imports); extract a `renderPlan(doc, plan, assetResolver)` entry if the worker currently owns it.
  - `apps/web`: `GET /api/v1/projects` listing and `GET /api/v1/me` (workspace, scopes, balance) for `doctor`.
  - npm publish workflow for `@chitrapx/cli`, version tied to the bundle format version.
- **Reference code:**
  - `open-screenshot-generator/cli/src/cli.ts` and `args.ts` (MIT) — command dispatch and argument parsing without a heavy framework.
  - `open-screenshot-generator/cli/src/commands/doctor.ts`, `init.ts`, `render.ts`, `fill.ts`, `verify.ts` (MIT) — command surface and output conventions to match or improve.
  - `open-screenshot-generator/cli/src/verify/rules.ts`, `png.ts`, `mp4.ts` (MIT) — store rule table with a `VERIFIED_ON` date, and file-level PNG/MP4 checks; compare against `packages/document/src/readiness.ts` and `targets.ts` rather than copying the table.
  - `open-screenshot-generator/cli/src/browser/find.ts`, `launch.ts` (MIT) — locating a local Chrome/Chromium for headless render.
  - `PixelDeck/cli/index.mjs`, `export.mjs`, `locale.mjs` (MIT) — headless Playwright export loop and locale handling.
- **License note:** MIT sources may be adapted with attribution in `NOTICES.md`. Do not copy storeshots code (AGPL-3.0).
- **Size:** L

### 13.3 CLI capture: iOS Simulator, Android ADB, macOS window; watch mode

- **What it does:** `chitrapx capture ios|android|window` grabs a screenshot from a booted Simulator, an ADB device or an app window and writes it (optionally uploads it to the app's assets); `capture --watch` re-captures when the screen changes and uploads new, distinct frames.
- **Details:**
  - iOS: `xcrun simctl io booted screenshot --type=png`; clear error if Xcode tools are missing. Android: locate `adb` (env `ANDROID_HOME`, PATH), pick the device by `--serial`, `adb exec-out screencap -p`.
  - macOS window: list windows by app name (`--list`), capture by window id; raw capture only, no device frame (Chitrapx frames devices itself).
  - Watch mode: poll at an interval, hash the PNG, upload only when the hash changes; debounce; stop on Ctrl+C with a summary.
  - Uploads go through the existing signed-upload flow (kind `screenshot`); sha256 dedupe (`assets_ws_app_sha_uq`) prevents duplicates.
  - Linux/Windows hosts: only ADB is available; the iOS and window commands exit with a clear "macOS only" message.
  - `--out dir` writes files without any network call.
- **Acceptance criteria:**
  - On macOS with a booted Simulator, `chitrapx capture ios --out ./shots` writes a PNG at the Simulator's native pixel size.
  - With no ADB device attached, the command exits non-zero with a message mentioning `--serial`.
  - Watch mode on a static screen uploads one asset; after a UI change it uploads exactly one more.
  - Re-uploading an identical frame returns the existing asset (no duplicate row).
- **Chitrapx today:** Nothing for capture. Uploads exist: `apps/web/src/server/uploads.ts` (kind `screenshot|image|recording`, sniffing, size limits, sha256 dedupe) behind `apps/web/src/app/api/uploads/sign/route.ts` and `complete/route.ts`.
- **Chitrapx changes:** `packages/cli/src/commands/capture.ts`, `src/capture/{simulator,adb,window}.ts`, `src/watch.ts`; no server change beyond API-key access to the upload routes with the `uploads` scope.
- **Reference code:**
  - `launch/src/main.rs` (MIT) — around line 893 (`xcrun simctl io booted screenshot`), line 1083 (window enumeration via CoreGraphics), lines 75 and 299 (window capture subcommand and its list flag); behaviour to port, not the Rust code.
  - `launch/src/screenshot.rs` (MIT) — `run` (107) and `run_android` (178); ADB capture path.
  - `launch/src/watch.rs` (MIT) — `file_hash` (13), `find_adb` (21), `detect_adb_device` (43), `watch_loop` (127), `run`/`run_android` (243/261): the change-detection loop to reimplement in TypeScript.
  - `launch/src/device.rs` (MIT) — device/size detection reference.
- **License note:** launch is MIT; porting its logic to TypeScript is adaptation, so credit it in `NOTICES.md`. Alternative: shell out to a user-installed `launch` binary (open question).
- **Size:** M

### 13.4 CLI record: Simulator recording with markers, auto-trim, frame-video, upload as screen recording

- **What it does:** `chitrapx record ios|android` records the device, lets the user press `m` to drop markers and `q` to stop, optionally removes still sections, and uploads the result as a screen recording asset that the existing `process_recording` pipeline handles.
- **Details:**
  - Record via `xcrun simctl io booted recordVideo` or `adb shell screenrecord`; ffmpeg is required for trimming (checked by `doctor`).
  - Markers saved to `markers.json` (seconds); `--split-markers` cuts clips per marker.
  - `--auto-trim` uses ffmpeg freeze detection and keeps `--keep-still` seconds (default 0.5) of each still interval; a `cuts.json` records what was removed.
  - `--frame` composes the video into a device frame (local equivalent of launch's `frame-video`); optional because Chitrapx frames at render time.
  - Upload kind `recording`; the server sets `meta.ready=false`, then `process_recording` produces WebM, poster and duration (`apps/worker/src/recording.ts`). The CLI polls the job until ready and prints the asset id.
  - Size limits follow `UPLOAD_LIMITS.recording` in `uploads.ts`; the CLI checks before upload and suggests `--auto-trim`.
- **Acceptance criteria:**
  - A recording with a 10 s idle middle and `--auto-trim --keep-still 0.5` yields a clip about 9 s shorter and a `cuts.json` listing the removed range.
  - Pressing `m` three times writes three timestamps within 0.1 s of the key presses.
  - The uploaded recording appears in the app's assets with a poster once processing completes; a processing failure surfaces `meta.error` in the CLI exit message.
  - A file over the recording size limit is rejected client-side with the limit in MB.
- **Chitrapx today:** Recording upload and processing exist (SP6b): `apps/web/src/server/uploads.ts` handles kind `recording` and sets `meta: { ready: false }`; `apps/web/src/server/jobs.ts:110` `queueRecordingProcessing`; worker `apps/worker/src/recording.ts`; `process_recording` TTL in `packages/db/src/credits.ts:12`. Spec: `docs/superpowers/specs/2026-10-02-sp6b-screen-recordings-design.md`. No CLI recording.
- **Chitrapx changes:** `packages/cli/src/commands/record.ts`, `src/record/{simulator,adb,markers,trim,frame}.ts`; `AssetMeta` in `packages/db/src/schema.ts` may gain `markers: number[]` (additive) so the video editor can snap scenes to markers.
- **Reference code:**
  - `launch/src/record.rs` (MIT) — `RecordOptions` (`auto_trim`, `keep_still` at lines 21-24), `run` (146), marker key loop (about 160-232, writes `markers.json`), `process_auto_trim` (459), `removable_freezes` (888), `run_trim_ffmpeg` (991), `frame_existing_video` (267), `run_frame_ffmpeg` (709): ffmpeg arguments and still-detection logic to port.
  - `launch/src/main.rs` (MIT) — `FrameVideoArgs` (463) and `run_frame_video` (1393): CLI surface of frame-video.
- **License note:** MIT; port with attribution in `NOTICES.md`.
- **Size:** L

### 13.5 MCP server exposing design tools to coding agents

- **What it does:** `chitrapx mcp --stdio` (hosted HTTP later) exposes tools such as `list_apps`, `list_projects`, `get_project`, `upload_screenshot`, `fill_project`, `ai_design`, `verify_project`, `export_project`, `get_job`, `credits` so Claude Code, Cursor and similar agents can build store assets.
- **Details:**
  - Tools map 1:1 to API routes and respect the key's scopes; tools above the key's scope are not listed.
  - Handshake (`initialize`, `tools/list`) answers from a static manifest generated at build time with no network, so editor startup is instant; the first real call reconciles the manifest against the API.
  - Long operations return a job id and `get_job` polls; credit-spending tools (`ai_design`, `export_project`) require an explicit `confirm_credits` argument echoing the estimated cost from `packages/db/src/pricing.ts`.
  - Ship a plugin manifest (`.mcp.json`, `.claude-plugin/plugin.json`) and agent skills (store screenshots, store compliance, localization) describing the workflow.
  - Tool outputs are JSON with stable fields; project docs are summarized, with `get_project_doc` for full detail to limit context use.
- **Acceptance criteria:**
  - `tools/list` returns without network access and in under 200 ms.
  - An agent session with a read-only key cannot enqueue an export (tool absent, or 403 mapped to a clear MCP error).
  - `ai_design` without `confirm_credits` returns an error stating the cost and does not reserve credits.
  - A stale manifest (tool count differs from the live API) is logged once at first call.
- **Chitrapx today:** Nothing. Job and credit flow to reuse: `apps/web/src/server/jobs.ts` (`enqueueExport`, `getJob`, `enqueueVideo`, `enqueueBundle`) and `packages/db/src/pricing.ts` (cost table, e.g. `ai_design: 10`).
- **Chitrapx changes:** `packages/cli/src/mcp/{tools,stdio,http}.ts`, a `tools.json` build step, root `.mcp.json` and `.claude-plugin/{plugin,marketplace}.json`, `skills/<name>/SKILL.md` files; a hosted MCP route `apps/web/src/app/api/mcp/route.ts` is optional and deferred.
- **Reference code:**
  - `open-screenshot-generator/cli/src/mcp/tools.ts` (MIT) — build-time `tools.json` manifest and reconcile logic; its header comment explains the design and the stale-count bug it guards against.
  - `open-screenshot-generator/cli/src/mcp/stdio.ts`, `http.ts` (MIT) — transports.
  - `open-screenshot-generator/cli/src/commands/mcp.ts`, `call.ts`, `install.ts` (MIT) — launch flags and `install` into agent configs.
  - `open-screenshot-generator/.mcp.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (MIT) — plugin and marketplace packaging.
  - `open-screenshot-generator/skills/{store-screenshots,store-compliance,store-localization,app-preview-video,editor-tools}/SKILL.md` (MIT) — skill structure and wording.
  - `app-store-screenshots/skills/app-store-screenshots/SKILL.md` (MIT) — second agent-skill example.
- **License note:** MIT; adapt with attribution. Skill text must be rewritten for Chitrapx's tools.
- **Size:** M

### 13.6 CI usage: GitHub Actions example, YAML batch config

- **What it does:** A `chitrapx.yaml` batch file lists jobs (project, screenshots dir, locale, targets, output); `chitrapx run` executes them, and a documented GitHub Actions workflow regenerates and verifies store screenshots on release and uploads them as artifacts.
- **Details:**
  - Schema: `jobs: [{ project, screenshots, locale, targets, output }]`, plus `verify: { strict }`; no store upload (later sub-project).
  - Env-only auth in CI (`CHITRAPX_API_KEY` from secrets); `--no-interactive`, `--json`, stable exit codes from 13.2.
  - `--offline` renders and verifies committed `.chitrapx` files with no key and no credits.
  - Example workflows: set up Node, `chitrapx doctor`, `chitrapx run`, `actions/upload-artifact`; and a PR gate running `chitrapx verify`.
  - YAML is validated with a zod schema and errors name the failing job and field.
- **Acceptance criteria:**
  - The example workflow passes in a sample repo against a fixture project and fails (exit 1) when a required Play size is missing.
  - A YAML job with an unknown target id fails and lists the valid ids.
  - `--offline` works with no network and no env vars.
- **Chitrapx today:** Nothing. The example lives in docs; no Chitrapx workflow files were inspected.
- **Chitrapx changes:** `packages/cli/src/commands/run.ts`, `src/batchConfig.ts` (zod schema), `docs/ci/github-actions.md`, `examples/chitrapx.yaml`, `examples/workflow.yml`.
- **Reference code:**
  - `PixelDeck/cli/batch.example.yaml` (MIT) — `jobs:` list with `project`, `screenshots`, `output` per job.
  - `PixelDeck/cli/index.mjs` (MIT) — `--config=<batch.yaml>` handling and job loop.
  - `PixelDeck/.github/workflows/ci.yml` (MIT) — workflow conventions.
  - `open-screenshot-generator/.github/workflows/npm.yml` (MIT) — publishing a CLI to npm.
- **License note:** MIT; adapt with attribution.
- **Size:** S

## Data model and API changes

- New table `api_keys` (13.1) plus migration `0009_api_keys.sql` with RLS; optional `api_rate_limits` table (key_id, window_start, count) if no Redis.
- `requireContext(scope?)` accepts bearer keys; `Ctx` gains `via: "session" | "api_key"` and `scopes`.
- `/api/v1/*` aliases, `GET /api/v1/me`, `GET /api/v1/projects`, key management routes `POST/GET/DELETE /api/keys` (session auth only).
- `AssetMeta` gains optional `markers: number[]`.
- Attribution: store `api_key_id` in job rows or ledger metadata so credit spend is attributable to a key.
- New package `packages/cli` (CLI + MCP); docs under `docs/api` and `docs/ci`.

## Open questions

- Key ownership: tied to the creating user (revoked if they leave) or to the workspace? v1 has one workspace per user, so this matters when team roles arrive.
- Rate limiting store: Postgres bucket (simple, slower) vs introducing Redis; what is the hosting setup?
- Should CLI `render` be free (local Chromium) or charge credits for parity with server exports? The plan assumes free; confirm against pricing.
- Port launch logic to TypeScript or shell out to the `launch` Rust binary (adds a Rust dependency, simpler)? Windows/Linux users only get ADB either way.
- Is `packages/renderer` free of server-only imports so the CLI can render locally? Check before 13.2.
- Hosted HTTP MCP with OAuth vs stdio-only at launch.
- Is the `.chitrapx` bundle format version stable enough to freeze for offline mode?
- ffmpeg as a user-installed dependency vs bundled (`ffmpeg-static`, licensing).

## Suggested build order

1. 13.1 API keys: schema, hashing, `requireContext` bearer path, scopes, revocation, rate limit, workspace-isolation tests.
2. 13.2 CLI core (`login`, `doctor`, offline `verify` and `render`), then `push`/`pull`/`fill`/`export` over the API.
3. 13.6 YAML batch + GitHub Actions example (small, builds on 13.2, validates the CLI in CI early).
4. 13.5 MCP server on top of the CLI's API client, plus plugin manifest and skills.
5. 13.3 Capture (iOS, ADB, window, watch).
6. 13.4 Record (markers, auto-trim, frame, upload as recording), last because it builds on 13.3 device plumbing and ffmpeg handling.
