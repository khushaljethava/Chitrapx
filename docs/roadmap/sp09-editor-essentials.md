# SP9: Editor essentials

**Status:** Not started
**Goal:** The editor gains the everyday tools users expect: a layers panel, grouping, layout presets, apply-to-all, drag-and-drop and folder import, version history with restore, and a simulated status bar on phone frames.
**Depends on:** SP3 (editor: command bus, store, canvas, save) and SP8 (done: sizes and export). Version restore reuses the `project_versions` table that saves and exports already fill.
**Gap source:** PixelDeck (layers, groups, lock/hide, status bar, folder import), open-screenshot-generator (layers panel, groups, versions, drop and folder intake), appshots (apply-to-all, reference only), storeshots (apply layout to all languages, ideas only), app-store-screenshots (layout names).

## Features

### 9.1 Layers panel

- **What it does:** A panel listing every element on the active board (top of the list is front-most) with drag to reorder, lock, hide, and rename. The board background appears as a pinned row at the bottom that cannot be moved or dragged over.
- **Details:**
  - Rows are shown in reverse array order (last element in `elements` is drawn on top, so it is listed first).
  - Row shows type icon, name (`element.name`, falling back to a type label such as "Text", "Device"), lock toggle, visibility toggle.
  - Double-click a name to rename inline; Enter commits, Escape cancels; empty string clears back to the default label.
  - Click selects, shift-click toggles into the selection; selecting in the panel selects on the canvas and the reverse.
  - Locked elements cannot be selected or moved on the canvas, and are skipped by select-all and arrow-key nudges, but can still be selected from the panel (to unlock).
  - Hidden elements are not rendered on the canvas and not exported. Hide is a document property, not an editor-only view state, so export and canvas cannot disagree.
  - The background row is display-only unless a board-background visibility field is added; see open questions.
  - Span elements (`boardId: null`) appear in a separate "Spans strip" section above the board's elements.
  - Drag reorder produces one undo step.
  - Elements with a per-locale `hidden` override (`packages/document/src/artboard.ts:375`) keep that meaning; the new base-level `hidden` is independent and applies in every language.
- **Acceptance criteria:**
  - Dragging a row above another changes the element's array order and the canvas stacking in the same frame; undo restores it.
  - A locked element ignores click, drag and arrow nudge on the canvas; unlocking restores all of them.
  - A hidden element disappears from the canvas and from an exported PNG of that board; unhiding brings it back.
  - Renaming persists after save and reload, and survives board duplication (`duplicateBoard` copies `name`).
  - The background row is always last and refuses drops below it.
  - Unit test on `applyCommand` for lock/hide/reorder, and a render test showing a hidden element is absent from `StaticArtboard` output.
- **Chitrapx today:**
  - Only front/back/forward/backward through `reorderElement` (`apps/web/src/editor/commands.ts:15`, `:86-94`) and two buttons in the inspector (`apps/web/src/editor/ui/Inspector.tsx:198-199`). No list UI.
  - `updateElement` can already set `name` (`BaseElement.name`, `packages/document/src/artboard.ts:64`).
  - `locked` does not exist on elements. `hidden` exists only on `ElementLocaleOverride` (`artboard.ts:375`), not on `BaseElement`.
  - Store `locked` (`apps/web/src/editor/store.ts`, field `locked`) means "save conflict, document frozen"; it is unrelated. Use different names (`isElementLocked`) in new code.
  - Canvas hit boxes are built per element in `apps/web/src/editor/ui/Canvas.tsx` (around `:180`, `data-hit`); the left panel is `LeftPanel.tsx` (141 lines, add palette).
- **Chitrapx changes:**
  - `packages/document/src/artboard.ts`: add `locked?: boolean` and `hidden?: boolean` to `BaseElement`. No schema bump needed: `element` in `doc.ts` is `.passthrough()`.
  - `packages/renderer` (`src/osg/StaticArtboard.tsx`, `src/board.ts`): skip elements with `hidden: true`.
  - `apps/web/src/editor/commands.ts`: new `reorderElementTo` command (see Data model); lock, hide and rename use existing `updateElement`.
  - `apps/web/src/editor/ui/Canvas.tsx`: skip locked elements in hit testing and snapping targets; keep them rendered.
  - `apps/web/src/editor/shortcuts.ts`: select-all (`:20-25`) and arrow nudge filter locked refs.
  - New `apps/web/src/editor/ui/LayersPanel.tsx` (drag via `@dnd-kit/sortable`, as PixelDeck does), mounted in `Editor.tsx`.
  - New commands: `reorderElementTo { ref, toIndex }`, `setElementsLocked { refs, locked }`, `setElementsHidden { refs, hidden }` (batch forms so "lock selection" is one undo step). Rename is `updateElement { props: { name } }`.
