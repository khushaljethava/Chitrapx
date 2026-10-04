# Sub-project 9: Editor essentials

The everyday editor tools users expect: a layers panel (reorder, lock, hide, rename), element grouping, layout presets, apply-to-all (across boards and languages), dropping files and importing folders, version history with restore, and a simulated status bar on phones. Feature breakdown and reference code: `docs/roadmap/sp09-editor-essentials.md`.

## Decisions

- **Lock and hide are document properties** on every element (`locked`, `hidden`). Hidden elements are not rendered on the canvas or in exports. Neither varies per language; the existing per-locale `hidden` override keeps its meaning.
- **Grouping is a tag, not nesting**: members share `groupId` (and `groupName`) and stay separate layers in the same list. The fields already exist on `BaseElement`.
- **The board background** is a fixed bottom row in the layers panel: not movable, no visibility toggle.
- **Layers panel drag uses `@dnd-kit/core` + `@dnd-kit/sortable`** (keyboard reordering and touch included).
- **Every edit is one editor command**, so it is one undo step. Pure logic lives in `packages/document` (`layout.ts`, `match.ts`, `deviceStatusBar.ts`) and in `apps/web/src/editor/selection.ts` and `intake.ts`.
- **Presets with nothing selected** apply to the first text and the first device on the board. Presets are one-shot edits: no stored "layout" field.
- **Apply-to-all matching** pairs elements by type and position in the list (nth device ↔ nth device). Missing counterparts are skipped and reported.
- **Restore** replaces the live project after saving the current state as "Before restore". No "open as a copy".
- **Folder import** creates one board per image in the active size, at most 20 files per drop.
- **Status bar**: iOS (Dynamic Island) and one Android style; editable time; battery and signal always full; 2D devices only in v1.
- **Version retention**: keep the newest 50 automatic versions (`auto`, `export`, `restore`) per project; never prune `named` versions or versions a queued or running export needs. Same for every plan; any workspace member can restore.
- No document schema version bump: every new element field is optional and elements are validated with `.passthrough()`.

## 1. Document model and renderer

`packages/document/src/artboard.ts`:

- `BaseElement` gains `locked?: boolean` and `hidden?: boolean`.
- Device and video-device props gain:
  - `showStatusBar?: boolean`
  - `statusBarPlatform?: "ios" | "android"`
  - `statusBarTheme?: "light" | "dark"`
  - `statusBarBg?: "transparent" | "solid"`
  - `statusBarColor?: string`
  - `statusBarTime?: string`

`packages/document/src/doc.ts`:

- `statusBarColor` joins `COLOR_KEYS`.
- `statusBarTime`, when present, must match `^\d{1,2}:\d{2}$` (else Zod error at that path).
- A test proves documents saved before SP9 still pass `migrate` unchanged.

Renderer (`packages/renderer`): an element is drawn only when neither `element.hidden` nor the active locale's `hidden` override is true. This applies in `StaticArtboard` and so in canvas, preview and export alike.

## 2. Layers panel and grouping

### Commands (`apps/web/src/editor/commands.ts`)

| Command | Behaviour |
|---|---|
| `reorderElementTo { ref, toIndex }` | Move one element to an index in its list. |
| `setElementsLocked { refs, locked }` | Set `locked` on every ref. |
| `setElementsHidden { refs, hidden }` | Set `hidden` on every ref. |
| `groupElements { refs, groupId, groupName? }` | Requires ≥ 2 refs in the same list (one board, or the span list); otherwise no-op. Moves members to be adjacent at the top-most member's index, preserving their relative order; sets `groupId` and `groupName`. |
| `ungroupElements { refs }` | Clears `groupId` and `groupName` on refs; positions unchanged. |
| `renameGroup { groupId, boardId, name }` | Sets `groupName` on every member in that list. |

- After any command, a group left with exactly one member in a list has its tags cleared.
- Element rename uses the existing `updateElement { props: { name } }`; an empty name clears it back to the type label.
- `duplicateElements` gives copied groups a fresh `groupId` (one new id per source group).

### Selection (`apps/web/src/editor/selection.ts`, new, pure)

