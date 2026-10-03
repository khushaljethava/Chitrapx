# Sub-project 8: Sizes and export

Every store slot covered, one design exporting to every size, a free single-PNG download, a store-readiness report, and a portable `.chitrapx` project file. First of the gap-closing sub-projects (SP8–SP16) that bring Chitrapx level with open-screenshot-generator, PixelDeck, storeshots, app-store-screenshots, appshots and launch.

## Decisions

- **Derived sizes at export, never saved.** A size without its own group is rendered from the closest group, retargeted in memory. Users add a size as an editable group only when they want to.
- **One pure planner** in `packages/document` (`exportPlan`, `resolveGroup`, `storeReadiness`), shared by the dialog, the worker, the render page, and later the SP13 CLI.
- **Exports read a pinned document.** The job snapshots the document when it is queued; worker and render page plan against that snapshot. This also fixes today's bug where both sides call `exportPlan` on the live document and a concurrent edit can put the wrong board under a filename.
- **Single PNG is a server render at 0 credits**, pixel-identical to the ZIP, rate-limited. No browser capture.
- **Store rules report, never block.**
- **Project file is a zip bundle** with the document and every referenced asset original.
- Existing target ids and sizes are unchanged; saved projects keep working.

## 1. Sizes

New entries in `packages/document/src/targets.ts`. `Target` gains `slot: string`, the store slot the size fills; existing targets get their slot too (`iphone-6.9` -> `ios-6.9`, and so on).

| Slot | New target id | Pixels |
|---|---|---|
| `ios-6.9` | `iphone-6.9-1320` | 1320×2868 |
| `ios-6.5` | `iphone-6.5-1284` | 1284×2778 |
| `ios-6.3` | `iphone-6.3-1206` | 1206×2622 |
| `ios-6.1` | `iphone-6.1` | 1170×2532 |
| `ipad-11` | `ipad-11` | 1668×2388 |
| `android-tablet-7` | `android-tablet-7-land` | 1920×1200 |
| `android-tablet-10` | `android-tablet-10-land` | 2560×1600 |
| `tv` | `apple-tv-4k` | 3840×2160 |
| `watch` | `watch-s9` | 396×484 |
| `watch` | `watch-s6` | 368×448 |
| `watch` | `watch-s3` | 312×390 |
| `preview` | `app-preview-landscape` | 1920×886 |

- `iphone-6.9-1320` is listed first among iPhone sizes in "Add a store size" and the export dialog. Templates keep their 1290×2796 boards (`iphone-6.9`), which stays valid in the same slot.
- CarPlay is not a size (App Store Connect takes it in the iPhone slot); it moves to SP10 as a device frame.
- **First implementation task:** check every size above, and every rule in section 4, against Apple's and Google's current help pages, and correct this table before writing code.

## 2. Planning

```ts
type ExportSelection = {
  targets: TargetId[];
  locales: string[];
  /** Single-PNG export: exactly one board. */
  board?: { groupId: string; boardIndex: number };
};

type ExportItem = {
  targetId: TargetId; sourceGroupId: string; boardIndex: number; locale: string;
  /** <platform>/<target>[-variant]/<locale>/<NN>-<board-name>.png */
  file: string;
  width: number; height: number;
  derived: boolean;      // rendered from another size's group
  letterboxed: boolean;  // derived across a large aspect-ratio change
  threeD: number;
};

exportPlan(doc, selection): ExportItem[]
resolveGroup(doc, item): BoardGroup   // retarget(source, item.targetId) when derived
```

Source group for each selected target, first match wins:

1. Groups whose `target` equals it exactly, including their A/B variant groups (each exported under its `-variant` folder as today).
2. The group on the same platform with the nearest aspect ratio; `derived: true`.
3. The group on any platform with the nearest aspect ratio; `derived: true`.

A derived item is `letterboxed` whenever source and target aspect ratios differ by more than 5%, whichever rule picked it.

- `resolveGroup` is cached per (group, target) within one render.
- Order stays locale-major and stable; `MAX_EXPORT_ITEMS = 200` and `exportBatches` are unchanged.
- `checkExportable(doc, selection)` keeps its codes (`board_size_mismatch`, `export_too_large`, `nothing_to_export`) and applies them to the new plan.