- **Reference code:**
  - `PixelDeck/src/components/panels/LayersPanel.tsx` (MIT, 440 lines) — dnd-kit `SortableContext`, drag-end handling (`:176-250`), pinned background row at the bottom (`:405-420`).
  - `PixelDeck/src/components/panels/layers/SortableLayerRow.tsx` (MIT, 278 lines) — row layout with lock toggle (`:17`, `:70`), visibility and rename.
  - `PixelDeck/src/components/panels/layers/LayerContextMenu.tsx` (MIT, 40 lines) — row context menu.
  - `PixelDeck/src/hooks/useLayerInteraction.ts` (MIT) — how a locked layer skips select and drag (`:20-27`).
  - `PixelDeck/src/types/index.ts:193-194` (MIT) — `visible` and `locked` fields on a layer.
  - `open-screenshot-generator/src/components/open-screenshot-generator/LayersPanel.tsx` (MIT, 609 lines) — native HTML5 drag with drop-line indicator and drop-into-group targets (`:56-95`, `:260-300`, `:482-500`), inline rename shared by layers and groups (`:307-325`), touch drag fallback via `src/hooks/use-touch-drag.tsx`. It has no lock; hide there is only the per-locale `hidden` field (`src/types/artboard.ts:374`).
- **License note:** All referenced code is MIT; port with attribution in `NOTICES.md`. Chitrapx's doc model differs (immer commands, array order = z-order), so port UI structure, not store code.
- **Size:** M

### 9.2 Element grouping

- **What it does:** Select several elements and group them so they select, move, duplicate and delete together; ungroup to release them.
- **Details:**
  - Model is a tag, not nesting: members keep `groupId` (and optional `groupName`) and stay independent layers in the same array. This is the model already defined in `BaseElement` (`artboard.ts:78-88`), matching OSG.
  - Group requires 2 or more elements in the same list (one board, or the span list); mixed selections are rejected.
  - Clicking one member on the canvas selects the whole group; alt-click selects one member (the `single` modifier documented at `artboard.ts:560-564`).
  - Membership is resolved within one board, because `duplicateBoard` copies `groupId` verbatim while re-minting element ids (`artboard.ts:79-82`). Duplicating a group inside a board must mint a new `groupId`.
  - Layers panel shows a group header row (collapsible, renameable via `groupName`, ungroup button) with its members under it. Grouping moves members to be adjacent at the top-most member's position.
  - A group left with one member is dissolved.
  - Locking or hiding a group header applies to all members.
  - Shortcuts: cmd/ctrl+G group, cmd/ctrl+shift+G ungroup.
- **Acceptance criteria:**
  - Shift-click two elements, press cmd+G: both get the same `groupId`; dragging either moves both; one undo reverts grouping.
  - Clicking one member selects all members; alt-click selects only that one.
  - Ungroup clears `groupId` and `groupName` on members and leaves positions unchanged.
  - Duplicate selection (cmd+D) of a group yields a new group with a fresh `groupId` and a copied `groupName`; duplicating the board keeps both boards' groups independent.
  - Group tags survive save and reload and pass `docSchema` (`groupName` is already in `TEXT_KEYS`, `packages/document/src/doc.ts:35`).
- **Chitrapx today:**
  - Data model already has `groupId` and `groupName` on `BaseElement` (`packages/document/src/artboard.ts:78-88`), ported from OSG, but no command or UI reads or writes them.
  - `ElementSelectModifiers { toggle, single }` exists (`artboard.ts:560-564`) but is not used by `Canvas.tsx`.
  - `duplicateElements` (`commands.ts:73-85`) copies elements and localized overrides but would copy `groupId` unchanged.
  - Not to be confused with `BoardGroup` in `doc.ts:9` (a device-size strip). Name new code `elementGroup` / `layerGroup`.