- `expandToGroups(elements, refs, { single })`: clicking a member selects every member of its group in that list; `single` (alt-click) selects only the clicked element.
- `selectableRefs(elements, refs)`: drops locked elements.

### Canvas and shortcuts

- **Canvas** (`Canvas.tsx`): locked elements are drawn but skipped for click, drag and snap targets. Clicks go through `expandToGroups`.
- **Shortcuts** (`shortcuts.ts`): select-all and arrow nudges skip locked elements. ⌘/Ctrl+G groups the selection; ⌘/Ctrl+Shift+G ungroups it.
- **Naming:** new code uses `isElementLocked` to stay distinct from the store's existing `locked` (save-conflict freeze).

### Layers panel (`apps/web/src/editor/ui/LayersPanel.tsx`, new, inside the left panel)

- **Order and sections:**
  - The list is front-most first: reverse of the element array.
  - Span elements get their own section at the top.
  - The board background is a fixed bottom row; nothing can be dropped below it.
- **Rows:** type icon, name (falling back to "Text", "Device", "Image", "Shape", "Video"), lock toggle, eye toggle.
  - Double-click renames inline: Enter saves, Escape cancels.
  - Click selects, Shift-click adds. Panel and canvas selection stay in sync.
  - Locked elements can still be selected here, so they can be unlocked.
- **Groups:** a group is a collapsible header row with rename, ungroup, lock-all and hide-all, and its members indented beneath.
  - Dropping a row inside a group adds it to that group; dropping it outside removes it.
  - Each drop is one command.
- **Keyboard:** reordering works through dnd-kit's keyboard sensor.
- **Attribution:** ported code from PixelDeck (`LayersPanel.tsx`, `SortableLayerRow.tsx`) and open-screenshot-generator (group header rows) gets `NOTICES.md` entries.

## 3. Layout presets and apply-to-all

### `packages/document/src/layout.ts` (new, pure)

`layoutFor(preset, board, element): { position, size, rotation }`. All values are in percentages of the board size, so they hold at every store size. Device aspect is preserved: height is set from the table, then reduced if the width would exceed 90% of the board width.

| Preset | Applies to | Size | Vertical position | Horizontal | Rotation |
|---|---|---|---|---|---|
| `text-top` | text | width 88% of board, height kept | top at 6% of height | centred | 0 |
| `text-middle` | text | same | centred | centred | 0 |
| `text-bottom` | text | same | bottom at 6% of height from the bottom | centred | 0 |
| `phone-center` | device, video-device | height 80% | centred | centred | 0 |
| `phone-hero` | device, video-device | height 85% | top at 28% | centred | 0 |
| `phone-bleed` | device, video-device | height 95% | top at 40% (about a third past the bottom edge) | centred | 0 |
| `phone-tilt` | device, video-device | height 72% | top at 18% | centre + 4% of width | −12° |

**Command** `applyLayoutPreset { groupId, boardId, preset, refs? }`:

- **Targets:** applies to the matching refs, or, with none, the first element of the preset's type on the board.
- **Skipped:** span elements, with a notice.
- **Locales:** locales with a detached box for the element keep it, with a one-time warning.
- **Repeat:** applying the same preset twice changes nothing.

**UI:** a Layout section in the inspector's board section with Text (Top, Middle, Bottom) and Phone (Center, Hero, Bleed, Tilt) buttons.

### `packages/document/src/match.ts` (new, pure)

`matchElements(source: ArtboardState, target: ArtboardState): Map<sourceId, targetId>` pairs the nth element of each type.

### Apply to all boards

`applyToAllBoards { groupId, sourceRef }` copies to each other board's counterpart:

- **Always copied:** `position`, `size`, `rotation`, `scale`.
- **For devices:** also `screenshotRect`.
- **Never copied:** screenshot or image sources, text, fonts or colours.

UI and behaviour:

- **UI:** "Apply position to all boards" in the inspector's element section, disabled when the group has one board.
- **Confirmation:** shows how many boards change and which have no counterpart (those are skipped).
- **Undo:** one undo step.

### Apply layout to all languages

`applyLayoutToLocales { groupId, boardId }`: for every element on the board and every locale, removes `position`, `size`, `rotation` and `scale` from that locale's `detached` list and drops their stored values, so every language follows the base layout.