**Pinned document.** On enqueue, the API reuses the `project_versions` row for the current `revision` if one exists, else inserts the current `doc` and `revision`, and stores `{ selection, versionId }` in the job input. Worker and `/render/[jobId]` load that version row, never `projects.doc`. Both therefore compute the same plan.

## 3. Export dialog and single PNG

**Dialog** (replaces `ExportPanel`; opened from the editor toolbar's Export button and from the project dashboard):

- Presets that fill the selection: *App Store required* (iPhone 6.9", plus iPad 13" when the project has an iPad group), *Play required* (phone, feature graphic), *Everything* (every size on the project's platforms), *Custom*.
- Size grid grouped by platform, ordered by slot. Each size is tagged *Designed*, *Auto from <size>*, or *Letterboxed*; letterboxed sizes offer "Add as editable size" (existing `addGroupFromTarget` command).
- Language checkboxes, all on by default.
- Footer: live PNG count (error state above 200), store-readiness summary (section 4), **Export ZIP (1 credit)**.
- The dialog opens with the selection of the project's latest export job (`jobs.input.selection`); with none, it opens on *App Store required* and/or *Play required* for the platforms the project has. No document field.
- Export history moves into the dialog; a finished row reads "Download 84 PNGs · 2 warnings".

**Single PNG:**

- **Download PNG** in each board's menu in the editor's left panel: active size, active language, free.
- Flow: flush autosave (`save.ts`) -> `POST /api/projects/:id/export { kind: "single", groupId, boardIndex, locale }` -> poll job every 1 s -> download `<jobId>.png`.
- Spinner on the menu item; the editor stays usable.
- Over the limit: "Free downloads are limited to 30 per hour. Use Export ZIP for full sets."

**Server:**

- One POST route, Zod discriminated union on `kind: "zip" | "single"`. Job types `export` (1 credit) and `export_single` (0, new in `PRICES`).
- `runExport` handles both; single skips the ZIP and uploads `<workspace>/<jobId>.png`.
- `/api/jobs/:id/download` chooses extension and `Content-Disposition: attachment` by job type (`export` zip, `export_single` png, `project_bundle` chitrapx, `video` mp4).
- **Free-job rate limit:** at most 30 `export_single` + `project_bundle` jobs per workspace per rolling hour, counted from `jobs.created_at`. Over the limit: HTTP 429, code `rate_limited`, no job row.

## 4. Store readiness

`storeReadiness(plan, doc): ReadinessIssue[]`, pure, in `packages/document`.

```ts
type ReadinessIssue = {
  store: "app-store" | "play"; severity: "error" | "warning"; code: string; message: string;
  targetId?: TargetId; locale?: string; groupId?: string; boardIndex?: number;
};
```

Before export, from the plan:

| Store | Code | Rule | Severity |
|---|---|---|---|
| App Store | `iphone_slot_missing` | Any iPhone size selected, but neither `ios-6.9` nor `ios-6.5` slot | error |
| App Store | `ipad_slot_missing` | Any iPad size selected, but not `ipad-13` slot | error |
| App Store | `count_out_of_range` | Not 1–10 screenshots per slot × locale × variant | error |
| Play | `phone_count_out_of_range` | Not 2–8 phone screenshots per locale | error |
| Play | `feature_graphic_missing` | Any Play size selected, no 1024×500 feature graphic | error |
| Play | `dimension_out_of_range` | A side outside 320–3840 px, or long side over 2× short side | error |
| Play | `promo_ineligible` | Fewer than 4 phone screenshots at 1080 px or more | warning |
| Both | `letterboxed` | An item is letterboxed | warning |
| Both | `design_issues` | `lintBoard` issues, totalled per size | warning |

The dialog shows ✓ or a count per store; expanding lists issues; clicking one opens that board in the editor and selects the element, as `Checks` does.

After export, in the worker, per PNG:

- Pixel size from IHDR must equal the plan (unchanged; mismatch fails the job).
- `sharp(png).stats()`; if not opaque, warning `transparent_pixels` naming the file.
- Every PNG is written as RGB without alpha: `sharp(png).flatten({ background: "#ffffff" }).removeAlpha().png()`.
- Over 8 MB: error `file_too_large`.
- ZIP root gets `report.txt`: pre-export issues, post-export issues, and each derived or letterboxed size with its source size. Job output gains `issues: number`.
- Single PNG gets flattening, no report.

## 5. Project file (`.chitrapx`)

A zip, version 1:

```
manifest.json            { format: "chitrapx-project", version: 1, docSchema, appName, exportedAt,
                           assets: [{ sha256, kind: "screenshot" | "image" | "recording", mime }] }
doc.json                 document; every "asset:<uuid>" source rewritten to "bundle:<sha256>"
assets/<sha256>.<ext>    original of every referenced image, screenshot and recording
```

- Recordings ship as the uploaded original, not the converted `.webm`; import queues `process_recording` (free). Public paths and Google Font URLs are kept as is. Fonts join in SP10.
- `docSchema` is the document version `migrate` produces. `exportedAt` is an ISO 8601 UTC timestamp, e.g. `2026-10-03T12:00:00Z`.

**Download project file:** job `project_bundle` (0 credits, shares the free-job rate limit; fails with `bundle_too_large` when the assets total over 500 MB, since such a file could not be imported), output `<workspace>/<jobId>.chitrapx` in the exports bucket, downloaded through `/api/jobs/:id/download`.

**Import project** (on an app page):

1. Plan project limit checked; over it, HTTP 403 `plan_limit` (the existing code), no upload.
2. Browser uploads the file to a staging path in the existing private `uploads` bucket (`<workspace>/staging/<uploadId>`, the same place uploads stage), limit 500 MB, the bucket's limit.
3. Job `project_import` (0 credits) treats the file as untrusted:
   - At most 500 entries and 500 MB total uncompressed, checked from the central directory before extracting; each entry within its asset kind's limit (25 MB image, 500 MB recording). Else `bundle_too_large`.
   - `manifest.format` and `version` supported, else `bundle_version_unsupported`. `doc.json` passes `migrate` then Zod and fits `MAX_DOC_BYTES`, else `bundle_invalid`.
   - Each asset: sha256 of the bytes equals its filename, kind and MIME match `manifest.assets`, MIME sniffed with the same accepted types as uploads (SVG stays rejected, as for uploads), using the checks moved from `uploads.ts` into `packages/db/src/assetCheck.ts`. Mismatch: `bundle_asset_mismatch`.
   - Every `bundle:` source in the document has a file, else `bundle_invalid`.
   - Insert assets (dedupe through the existing `(workspace, app, sha256)` unique key), rewrite sources back to `asset:<id>`, create the project, all in one transaction.
4. The uploaded file is deleted whether the import succeeds or fails. On failure nothing else is created.

## 6. Errors

- New user-facing codes in `jobText.ts`: `rate_limited`, `bundle_invalid`, `bundle_too_large`, `bundle_asset_mismatch`, `bundle_version_unsupported`. Project limits reuse the existing `plan_limit`.
- Export jobs queued before this ships carry `{ locales }` and no `versionId`; they still run against the live project with every group's own target selected, as today.
- `export_single`, `project_bundle` and `project_import` are ordinary jobs with price 0: same retries, same fatal handling, no ledger rows.

## 7. Testing

- **Vitest, `packages/document`:**
  - source selection: exact, variants, same platform, cross-platform, 5% letterbox threshold;
  - each `storeReadiness` rule, both passing and failing;
  - `resolveGroup` equals a stored `retarget`;
  - bundle doc rewrite round-trip (`asset:` -> `bundle:` -> `asset:`).
- **Vitest, worker:** alpha flattening; `report.txt` content; import rejects a zip bomb, a sha256 mismatch, a dangling `bundle:` source, an unknown version, an oversized document.
- **Vitest, web:** 31st free job in an hour returns 429; POST route union accepts `zip` and `single` and rejects anything else.
- **E2E** (`test:e2e`, golden images):
  - mixed selection with one derived size: ZIP contents and every PNG's size match the plan;
  - single PNG equals its golden image;
  - bundle -> import into a second app -> export both -> byte-identical PNGs;
  - editing the project during an export does not change the ZIP (pinned version).

## Out of scope

- Browser-side rendering of any kind.
- Saving derived sizes into the project automatically.
- Uploading to App Store Connect or Google Play (SP14); CLI and API access to the bundle and planner (SP13).
- Custom fonts in bundles (SP10).