- **Chitrapx changes:**
  - `apps/web/src/editor/commands.ts`: new `groupElements { refs, groupId, groupName? }`, `ungroupElements { refs }`, `renameGroup { groupId, groupId scope, name }`; fix `duplicateElements` to remap `groupId` for copies.
  - New `apps/web/src/editor/selection.ts`: `expandToGroups(elements, seedRefs, { single })`, used by the Canvas click handler.
  - `Canvas.tsx` pointer-down: expand selection, honour `single` on alt.
  - `shortcuts.ts`: cmd+G, cmd+shift+G.
  - `LayersPanel.tsx` (from 9.1): group header rows and drag into or out of a group (drop sets `groupId` and makes the element adjacent).
- **Reference code:**
  - `open-screenshot-generator/src/lib/elementGeometry.ts:297-319` (MIT) — group expansion on pick-up and `groupMembers`: exactly the tag model Chitrapx already adopted in its types.
  - `open-screenshot-generator/src/types/artboard.ts` (MIT) — the original `groupId` / `groupName` definitions.
  - `open-screenshot-generator/src/components/open-screenshot-generator/LayersPanel.tsx:37-47`, `:500-600` (MIT) — group header rows, collapse, rename, ungroup, drop-into-group (`onDropLayer(dragId, anchorId, side, groupId)`).
  - `open-screenshot-generator/src/lib/panels/useDockHost.ts:204-208` and `.../protocol.ts:145` (MIT) — group/ungroup command plumbing.
  - `PixelDeck/src/store/slices/groupSlice.ts` (MIT, 279 lines) — an alternative nested model (container layer with children; "no nested groups", auto-flatten on create `:32-85`, dissolve `:87-106`). Useful edge cases, but do not port the nesting. In that file "group" in `getActiveGroup` means a slide group, a different concept.
  - `PixelDeck/src/store/slices/selectionSlice.ts:70-93` (MIT) — enter/exit group edit and select-child (the equivalent of alt-click).
- **License note:** MIT, port with attribution. The tag model is already in Chitrapx types; port behaviour and tests, not the nested container.
- **Size:** M

### 9.3 Layout presets

- **What it does:** One-click arrangements for a board: the headline text goes Top, Middle or Bottom; the phone goes Center, Hero, Bleed or Tilt. Applying a preset repositions and resizes existing text and device elements without touching their content.
- **Details:**
  - Text presets: Top, Middle, Bottom. Place the target text element (selected one, else the first `text` element) in a horizontal band with margins as a percentage of board size so it works at every SP8 target size.
  - Phone presets (numbers to be designed, see open questions):
    - Center: device centred, about 80% of board height, upright.
    - Hero: device larger, anchored low so the top of the screen shows, text above it.
    - Bleed: device scaled up and pushed past the bottom edge of the board.
    - Tilt: device rotated about 15 degrees with a slight offset; may also set a device pose (`artboard.ts:190-193` lists poses such as `tilted`).
  - Presets compute in percent of board `size`, then convert to px.
  - Applies to the selected elements; with nothing selected it targets the first text and first device on the board.
  - A preset is a one-shot edit with no persistent "layout" field, so later manual tweaks are never overwritten.
  - Span elements are skipped with a notice.
  - If a locale has detached position or size (`ElementLocaleOverride` detach support, `artboard.ts:370-400`), that locale keeps its own box; warn once.
- **Acceptance criteria:**
  - On a 1290x2796 board, "Text: Top" puts the text box at the configured margin, horizontally centred; "Bottom" mirrors it; "Middle" centres it vertically.
  - Each phone preset yields deterministic position, size and rotation (unit tests on pure `layoutFor(preset, board, element)` with values per target size).
  - Bleed leaves part of the device outside the board and export still renders; Tilt sets a non-zero rotation.
  - One undo step per application; applying the same preset twice is idempotent.
- **Chitrapx today:**
  - Nothing. Elements are placed manually (`LeftPanel.tsx:34-43` builds elements with `base(w,h,ew,eh)` defaults) and `retarget` (`packages/document/src/retarget.ts:5-10`) only letterboxes whole groups; its comment says smarter per-element reflow "belongs to the editor's layout tools".
  - `Inspector.tsx:19` has a `POSES` list for device pose, which Tilt can reuse.