- **Kept:** content, fonts, font metrics and manual translations.
- **UI:** in the board section when the project has more than one language.
- **Confirmation:** lists the languages that currently have their own layout.
- **Undo:** one undo step.

## 4. Dropping files and folder import

- **Shared upload:** the upload flow moves from `UploadGrid.tsx` into `apps/web/src/lib/uploadScreenshot.ts` (sign → `uploadToSignedUrl` → complete). The app page and the editor both use it; server checks are unchanged (25 MB, sniffed type, checksum, dedupe).
- **Intake** (`apps/web/src/editor/intake.ts`, new, ported from open-screenshot-generator `src/lib/intake/intakeFiles.ts`, MIT):
  - `collectDroppedFiles(dataTransfer)` gathers entries synchronously in the drop event.
  - Folders are walked to depth 3.
  - Accepts PNG, JPEG and WebP; skips dotfiles.
  - `naturalSort` orders files (`shot2` before `shot10`).
  - At most 20 files per drop; extras are rejected with a message.
- **Canvas drop:** only drags whose `types` include `"Files"` are handled, so element drags inside the canvas are unaffected.
  - One image on a device fills its screenshot (`setScreenshot`).
  - One image on empty space adds an image element at the drop point.
  - Two or more images ask "Add here as images" or "Create a board for each".
- **Import folder:** an "Import folder" button in the left panel (`<input webkitdirectory>`) always creates a board per image.
- **Command** `addBoardsFromAssets { groupId, assetIds }`: appends one board per asset to the group. Each copies the active board's design (as `duplicateBoard` does: fresh element ids, group tags copied, which is safe because groups resolve within one board) with the asset in its first device. One undo step.
- **Progress:** each file shows progress; a failure shows a message and does not stop the rest.
- **Asset URLs:** the editor's asset URL map becomes editor state. After an upload, the editor fetches that asset's signed URL from `GET /api/apps/:appId/assets` and merges it in.

## 5. Version history

### Database

- **Migration:** `project_versions` gains `kind text not null default 'auto'`, one of `auto | export | restore | named`.
- **Backfill:** rows with `label = 'export'` become `export`.
- **Index:** add `(project_id, created_at desc)`.
- **SP8 change:** `pinVersion` in `apps/web/src/server/jobs.ts` writes `kind: 'export'`.

### Server (`apps/web/src/server/projects.ts`)

All functions take `ctx` and filter by workspace; any workspace member may call them.

- `listVersions(ctx, projectId)`: newest first, at most 100, without `doc`.
  - Fields: `id, revision, kind, label, createdBy, createdAt`.
- `getVersion(ctx, projectId, versionId)`: the version with its `doc` passed through `migrate`.
- `saveNamedVersion(ctx, projectId, label)`: label trimmed, 1–80 characters. Inserts the current saved `doc` and `revision` as `named`.
- `restoreVersion(ctx, projectId, versionId, currentRevision)`, in one transaction:
  1. Lock the project row and check `revision === currentRevision`, else `ConflictError` (409 with `current`).
  2. Insert the current document as `restore`, labelled "Before restore".
  3. Write the version's migrated document with `revision + 1`.
  4. Return `{ revision, doc }`.

**Pruning:**

- **When:** after inserting an `auto`, `export` or `restore` version, delete the project's versions of those kinds beyond the newest 50.
- **Never deleted:**
  - `named` versions;
  - any version whose id appears in `jobs.input->>'versionId'` for a job of that project with status `queued` or `running`.
- **Covered writers:** the auto-snapshot in `saveDoc` and `pinVersion` both call the prune.

### Routes

| Route | Purpose |
|---|---|
| `GET /api/projects/:id/versions` | list |
| `POST /api/projects/:id/versions` | named save, body `{ label }` |
| `GET /api/projects/:id/versions/:versionId` | preview |
| `POST /api/projects/:id/versions/:versionId/restore` | restore, body `{ revision }` |

### UI (`apps/web/src/editor/ui/VersionsDialog.tsx`, opened from the toolbar)

