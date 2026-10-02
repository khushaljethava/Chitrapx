# Sub-project 3: Editor

**Date:** 2026-10-02
**Status:** Derived from the approved architecture (main spec, section A9); built on the user's instruction "build next".
**Parent spec:** `2026-10-02-chitrapx-design.md`

## Goal

A customer opens a project and changes anything on any board: text, fonts, colours, positions, devices, screenshots, backgrounds, board order, languages, and the store size. Every change is undoable, saved automatically, never lost on a flaky connection, and never silently overwrites another tab.

## Decisions

1. **State:** one Zustand store per open project (`apps/web/src/editor/store.ts`). The document changes only through `apply(command)`, a pure function over `ChitrapxDoc` run with Immer `produceWithPatches`; undo and redo replay inverse patches (history capped at 200 steps).
2. **Addressing:** an element is `{ groupId, boardId | null, elementId }`; `boardId: null` means a span element in strip coordinates.
3. **Canvas:** the active group's boards side by side, rendered with the same `StaticArtboard` as export (so the canvas cannot drift from the ZIP), under an interaction overlay with one rotated hit box per element. Select, multi-select (shift), drag to move, 8 resize handles (shift keeps aspect ratio; devices and images always keep it), rotate handle (shift snaps to 15 degrees). Snapping to board edges and centres and to other elements' edges and centres within 6 screen pixels, with guide lines. Zoom with ctrl/cmd + wheel or buttons; scroll pans. Pointer events only, so pens and touch work.
4. **Text editing:** double-click a text element focuses its content field in the inspector (inline on-canvas editing comes later).
5. **Inspector:** board (name, solid or gradient background) or element fields by type: text (content, family, size, weight, italic, colour, alignment, line height, letter spacing), shape (fill, stroke, radius, opacity), device (model, 2D or 3D style and pose, frame colour, screenshot from the app's uploads, fit), image (picture from the app's uploads, fit, radius), and common fields (x, y, w, h, rotation, opacity).
6. **Languages:** locale tabs. On a non-base locale, text content and font family edits and device screenshots write that locale's override; every overridden field shows a "reset to base" control. Adding a language picks from the ported OSG locale list.
7. **Boards and sizes:** add a blank board, duplicate, delete, reorder. "Add size" copies the active group into another store target using `retarget`.
8. **Saving:** `PUT /api/projects/[id]/doc` with `{ doc, revision }`; the server validates with `migrate`, caps the body at 5 MB, and updates only if the revision matches (409 returns the current revision). Every 20th revision is copied into `project_versions`. The client saves 1.5 s after the last change, buffers unsaved documents in IndexedDB keyed by project, restores a newer local buffer on load, and on 409 offers "Load theirs" or "Keep mine" (re-save on the server's revision).
9. **Keyboard:** Delete/Backspace, cmd/ctrl+Z, shift+cmd/ctrl+Z, cmd/ctrl+D duplicate, arrows nudge 1 px (shift: 10), cmd/ctrl+A select all on the board, Escape clears; ignored while typing in a field.

## Units

| Unit | Responsibility |
|---|---|
| `apps/web/src/editor/commands.ts` | pure document commands (the only document mutations) |
| `apps/web/src/editor/store.ts` | Zustand store: doc, selection, active group/locale, zoom, history, apply/undo/redo |
| `apps/web/src/editor/geometry.ts` | hit boxes, resize/rotate math, snapping |
| `apps/web/src/editor/save.ts` | autosave, IndexedDB buffer, conflict state |
| `apps/web/src/editor/ui/*` | Canvas, Overlay, Inspector, BoardsPanel, Palette, Toolbar, LocaleTabs |
| `apps/web/src/server/projects.ts` | `saveDoc` with optimistic concurrency and snapshots |

## Acceptance criteria

- Every command in `commands.ts` has a unit test, and undo after any command restores the previous document exactly.
- Moving, resizing and rotating with the mouse changes the element as dragged; snapping engages within 6 screen pixels of a board centre line.
- Editing German text on a project with `de-DE` writes an override and leaves English unchanged; "reset to base" removes the override.
- Two tabs editing the same project: the second save gets 409 and the conflict dialog; nothing is overwritten silently.
- Reloading after editing offline restores the unsaved document from IndexedDB.
- Export after editing renders the edited document.