- **Chitrapx changes:**
  - New `packages/document/src/layout.ts`: pure `layoutFor(preset, board, element)` returning `{ position, size, rotation, pose? }`; export from `index.ts` (testable, reusable by the AI pipeline).
  - `commands.ts`: `applyLayoutPreset { groupId, boardId, preset, refs? }`.
  - `Inspector.tsx` board section or new `LayoutPresets.tsx`: button rows for text and phone presets.
  - Tests in `packages/document/test/` and `apps/web/test/`.
- **Reference code:**
  - `app-store-screenshots/skills/app-store-screenshots/template/src/lib/types.ts:18-25` (MIT) — named slide layouts (`hero`, `device-bottom`, `device-top`, `two-devices`, `no-device`, `split-landscape`) as vocabulary; `src/lib/constants.ts:478-495` (`LAYOUT_LABEL`, `LAYOUT_HINT`) for user-facing names. These are slide templates, not element placement math.
  - `PixelDeck/src/assets/mockups/specs.ts:137-139` (MIT) — `computePhoneFitScale` (device fit to 80% of slide height) as the Center sizing rule.
  - `PixelDeck/src/utils/alignLayers.ts` (MIT) — alignment helpers over layer boxes.
  - `PixelDeck/src/types/index.ts:386-387` (MIT) — `verticalAlign: 'top' | 'middle' | 'bottom'` on text: the same vocabulary, but it anchors text inside its box rather than placing the box.
  - `storeshots/app/utils/types.ts:8-14` (AGPL-3.0, ideas only) — a per-slide `variant` selects from `VARIANT_PRESETS`, and an `elements` override replaces the preset composition. Idea: preset = default composition with per-slide override.
  - `open-screenshot-generator/src/lib/device3dPresets.ts` and `src/lib/sizePresets.ts` (MIT) — device pose and size preset tables to compare with Chitrapx's pose list.
- **License note:** MIT sources can be ported with attribution; storeshots is AGPL-3.0, ideas only, copy nothing. The exact Center/Hero/Bleed/Tilt numbers are not defined in any reference repo and must be designed.
- **Size:** M

### 9.4 Apply-to-all

- **What it does:** (a) Copy the selected element's position and zoom to the matching element on every other board in the strip; (b) copy one board's layout to every language while each language keeps its own text.
- **Details:**
  - Boards: for the selected element apply `position`, `size`, `rotation`, `scale` and, for devices, `screenshotRect` zoom/offset to the corresponding element on each other board of the active group. Correspondence is by nth element of the same type, because ids differ per board (`duplicateBoard`, `commands.ts:96-110`).
  - Screenshot zoom and vertical offset is the main appshots use-case: align the crop across all frames.
  - Languages: write the layout props into each locale's override for the board's elements; keep each locale's `content`. Locales with a manually detached position are skipped unless the user confirms overwrite.
  - Never touches text content, fonts, or `origin: "manual"` translations (`commands.ts:134-141`).
  - Confirmation shows how many boards or locales change; one undo step.
  - Disabled when the group has one board or no counterpart exists; missing counterparts are skipped and reported.
- **Acceptance criteria:**
  - Moving a phone on board 1 then "Apply position to all boards" places the nth device on every other board at the same position.
  - Applying screenshot zoom copies `screenshotRect` to the other boards' devices; their `screenshotSrc` is unchanged.
  - "Apply layout to all languages" leaves each locale's `content` intact and sets position/size so the element sits where the base language has it.
  - A manually translated text keeps its content.
  - Undo reverts the whole operation at once.
- **Chitrapx today:**
  - Nothing. Per-language overrides exist (`ElementLocaleOverride`, `artboard.ts:370-400`; `setOverride` / `resetOverride`, `commands.ts:124-141`); `duplicateBoard` already maps element ids by position.
- **Chitrapx changes:**
  - `commands.ts`: `applyToAllBoards { groupId, sourceRef, props }` and `applyLayoutToLocales { groupId, boardId, elementIds?, locales? }`.
  - Pure helper `matchElements(sourceBoard, targetBoard)` in new `packages/document/src/match.ts`, with tests.
  - `Inspector.tsx`: "Apply to all boards" in the element section; "Apply layout to all languages" in the board section when `localization.locales.length > 0`.
  - Confirmation dialog following `ConflictDialog.tsx`.