- **Rows:** label, or for automatic kinds "Auto-save", "Before export" or "Before restore"; relative time; author.
- **Preview:** selecting a row shows a read-only thumbnail of the version's first board and a Restore button.
- **Restore:**
  - flushes unsaved edits first;
  - calls the route, then `replaceDoc(doc, revision, false)` and clears the IndexedDB draft;
  - is disabled while a save conflict is open;
  - a 409 opens the existing conflict dialog.
- **Save version:** a name field that saves a named version (flushes first).

## 6. Status bar

`packages/document/src/deviceStatusBar.ts` (new, pure): `statusBarSpec(deviceType)` returns `{ platform, heightPct, contentPct } | null`. Percentages are of the screen height.

| Device types | Platform | Height | Content row |
|---|---|---|---|
| `iphone-15`, `iphone-15-pro`, `iphone-17-pro-max` | `ios` (Dynamic Island) | 6.9% | time left, icons right, centre clear for the island |
| `android-punch-hole`, `android-notch`, `android-bar` | `android` | 5.9% | time left, icons right |
| every other device type | none | — | no toggle |

Renderer: a new `packages/renderer/src/osg/elements/StatusBar.tsx` is an SVG port of PixelDeck `src/components/canvas/PhoneStatusBar.tsx` (MIT).

- **Rendering:**
  - Draws time, 4 signal bars, Wi-Fi and a full battery in iOS or Android style, light or dark.
  - Mounted over the screenshot inside the device frame when `showStatusBar` is true, `styleType` is 2D (`normal`), and `statusBarSpec` is not null.
- **Solid vs transparent:** solid background fills with `statusBarColor` and shifts the screenshot down by the bar height; transparent draws over the screenshot.
- **Defaults on first enable:** platform from the spec, `dark`, `transparent`, `9:41`.

Inspector device section:

- **Fields:** show toggle, platform, theme, background, colour (when solid), time.
- **3D devices:** the toggle is disabled with a note.
- **No-spec devices:** the toggle is not shown.

## 7. Errors

- **Commands that would do nothing do nothing:** they show a notice and add no undo step. Cases:
  - grouping fewer than 2 elements, or elements from different lists;
  - apply-to-all with no counterparts;
  - presets on span elements.
- **Invalid document values** (`statusBarTime`, `statusBarColor`) fail save with the existing 400 and field path.
- **Version routes:**
  - A missing version, or one from another project or workspace, returns 404.
  - A stale restore returns 409 `conflict`.
  - A bad label returns 400.
- **Uploads:** each failure shows its own message; others continue.

## 8. Testing

- **`packages/document`:**
  - `layoutFor` for every preset at a portrait phone (1290×2796), a landscape tablet (2560×1600) and a Mac size (2880×1800), including repeat application and the 90%-width clamp.
  - `matchElements` for matches, misses and mixed types.
  - `statusBarSpec` per device type.
  - Pre-SP9 documents pass `migrate`.
  - `statusBarTime` and `statusBarColor` validation.
- **`apps/web/test/commands.test.ts`:** every new command, each undone in one step.
  - Grouping adjacency and the single-member dissolve.
  - `duplicateElements` re-minting `groupId`.
  - `applyLayoutToLocales` keeping content.
  - `addBoardsFromAssets`.
- **`apps/web/test/selection.test.ts`:** group expansion, alt-click, locked skipping.
- **`apps/web/test/versions.test.ts` (database):**
  - list without doc, preview, named save;
  - restore (snapshot + new revision + `migrate`), stale restore → 409;
  - pruning keeps 50, never deletes `named` or versions an active export references;
  - another workspace gets 404.
- **Worker e2e:**
  - a hidden element is absent from the exported PNG;
  - new golden image `status-bar-ios.png` (iPhone, iOS style, solid);
  - existing golden images unchanged.
- **Manual browser checks** (magic-link login blocks automated sign-in):
  - drag and keyboard reorder;
  - drop one file and a folder;
  - the history dialog's preview and restore;
  - the status bar in the editor.

## Out of scope

- "Open version as a copy", plan-based retention limits, and per-role restore permissions (roles arrive in SP15).
- Status bar on 3D devices; editable battery and signal.
- Per-language lock or hide.
- Nested groups.