- **Reference code:**
  - `appshots/src/app/page.tsx:102-114` and `:228-251` (reference only, copy nothing) — `applyToAll` spreads `{ screenshotOffsetY, screenshotZoom }` to every screenshot of every device; look at which two properties it treats as shared.
  - `storeshots/app/composables/useScreenshots.ts:90-125` (AGPL-3.0, ideas only, copy nothing) — `applyLayoutToAllLocales(slideIdx)` grafts a slide's layout onto each other locale while keeping each locale's text, as an explicit opt-in because long translations may need their own placement. Idea: layout copy is opt-in and never touches text.
  - `PixelDeck/src/store/slices/localeLayoutSlice.ts` and `PixelDeck/src/store/localeLayoutInvariants.test.ts` (MIT) — per-locale layout storage and invariants to hold after copying layout between locales.
  - `PixelDeck/src/pages/localization/helpers.ts` (MIT) — helpers for locale layout adjustments.
- **License note:** appshots reference only; storeshots AGPL-3.0 ideas only; write original code. PixelDeck is MIT and may be ported with attribution.
- **Size:** M

### 9.5 Drop files from the OS onto the canvas; import a whole folder

- **What it does:** Drag image files (or a folder) from the desktop onto the canvas to create screenshot-filled devices or image elements; import a folder to create one board per image in natural filename order.
- **Details:**
  - Drop on canvas: each image is uploaded through the existing screenshot pipeline, then placed at the drop point (device with `screenshotSrc`, or a plain `image`).
  - Folders: `DataTransfer.items[].webkitGetAsEntry()` with a depth limit; the "Import folder" button uses `<input webkitdirectory>`.
  - Accept PNG, JPEG, WebP (as `UploadGrid.tsx`), natural sort (`shot2` before `shot10`), ignore dotfiles such as `.DS_Store`.
  - Limits: 25 MB per image (`UploadGrid.tsx` `KINDS.screenshot.max`), a per-drop file cap (OSG uses 20), toast for rejected files.
  - Many images prompt: "Add as elements here" or "Create a board for each".
  - Per-file progress; one failure does not abort the rest.
  - Duplicate detection (same bytes) to avoid re-uploading a capture (OSG does this).
  - Collect dropped entries synchronously in the event turn, because `dataTransfer` is neutered after the handler returns.
  - React only to drags whose `types` include `"Files"`, so internal element drags keep working.
- **Acceptance criteria:**
  - Dropping one PNG creates an element at the drop point and an asset; the element references `asset:<id>`.
  - Dropping a folder of 6 images creates 6 boards in natural order after confirmation.
  - Non-images and oversize files are rejected with a message without blocking valid ones.
  - Dragging an element within the canvas does not show the file-drop overlay.
- **Chitrapx today:**
  - Uploads exist only in the app page grid: `apps/web/src/components/UploadGrid.tsx` (limits `:9-13`; Supabase browser client and `api`). The editor picks from already-uploaded assets (`apps/web/src/editor/ui/fields.tsx:70`). No `onDrop`, `dragover` or folder code in `apps/web/src/editor`.
  - Upload routes live under `apps/web/src/app/api/uploads/`.
- **Chitrapx changes:**
  - New `apps/web/src/editor/intake.ts`: `collectDroppedFiles`, `naturalSort`, `normalizePickedFiles`, directory walk with depth cap (port from OSG).
  - Extract the upload call from `UploadGrid.tsx` into shared `apps/web/src/lib/uploadScreenshot.ts`.
  - `Canvas.tsx`: `onDragOver` (`dropEffect = "copy"` for files) and `onDrop` converting the client point to board coordinates using the zoom and board offsets already in the file.
  - `Toolbar.tsx` or `LeftPanel.tsx`: "Import folder" button.
  - Commands: `addBoardsFromAssets { groupId, assets: { assetId, width, height }[] }`; single drops reuse `addElement`. New `asset:<id>` sources resolve via `assetUrlMap` (`apps/web/src/server/projects.ts:100`).
- **Reference code:**
  - `open-screenshot-generator/src/lib/intake/intakeFiles.ts` (MIT, 219 lines) — `collectDroppedFiles` with directory entries (`:51-100`), `naturalSort` (`:39`), `normalizePickedFiles` (`:110`), `collectPastedFiles` (`:115`), `readIntakeFiles` with dedupe (`:151-212`), `INTAKE_MAX = 20` (`:23`). Header comment (`:5`) explains the drag-a-simulator-folder use case.
  - `open-screenshot-generator/src/components/open-screenshot-generator/CanvasArea.tsx:590-650` (MIT) — canvas `onDrop` for files at a point; why collection must start synchronously (`:599-606`); `dragOver` copy effect (`:647-648`).
  - `PixelDeck/src/components/canvas/stage/useAssetDropTarget.ts` (MIT, 170 lines) — stage drop hook: internal asset drag vs OS file drag (`:111-140`), image filter (`:120`).
  - `PixelDeck/src/components/panels/layers/AssetsSection.tsx:150-160`, `:378` (MIT) — folder import with `webkitdirectory` input fallback.
  - `PixelDeck/src/components/ui/FileUploadButton.tsx` (MIT, 74 lines) — small drop target (`:35`, `:47`).
  - `appshots/src/components/UploadSection.tsx:25-50` (reference only, copy nothing) — react-dropzone usage and the screenshot vs logo target split.
- **License note:** OSG and PixelDeck are MIT; port `intakeFiles.ts` with attribution in `NOTICES.md`. appshots reference only.
- **Size:** M

### 9.6 Version history: browse and restore

- **What it does:** A history dialog lists saved versions (auto-snapshots, export snapshots, named versions) with time and author; the user can preview, restore, or save a named version.
- **Details:**
  - Auto-snapshot already happens every 20th revision (`AUTO_SNAPSHOT_EVERY = 20`, `apps/web/src/server/projects.ts:125`, insert `:147-149`). Exports also snapshot (`apps/web/src/server/jobs.ts:48-55`), which yields a "Before export"-style entry.
  - List shows revision, `label` (null reads "Auto-save"), relative time, creator.
  - Restore never rewinds server history: it first snapshots the current doc as "Before restore", then writes the version's doc as the new current doc through the revision-checked path (new revision).
  - "Save version" takes a label and snapshots the current saved doc (flush unsaved changes first).
  - Preview shows the version read-only before restoring.
  - Workspace scoping via RLS (`packages/db/migrations/0001_rls.sql`, `0002_lock_down_writes.sql`); every function goes through `ctx`.
  - Retention for auto snapshots is an open question.
  - Restore is blocked while the store is `locked` (save conflict).
- **Acceptance criteria:**
  - After 20 saves the list shows an "Auto-save" entry with the right revision.
  - Restoring version V shows V's document, creates a new server revision, and creates a "Before restore" version holding the previous document.
  - A second tab on the old revision gets the normal 409 conflict flow after a restore.
  - A user in another workspace cannot list or read versions (RLS test in `packages/db/test/rls.test.ts`).
  - A named version appears with its label and is exempt from retention pruning.
- **Chitrapx today:**
  - Table `project_versions` (`packages/db/src/schema.ts:89-98`: id, workspaceId, projectId, revision, doc, label, createdBy, createdAt) is written by `saveDoc` and `jobs.ts` and read by `packages/db/src/exportSource.ts:13`, but there is no list/restore path and no UI. Routes under `apps/web/src/app/api/projects/[projectId]/` are `doc`, `export`, `jobs`, `bundle`, `social`, `translate`, `video`, `copy-variants`; none lists versions.
  - Save and conflict handling: `apps/web/src/editor/save.ts`, `ConflictDialog.tsx`. `replaceDoc(doc, revision, dirty)` in `store.ts` loads a document wholesale.
- **Chitrapx changes:**
  - `apps/web/src/server/projects.ts`: `listVersions(ctx, projectId)` (without `doc`), `getVersion`, `saveNamedVersion`, `restoreVersion(ctx, projectId, versionId, currentRevision)` (one transaction: snapshot current, `migrate()` stored doc, update with revision check).
  - New routes `apps/web/src/app/api/projects/[projectId]/versions/route.ts` (GET, POST named) and `.../versions/[versionId]/route.ts` (GET, POST restore).
  - New `apps/web/src/editor/ui/VersionsDialog.tsx`, opened from `Toolbar.tsx`; after restore call `replaceDoc(doc, revision, false)` and clear the IndexedDB buffer (`idb.ts`).
  - Tests next to `apps/web/test/save.test.ts`; RLS test in `packages/db/test/rls.test.ts`.
- **Reference code:**
  - `open-screenshot-generator/src/components/open-screenshot-generator/VersionsPanel.tsx` (MIT, 222 lines) — list UI with name draft ("Version N", `:90`), restore, open-as-copy, delete handlers (`:30-38`), relative time and size labels (`:49-65`).
  - `open-screenshot-generator/src/lib/versions/store.ts` (MIT) — `VersionKind` (`:36`), `saveVersion` (`:88`), `listVersions` returning metadata without the doc (`:69`, `:122`), `readVersion` (`:135`), thinning of auto versions (comment `:17`). Storage there is local IndexedDB; port the model and retention idea only.
  - `open-screenshot-generator/src/components/open-screenshot-generator/HistoryPanel.tsx` (MIT, 136 lines) — a list of undo steps; optional, since Chitrapx session history is `past`/`future` in `store.ts`.
- **License note:** MIT, port with attribution. PixelDeck, appshots and app-store-screenshots have no browsable version history worth citing.
- **Size:** M

### 9.7 Simulated iOS/Android status bar

- **What it does:** A phone device can show a simulated status bar (time, signal, Wi-Fi, battery) in iOS or Android style, light or dark, with transparent or solid background, drawn over the top of the screenshot.
- **Details:**
  - Device options: show (on/off), platform (iOS/Android, default from device type), theme (light/dark), background (transparent/solid + colour), time string.
  - Defaults: "9:41", full battery, full signal.
  - Height and content row come from a per-device spec (Dynamic Island vs classic vs Android punch-hole).
  - Solid background pushes the screenshot down by the bar height; transparent does not.
  - Frameless devices have no status bar option.
  - Rendered by the shared renderer so canvas, preview and export match.
  - Time must match `^\d{1,2}:\d{2}$` so it passes `cssSafe` in `doc.ts`.
- **Acceptance criteria:**
  - Toggling the status bar on an iPhone device draws it over the screenshot in canvas and in exported PNG, identically.
  - iOS style on a Dynamic Island frame leaves the island clear; Android style shows its own icon set.
  - Solid mode offsets the screenshot by the bar height; transparent does not.
  - Theme and colour changes survive save and reload.
  - Frameless device types do not offer the toggle.
- **Chitrapx today:**
  - Nothing: no `statusBar` implementation in `apps/web/src` or `packages`. Device elements carry `notchColor` (`packages/document/src/artboard.ts:220`, `:257`) and a device type list including `android-notch` (`:167`), from the OSG port.
  - Device rendering lives under `packages/renderer/src/osg/elements/`; device props are in `artboard.ts` around `:160-270`; device fields are edited in `Inspector.tsx`.
- **Chitrapx changes:**
  - `artboard.ts`: on device and video-device props add `showStatusBar?`, `statusBarPlatform?`, `statusBarTheme?`, `statusBarBg?`, `statusBarColor?`, `statusBarTime?`. Add `statusBarColor` to `COLOR_KEYS` (`packages/document/src/doc.ts:33`).
  - New renderer component (HTML/SVG, since Chitrapx renders DOM/CSS rather than Konva) under `packages/renderer/src/osg/elements/`, driven by a per-device spec table in new `packages/document/src/deviceStatusBar.ts` (`{ height, contentY, platform }`).
  - `Inspector.tsx` device section controls.
  - Renderer snapshot tests per platform and theme; `docSchema` test for the time allowlist and colour.
- **Reference code:**
  - `PixelDeck/src/components/canvas/PhoneStatusBar.tsx` (MIT, 212 lines) — signal bars (`:28-52`), Wi-Fi, battery, time text, theme and solid-background props (`:5-14`). Konva primitives, so re-express as SVG/HTML.
  - `PixelDeck/src/assets/mockups/specs.ts:19-23`, `:42-46`, `:63-67` (MIT) — per-model `statusBar { height, platform, contentY }` (59 Dynamic Island, 48 Android punch-hole, 44 classic).
  - `PixelDeck/src/components/canvas/PhoneNode.tsx:109-110`, `:221-232` (MIT) — solid mode offsets the screenshot (`sbOffset`); render guard `showStatusBar !== false && height > 0`; prop wiring.
  - `PixelDeck/src/components/properties/PhoneProperties.tsx:111-134`, `:182-205` (MIT) — controls and the reset of status-bar fields when switching to a frameless model.
  - `PixelDeck/src/types/index.ts` (MIT) — `showStatusBar`, `statusBarBg`, `statusBarTheme`, `statusBarColor` on the phone layer.
- **License note:** MIT, port with attribution in `NOTICES.md`. None of OSG, appshots, storeshots or app-store-screenshots draws a status bar (grep hits there are unrelated load-status components).
- **Size:** M

## Data model and API changes

- `packages/document/src/artboard.ts`
  - `BaseElement`: add `locked?: boolean`, `hidden?: boolean` (9.1). `groupId` / `groupName` already exist (9.2).
  - Device and video-device props: add `showStatusBar`, `statusBarPlatform`, `statusBarTheme`, `statusBarBg`, `statusBarColor`, `statusBarTime` (9.7).
- `packages/document/src/doc.ts`: add `statusBarColor` to `COLOR_KEYS`; no `schemaVersion` bump because elements are `.passthrough()` and every new field is optional. Add a test that old documents still pass `migrate`.
- `packages/document/src/`: new pure modules `layout.ts` (9.3), `match.ts` (9.4), `deviceStatusBar.ts` (9.7); re-export from `index.ts`.
- `apps/web/src/editor/commands.ts`: new commands `reorderElementTo`, `setElementsLocked`, `setElementsHidden`, `groupElements`, `ungroupElements`, `renameGroup`, `applyLayoutPreset`, `applyToAllBoards`, `applyLayoutToLocales`, `addBoardsFromAssets`; update `duplicateElements` to remap `groupId`.
- `packages/renderer`: honour `hidden`, render the status bar.
- API (new): `GET/POST /api/projects/[projectId]/versions`, `GET/POST /api/projects/[projectId]/versions/[versionId]` (get, restore). Server functions in `apps/web/src/server/projects.ts`.
- DB: no new table. Optional index on `project_versions (project_id, created_at)` and a documented `label` convention (auto, export, before-restore, named). Retention by prune-on-insert for auto versions (see open questions).
- Dependencies: `@dnd-kit/core` and `@dnd-kit/sortable` in `apps/web` (as PixelDeck uses).
- `NOTICES.md` (Chitrapx root): add entries for every ported MIT file from open-screenshot-generator and PixelDeck.

## Open questions

- Board background as a layer: Chitrapx stores it as `backgroundColor` / background image fields on the board (`doc.ts` `board` schema), not as an element. Is the "background always at bottom" row display-only (recommended), and should it get a visibility toggle?
- Should `hidden` and `locked` live on the base element (proposed) or only in editor view state? Base-level means hidden elements are also dropped from export; confirm that is desired.
- Preset numbers: Center, Hero, Bleed and Tilt have no definitive reference implementation in the cloned repos. Design and approve scale, anchor and rotation against real boards before building; should they differ per target class (phone vs tablet)?
- With nothing selected, do presets apply to the first text/device only or to every text/device on the board?
- Apply-to-all matching: is nth-of-type correspondence acceptable, or should template elements carry a stable `slot` id?
- Version retention: how many auto snapshots per project, and are there plan limits? Which roles may restore?
- Restore semantics: restore into the live project (proposed) versus "open as a copy" like OSG's `onOpenCopy` (`VersionsPanel.tsx:37`). Offer both?
- Folder import: one board per image into the active group (proposed), or a new group per target size? Per-drop cap (OSG: 20) and workspace storage quota interaction?
- Status bar: are time and battery editable, and do we ship Android punch-hole and gesture-bar variants in v1, or iOS plus one Android style?
- Should lock, hide or status-bar settings ever vary per language? Proposed no, except the existing per-locale `hidden` override.

## Suggested build order

1. 9.1 Layers panel foundation: `locked` / `hidden` fields, renderer skip for hidden, canvas lock handling, `reorderElementTo`, `LayersPanel.tsx`. Everything else builds on a layers list and these fields.
2. 9.2 Grouping: commands, selection expansion, `duplicateElements` fix, group rows in the panel (the data model is already in place).
3. 9.6 Version history: independent of canvas work, server-heavy, and gives users a safety net before bulk-edit features land.
4. 9.4 Apply-to-all: commands plus a small inspector section; introduces `match.ts`.
5. 9.3 Layout presets: pure `layout.ts` plus one command; needs design sign-off on numbers (prepare in parallel with 9.2).
6. 9.5 Drop and folder import: shared upload extraction, `intake.ts`, canvas drop, `addBoardsFromAssets`.
7. 9.7 Status bar: renderer and device fields; last because it touches renderer output and export goldens and blocks nothing else.
