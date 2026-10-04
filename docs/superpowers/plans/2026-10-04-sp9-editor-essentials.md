# Sub-project 9: Editor Essentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layers panel (reorder, lock, hide, rename), element grouping, layout presets, apply-to-all, file drop and folder import, version history with restore, and a simulated status bar.

**Architecture:** New element fields are optional, so documents need no schema bump. Pure logic lives in `packages/document` (`layout.ts`, `match.ts`, `deviceStatusBar.ts`) and `apps/web/src/editor` (`selection.ts`, `intake.ts`, `layersOrder.ts`). Every edit is one editor command in `commands.ts`, so it is one undo step. Version history is a new server module (`apps/web/src/server/versions.ts`) plus one migration adding `project_versions.kind`.

**Tech Stack:** TypeScript, Next.js (apps/web), React, Zustand + Immer editor store, `@dnd-kit/core` + `@dnd-kit/sortable`, Drizzle + Postgres, Playwright worker (e2e goldens), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-04-sp9-editor-essentials-design.md` (feature research and reference code: `docs/roadmap/sp09-editor-essentials.md`)

## Global Constraints

- No document `schemaVersion` bump. Every new element field is optional; documents saved before SP9 must pass `migrate` unchanged.
- Every editor change is exactly one `apply(command)`, so it is one undo step. Commands that would change nothing must return the same document, which adds no undo step.
- `locked` and `hidden` are document properties and are not per language. Hidden elements are not rendered on the canvas or in exports.
- Grouping is a tag (`groupId`, `groupName`), never nesting. Membership resolves within one list (one board, or the span list). Commands name the tag `elementGroupId` to avoid clashing with the board group's `groupId`.
- Layout preset values (percent of board): text width 88%, margin 6%. Phone heights: center 80%, hero 85% (top 28%), bleed 95% (top 40%), tilt 72% (top 18%, +4% x, −12°). Device width is capped at 90% of the board.
- Apply-to-all matching is the nth element of the same type.
- Version retention: keep the newest 50 versions of kinds `auto | export | restore` per project. Never prune `named` versions, or a version referenced by a queued or running job (`jobs.input->>'versionId'`).
- Folder or drop intake: PNG, JPEG and WebP only; skip dotfiles; natural sort; at most 20 files per drop; 25 MB per image.
- `statusBarTime` must match `^\d{1,2}:\d{2}$`; `statusBarColor` is a colour key.
- The status bar is drawn only on `device` elements that are not 3D, and only for device types with a spec (iPhones 15, 15 Pro, 17 Pro Max: iOS 6.9% of screen height; android-punch-hole, android-notch, android-bar: Android 5.9%).
- Ported MIT code (PixelDeck, open-screenshot-generator) gets a `NOTICES.md` entry. appshots and storeshots: ideas only, copy nothing.
- Known pre-existing typecheck error: `apps/web/src/server/billing.ts:61` (TS2339, also on main). The gate is "no new errors".

## Review Focus

1. **Locked element stays locked.** A locked element that is also in a group must not move when another member is dragged. `expandToGroups` skips locked members; pinned in Task 2.
2. **Duplicating one member of a group** must not add the copy to the original group (two groups would share an id). The single-member dissolve after `duplicateElements` handles it; pinned in Task 2.
3. **Restoring while the project changed elsewhere** (stale revision) must 409 and change nothing, with no "Before restore" row left behind. The transaction checks before inserting; pinned in Task 7.
4. **Dropped files that aren't images** (e.g. a .txt or .mov in a folder) must be reported and skipped, never uploaded. Pinned in Task 9 `acceptImages` tests.
5. **Pruning must never delete the version a running export reads.** Pinned in Task 7.

## File Structure

| File | Responsibility |
|---|---|
| `packages/document/src/artboard.ts` (modify) | `locked`, `hidden`, status bar fields |
| `packages/document/src/doc.ts` (modify) | `statusBarColor` colour key, `statusBarTime` format |
| `packages/document/src/layout.ts` (create) | `layoutFor`, preset table |
| `packages/document/src/match.ts` (create) | `matchElements`, `LAYOUT_KEYS` |
| `packages/document/src/deviceStatusBar.ts` (create) | `statusBarSpec` |
| `packages/renderer/src/board.ts` (modify) | skip hidden elements |
| `packages/renderer/src/osg/elements/StatusBar.tsx` (create) | status bar drawing |
| `packages/renderer/src/osg/elements/DeviceFrameElement.tsx` (modify) | mount status bar, solid offset |
| `apps/web/src/editor/commands.ts` (modify) | new commands, `elementsOf`, single-member dissolve |
| `apps/web/src/editor/selection.ts` (create) | `expandToGroups`, `selectableRefs` |
| `apps/web/src/editor/layersOrder.ts` (create) | panel position → array index |
| `apps/web/src/editor/intake.ts` (create) | `acceptImages`, `naturalSort`, `collectDroppedFiles`, `isFileDrag` |
| `apps/web/src/editor/assets.tsx` (create) | editor assets context (asset list, URL map, refresh) |
| `apps/web/src/editor/useIntake.ts` (create) | upload + place dropped or picked files |
| `apps/web/src/editor/ui/LayersPanel.tsx` (create) | layers panel |
| `apps/web/src/editor/ui/LayoutPresets.tsx` (create) | preset buttons |
| `apps/web/src/editor/ui/ApplyToAll.tsx` (create) | apply-to-all buttons with inline confirm |
| `apps/web/src/editor/ui/VersionsDialog.tsx` (create) | version history dialog |
| `apps/web/src/editor/ui/Canvas.tsx`, `shortcuts.ts`, `LeftPanel.tsx`, `Inspector.tsx`, `Toolbar.tsx`, `Editor.tsx`, `save.ts` (modify) | wiring |
| `apps/web/src/lib/uploadAsset.ts` (create) | shared upload (sign → upload → complete) |
| `apps/web/src/components/UploadGrid.tsx` (modify) | use `uploadAsset` |
| `apps/web/src/server/versions.ts` (create) | list, get, named save, restore, prune |
| `apps/web/src/server/projects.ts`, `jobs.ts` (modify) | prune after snapshots, `kind` on export versions |
| `apps/web/src/app/api/projects/[projectId]/versions/**` (create) | routes |
| `packages/db/src/schema.ts` + new migration (modify / create) | `project_versions.kind`, index |

---

### Task 1: Document fields and hidden rendering

**Files:**
- Modify: `packages/document/src/artboard.ts` (`BaseElement`, `DeviceFrameElementProps`)
- Modify: `packages/document/src/doc.ts:33` (`COLOR_KEYS`), `:58-63` (`element` schema)
- Modify: `packages/renderer/src/board.ts`
- Test: `packages/document/test/sp9-fields.test.ts` (create), `packages/renderer/test/hidden.test.ts` (create)

**Interfaces:**
- Produces:
  - `BaseElement.locked?: boolean` and `BaseElement.hidden?: boolean`.
  - `DeviceFrameElementProps`: `showStatusBar?: boolean`, `statusBarPlatform?: "ios" | "android"`, `statusBarTheme?: "light" | "dark"`, `statusBarBg?: "transparent" | "solid"`, `statusBarColor?: string`, `statusBarTime?: string`.
  - `boardFor` never returns hidden elements.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/document/test/sp9-fields.test.ts
import { describe, expect, it } from "vitest";
import { migrate } from "../src/index.ts";
import { board, device, doc, group, text } from "./fixtures.ts";

describe("SP9 element fields", () => {
  it("documents saved before SP9 pass migrate unchanged", () => {
    const d = doc([group([board("b1", [text("t", 0, 0), device("d", 100)])])]);
    expect(migrate(JSON.parse(JSON.stringify(d)))).toEqual(migrate(d));
  });

  it("keeps locked, hidden and status bar fields", () => {
    const el = { ...device("d", 0), locked: true, hidden: true, showStatusBar: true, statusBarPlatform: "ios", statusBarTheme: "dark", statusBarBg: "solid", statusBarColor: "#112233", statusBarTime: "9:41" };
    const out = migrate(doc([group([board("b1", [el as never])])]));
    expect(out.groups[0]!.boards[0]!.elements[0]).toMatchObject({ locked: true, hidden: true, statusBarTime: "9:41", statusBarColor: "#112233" });
  });

  it("rejects a status bar time that is not like 9:41", () => {
    for (const bad of ["9.41", "941", "9:4", "url(x)"]) {
      expect(() => migrate(doc([group([board("b1", [{ ...device("d", 0), statusBarTime: bad } as never])])]))).toThrow();
    }
    expect(() => migrate(doc([group([board("b1", [{ ...device("d", 0), statusBarTime: "12:05" } as never])])]))).not.toThrow();
  });

  it("validates statusBarColor as a colour", () => {
    expect(() => migrate(doc([group([board("b1", [{ ...device("d", 0), statusBarColor: "red), url(http://x/)" } as never])])]))).toThrow();
  });
});
```

```ts
// packages/renderer/test/hidden.test.ts
import { describe, expect, it } from "vitest";
import type { ChitrapxDoc } from "@chitrapx/document";
import { boardFor } from "../src/board.ts";

const el = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, type: "shape", shapeType: "rectangle", fillColor: "#000", strokeColor: "#000", strokeWidth: 0, position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, rotation: 0, scale: 1, ...extra });

describe("hidden elements", () => {
  it("are not part of the rendered board, on boards or in span elements", () => {
    const doc = {
      schemaVersion: 1, kind: "screenshots", localization: { baseLocale: "en-US", locales: [] },
      groups: [{ id: "g", target: "iphone-6.9", spanElements: [el("s", { hidden: true })],
        boards: [{ id: "b", name: "b", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "#fff", zoom: 1, elements: [el("a"), el("h", { hidden: true })] }] }],
    } as unknown as ChitrapxDoc;
    expect(boardFor(doc, "g", 0, null, (s) => s).board.elements.map((e) => e.id)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @chitrapx/document exec vitest run test/sp9-fields.test.ts && pnpm --filter @chitrapx/renderer exec vitest run test/hidden.test.ts`
Expected: FAIL. The time format is accepted and the hidden element is rendered.

- [ ] **Step 3: Implement**

In `packages/document/src/artboard.ts`, add to `BaseElement` (after `groupName`):

```ts
  // SP9 Layers panel. Locked: drawn, but the canvas ignores it (select it from
  // the Layers panel to unlock). Hidden: not drawn at all, on the canvas or in
  // exports. Neither varies per language; the per-locale `hidden` override in
  // ElementLocaleOverride is separate and still applies.
  locked?: boolean;
  hidden?: boolean;
```

In `DeviceFrameElementProps` (after `notchColor`):

```ts
  // SP9 simulated status bar, drawn over the top of the screen (2D frames only).
  showStatusBar?: boolean;
  statusBarPlatform?: 'ios' | 'android';
  statusBarTheme?: 'light' | 'dark'; // 'dark' = dark text and icons, for light screenshots
  statusBarBg?: 'transparent' | 'solid'; // solid fills with statusBarColor and pushes the screenshot down
  statusBarColor?: string;
  statusBarTime?: string; // like "9:41"
```

In `packages/document/src/doc.ts`:
- Add `"statusBarColor"` to the `COLOR_KEYS` set.
- Change the `element` schema to:

```ts
const element = z.object({
  id: z.string().min(1),
  type: z.enum(["text", "shape", "device", "image", "video", "video-device", "gesture", "audio"]),
  position: point,
  size,
  statusBarTime: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
}).passthrough();
```

In `packages/renderer/src/board.ts`, replace the return line of `boardFor` with:

```ts
  // SP9: hidden elements are not drawn anywhere (canvas, preview, export).
  const elements = [...span, ...board.elements].filter((el) => !el.hidden);
  return { board: resolveBoardSources({ ...board, elements }, resolveSrc, missing), missing: [...missing] };
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @chitrapx/document test && pnpm --filter @chitrapx/renderer test && pnpm typecheck`
Expected: PASS (only the known `billing.ts:61` typecheck error).

- [ ] **Step 5: Commit**

```bash
git add packages/document packages/renderer
git commit -m "feat(document): locked, hidden and status bar fields; hidden elements are not rendered"
```

---

### Task 2: Layer and group commands, selection helpers

**Files:**
- Modify: `apps/web/src/editor/commands.ts`
- Create: `apps/web/src/editor/selection.ts`
- Test: `apps/web/test/commands.test.ts` (append), `apps/web/test/selection.test.ts` (create)

**Interfaces:**
- Consumes: `locked`, `hidden`, `groupId`, `groupName` on elements (Task 1).
- Produces (all in `commands.ts`):

  | Export | Shape |
  |---|---|
  | `elementsOf` | `(doc, groupId, boardId \| null) => ArtboardElement[] \| undefined` |
  | `reorderElementTo` | `{ ref, toIndex, elementGroupId?: string \| null }` |
  | `setElementsLocked` | `{ refs, locked }` |
  | `setElementsHidden` | `{ refs, hidden }` |
  | `groupElements` | `{ refs, elementGroupId, name? }` |
  | `ungroupElements` | `{ refs }` |
  | `renameGroup` | `{ groupId, boardId \| null, elementGroupId, name }` |

  - **`reorderElementTo.elementGroupId`:** `undefined` keeps the element's group; `null` leaves it; a string joins that group and copies its `groupName`.
  - **`duplicateElements`:** copies of a group get the id `${groupId}-${newIds[0]}`. A copy left alone in its group is dissolved.
- Produces (in `selection.ts`): `expandToGroups(doc, refs, { single? }): Ref[]` and `selectableRefs(doc, refs): Ref[]`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/test/commands.test.ts` (it already has `el`, `board`, `doc`, `r`, `ids`):

```ts
describe("layers and groups", () => {
  const groupOf = (d: ChitrapxDoc, id: string) => (findElement(d, r(id)) as { groupId?: string; groupName?: string });

  it("reorderElementTo moves to an index and clamps", () => {
    expect(ids(applyCommand(doc(), { type: "reorderElementTo", ref: r("a"), toIndex: 2 }))).toEqual(["b", "c", "a"]);
    expect(ids(applyCommand(doc(), { type: "reorderElementTo", ref: r("c"), toIndex: -5 }))).toEqual(["c", "a", "b"]);
  });

  it("locks and hides several elements at once, and clears the flags", () => {
    let d = applyCommand(doc(), { type: "setElementsLocked", refs: [r("a"), r("b")], locked: true });
    expect([findElement(d, r("a")), findElement(d, r("b"))].map((e) => (e as { locked?: boolean }).locked)).toEqual([true, true]);
    d = applyCommand(d, { type: "setElementsLocked", refs: [r("a")], locked: false });
    expect("locked" in findElement(d, r("a"))!).toBe(false);
    d = applyCommand(d, { type: "setElementsHidden", refs: [r("c")], hidden: true });
    expect((findElement(d, r("c")) as { hidden?: boolean }).hidden).toBe(true);
  });

  it("groups two or more elements of one list, adjacent at the top-most member", () => {
    const d = applyCommand(doc(), { type: "groupElements", refs: [r("a"), r("c")], elementGroupId: "G", name: "Hero" });
    expect(ids(d)).toEqual(["b", "a", "c"]);
    expect(groupOf(d, "a")).toMatchObject({ groupId: "G", groupName: "Hero" });
    expect(groupOf(d, "c")).toMatchObject({ groupId: "G", groupName: "Hero" });
  });

  it("refuses fewer than two elements or elements from different lists", () => {
    const d = doc();
    expect(applyCommand(d, { type: "groupElements", refs: [r("a")], elementGroupId: "G" })).toBe(d);
    expect(applyCommand(d, { type: "groupElements", refs: [r("a"), r("d", "b2")], elementGroupId: "G" })).toBe(d);
  });

  it("ungroups, renames, and dissolves a group left with one member", () => {
    let d = applyCommand(doc(), { type: "groupElements", refs: [r("a"), r("b"), r("c")], elementGroupId: "G" });
    d = applyCommand(d, { type: "renameGroup", groupId: "g", boardId: "b1", elementGroupId: "G", name: "Cards" });
    expect(groupOf(d, "b").groupName).toBe("Cards");
    d = applyCommand(d, { type: "ungroupElements", refs: [r("a"), r("b")] });
    expect(groupOf(d, "a").groupId).toBeUndefined();
    expect(groupOf(d, "c").groupId).toBeUndefined(); // last member alone: dissolved
  });

  it("deleting all but one member dissolves the group", () => {
    let d = applyCommand(doc(), { type: "groupElements", refs: [r("a"), r("b")], elementGroupId: "G" });
    d = applyCommand(d, { type: "deleteElements", refs: [r("a")] });
    expect(groupOf(d, "b").groupId).toBeUndefined();
  });

  it("reorderElementTo can join or leave a group in the same step", () => {
    let d = applyCommand(doc(), { type: "groupElements", refs: [r("b"), r("c")], elementGroupId: "G", name: "Pair" });
    d = applyCommand(d, { type: "reorderElementTo", ref: r("a"), toIndex: 2, elementGroupId: "G" });
    expect(groupOf(d, "a")).toMatchObject({ groupId: "G", groupName: "Pair" });
    d = applyCommand(d, { type: "reorderElementTo", ref: r("a"), toIndex: 0, elementGroupId: null });
    expect(groupOf(d, "a").groupId).toBeUndefined();
  });

  it("duplicating a group makes a new group; duplicating one member makes an ungrouped copy", () => {
    let d = applyCommand(doc(), { type: "groupElements", refs: [r("a"), r("b")], elementGroupId: "G" });
    const both = applyCommand(d, { type: "duplicateElements", refs: [r("a"), r("b")], newIds: ["a2", "b2"], offset: 10 });
    expect(groupOf(both, "a2").groupId).toBe("G-a2");
    expect(groupOf(both, "b2").groupId).toBe("G-a2");
    expect(groupOf(both, "a").groupId).toBe("G");
    d = applyCommand(d, { type: "duplicateElements", refs: [r("a")], newIds: ["a3"], offset: 10 });
    expect(groupOf(d, "a3").groupId).toBeUndefined();
    expect(groupOf(d, "a").groupId).toBe("G");
  });
});
```

```ts
// apps/web/test/selection.test.ts
import { describe, expect, it } from "vitest";
import type { ArtboardElement, ChitrapxDoc } from "@chitrapx/document";
import type { Ref } from "@/editor/commands.ts";
import { expandToGroups, selectableRefs } from "@/editor/selection.ts";

const el = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, type: "text", position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, rotation: 0, scale: 1, content: id, fontSize: 10, fontFamily: "Inter", color: "#000", ...extra }) as unknown as ArtboardElement;
const doc = {
  schemaVersion: 1, kind: "screenshots", localization: { baseLocale: "en-US", locales: [] },
  groups: [{ id: "g", target: "iphone-6.9", spanElements: [], boards: [{ id: "b", name: "b", position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, backgroundColor: "#fff", zoom: 1,
    elements: [el("a", { groupId: "G" }), el("b", { groupId: "G" }), el("c", { groupId: "G", locked: true }), el("d"), el("h", { hidden: true })] }] }],
} as unknown as ChitrapxDoc;
const r = (elementId: string): Ref => ({ groupId: "g", boardId: "b", elementId });

describe("selection", () => {
  it("a click on a member selects its unlocked group members", () => {
    expect(expandToGroups(doc, [r("a")]).map((x) => x.elementId)).toEqual(["a", "b"]);
  });
  it("alt-click (single) selects only the clicked element", () => {
    expect(expandToGroups(doc, [r("b")], { single: true }).map((x) => x.elementId)).toEqual(["b"]);
  });
  it("ungrouped elements select alone, without duplicates", () => {
    expect(expandToGroups(doc, [r("d"), r("d")]).map((x) => x.elementId)).toEqual(["d"]);
  });
  it("selectableRefs drops locked, hidden and missing elements", () => {
    expect(selectableRefs(doc, [r("a"), r("c"), r("h"), r("zz")]).map((x) => x.elementId)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @chitrapx/web exec vitest run test/commands.test.ts test/selection.test.ts`
Expected: FAIL (unknown command types; `selection.ts` missing).

- [ ] **Step 3: Implement in `commands.ts`**

Add to the `Command` union:

```ts
  | { type: "reorderElementTo"; ref: Ref; toIndex: number; elementGroupId?: string | null }
  | { type: "setElementsLocked"; refs: Ref[]; locked: boolean }
  | { type: "setElementsHidden"; refs: Ref[]; hidden: boolean }
  | { type: "groupElements"; refs: Ref[]; elementGroupId: string; name?: string }
  | { type: "ungroupElements"; refs: Ref[] }
  | { type: "renameGroup"; groupId: string; boardId: string | null; elementGroupId: string; name: string }
```

Below the private `list` helper, add:

```ts
/** The element list a ref points into: a board's elements, or the group's span elements when `boardId` is null. */
export const elementsOf = (d: ChitrapxDoc, groupId: string, boardId: string | null): ArtboardElement[] | undefined => list(d, groupId, boardId);

/** A group tag with one member left in its list is meaningless: clear it. */
function dissolveSingletons(els: Array<{ groupId?: string; groupName?: string }>) {
  const counts = new Map<string, number>();
  for (const e of els) if (e.groupId) counts.set(e.groupId, (counts.get(e.groupId) ?? 0) + 1);
  for (const e of els) if (e.groupId && counts.get(e.groupId) === 1) { delete e.groupId; delete e.groupName; }
}
```

Replace the `deleteElements` case:

```ts
      case "deleteElements":
        for (const ref of cmd.refs) {
          const els = list(d, ref.groupId, ref.boardId);
          const i = els?.findIndex((e) => e.id === ref.elementId) ?? -1;
          if (els && i >= 0) { els.splice(i, 1); dissolveSingletons(els); }
        }
        return;
```

In `duplicateElements`, after the line that builds `copy`, add:

```ts
          // Copies of a group form their own group; one copied member alone is dissolved below.
          if (src.groupId) copy.groupId = `${src.groupId}-${cmd.newIds[0]}`;
```

After that case's `forEach` (before its `return;`):

```ts
        for (const ref of cmd.refs) { const els = list(d, ref.groupId, ref.boardId); if (els) dissolveSingletons(els); }
```

Add new cases:

```ts
      case "reorderElementTo": {
        const els = list(d, cmd.ref.groupId, cmd.ref.boardId);
        const i = els?.findIndex((e) => e.id === cmd.ref.elementId) ?? -1;
        if (!els || i < 0) return;
        const [el] = els.splice(i, 1);
        els.splice(Math.max(0, Math.min(els.length, cmd.toIndex)), 0, el!);
        if (cmd.elementGroupId === null) { delete el!.groupId; delete el!.groupName; }
        else if (cmd.elementGroupId) {
          const name = els.find((e) => e !== el && e.groupId === cmd.elementGroupId)?.groupName;
          el!.groupId = cmd.elementGroupId;
          if (name) el!.groupName = name; else delete el!.groupName;
        }
        dissolveSingletons(els);
        return;
      }
      case "setElementsLocked":
      case "setElementsHidden": {
        const key = cmd.type === "setElementsLocked" ? "locked" : "hidden";
        const on = cmd.type === "setElementsLocked" ? cmd.locked : cmd.hidden;
        for (const ref of cmd.refs) {
          const el = list(d, ref.groupId, ref.boardId)?.find((e) => e.id === ref.elementId) as Record<string, unknown> | undefined;
          if (!el) continue;
          if (on) el[key] = true; else delete el[key];
        }
        return;
      }
      case "groupElements": {
        const first = cmd.refs[0];
        if (!first || cmd.refs.some((x) => x.groupId !== first.groupId || x.boardId !== first.boardId)) return;
        const els = list(d, first.groupId, first.boardId);
        if (!els) return;
        const wanted = new Set(cmd.refs.map((x) => x.elementId));
        const members = els.filter((e) => wanted.has(e.id));
        if (members.length < 2) return;
        const top = Math.max(...members.map((m) => els.indexOf(m)));
        const next: typeof els = [];
        els.forEach((e, i) => { if (!wanted.has(e.id)) next.push(e); if (i === top) next.push(...members); });
        for (const m of members) { m.groupId = cmd.elementGroupId; if (cmd.name) m.groupName = cmd.name; else delete m.groupName; }
        els.splice(0, els.length, ...next);
        dissolveSingletons(els);
        return;
      }
      case "ungroupElements":
        for (const ref of cmd.refs) {
          const els = list(d, ref.groupId, ref.boardId);
          const el = els?.find((e) => e.id === ref.elementId);
          if (el) { delete el.groupId; delete el.groupName; }
          if (els) dissolveSingletons(els);
        }
        return;
      case "renameGroup":
        for (const e of list(d, cmd.groupId, cmd.boardId) ?? []) {
          if (e.groupId !== cmd.elementGroupId) continue;
          if (cmd.name.trim()) e.groupName = cmd.name.trim(); else delete e.groupName;
        }
        return;
```

Immer returns the original document when a draft is not modified, so the early `return`s keep the "no undo step" rule.

- [ ] **Step 4: Implement `apps/web/src/editor/selection.ts`**

```ts
import type { ChitrapxDoc } from "@chitrapx/document";
import { elementsOf, findElement, type Ref } from "./commands.ts";

const key = (r: Ref) => `${r.groupId}|${r.boardId}|${r.elementId}`;
function unique(refs: Ref[]): Ref[] {
  const seen = new Set<string>();
  return refs.filter((r) => (seen.has(key(r)) ? false : (seen.add(key(r)), true)));
}

/**
 * What a canvas click on `refs` selects: each clicked element plus the unlocked members of its
 * element group in the same list. `single` (alt-click) selects only what was clicked.
 */
export function expandToGroups(doc: ChitrapxDoc, refs: Ref[], opts: { single?: boolean } = {}): Ref[] {
  if (opts.single) return unique(refs);
  const out: Ref[] = [];
  for (const r of refs) {
    const els = elementsOf(doc, r.groupId, r.boardId);
    const el = els?.find((e) => e.id === r.elementId);
    if (!els || !el?.groupId) { out.push(r); continue; }
    for (const m of els) if (m.groupId === el.groupId && (!m.locked || m.id === el.id)) out.push({ ...r, elementId: m.id });
  }
  return unique(out);
}

/** Refs the canvas and keyboard may act on: existing, not locked, not hidden. */
export function selectableRefs(doc: ChitrapxDoc, refs: Ref[]): Ref[] {
  return refs.filter((r) => { const el = findElement(doc, r); return !!el && !el.locked && !el.hidden; });
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @chitrapx/web exec vitest run test/commands.test.ts test/selection.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/editor apps/web/test
git commit -m "feat(editor): layer and group commands with single-member dissolve; selection helpers"
```

---

### Task 3: Canvas and keyboard honour locks, hiding and groups

**Files:**
- Modify: `apps/web/src/editor/ui/Canvas.tsx`, `apps/web/src/editor/shortcuts.ts`

**Interfaces:**
- Consumes: `expandToGroups`, `selectableRefs`, `groupElements`, `ungroupElements` (Task 2).
- Produces: `hittable` (visible, unlocked canvas items) inside `Canvas`, used again by Task 10's drop handler.

- [ ] **Step 1: Canvas**

In `Canvas.tsx`, import `expandToGroups` from `../selection.ts`. Replace the `items` constant with:

```ts
  const items: Array<{ ref: Ref; el: ArtboardElement; offset: number }> = [
    ...group.spanElements.map((el) => ({ ref: { groupId, boardId: null, elementId: el.id }, el, offset: 0 })),
    ...group.boards.flatMap((b, i) => b.elements.map((el) => ({ ref: { groupId, boardId: b.id, elementId: el.id }, el, offset: i * boardW }))),
  ].filter((it) => !it.el.hidden);
  /** Locked elements are drawn but the pointer passes through them. */
  const hittable = items.filter((it) => !it.el.locked);
```

Replace the selection logic at the top of `startMove` (from `const s = store.getState();` through `s.select(next);`):

```ts
    const s = store.getState();
    const picked = expandToGroups(s.doc, [ref], { single: e.altKey });
    const has = (x: Ref) => s.selection.some((r) => sameRef(r, x));
    const already = picked.every(has);
    const next = e.shiftKey
      ? (already ? s.selection.filter((r) => !picked.some((p) => sameRef(p, r))) : [...s.selection, ...picked.filter((p) => !has(p))])
      : already ? s.selection : picked;
    s.select(next);
```

Keep the rest of `startMove`, but build its `others` (snap targets) from `hittable` instead of `items`.
- Render the hit-box list from `hittable`: the `{items.map(({ ref, el, offset }) => ...` block becomes `{hittable.map(...`.
- Keep `single` looked up in `items`, so a locked element selected from the Layers panel shows its outline.
- Make the first line of both `startResize` and `startRotate` `if (!single || single.el.locked) return;` (after `e.stopPropagation();`).

- [ ] **Step 2: Shortcuts**

In `shortcuts.ts`, import `selectableRefs` from `./selection.ts`. Select-all selects only unlocked, visible elements:

```ts
        if (b) s.select(b.elements.filter((el) => !el.locked && !el.hidden).map((el) => ({ groupId: s.activeGroupId, boardId: b.id, elementId: el.id })));
```

Add before the `Escape` line:

```ts
      if (mod && key === "g") {
        e.preventDefault();
        if (e.shiftKey) s.apply({ type: "ungroupElements", refs: s.selection });
        else s.apply({ type: "groupElements", refs: s.selection, elementGroupId: crypto.randomUUID(), name: "Group" });
        return;
      }
```

Arrow nudges move only selectable refs:

```ts
      if (move) {
        e.preventDefault();
        const refs = selectableRefs(s.doc, s.selection);
        if (refs.length) s.apply({ type: "moveElements", refs, dx: move[0], dy: move[1] });
      }
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @chitrapx/web test`
Expected: PASS (logic is covered by Task 2 tests; pointer behaviour is checked in the browser at the end).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/editor
git commit -m "feat(editor): canvas and keyboard skip locked and hidden elements; group selection and cmd+G"
```

---

### Task 4: Layers panel

**Files:**
- Create: `apps/web/src/editor/layersOrder.ts`, `apps/web/test/layersOrder.test.ts`, `apps/web/src/editor/ui/LayersPanel.tsx`
- Modify: `apps/web/src/editor/ui/LeftPanel.tsx` (mount after the Boards section), `apps/web/package.json`, `NOTICES.md`

**Interfaces:**
- Consumes: `reorderElementTo`, `setElementsLocked`, `setElementsHidden`, `renameGroup`, `ungroupElements`, `updateElement` (Task 2).
- Produces: `arrayIndexForPanelDrop(panel: string[], elements: string[], id: string): number`.

- [ ] **Step 1: Failing test for the drop-index helper**

```ts
// apps/web/test/layersOrder.test.ts
import { describe, expect, it } from "vitest";
import { arrayIndexForPanelDrop } from "@/editor/layersOrder.ts";

// elements (back to front): a b c d  → panel (front to back): d c b a
describe("arrayIndexForPanelDrop", () => {
  const els = ["a", "b", "c", "d"];
  it("dropping to the top of the panel makes it front-most", () => {
    expect(arrayIndexForPanelDrop(["a", "d", "c", "b"], els, "a")).toBe(3);
  });
  it("dropping to the bottom makes it back-most", () => {
    expect(arrayIndexForPanelDrop(["c", "b", "a", "d"], els, "d")).toBe(0);
  });
  it("dropping between c and b puts it just in front of b", () => {
    expect(arrayIndexForPanelDrop(["c", "d", "b", "a"], els, "d")).toBe(2);
  });
});
```

Run: `pnpm --filter @chitrapx/web exec vitest run test/layersOrder.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 2: `apps/web/src/editor/layersOrder.ts`**

```ts
/**
 * The array index (last is front-most) for an element dropped in a front-most-first panel list.
 * `panel` is the panel order after the move; it may omit collapsed rows. `elements` is the current
 * array. The element just below the dropped one in the panel is just behind it in the array.
 */
export function arrayIndexForPanelDrop(panel: string[], elements: string[], id: string): number {
  const without = elements.filter((x) => x !== id);
  const behind = panel[panel.indexOf(id) + 1];
  if (behind === undefined) return 0; // dropped at the bottom of the panel: back-most
  return without.indexOf(behind) + 1;
}
```

Run the test again — Expected: PASS.

- [ ] **Step 3: Add dependencies**

Run: `pnpm --filter @chitrapx/web add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`

- [ ] **Step 4: Write `apps/web/src/editor/ui/LayersPanel.tsx`**

Adapted from PixelDeck `src/components/panels/LayersPanel.tsx` and `layers/SortableLayerRow.tsx` (MIT); group header rows after open-screenshot-generator `LayersPanel.tsx` (MIT).

```tsx
"use client";

import { useState } from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ArtboardElement } from "@chitrapx/document";
import type { Ref } from "../commands.ts";
import { useEditor, useEditorStore } from "../context.tsx";
import { arrayIndexForPanelDrop } from "../layersOrder.ts";

const TYPE_LABEL: Record<string, string> = { text: "Text", shape: "Shape", device: "Device", image: "Image", video: "Video", "video-device": "Phone with video", gesture: "Gesture", audio: "Audio" };
const TYPE_ICON: Record<string, string> = { text: "T", shape: "◼", device: "▯", image: "▣", video: "▶", "video-device": "▶", gesture: "☝", audio: "♪" };
const label = (el: ArtboardElement) => el.name?.trim() || TYPE_LABEL[el.type] || el.type;

/** Front-most first: the element array draws last-on-top, so the list is its reverse. */
export function LayersPanel() {
  const doc = useEditor((s) => s.doc);
  const groupId = useEditor((s) => s.activeGroupId);
  const boardId = useEditor((s) => s.activeBoardId);
  const group = doc.groups.find((g) => g.id === groupId);
  const board = group?.boards.find((b) => b.id === boardId) ?? group?.boards[0];
  if (!group || !board) return null;
  return (
    <section className="space-y-2" aria-label="Layers">
      <h2 className="label">Layers</h2>
      {group.spanElements.length > 0 && (
        <LayerList title="Across boards" groupId={groupId} boardId={null} elements={group.spanElements} />
      )}
      <LayerList groupId={groupId} boardId={board.id} elements={board.elements} />
      <div className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-neutral-500" aria-label="Background (always at the bottom)">
        <span className="w-4 text-center">▤</span><span className="flex-1">Background</span>
      </div>
    </section>
  );
}

function LayerList({ title, groupId, boardId, elements }: { title?: string; groupId: string; boardId: string | null; elements: ArtboardElement[] }) {
  const store = useEditorStore();
  const selection = useEditor((s) => s.selection);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const front = [...elements].reverse();
  const visible = front.filter((el) => !el.groupId || !collapsed.has(el.groupId));
  const ref = (elementId: string): Ref => ({ groupId, boardId, elementId });
  const isSelected = (id: string) => selection.some((r) => r.groupId === groupId && r.boardId === boardId && r.elementId === id);

  function onDragEnd(e: DragEndEvent) {
    const from = visible.findIndex((x) => x.id === e.active.id);
    const to = visible.findIndex((x) => x.id === e.over?.id);
    if (from < 0 || to < 0 || from === to) return;
    const moved = arrayMove(visible, from, to);
    const el = moved[to]!;
    const above = moved[to - 1]?.groupId, below = moved[to + 1]?.groupId;
    // Landing between two members of a group joins it; landing outside the element's own group leaves it.
    const join = above && above === below ? above : undefined;
    const elementGroupId = join ?? (el.groupId && el.groupId !== above && el.groupId !== below ? null : undefined);
    const toIndex = arrayIndexForPanelDrop(moved.map((x) => x.id), elements.map((x) => x.id), el.id);
    store.getState().apply({ type: "reorderElementTo", ref: ref(el.id), toIndex, elementGroupId });
  }

  function onSelect(id: string, shift: boolean) {
    const s = store.getState();
    const mine = (x: Ref) => x.groupId === groupId && x.boardId === boardId && x.elementId === id;
    s.select(shift ? (isSelected(id) ? s.selection.filter((x) => !mine(x)) : [...s.selection, ref(id)]) : [ref(id)]);
    if (boardId) s.setActiveBoard(boardId);
  }

  const headerShown = new Set<string>();
  return (
    <div className="space-y-0.5">
      {title && <p className="text-xs text-neutral-500">{title}</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visible.map((x) => x.id)} strategy={verticalListSortingStrategy}>
          <ul>
            {front.map((el) => {
              const gid = el.groupId;
              const header = gid && !headerShown.has(gid);
              if (gid) headerShown.add(gid);
              const members = gid ? elements.filter((x) => x.groupId === gid) : [];
              const refs = members.map((m) => ref(m.id));
              return (
                <li key={el.id}>
                  {header && (
                    <GroupHeader name={el.groupName || "Group"} collapsed={collapsed.has(gid)}
                      onToggle={() => setCollapsed((c) => { const n = new Set(c); if (n.has(gid)) n.delete(gid); else n.add(gid); return n; })}
                      onRename={(name) => store.getState().apply({ type: "renameGroup", groupId, boardId, elementGroupId: gid, name })}
                      onUngroup={() => store.getState().apply({ type: "ungroupElements", refs })}
                      locked={members.every((m) => m.locked)} hidden={members.every((m) => m.hidden)}
                      onLock={(v) => store.getState().apply({ type: "setElementsLocked", refs, locked: v })}
                      onHide={(v) => store.getState().apply({ type: "setElementsHidden", refs, hidden: v })} />
                  )}
                  {(!gid || !collapsed.has(gid)) && (
                    <LayerRow el={el} indent={!!gid} selected={isSelected(el.id)} onSelect={(shift) => onSelect(el.id, shift)}
                      onRename={(name) => store.getState().apply({ type: "updateElement", ref: ref(el.id), props: { name: name || undefined } as Partial<ArtboardElement> })}
                      onLock={(v) => store.getState().apply({ type: "setElementsLocked", refs: [ref(el.id)], locked: v })}
                      onHide={(v) => store.getState().apply({ type: "setElementsHidden", refs: [ref(el.id)], hidden: v })} />
                  )}
                </li>
              );
            })}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function InlineName({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) return <span className="flex-1 truncate" onDoubleClick={() => setDraft(value)}>{value}</span>;
  return (
    <input autoFocus aria-label="Layer name" className="input flex-1 py-0 text-sm" value={draft} onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { onCommit(draft.trim()); setDraft(null); } if (e.key === "Escape") setDraft(null); }}
      onBlur={() => setDraft(null)} />
  );
}

function Toggles({ locked, hidden, onLock, onHide, name }: { locked: boolean; hidden: boolean; onLock: (v: boolean) => void; onHide: (v: boolean) => void; name: string }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <span className="flex gap-0.5">
      <button type="button" className="px-1" aria-pressed={locked} aria-label={`${locked ? "Unlock" : "Lock"} ${name}`} onPointerDown={stop} onClick={(e) => { stop(e); onLock(!locked); }}>{locked ? "🔒" : "🔓"}</button>
      <button type="button" className="px-1" aria-pressed={hidden} aria-label={`${hidden ? "Show" : "Hide"} ${name}`} onPointerDown={stop} onClick={(e) => { stop(e); onHide(!hidden); }}>{hidden ? "◌" : "●"}</button>
    </span>
  );
}

function LayerRow({ el, indent, selected, onSelect, onRename, onLock, onHide }: {
  el: ArtboardElement; indent: boolean; selected: boolean; onSelect: (shift: boolean) => void;
  onRename: (name: string) => void; onLock: (v: boolean) => void; onHide: (v: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: el.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners}
      onClick={(e) => onSelect(e.shiftKey)}
      className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm ${indent ? "pl-6" : ""} ${selected ? "bg-indigo-50 dark:bg-indigo-950" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"} ${isDragging ? "opacity-60" : ""} ${el.hidden ? "text-neutral-400" : ""}`}>
      <span className="w-4 text-center text-neutral-500" aria-hidden>{TYPE_ICON[el.type] ?? "•"}</span>
      <InlineName value={label(el)} onCommit={onRename} />
      <Toggles locked={!!el.locked} hidden={!!el.hidden} onLock={onLock} onHide={onHide} name={label(el)} />
    </div>
  );
}

function GroupHeader({ name, collapsed, onToggle, onRename, onUngroup, locked, hidden, onLock, onHide }: {
  name: string; collapsed: boolean; onToggle: () => void; onRename: (name: string) => void; onUngroup: () => void;
  locked: boolean; hidden: boolean; onLock: (v: boolean) => void; onHide: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium">
      <button type="button" className="w-4" aria-expanded={!collapsed} aria-label={`${collapsed ? "Expand" : "Collapse"} ${name}`} onClick={onToggle}>{collapsed ? "▸" : "▾"}</button>
      <InlineName value={name} onCommit={onRename} />
      <button type="button" className="px-1 text-xs text-indigo-600 hover:underline" onClick={onUngroup}>Ungroup</button>
      <Toggles locked={locked} hidden={hidden} onLock={onLock} onHide={onHide} name={name} />
    </div>
  );
}
```

- [ ] **Step 5: Mount it**

In `LeftPanel.tsx`, import `LayersPanel` from `./LayersPanel.tsx` and render `<LayersPanel />` right after the closing `</section>` of the Boards section (before `<Checks />`).

- [ ] **Step 6: NOTICES.md**

Read `../PixelDeck/LICENSE` for its exact copyright line and add a table row:

```
| [PixelDeck](https://github.com/Pr0xS/PixelDeck) (MIT) | <copyright line from PixelDeck's LICENSE> | Layers panel structure and sortable row (`apps/web/src/editor/ui/LayersPanel.tsx`); status bar drawing and per-device status bar heights (`packages/renderer/src/osg/elements/StatusBar.tsx`, `packages/document/src/deviceStatusBar.ts`). |
```

Extend the existing open-screenshot-generator row's "Reused material" with: "group header rows in the Layers panel (`apps/web/src/editor/ui/LayersPanel.tsx`); file intake (`apps/web/src/editor/intake.ts`)".

- [ ] **Step 7: Verify**

Run: `pnpm --filter @chitrapx/web exec vitest run test/layersOrder.test.ts && pnpm typecheck && pnpm lint && pnpm --filter @chitrapx/web test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web NOTICES.md pnpm-lock.yaml
git commit -m "feat(editor): layers panel with drag and keyboard reorder, lock, hide, rename and group rows"
```

---

### Task 5: Layout presets

**Files:**
- Create: `packages/document/src/layout.ts`, `packages/document/test/layout.test.ts`, `apps/web/src/editor/ui/LayoutPresets.tsx`
- Modify: `packages/document/src/index.ts`, `apps/web/src/editor/commands.ts`, `apps/web/src/editor/ui/Inspector.tsx` (`BoardInspector`), `apps/web/test/commands.test.ts`

**Interfaces:**
- Produces:
  - `type LayoutPreset = "text-top" | "text-middle" | "text-bottom" | "phone-center" | "phone-hero" | "phone-bleed" | "phone-tilt"`
  - `LAYOUT_PRESETS: readonly LayoutPreset[]`
  - `presetKind(p): "text" | "phone"`
  - `layoutFor(preset, board: { width; height }, el: { size; scale? }): { position; size; rotation }`
  - command `applyLayoutPreset { groupId, boardId, preset, elementIds?: string[] }`

- [ ] **Step 1: Failing tests**

```ts
// packages/document/test/layout.test.ts
import { describe, expect, it } from "vitest";
import { layoutFor } from "../src/index.ts";

const phone = { size: { width: 600, height: 1200 }, scale: 1 };
const text = { size: { width: 500, height: 200 }, scale: 1 };
const portrait = { width: 1290, height: 2796 };

describe("layoutFor", () => {
  it("text presets: 88% width, centred, 6% margins, height kept", () => {
    expect(layoutFor("text-top", portrait, text)).toEqual({ position: { x: 77.4, y: 167.76 }, size: { width: 1135.2, height: 200 }, rotation: 0 });
    expect(layoutFor("text-middle", portrait, text).position.y).toBeCloseTo((2796 - 200) / 2);
    expect(layoutFor("text-bottom", portrait, text).position.y).toBeCloseTo(2796 - 200 - 167.76);
  });

  it("phone presets keep the device aspect and place it per the table", () => {
    const c = layoutFor("phone-center", portrait, phone);
    expect(c.size).toEqual({ width: 1118.4, height: 2236.8 }); // 80% of 2796, width under the 90% cap
    expect(c.position.x + c.size.width / 2).toBeCloseTo(645);
    expect(c.position.y + c.size.height / 2).toBeCloseTo(1398);
    expect(layoutFor("phone-hero", portrait, phone).position.y).toBeCloseTo(2796 * 0.28);
    const bleed = layoutFor("phone-bleed", portrait, phone);
    expect(bleed.position.y + bleed.size.height).toBeGreaterThan(2796);
    const tilt = layoutFor("phone-tilt", portrait, phone);
    expect(tilt.rotation).toBe(-12);
    expect(tilt.position.x + tilt.size.width / 2).toBeCloseTo(645 + 1290 * 0.04);
  });

  it("caps device width at 90% of the board", () => {
    const wide = { size: { width: 2000, height: 1000 }, scale: 1 }; // 80% of 1600 tall would be 2560 wide
    const out = layoutFor("phone-center", { width: 2560, height: 1600 }, wide);
    expect(out.size.width).toBeCloseTo(2560 * 0.9);
    expect(out.size.width / out.size.height).toBeCloseTo(2);
  });

  it("accounts for element scale and is idempotent", () => {
    const scaled = { size: { width: 300, height: 600 }, scale: 2 };
    const once = layoutFor("phone-center", portrait, scaled);
    expect(once.size.height * 2).toBeCloseTo(2796 * 0.8);
    expect(layoutFor("phone-center", portrait, { ...scaled, size: once.size })).toEqual(once);
  });
});
```

Append to `apps/web/test/commands.test.ts`:

```ts
describe("applyLayoutPreset", () => {
  it("places the first text when nothing is targeted, in one step, idempotently", () => {
    const d1 = applyCommand(doc(), { type: "applyLayoutPreset", groupId: "g", boardId: "b1", preset: "text-top" });
    expect(findElement(d1, r("a"))!.position.y).toBeCloseTo(2796 * 0.06);
    expect(findElement(d1, r("b"))!.position).toEqual({ x: 200, y: 10 });
    expect(applyCommand(d1, { type: "applyLayoutPreset", groupId: "g", boardId: "b1", preset: "text-top" })).toEqual(d1);
  });
  it("places targeted elements of the preset's kind only", () => {
    const d1 = applyCommand(doc(), { type: "applyLayoutPreset", groupId: "g", boardId: "b1", preset: "text-bottom", elementIds: ["b", "c"] });
    expect(findElement(d1, r("a"))!.position).toEqual({ x: 0, y: 10 });
    expect(findElement(d1, r("c"))!.position.y).toBeCloseTo(2796 - 50 - 2796 * 0.06);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @chitrapx/document exec vitest run test/layout.test.ts`
Expected: FAIL (`layoutFor` not exported).

- [ ] **Step 3: Implement `packages/document/src/layout.ts`**

```ts
export type LayoutPreset = "text-top" | "text-middle" | "text-bottom" | "phone-center" | "phone-hero" | "phone-bleed" | "phone-tilt";
export const LAYOUT_PRESETS = ["text-top", "text-middle", "text-bottom", "phone-center", "phone-hero", "phone-bleed", "phone-tilt"] as const satisfies readonly LayoutPreset[];
export const presetKind = (p: LayoutPreset): "text" | "phone" => (p.startsWith("text-") ? "text" : "phone");

const TEXT_WIDTH = 0.88;
const MARGIN = 0.06;
const MAX_DEVICE_WIDTH = 0.9;
/** Device height and top edge as fractions of the board; `top: null` centres vertically. */
const PHONE: Record<string, { height: number; top: number | null; dx: number; rotation: number }> = {
  "phone-center": { height: 0.8, top: null, dx: 0, rotation: 0 },
  "phone-hero": { height: 0.85, top: 0.28, dx: 0, rotation: 0 },
  "phone-bleed": { height: 0.95, top: 0.4, dx: 0, rotation: 0 },
  "phone-tilt": { height: 0.72, top: 0.18, dx: 0.04, rotation: -12 },
};

type Box = { position: { x: number; y: number }; size: { width: number; height: number }; rotation: number };
const round = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * Where a preset puts an element on a board. Pure: the result depends only on the board and the
 * element's aspect, so applying a preset twice changes nothing. Sizes are the element's base size
 * (displayed size divided by `scale`).
 */
export function layoutFor(preset: LayoutPreset, board: { width: number; height: number }, el: { size: { width: number; height: number }; scale?: number }): Box {
  const W = board.width, H = board.height, s = el.scale || 1;
  if (presetKind(preset) === "text") {
    const w = TEXT_WIDTH * W, h = el.size.height * s;
    const y = preset === "text-top" ? MARGIN * H : preset === "text-bottom" ? H - h - MARGIN * H : (H - h) / 2;
    return { position: { x: round((W - w) / 2), y: round(y) }, size: { width: round(w / s), height: round(h / s) }, rotation: 0 };
  }
  const spec = PHONE[preset]!;
  const aspect = el.size.width / el.size.height;
  let h = spec.height * H, w = h * aspect;
  if (w > MAX_DEVICE_WIDTH * W) { w = MAX_DEVICE_WIDTH * W; h = w / aspect; }
  const x = (W - w) / 2 + spec.dx * W;
  const y = spec.top === null ? (H - h) / 2 : spec.top * H;
  return { position: { x: round(x), y: round(y) }, size: { width: round(w / s), height: round(h / s) }, rotation: spec.rotation };
}
```

Add `export * from "./layout.ts";` to `packages/document/src/index.ts`.

- [ ] **Step 4: Command**

In `commands.ts`, import `layoutFor, presetKind, type LayoutPreset` from `@chitrapx/document`. Add to the union:

```ts
  | { type: "applyLayoutPreset"; groupId: string; boardId: string; preset: LayoutPreset; elementIds?: string[] }
```

Add the case:

```ts
      case "applyLayoutPreset": {
        const b = findBoard(d, cmd.groupId, cmd.boardId);
        if (!b) return;
        const fits = (e: ArtboardElement) => (presetKind(cmd.preset) === "text" ? e.type === "text" : e.type === "device" || e.type === "video-device");
        const chosen = cmd.elementIds?.length ? b.elements.filter((e) => cmd.elementIds!.includes(e.id) && fits(e as ArtboardElement)) : [];
        const targets = chosen.length ? chosen : b.elements.filter((e) => fits(e as ArtboardElement)).slice(0, 1);
        for (const e of targets) Object.assign(e, layoutFor(cmd.preset, b.size, e));
        return;
      }
```

- [ ] **Step 5: UI `apps/web/src/editor/ui/LayoutPresets.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { LayoutPreset } from "@chitrapx/document";
import { useEditor, useEditorStore } from "../context.tsx";

const ROWS: Array<[string, Array<[LayoutPreset, string]>]> = [
  ["Text", [["text-top", "Top"], ["text-middle", "Middle"], ["text-bottom", "Bottom"]]],
  ["Phone", [["phone-center", "Center"], ["phone-hero", "Hero"], ["phone-bleed", "Bleed"], ["phone-tilt", "Tilt"]]],
];

/** One-click placement for the selected text or phone (or the first one on the board). */
export function LayoutPresets({ groupId, boardId }: { groupId: string; boardId: string }) {
  const store = useEditorStore();
  const [notice, setNotice] = useState("");
  const board = useEditor((s) => s.doc.groups.find((g) => g.id === groupId)?.boards.find((b) => b.id === boardId));

  function apply(preset: LayoutPreset) {
    const s = store.getState();
    const spans = s.selection.some((r) => r.boardId === null);
    const elementIds = s.selection.filter((r) => r.groupId === groupId && r.boardId === boardId).map((r) => r.elementId);
    const detached = Object.entries(board?.localized ?? {}).filter(([, byEl]) =>
      Object.values(byEl).some((ov) => (ov as { detached?: string[] }).detached?.some((k) => k === "position" || k === "size"))).map(([loc]) => loc);
    s.apply({ type: "applyLayoutPreset", groupId, boardId, preset, elementIds });
    setNotice([
      spans ? "Elements across boards are not moved by presets." : "",
      detached.length ? `${detached.join(", ")} keep their own layout for some elements.` : "",
    ].filter(Boolean).join(" "));
  }

  return (
    <div className="space-y-1">
      <h3 className="label">Layout</h3>
      {ROWS.map(([title, presets]) => (
        <div key={title} className="flex flex-wrap items-center gap-1" role="group" aria-label={`${title} layout`}>
          <span className="w-12 text-xs text-neutral-500">{title}</span>
          {presets.map(([p, text]) => <button key={p} type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={() => apply(p)}>{text}</button>)}
        </div>
      ))}
      {notice && <p className="text-xs text-amber-700" role="status">{notice}</p>}
    </div>
  );
}
```

In `Inspector.tsx` `BoardInspector`, import `LayoutPresets` and render `<LayoutPresets groupId={groupId} boardId={boardId} />` as the last child of the returned `div`.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @chitrapx/document test && pnpm --filter @chitrapx/web exec vitest run test/commands.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/document apps/web
git commit -m "feat: layout presets for text and phones (Top, Middle, Bottom; Center, Hero, Bleed, Tilt)"
```

---

### Task 6: Apply to all boards and to all languages

**Files:**
- Create: `packages/document/src/match.ts`, `packages/document/test/match.test.ts`, `apps/web/src/editor/ui/ApplyToAll.tsx`
- Modify: `packages/document/src/index.ts`, `apps/web/src/editor/commands.ts`, `apps/web/src/editor/ui/Inspector.tsx`, `apps/web/test/commands.test.ts`

**Interfaces:**
- Produces:
  - `matchElements(source: ArtboardState, target: ArtboardState): Map<string, string>`
  - `LAYOUT_KEYS = ["position", "size", "rotation", "scale"] as const`
  - command `applyToAllBoards { groupId, sourceRef: Ref }`
  - command `applyLayoutToLocales { groupId, boardId }`

- [ ] **Step 1: Failing tests**

```ts
// packages/document/test/match.test.ts
import { describe, expect, it } from "vitest";
import { matchElements } from "../src/index.ts";
import { board, device, text } from "./fixtures.ts";

describe("matchElements", () => {
  it("pairs the nth element of each type", () => {
    const a = board("a", [text("t1", 0, 0), device("d1", 0), text("t2", 0, 0)]);
    const b = board("b", [device("x1", 0), text("y1", 0, 0), text("y2", 0, 0)]);
    expect([...matchElements(a, b)]).toEqual([["t1", "y1"], ["d1", "x1"], ["t2", "y2"]]);
  });
  it("skips elements with no counterpart", () => {
    expect([...matchElements(board("a", [device("d1", 0), device("d2", 0)]), board("b", [device("x1", 0)]))]).toEqual([["d1", "x1"]]);
  });
});
```

Append to `apps/web/test/commands.test.ts`:

```ts
describe("apply to all", () => {
  it("copies position, size, rotation and scale to the nth counterpart on every other board", () => {
    let d = applyCommand(doc(), { type: "updateElement", ref: r("a"), props: { position: { x: 70, y: 80 }, rotation: 5 } as never });
    d = applyCommand(d, { type: "applyToAllBoards", groupId: "g", sourceRef: r("a") });
    expect(findElement(d, r("d", "b2"))).toMatchObject({ position: { x: 70, y: 80 }, rotation: 5, size: { width: 100, height: 50 }, content: "d" });
  });
  it("copies a device's screenshot crop but not its screenshot", () => {
    const dev = (id: string, rect: object, src: string) => ({ id, type: "device", deviceType: "iphone-15-pro", position: { x: 0, y: 0 }, size: { width: 10, height: 20 }, rotation: 0, scale: 1, screenshotSrc: src, screenshotRect: rect }) as never;
    let d = applyCommand(doc(), { type: "addElement", groupId: "g", boardId: "b1", element: dev("p1", { left: 5, top: 10, width: 90, height: 120 }, "asset:one") });
    d = applyCommand(d, { type: "addElement", groupId: "g", boardId: "b2", element: dev("p2", { left: 0, top: 0, width: 100, height: 100 }, "asset:two") });
    d = applyCommand(d, { type: "applyToAllBoards", groupId: "g", sourceRef: r("p1") });
    expect(findElement(d, r("p2", "b2"))).toMatchObject({ screenshotRect: { left: 5, top: 10, width: 90, height: 120 }, screenshotSrc: "asset:two" });
  });
  it("re-attaches layout in every language and keeps the translated text", () => {
    let d = applyCommand(doc(), { type: "setOverride", ref: r("a"), locale: "de-DE", props: { content: "Hallo", position: { x: 9, y: 9 }, detached: ["position", "fontSize"], fontSize: 12 } as never });
    d = applyCommand(d, { type: "applyLayoutToLocales", groupId: "g", boardId: "b1" });
    const ov = d.groups[0]!.boards[0]!.localized!["de-DE"]!["a"] as Record<string, unknown>;
    expect(ov).toMatchObject({ content: "Hallo", detached: ["fontSize"], fontSize: 12 });
    expect(ov.position).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @chitrapx/document exec vitest run test/match.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/document/src/match.ts`**

```ts
import type { ArtboardState } from "./artboard.ts";

/** Layout properties apply-to-all copies, and that a language can detach. */
export const LAYOUT_KEYS = ["position", "size", "rotation", "scale"] as const;

/** Counterparts across boards: the nth element of a type on `source` pairs with the nth of that type on `target`. */
export function matchElements(source: ArtboardState, target: ArtboardState): Map<string, string> {
  const byType = new Map<string, string[]>();
  for (const e of target.elements) byType.set(e.type, [...(byType.get(e.type) ?? []), e.id]);
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const e of source.elements) {
    const n = seen.get(e.type) ?? 0;
    seen.set(e.type, n + 1);
    const t = byType.get(e.type)?.[n];
    if (t) out.set(e.id, t);
  }
  return out;
}
```

Add `export * from "./match.ts";` to `index.ts`.

- [ ] **Step 4: Commands**

Import `matchElements, LAYOUT_KEYS` in `commands.ts`. Add to the union:

```ts
  | { type: "applyToAllBoards"; groupId: string; sourceRef: Ref }
  | { type: "applyLayoutToLocales"; groupId: string; boardId: string }
```

Cases:

```ts
      case "applyToAllBoards": {
        const g = d.groups.find((x) => x.id === cmd.groupId);
        const src = cmd.sourceRef.boardId ? g?.boards.find((b) => b.id === cmd.sourceRef.boardId) : undefined;
        const el = src?.elements.find((e) => e.id === cmd.sourceRef.elementId) as (ArtboardElement & Record<string, unknown>) | undefined;
        if (!g || !src || !el) return;
        for (const b of g.boards) {
          if (b === src) continue;
          const id = matchElements(src as ArtboardState, b as ArtboardState).get(el.id);
          const t = b.elements.find((e) => e.id === id) as Record<string, unknown> | undefined;
          if (!t) continue;
          for (const k of LAYOUT_KEYS) t[k] = JSON.parse(JSON.stringify(el[k] ?? (k === "scale" ? 1 : 0)));
          if (el.type === "device" && t.type === "device" && el.screenshotRect) t.screenshotRect = JSON.parse(JSON.stringify(el.screenshotRect));
        }
        return;
      }
      case "applyLayoutToLocales": {
        const b = findBoard(d, cmd.groupId, cmd.boardId);
        if (!b?.localized) return;
        for (const [loc, byEl] of Object.entries(b.localized)) {
          for (const [id, raw] of Object.entries(byEl)) {
            const ov = raw as Record<string, unknown> & { detached?: string[] };
            for (const k of LAYOUT_KEYS) delete ov[k];
            if (ov.detached) { ov.detached = ov.detached.filter((k) => !(LAYOUT_KEYS as readonly string[]).includes(k)); if (!ov.detached.length) delete ov.detached; }
            if (!Object.keys(ov).length) delete byEl[id];
          }
          if (!Object.keys(byEl).length) delete b.localized[loc];
        }
        return;
      }
```

- [ ] **Step 5: UI `apps/web/src/editor/ui/ApplyToAll.tsx`**

```tsx
"use client";

import { useState } from "react";
import { LAYOUT_KEYS, matchElements, type ArtboardState } from "@chitrapx/document";
import type { Ref } from "../commands.ts";
import { useEditor, useEditorStore } from "../context.tsx";

function Confirm({ label, question, onYes }: { label: string; question: () => string; onYes: () => void }) {
  const [asking, setAsking] = useState<string | null>(null);
  if (asking === null) return <button type="button" className="btn-ghost w-full text-xs" onClick={() => setAsking(question())}>{label}</button>;
  return (
    <div className="space-y-1 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-700" role="alertdialog" aria-label={label}>
      <p>{asking}</p>
      <div className="flex gap-1">
        <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => { onYes(); setAsking(null); }}>Apply</button>
        <button type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={() => setAsking(null)}>Cancel</button>
      </div>
    </div>
  );
}

/** Element section: copy this element's position and size (and a device's screenshot crop) to every other board. */
export function ApplyToBoards({ refr }: { refr: Ref }) {
  const store = useEditorStore();
  const group = useEditor((s) => s.doc.groups.find((g) => g.id === refr.groupId));
  if (!group || !refr.boardId || group.boards.length < 2) return null;
  const question = () => {
    const src = group.boards.find((b) => b.id === refr.boardId)! as ArtboardState;
    const others = group.boards.filter((b) => b.id !== refr.boardId);
    const missing = others.filter((b) => !matchElements(src, b as ArtboardState).has(refr.elementId)).map((b) => b.name);
    const n = others.length - missing.length;
    return `Change ${n} board${n === 1 ? "" : "s"}?${missing.length ? ` No matching element on: ${missing.join(", ")} (skipped).` : ""}`;
  };
  return <Confirm label="Apply position to all boards" question={question}
    onYes={() => store.getState().apply({ type: "applyToAllBoards", groupId: refr.groupId, sourceRef: refr })} />;
}

/** Board section: every language follows this board's base layout again; text stays translated. */
export function ApplyToLocales({ groupId, boardId }: { groupId: string; boardId: string }) {
  const store = useEditorStore();
  const locales = useEditor((s) => s.doc.localization.locales);
  const board = useEditor((s) => s.doc.groups.find((g) => g.id === groupId)?.boards.find((b) => b.id === boardId));
  if (!locales.length || !board) return null;
  const question = () => {
    const own = Object.entries(board.localized ?? {}).filter(([, byEl]) => Object.values(byEl).some((ov) =>
      (ov as { detached?: string[] }).detached?.some((k) => (LAYOUT_KEYS as readonly string[]).includes(k)))).map(([loc]) => loc);
    return own.length ? `${own.join(", ")} will follow this layout. Text stays translated.` : "Every language already follows this layout.";
  };
  return <Confirm label="Apply layout to all languages" question={question}
    onYes={() => store.getState().apply({ type: "applyLayoutToLocales", groupId, boardId })} />;
}
```

In `Inspector.tsx`, import `ApplyToBoards` and `ApplyToLocales` from `./ApplyToAll.tsx`:
- `BoardInspector`: render `<ApplyToLocales groupId={groupId} boardId={boardId} />` after `<LayoutPresets .../>`.
- `ElementInspector`: render `<ApplyToBoards refr={refr} />` just above the existing "Bring to front" / "Send to back" buttons.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @chitrapx/document test && pnpm --filter @chitrapx/web exec vitest run test/commands.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/document apps/web
git commit -m "feat: apply position to all boards and layout to all languages"
```

---

### Task 7: Version history on the server

**Files:**
- Modify: `packages/db/src/schema.ts:89-98`
- Create: `packages/db/migrations/0009_*.sql` (generated, then edited)
- Create: `apps/web/src/server/versions.ts`, `apps/web/src/app/api/projects/[projectId]/versions/route.ts`, `apps/web/src/app/api/projects/[projectId]/versions/[versionId]/route.ts`, `apps/web/src/app/api/projects/[projectId]/versions/[versionId]/restore/route.ts`
- Modify: `apps/web/src/server/projects.ts:146-149` (prune after the auto-snapshot), `apps/web/src/server/jobs.ts:47-57` (`kind: "export"` and prune)
- Test: `apps/web/test/versions.test.ts` (create)

**Interfaces:**
- Produces:

  | Export | Shape |
  |---|---|
  | `VERSIONS_KEPT` | `50` |
  | `pruneVersions` | `(db: Db, workspaceId, projectId) => Promise<void>` |
  | `listVersions` | `(ctx, projectId) => Promise<VersionSummary[]>`, where `VersionSummary = { id, revision, kind, label, createdAt, author: string \| null }` |
  | `getVersion` | `(ctx, projectId, versionId) => Promise<VersionSummary & { doc: ChitrapxDoc }>` |
  | `saveNamedVersion` | `(ctx, projectId, raw: { label }) => Promise<VersionSummary>` |
  | `restoreVersion` | `(ctx, projectId, versionId, raw: { revision }) => Promise<{ revision: number; doc: ChitrapxDoc }>` |

  - `project_versions.kind` is `'auto' | 'export' | 'restore' | 'named'`.
  - Routes:
    - `GET /api/projects/:id/versions` and `POST /api/projects/:id/versions` (`{ label }`)
    - `GET /api/projects/:id/versions/:versionId`
    - `POST /api/projects/:id/versions/:versionId/restore` (`{ revision }`)

- [ ] **Step 1: Schema and migration**

In `packages/db/src/schema.ts`, `projectVersions`, after `label`:

```ts
  kind: text("kind").$type<"auto" | "export" | "restore" | "named">().notNull().default("auto"),
```

Replace the table's index list with:

```ts
}, (t) => [index("project_versions_project_idx").on(t.projectId), index("project_versions_project_created_idx").on(t.projectId, t.createdAt.desc())]);
```

Run `pnpm --filter @chitrapx/db generate`, then open the new `packages/db/migrations/0009_*.sql` and append:

```sql
--> statement-breakpoint
UPDATE "project_versions" SET "kind" = 'export' WHERE "label" = 'export';
```

Run `pnpm db:migrate`.

- [ ] **Step 2: Failing tests `apps/web/test/versions.test.ts`**

```ts
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { describe, expect, it } from "vitest";
import { db, schema } from "@chitrapx/db";
import { seedTemplates } from "@chitrapx/db/seed";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { createApp } from "@/server/apps.ts";
import type { Ctx } from "@/server/context.ts";
import { createProject, getProject, saveDoc } from "@/server/projects.ts";
import { getVersion, listVersions, pruneVersions, restoreVersion, saveNamedVersion, VERSIONS_KEPT } from "@/server/versions.ts";

async function setup() {
  await seedTemplates();
  const user = await createUser();
  const ctx: Ctx = { userId: user.id, workspaceId: await makeWorkspace(user.id), plan: "pro" };
  const app = await createApp(ctx, { name: "A" });
  const p = await createProject(ctx, app.id, { name: "T", templateSlug: "amoura-dating" });
  return { ctx, p: await getProject(ctx, p.id) };
}

describe("versions", () => {
  it("named save, list without doc, and preview", async () => {
    const { ctx, p } = await setup();
    const v = await saveNamedVersion(ctx, p.id, { label: "  Launch set  " });
    expect(v).toMatchObject({ kind: "named", label: "Launch set", revision: p.revision });
    const list = await listVersions(ctx, p.id);
    expect(list[0]).toMatchObject({ id: v.id, kind: "named" });
    expect("doc" in list[0]!).toBe(false);
    expect((await getVersion(ctx, p.id, v.id)).doc.groups.length).toBe(p.doc.groups.length);
    await expect(saveNamedVersion(ctx, p.id, { label: "" })).rejects.toBeInstanceOf(ZodError);
  });

  it("restore snapshots the current doc, writes the version as a new revision, and 409s when stale", async () => {
    const { ctx, p } = await setup();
    const v = await saveNamedVersion(ctx, p.id, { label: "Before edit" });
    const edited = { ...p.doc, groups: p.doc.groups.slice(0, 1).map((g) => ({ ...g, boards: g.boards.slice(0, 1) })) };
    const { revision } = await saveDoc(ctx, p.id, { doc: edited, revision: p.revision });
    await expect(restoreVersion(ctx, p.id, v.id, { revision: revision - 1 })).rejects.toMatchObject({ status: 409 });
    expect((await listVersions(ctx, p.id)).filter((x) => x.kind === "restore")).toEqual([]);
    const out = await restoreVersion(ctx, p.id, v.id, { revision });
    expect(out.revision).toBe(revision + 1);
    expect(out.doc.groups[0]!.boards.length).toBe(p.doc.groups[0]!.boards.length);
    const before = (await listVersions(ctx, p.id)).find((x) => x.kind === "restore")!;
    expect(before).toMatchObject({ label: "Before restore", revision });
    expect((await getProject(ctx, p.id)).revision).toBe(revision + 1);
  });

  it("another workspace cannot see or restore versions", async () => {
    const { ctx, p } = await setup();
    const v = await saveNamedVersion(ctx, p.id, { label: "Mine" });
    const other = await setup();
    await expect(getVersion(other.ctx, p.id, v.id)).rejects.toMatchObject({ status: 404 });
    await expect(listVersions(other.ctx, p.id)).rejects.toMatchObject({ status: 404 });
    await expect(restoreVersion(other.ctx, p.id, v.id, { revision: p.revision })).rejects.toMatchObject({ status: 404 });
  });

  it("prunes automatic versions beyond 50, keeps named ones and ones a running export reads", async () => {
    const { ctx, p } = await setup();
    const named = await saveNamedVersion(ctx, p.id, { label: "Keep" });
    const rows = await db.insert(schema.projectVersions).values(Array.from({ length: VERSIONS_KEPT + 5 }, (_, i) => ({
      workspaceId: ctx.workspaceId, projectId: p.id, revision: i, doc: p.doc, kind: "auto" as const, createdAt: new Date(Date.now() - (100 - i) * 60_000),
    }))).returning({ id: schema.projectVersions.id });
    const oldest = rows[0]!.id;
    await db.insert(schema.jobs).values({ workspaceId: ctx.workspaceId, projectId: p.id, type: "export", status: "running", creditsReserved: 1, input: { versionId: oldest } });
    await pruneVersions(db, ctx.workspaceId, p.id);
    const left = await db.select({ id: schema.projectVersions.id, kind: schema.projectVersions.kind }).from(schema.projectVersions).where(eq(schema.projectVersions.projectId, p.id));
    expect(left.filter((x) => x.kind !== "named")).toHaveLength(VERSIONS_KEPT + 1); // newest 50 + the one a running job reads
    expect(left.some((x) => x.id === named.id)).toBe(true);
    expect(left.some((x) => x.id === oldest)).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @chitrapx/web exec vitest run test/versions.test.ts`
Expected: FAIL (`@/server/versions.ts` missing).

- [ ] **Step 4: Implement `apps/web/src/server/versions.ts`**

```ts
import { and, desc, eq, sql } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";
import { z } from "zod";
import { db, schema, withTx, type Db } from "@chitrapx/db";
import { migrate, type ChitrapxDoc } from "@chitrapx/document";
import type { Ctx } from "./context.ts";
import { ConflictError, notFound } from "./http.ts";

/** Automatic versions (autosave, export, before-restore) kept per project; named versions are never pruned. */
export const VERSIONS_KEPT = 50;
const LIST_LIMIT = 100;

export type VersionKind = "auto" | "export" | "restore" | "named";
export type VersionSummary = { id: string; revision: number; kind: VersionKind; label: string | null; createdAt: Date; author: string | null };

const uuid = (id: string) => { if (!z.uuid().safeParse(id).success) throw notFound(); };
const v = schema.projectVersions;
const summary = { id: v.id, revision: v.revision, kind: v.kind, label: v.label, createdAt: v.createdAt, author: authUsers.email };

async function ownProject(ctx: Ctx, projectId: string) {
  uuid(projectId);
  const [p] = await db.select({ id: schema.projects.id, revision: schema.projects.revision, doc: schema.projects.doc }).from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.workspaceId, ctx.workspaceId)));
  if (!p) throw notFound();
  return p;
}

/**
 * Keeps the newest VERSIONS_KEPT automatic versions of a project. Never deletes named versions or
 * a version that a queued or running job still reads (export jobs store it in input.versionId).
 */
export async function pruneVersions(tx: Db, workspaceId: string, projectId: string): Promise<void> {
  await tx.execute(sql`
    delete from project_versions pv
    where pv.project_id = ${projectId} and pv.workspace_id = ${workspaceId} and pv.kind <> 'named'
      and pv.id not in (
        select id from project_versions
        where project_id = ${projectId} and kind <> 'named'
        order by created_at desc, id desc limit ${VERSIONS_KEPT})
      and not exists (
        select 1 from jobs j
        where j.project_id = ${projectId} and j.status in ('queued', 'running') and j.input->>'versionId' = pv.id::text)`);
}

export async function listVersions(ctx: Ctx, projectId: string): Promise<VersionSummary[]> {
  await ownProject(ctx, projectId);
  const rows = await db.select(summary).from(v).leftJoin(authUsers, eq(authUsers.id, v.createdBy))
    .where(and(eq(v.projectId, projectId), eq(v.workspaceId, ctx.workspaceId)))
    .orderBy(desc(v.createdAt), desc(v.id)).limit(LIST_LIMIT);
  return rows as VersionSummary[];
}

export async function getVersion(ctx: Ctx, projectId: string, versionId: string): Promise<VersionSummary & { doc: ChitrapxDoc }> {
  await ownProject(ctx, projectId);
  uuid(versionId);
  const [row] = await db.select({ ...summary, doc: v.doc }).from(v).leftJoin(authUsers, eq(authUsers.id, v.createdBy))
    .where(and(eq(v.id, versionId), eq(v.projectId, projectId), eq(v.workspaceId, ctx.workspaceId)));
  if (!row) throw notFound();
  const { doc, ...rest } = row;
  return { ...(rest as VersionSummary), doc: migrate(doc) };
}

const namedInput = z.object({ label: z.string().trim().min(1).max(80) });

/** Saves the project's current saved document as a named version (never pruned). */
export async function saveNamedVersion(ctx: Ctx, projectId: string, raw: unknown): Promise<VersionSummary> {
  const { label } = namedInput.parse(raw);
  const p = await ownProject(ctx, projectId);
  const [row] = await db.insert(v).values({ workspaceId: ctx.workspaceId, projectId, revision: p.revision, doc: p.doc, kind: "named", label, createdBy: ctx.userId })
    .returning({ id: v.id, revision: v.revision, kind: v.kind, label: v.label, createdAt: v.createdAt });
  return { ...(row as Omit<VersionSummary, "author">), author: null };
}

const restoreInput = z.object({ revision: z.number().int().min(0) });

/**
 * Makes a version the current document. History is never rewound: the current document is saved
 * first as "Before restore", and the restored document becomes a new revision. A stale revision
 * is a 409 conflict and changes nothing. Another workspace always gets 404 (checked first).
 */
export async function restoreVersion(ctx: Ctx, projectId: string, versionId: string, raw: unknown): Promise<{ revision: number; doc: ChitrapxDoc }> {
  const { revision } = restoreInput.parse(raw);
  uuid(projectId); uuid(versionId);
  return withTx(async ({ db: tx }) => {
    const [p] = await tx.select({ revision: schema.projects.revision, doc: schema.projects.doc }).from(schema.projects)
      .where(and(eq(schema.projects.id, projectId), eq(schema.projects.workspaceId, ctx.workspaceId))).for("update");
    if (!p) throw notFound();
    const [ver] = await tx.select({ doc: v.doc }).from(v).where(and(eq(v.id, versionId), eq(v.projectId, projectId), eq(v.workspaceId, ctx.workspaceId)));
    if (!ver) throw notFound();
    if (p.revision !== revision) throw new ConflictError(p.revision);
    const doc = migrate(ver.doc);
    await tx.insert(v).values({ workspaceId: ctx.workspaceId, projectId, revision: p.revision, doc: p.doc, kind: "restore", label: "Before restore", createdBy: ctx.userId });
    const [row] = await tx.update(schema.projects).set({ doc, revision: p.revision + 1, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(schema.projects.id, projectId), eq(schema.projects.workspaceId, ctx.workspaceId))).returning({ revision: schema.projects.revision });
    await pruneVersions(tx, ctx.workspaceId, projectId);
    return { revision: row!.revision, doc };
  });
}
```

`Db` is exported from `@chitrapx/db` (the worker's `runJob.ts` already imports `type Db`). If drizzle's `authUsers` has no `email` column, check with `grep -n "email" node_modules/drizzle-orm/supabase/*.d.ts`. In that case, drop `author` from `summary`, use `author: sql<null>\`null\``, and note it in the report.

- [ ] **Step 5: Prune from the existing writers**

- `apps/web/src/server/projects.ts` `saveDoc`: inside the auto-snapshot `if`, after the insert, add `await pruneVersions(tx, ctx.workspaceId, projectId);`. Import it from `./versions.ts`.
- `apps/web/src/server/jobs.ts` `pinVersion`: add `kind: "export",` to the insert values, then before `return ins!.id;` add `await pruneVersions(tx.db, ctx.workspaceId, project.id);`. Import it from `./versions.ts`. The row just inserted is the newest, so pruning always keeps it.

- [ ] **Step 6: Routes**

`apps/web/src/app/api/projects/[projectId]/versions/route.ts`:

```ts
import { requireContext } from "@/server/context.ts";
import { readJson, route } from "@/server/http.ts";
import { listVersions, saveNamedVersion } from "@/server/versions.ts";

type P = { params: Promise<{ projectId: string }> };
export const GET = route(async (_req: Request, { params }: P) => listVersions(await requireContext(), (await params).projectId));
export const POST = route(async (req: Request, { params }: P) =>
  Response.json(await saveNamedVersion(await requireContext(), (await params).projectId, await readJson(req)), { status: 201 }));
```

`apps/web/src/app/api/projects/[projectId]/versions/[versionId]/route.ts`:

```ts
import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";
import { getVersion } from "@/server/versions.ts";

export const GET = route(async (_req: Request, { params }: { params: Promise<{ projectId: string; versionId: string }> }) => {
  const { projectId, versionId } = await params;
  return getVersion(await requireContext(), projectId, versionId);
});
```

`apps/web/src/app/api/projects/[projectId]/versions/[versionId]/restore/route.ts`:

```ts
import { requireContext } from "@/server/context.ts";
import { readJson, route } from "@/server/http.ts";
import { restoreVersion } from "@/server/versions.ts";

export const POST = route(async (req: Request, { params }: { params: Promise<{ projectId: string; versionId: string }> }) => {
  const { projectId, versionId } = await params;
  return restoreVersion(await requireContext(), projectId, versionId, await readJson(req));
});
```

- [ ] **Step 7: Verify**

Run: `pnpm --filter @chitrapx/web exec vitest run test/versions.test.ts test/jobs.test.ts test/save.test.ts && pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/db apps/web
git commit -m "feat(server): version history with named saves, restore and pruning of automatic versions"
```

---

### Task 8: Version history dialog

**Files:**
- Create: `apps/web/src/editor/ui/VersionsDialog.tsx`
- Modify: `apps/web/src/editor/save.ts` (expose `adoptServerDoc`, `reportConflict`), `apps/web/src/editor/Editor.tsx`, `apps/web/src/editor/ui/Toolbar.tsx`

**Interfaces:**
- Consumes: the version routes (Task 7), `flush` (SP8), `BoardView` from `@chitrapx/renderer`.
- Produces: `useAutosave` additionally returns:
  - `adoptServerDoc(doc, revision)`: replaces the store's document as saved and clears this tab's IndexedDB draft.
  - `reportConflict(serverRevision)`: opens the existing conflict dialog.

- [ ] **Step 1: Expose from `save.ts`**

Inside `useAutosave`, before the `return`:

```ts
  /** The server's document is now current (e.g. after a restore): load it as saved and drop this tab's draft. */
  function adoptServerDoc(doc: ChitrapxDoc, revision: number) {
    store.getState().replaceDoc(doc, revision, false);
    void idbDel(key());
    setStatus("saved");
  }
  /** Another writer moved the project on: show the usual conflict choice. */
  function reportConflict(serverRevision: number) { block({ serverRevision, source: "save" }); }
```

Add both to the returned object.

- [ ] **Step 2: `apps/web/src/editor/ui/VersionsDialog.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import type { ChitrapxDoc } from "@chitrapx/document";
import { BoardView, type ResolveSrc } from "@chitrapx/renderer";
import { api, ApiError } from "@/server/api.ts";
import { useEditor, useEditorStore } from "../context.tsx";

type Version = { id: string; revision: number; kind: "auto" | "export" | "restore" | "named"; label: string | null; createdAt: string; author: string | null };
const KIND_LABEL = { auto: "Auto-save", export: "Before export", restore: "Before restore", named: "" } as const;
const title = (v: Version) => (v.kind === "named" ? v.label ?? "Version" : KIND_LABEL[v.kind]);
function ago(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function VersionsDialog({ onClose, flush, adoptServerDoc, reportConflict, resolveSrc }: {
  onClose: () => void; flush: () => Promise<boolean>;
  adoptServerDoc: (doc: ChitrapxDoc, revision: number) => void; reportConflict: (revision: number) => void; resolveSrc: ResolveSrc;
}) {
  const store = useEditorStore();
  const projectId = useEditor((s) => s.projectId);
  const conflicted = useEditor((s) => s.locked);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [preview, setPreview] = useState<{ v: Version; doc: ChitrapxDoc } | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api<Version[]>(`/api/projects/${projectId}/versions`).then(setVersions).catch(() => setError("Could not load versions."));
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once per open

  async function open(v: Version) {
    setError("");
    try { setPreview({ v, doc: (await api<{ doc: ChitrapxDoc }>(`/api/projects/${projectId}/versions/${v.id}`)).doc }); }
    catch { setError("Could not open this version."); }
  }
  async function saveNamed() {
    setBusy(true); setError("");
    try {
      if (!(await flush())) { setError("Save your changes first."); return; }
      await api(`/api/projects/${projectId}/versions`, "POST", { label: name });
      setName(""); await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Could not save the version."); }
    finally { setBusy(false); }
  }
  async function restore(v: Version) {
    setBusy(true); setError("");
    try {
      if (!(await flush())) { setError("Save your changes first."); return; }
      const out = await api<{ revision: number; doc: ChitrapxDoc }>(`/api/projects/${projectId}/versions/${v.id}/restore`, "POST", { revision: store.getState().revision });
      adoptServerDoc(out.doc, out.revision);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) { onClose(); reportConflict(store.getState().revision); return; }
      setError(err instanceof ApiError ? err.message : "Could not restore.");
    } finally { setBusy(false); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Version history" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="card grid w-full max-w-3xl gap-4 sm:grid-cols-[1fr_16rem]">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Version history</h2>
            <button type="button" className="btn-ghost" onClick={onClose} aria-label="Close" autoFocus>✕</button>
          </div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void saveNamed(); }}>
            <input className="input flex-1" aria-label="Version name" placeholder="Name this version" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn" disabled={busy || !name.trim()}>Save version</button>
          </form>
          {error && <p role="alert" className="error">{error}</p>}
          {versions === null ? <p className="text-sm text-neutral-500">Loading</p> : versions.length === 0 ? <p className="text-sm text-neutral-500">No versions yet.</p> : (
            <ul className="max-h-96 divide-y divide-neutral-200 overflow-y-auto text-sm dark:divide-neutral-800">
              {versions.map((v) => (
                <li key={v.id}>
                  <button type="button" onClick={() => open(v)} className={`flex w-full justify-between gap-3 px-1 py-2 text-left ${preview?.v.id === v.id ? "bg-indigo-50 dark:bg-indigo-950" : ""}`}>
                    <span className={v.kind === "named" ? "font-medium" : ""}>{title(v)}</span>
                    <span className="text-neutral-500">{ago(v.createdAt)}{v.author ? ` · ${v.author}` : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <aside className="space-y-2">
          {preview ? (
            <>
              <div className="overflow-hidden rounded border border-neutral-200 dark:border-neutral-700">
                {preview.doc.groups[0]?.boards[0]
                  ? <BoardView doc={preview.doc} groupId={preview.doc.groups[0].id} boardIndex={0} locale={preview.doc.localization.baseLocale} scale={240 / preview.doc.groups[0].boards[0].size.width} resolveSrc={resolveSrc} />
                  : <p className="p-4 text-sm text-neutral-500">This version has no boards.</p>}
              </div>
              <button type="button" className="btn w-full" disabled={busy || conflicted} onClick={() => restore(preview.v)}>Restore this version</button>
              <p className="text-xs text-neutral-500">Your current design is saved as “Before restore” first.</p>
            </>
          ) : <p className="text-sm text-neutral-500">Select a version to preview it.</p>}
        </aside>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into `Editor.tsx` and `Toolbar.tsx`**

`Editor.tsx`: `const { status, error, conflict, loadTheirs, keepMine, flush, adoptServerDoc, reportConflict } = useAutosave(store);` and pass `adoptServerDoc`, `reportConflict` and `resolveSrc` to `<Toolbar ... />`.

`Toolbar.tsx`:
- Accept the props `adoptServerDoc: (doc: ChitrapxDoc, revision: number) => void`, `reportConflict: (revision: number) => void` and `resolveSrc: ResolveSrc`.
- Add `const [history, setHistory] = useState(false);`.
- Before the Export button, add:

```tsx
      <button type="button" className="btn-ghost py-1.5" onClick={() => setHistory(true)}>History</button>
      {history && <VersionsDialog onClose={() => setHistory(false)} flush={flush} adoptServerDoc={adoptServerDoc} reportConflict={reportConflict} resolveSrc={resolveSrc} />}
```

Imports: `VersionsDialog` from `./VersionsDialog.tsx`, `type ResolveSrc` from `@chitrapx/renderer`, `type ChitrapxDoc` from `@chitrapx/document`.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @chitrapx/web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(editor): version history dialog with preview, named versions and restore"
```

---

### Task 9: Shared upload, file intake helpers and boards from images

**Files:**
- Create: `apps/web/src/lib/uploadAsset.ts`, `apps/web/src/editor/intake.ts`, `apps/web/test/intake.test.ts`
- Modify: `apps/web/src/components/UploadGrid.tsx` (use `uploadAsset`), `apps/web/src/editor/commands.ts`, `apps/web/test/commands.test.ts`

**Interfaces:**
- Produces:
  - `uploadAsset(appId, kind: "screenshot" | "recording", file: File): Promise<{ id: string }>` (throws `Error` with a `"<file name>: ..."` message)
  - `INTAKE_MAX = 20`, `IMAGE_MAX_BYTES = 25 * 1024 * 1024`
  - `naturalSort(a, b)`
  - `acceptImages(files: File[]): { accepted: File[]; rejected: string[] }`
  - `collectDroppedFiles(dt: DataTransfer): Promise<File[]>`
  - `isFileDrag(dt: DataTransfer | null): boolean`
  - command `addBoardsFromAssets { groupId, sourceBoardId, assetIds: string[], newBoardIds: string[] }`

- [ ] **Step 1: Failing tests**

```ts
// apps/web/test/intake.test.ts
import { describe, expect, it } from "vitest";
import { acceptImages, IMAGE_MAX_BYTES, INTAKE_MAX, naturalSort } from "@/editor/intake.ts";

const f = (name: string, type = "image/png", size = 10) => new File([new Uint8Array(size)], name, { type });

describe("intake", () => {
  it("sorts names naturally", () => {
    expect(["shot10.png", "shot2.png", "Shot1.png"].sort(naturalSort)).toEqual(["Shot1.png", "shot2.png", "shot10.png"]);
  });
  it("keeps PNG, JPEG and WebP; reports others; skips dotfiles silently", () => {
    const out = acceptImages([f("b.jpg", "image/jpeg"), f(".DS_Store", ""), f("notes.txt", "text/plain"), f("a.webp", "image/webp"), f("clip.mov", "video/quicktime")]);
    expect(out.accepted.map((x) => x.name)).toEqual(["a.webp", "b.jpg"]);
    expect(out.rejected).toEqual(["notes.txt: not a PNG, JPEG or WebP image", "clip.mov: not a PNG, JPEG or WebP image"]);
  });
  it("rejects images over 25 MB", () => {
    const out = acceptImages([f("big.png", "image/png", IMAGE_MAX_BYTES + 1), f("ok.png")]);
    expect(out.accepted.map((x) => x.name)).toEqual(["ok.png"]);
    expect(out.rejected).toEqual(["big.png: larger than 25 MB"]);
  });
  it("takes at most 20 per drop", () => {
    const out = acceptImages(Array.from({ length: 23 }, (_, i) => f(`s${i + 1}.png`)));
    expect(out.accepted).toHaveLength(INTAKE_MAX);
    expect(out.accepted.at(-1)!.name).toBe("s20.png");
    expect(out.rejected).toEqual(["3 more files skipped: at most 20 per drop"]);
  });
});
```

Append to `apps/web/test/commands.test.ts`:

```ts
describe("addBoardsFromAssets", () => {
  it("appends one board per image, copying the source board with the image in its first device", () => {
    const withDevice = applyCommand(doc(), { type: "addElement", groupId: "g", boardId: "b1",
      element: { id: "dev", type: "device", deviceType: "iphone-15-pro", position: { x: 0, y: 0 }, size: { width: 10, height: 20 }, rotation: 0, scale: 1 } as never });
    const d = applyCommand(withDevice, { type: "addBoardsFromAssets", groupId: "g", sourceBoardId: "b1", assetIds: ["A1", "A2"], newBoardIds: ["n1", "n2"] });
    const boards = d.groups[0]!.boards;
    expect(boards.map((b) => b.id)).toEqual(["b1", "b2", "n1", "n2"]);
    expect(boards[2]!.elements.map((e) => e.id)).toEqual(["a-n1", "b-n1", "c-n1", "dev-n1"]);
    expect(boards[2]!.elements[3]).toMatchObject({ screenshotSrc: "asset:A1", screenshotRect: { left: 0, top: 0, width: 100, height: 100 } });
    expect(boards[3]!.elements[3]).toMatchObject({ screenshotSrc: "asset:A2" });
  });
  it("adds a full-board image when the source board has no device", () => {
    const d = applyCommand(doc(), { type: "addBoardsFromAssets", groupId: "g", sourceBoardId: "b2", assetIds: ["A1"], newBoardIds: ["n1"] });
    const b = d.groups[0]!.boards.at(-1)!;
    expect(b.elements.at(-1)).toMatchObject({ type: "image", imageSrc: "asset:A1", objectFit: "contain", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 } });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @chitrapx/web exec vitest run test/intake.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: `apps/web/src/editor/intake.ts`**

Adapted from open-screenshot-generator `src/lib/intake/intakeFiles.ts` (MIT).

```ts
export const INTAKE_MAX = 20;
export const IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_DEPTH = 3;

/** "shot2" before "shot10", case-insensitive. */
export const naturalSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** Images we can upload, in natural order and capped per drop; everything else is reported (dotfiles silently skipped). */
export function acceptImages(files: File[]): { accepted: File[]; rejected: string[] } {
  const rejected: string[] = [];
  const ok: File[] = [];
  for (const file of files) {
    if (file.name.startsWith(".")) continue;
    if (!IMAGE_TYPES.has(file.type)) rejected.push(`${file.name}: not a PNG, JPEG or WebP image`);
    else if (file.size > IMAGE_MAX_BYTES) rejected.push(`${file.name}: larger than 25 MB`);
    else ok.push(file);
  }
  ok.sort((a, b) => naturalSort(a.name, b.name));
  if (ok.length > INTAKE_MAX) rejected.push(`${ok.length - INTAKE_MAX} more files skipped: at most ${INTAKE_MAX} per drop`);
  return { accepted: ok.slice(0, INTAKE_MAX), rejected };
}

/** True for drags from the operating system (files), false for element drags inside the page. */
export const isFileDrag = (dt: DataTransfer | null) => !!dt && Array.from(dt.types).includes("Files");

/**
 * Every file in a drop, walking dropped folders up to three levels deep. Entries are read
 * synchronously here because the browser empties the DataTransfer once the drop handler returns.
 */
export function collectDroppedFiles(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items).filter((i) => i.kind === "file");
  const entries = items.map((i) => i.webkitGetAsEntry?.() ?? null);
  const loose = entries.some((e) => e === null) ? Array.from(dt.files) : [];
  return Promise.all(entries.filter((e): e is FileSystemEntry => e !== null).map((e) => walk(e, 0))).then((all) => [...loose, ...all.flat()]);
}

async function walk(entry: FileSystemEntry, depth: number): Promise<File[]> {
  if (entry.isFile) return [await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))];
  if (!entry.isDirectory || depth >= MAX_DEPTH) return [];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    children.push(...batch);
  }
  return (await Promise.all(children.map((c) => walk(c, depth + 1)))).flat();
}
```

- [ ] **Step 4: `apps/web/src/lib/uploadAsset.ts` and `UploadGrid.tsx`**

```ts
import { createClient } from "@/lib/supabase/browser.ts";
import { api } from "@/server/api.ts";

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Signed upload of one file into the app's assets; the server re-checks type, size and checksum. Returns the asset id. */
export async function uploadAsset(appId: string, kind: "screenshot" | "recording", file: File): Promise<{ id: string }> {
  const sha256 = await sha256Hex(file);
  const signed = await api<{ existing?: { id: string }; uploadId?: string; path?: string; token?: string }>("/api/uploads/sign", "POST", {
    appId, kind, size: file.size, mime: file.type, sha256,
  });
  if (signed.existing) return { id: signed.existing.id };
  const { error } = await createClient().storage.from("uploads").uploadToSignedUrl(signed.path!, signed.token!, file, { contentType: file.type });
  if (error) throw new Error(`${file.name}: ${error.message}`);
  const asset = await api<{ id: string }>("/api/uploads/complete", "POST", { appId, kind, sha256, uploadId: signed.uploadId });
  return { id: asset.id };
}
```

In `UploadGrid.tsx`:
- Delete `sha256Hex`.
- Make the body of `uploadOne` after its size check `await uploadAsset(appId, kind, file);`.
- Import `uploadAsset` from `@/lib/uploadAsset.ts`, and remove the `createClient` import if it is no longer used.

- [ ] **Step 5: Command `addBoardsFromAssets`**

Add to the union:

```ts
  | { type: "addBoardsFromAssets"; groupId: string; sourceBoardId: string; assetIds: string[]; newBoardIds: string[] }
```

Add the case:

```ts
      case "addBoardsFromAssets": {
        const g = d.groups.find((x) => x.id === cmd.groupId);
        const src = g?.boards.find((b) => b.id === cmd.sourceBoardId);
        if (!g || !src) return;
        cmd.assetIds.forEach((assetId, n) => {
          const id = cmd.newBoardIds[n];
          if (!id) return;
          const plain = JSON.parse(JSON.stringify(src)) as ArtboardState;
          const idMap = Object.fromEntries(plain.elements.map((e) => [e.id, `${e.id}-${id}`]));
          const elements = plain.elements.map((e) => ({ ...e, id: idMap[e.id]! })) as Array<ArtboardElement & Record<string, unknown>>;
          const deviceEl = elements.find((e) => e.type === "device");
          if (deviceEl) { deviceEl.screenshotSrc = `asset:${assetId}`; deviceEl.screenshotRect ??= FULL_SCREEN; }
          else elements.push({ id: `img-${id}`, type: "image", name: "Screenshot", imageSrc: `asset:${assetId}`, objectFit: "contain",
            position: { x: 0, y: 0 }, size: { ...plain.size }, rotation: 0, scale: 1 } as unknown as ArtboardElement & Record<string, unknown>);
          g.boards.push({
            ...plain, id, name: `Screen ${g.boards.length + 1}`, elements,
            localized: plain.localized && Object.fromEntries(Object.entries(plain.localized).map(([loc, byEl]) =>
              [loc, Object.fromEntries(Object.entries(byEl).map(([eid, ov]) => [idMap[eid] ?? eid, ov]))])),
          } as Draft<ArtboardState>);
        });
        return;
      }
```

- [ ] **Step 6: Verify**

Run: `pnpm --filter @chitrapx/web exec vitest run test/intake.test.ts test/commands.test.ts test/uploads.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(editor): file intake helpers, shared upload, and boards from images"
```

---

### Task 10: Drop on the canvas and import a folder

**Files:**
- Create: `apps/web/src/editor/assets.tsx`, `apps/web/src/editor/useIntake.ts`
- Modify: `apps/web/src/app/editor/[projectId]/page.tsx` (pass `appId`), `apps/web/src/editor/Editor.tsx`, `apps/web/src/editor/ui/Canvas.tsx`, `apps/web/src/editor/ui/LeftPanel.tsx`, `apps/web/src/editor/ui/Inspector.tsx`, `apps/web/src/editor/ui/Toolbar.tsx` (read assets from context)

**Interfaces:**
- Consumes: `uploadAsset`, `acceptImages`, `collectDroppedFiles`, `isFileDrag`, `addBoardsFromAssets`, `setScreenshot`, `addElement`, Canvas's `hittable` (Task 3).
- Produces:
  - `EditorAssetsProvider` and `useEditorAssets(): { appId; assets: PickerAsset[]; resolveSrc: ResolveSrc; refresh(): Promise<PickerAsset[]> }`
  - `useIntake(): { progress; errors; pending: { assetIds; at } | null; dropFiles(files, at); importBoards(files); choose(mode); clearErrors() }`

- [ ] **Step 1: `apps/web/src/editor/assets.tsx`**

```tsx
"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ResolveSrc } from "@chitrapx/renderer";
import { api } from "@/server/api.ts";
import type { PickerAsset } from "./ui/fields.tsx";

type Row = PickerAsset & { videoUrl?: string };
type Value = { appId: string; assets: PickerAsset[]; resolveSrc: ResolveSrc; refresh(): Promise<PickerAsset[]> };
const Ctx = createContext<Value | null>(null);

/** The app's uploads and their signed URLs; refreshed after the editor uploads something. */
export function EditorAssetsProvider({ appId, assets: initial, urls: initialUrls, children }: {
  appId: string; assets: PickerAsset[]; urls: Record<string, string>; children: React.ReactNode;
}) {
  const [assets, setAssets] = useState(initial);
  const [urls, setUrls] = useState(initialUrls);
  const resolveSrc = useCallback<ResolveSrc>((src) => urls[src] ?? null, [urls]);
  const refresh = useCallback(async () => {
    const rows = await api<Row[]>(`/api/apps/${appId}/assets`);
    const usable = rows.filter((a) => a.kind !== "recording" || a.videoUrl);
    const picked = usable.map(({ id, url, width, height, kind }) => ({ id, url, width, height, kind }));
    setAssets(picked);
    setUrls((u) => ({ ...u, ...Object.fromEntries(usable.flatMap((a) => a.kind === "recording"
      ? [[`asset:${a.id}`, a.videoUrl!], [`asset:${a.id}#poster`, a.url]] : [[`asset:${a.id}`, a.url]])) }));
    return picked;
  }, [appId]);
  const value = useMemo(() => ({ appId, assets, resolveSrc, refresh }), [appId, assets, resolveSrc, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEditorAssets(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEditorAssets outside EditorAssetsProvider");
  return v;
}
```

Check `PickerAsset` in `fields.tsx` has `{ id, url, width, height, kind }`; if its fields differ, keep the mapping in line with that type.

- [ ] **Step 2: `apps/web/src/editor/useIntake.ts`**

```ts
"use client";

import { useRef, useState } from "react";
import type { ArtboardElement } from "@chitrapx/document";
import { uploadAsset } from "@/lib/uploadAsset.ts";
import { useEditorAssets } from "./assets.tsx";
import type { Ref } from "./commands.ts";
import { useEditorStore } from "./context.tsx";
import { acceptImages } from "./intake.ts";

export type DropAt = { boardId: string; x: number; y: number; device?: Ref };
type Sizes = Map<string, { width: number; height: number }>;

/** Uploads dropped or picked images and places them: into a device, as images, or as new boards. */
export function useIntake() {
  const store = useEditorStore();
  const { appId, refresh } = useEditorAssets();
  const [progress, setProgress] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState<{ assetIds: string[]; at: DropAt } | null>(null);
  const sizes = useRef<Sizes>(new Map());

  async function upload(files: File[]): Promise<string[]> {
    const { accepted, rejected } = acceptImages(files);
    const failed = [...rejected];
    const ids: string[] = [];
    for (const [i, file] of accepted.entries()) {
      setProgress(`Uploading ${i + 1} of ${accepted.length}`);
      try { ids.push((await uploadAsset(appId, "screenshot", file)).id); }
      catch (err) { const m = (err as Error).message; failed.push(m.startsWith(file.name) ? m : `${file.name}: ${m}`); }
    }
    setProgress("");
    setErrors(failed);
    if (ids.length) {
      const rows = await refresh();
      sizes.current = new Map(rows.map((r) => [r.id, { width: r.width ?? 1000, height: r.height ?? 2000 }]));
    }
    return ids;
  }

  function addImages(ids: string[], at: DropAt) {
    const s = store.getState();
    const board = s.doc.groups.find((g) => g.id === s.activeGroupId)?.boards.find((b) => b.id === at.boardId);
    if (!board) return;
    const w = board.size.width * 0.5;
    ids.forEach((id, n) => {
      const sz = sizes.current.get(id) ?? { width: 1000, height: 2000 };
      const h = (w * sz.height) / sz.width;
      const element = { id: crypto.randomUUID(), type: "image", name: "Screenshot", imageSrc: `asset:${id}`, objectFit: "contain",
        position: { x: at.x - w / 2 + n * 40, y: at.y - h / 2 + n * 40 }, size: { width: w, height: h }, rotation: 0, scale: 1 } as unknown as ArtboardElement;
      s.apply({ type: "addElement", groupId: s.activeGroupId, boardId: at.boardId, element });
    });
  }

  function addBoards(ids: string[], sourceBoardId: string) {
    const s = store.getState();
    s.apply({ type: "addBoardsFromAssets", groupId: s.activeGroupId, sourceBoardId, assetIds: ids, newBoardIds: ids.map(() => crypto.randomUUID()) });
  }

  async function dropFiles(files: File[], at: DropAt) {
    const ids = await upload(files);
    if (!ids.length) return;
    const s = store.getState();
    if (ids.length === 1 && at.device) {
      const base = s.doc.localization.baseLocale;
      s.apply({ type: "setScreenshot", ref: at.device, src: `asset:${ids[0]}`, locale: s.locale !== base ? s.locale : undefined });
    } else if (ids.length === 1) addImages(ids, at);
    else setPending({ assetIds: ids, at });
  }

  async function importBoards(files: File[]) {
    const ids = await upload(files);
    const boardId = store.getState().activeBoardId;
    if (ids.length && boardId) addBoards(ids, boardId);
  }

  function choose(mode: "here" | "boards" | "cancel") {
    if (pending && mode === "here") addImages(pending.assetIds, pending.at);
    if (pending && mode === "boards") addBoards(pending.assetIds, pending.at.boardId);
    setPending(null);
  }

  return { progress, errors, pending, dropFiles, importBoards, choose, clearErrors: () => setErrors([]) };
}
```

- [ ] **Step 3: Editor and page wiring**

`apps/web/src/app/editor/[projectId]/page.tsx`: pass `appId={project.appId}` to `<Editor>`.

`Editor.tsx`:
- Add the `appId: string` prop.
- Wrap the children of `EditorContext.Provider` in `<EditorAssetsProvider appId={appId} assets={assets} urls={assetUrls}>`.
- Remove the `resolveSrc` `useCallback`.
- Render `<Canvas />` and `<Inspector />` without props. They and `Toolbar` read `resolveSrc` / `assets` from `useEditorAssets()`. Update their prop types (Canvas drops `resolveSrc`, Inspector drops `assets`, Toolbar drops `resolveSrc`).
- `Toolbar` passes `resolveSrc` from the hook to `VersionsDialog`.

- [ ] **Step 4: Canvas drop**

In `Canvas.tsx`:
- Add `const { resolveSrc } = useEditorAssets(); const intake = useIntake(); const [fileOver, setFileOver] = useState(false);`.
- Import `isFileDrag, collectDroppedFiles` from `../intake.ts`, `useIntake` from `../useIntake.ts`, and `useEditorAssets` from `../assets.tsx`.
- Add to the viewport `div`:

```tsx
      onDragOver={(e) => { if (!isFileDrag(e.dataTransfer)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setFileOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setFileOver(false); }}
      onDrop={(e) => {
        if (!isFileDrag(e.dataTransfer) || !layer.current || !group) return;
        e.preventDefault();
        setFileOver(false);
        const files = collectDroppedFiles(e.dataTransfer); // must start before this handler returns
        const p = toStrip(e);
        const i = Math.max(0, Math.min(group.boards.length - 1, Math.floor(p.x / boardW)));
        const board = group.boards[i]!;
        const device = [...hittable].reverse().find((it) => {
          if (it.ref.boardId !== board.id || it.el.type !== "device") return false;
          const b = boxOf(it.el, it.offset);
          return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
        });
        void files.then((list) => intake.dropFiles(list, { boardId: board.id, x: p.x - i * boardW, y: p.y, device: device?.ref }));
      }}
```

As the last children of the viewport `div` (it already has `relative`):

```tsx
      {fileOver && <div className="pointer-events-none absolute inset-0 z-10 border-4 border-dashed border-indigo-500 bg-indigo-500/10" aria-hidden />}
      {(intake.progress || intake.errors.length > 0 || intake.pending) && (
        <div className="sticky bottom-4 left-4 z-20 m-4 max-w-sm space-y-2 rounded-md bg-white p-3 text-sm shadow dark:bg-neutral-800" role="status">
          {intake.progress && <p>{intake.progress}</p>}
          {intake.pending && (
            <div className="space-y-1">
              <p>{intake.pending.assetIds.length} images uploaded.</p>
              <div className="flex gap-1">
                <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => intake.choose("boards")}>Create a board for each</button>
                <button type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={() => intake.choose("here")}>Add here as images</button>
              </div>
            </div>
          )}
          {intake.errors.length > 0 && (
            <div>
              <ul className="error list-disc pl-4 text-xs">{intake.errors.map((m) => <li key={m}>{m}</li>)}</ul>
              <button type="button" className="text-xs text-neutral-500 hover:underline" onClick={intake.clearErrors}>Dismiss</button>
            </div>
          )}
        </div>
      )}
```

The `if (!group) return ...` early return in `Canvas` sits after the hooks. Keep all new hooks above it.

- [ ] **Step 5: Import folder button**

In `LeftPanel.tsx`, add `const intake = useIntake();` at the top of `LeftPanel` (import from `../useIntake.ts`). In the Boards section header, next to "Add board":

```tsx
          <label className="cursor-pointer text-xs text-indigo-600 hover:underline">
            Import folder
            <input type="file" multiple accept="image/png,image/jpeg,image/webp" className="sr-only" {...{ webkitdirectory: "" }}
              onChange={(e) => { const list = Array.from(e.target.files ?? []); e.target.value = ""; if (list.length) void intake.importBoards(list); }} />
          </label>
```

Under the board list (next to the existing `png.error` line):

```tsx
        {intake.progress && <p className="text-xs text-neutral-500">{intake.progress}</p>}
        {intake.errors.length > 0 && <ul className="error list-disc pl-4 text-xs" role="alert">{intake.errors.map((m) => <li key={m}>{m}</li>)}</ul>}
```

- [ ] **Step 6: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @chitrapx/web test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(editor): drop images on the canvas and import a folder as boards"
```

---

### Task 11: Status bar

**Files:**
- Create: `packages/document/src/deviceStatusBar.ts`, `packages/document/test/deviceStatusBar.test.ts`, `packages/renderer/src/osg/elements/StatusBar.tsx`
- Modify: `packages/document/src/index.ts`, `packages/renderer/src/osg/elements/DeviceFrameElement.tsx:378-432`, `apps/web/src/editor/ui/Inspector.tsx` (device section), `apps/worker/test-e2e/export.test.ts`
- Create (generated): `packages/assets/golden/status-bar-ios.png`

**Interfaces:**
- Produces: `statusBarSpec(deviceType: string): { platform: "ios" | "android"; heightPct: number } | null`

- [ ] **Step 1: Failing test**

```ts
// packages/document/test/deviceStatusBar.test.ts
import { describe, expect, it } from "vitest";
import { statusBarSpec } from "../src/index.ts";

describe("statusBarSpec", () => {
  it("iPhones with a Dynamic Island use the iOS bar", () => {
    for (const t of ["iphone-15", "iphone-15-pro", "iphone-17-pro-max"]) expect(statusBarSpec(t)).toEqual({ platform: "ios", heightPct: 6.9 });
  });
  it("Android phones use the Android bar", () => {
    for (const t of ["android-punch-hole", "android-notch", "android-bar"]) expect(statusBarSpec(t)).toEqual({ platform: "android", heightPct: 5.9 });
  });
  it("other devices have none", () => {
    for (const t of ["ipad-pro-13", "apple-watch", "macbook", "custom", "nope"]) expect(statusBarSpec(t)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @chitrapx/document exec vitest run test/deviceStatusBar.test.ts`
Expected: FAIL.

- [ ] **Step 3: `packages/document/src/deviceStatusBar.ts`**

```ts
/**
 * Simulated status bar per device type, as a percentage of the screen height. Values follow
 * PixelDeck's mockup specs (MIT): Dynamic Island 59 / 852 pt, Android punch-hole 48 / 820.
 */
const SPECS: Record<string, { platform: "ios" | "android"; heightPct: number }> = {
  "iphone-15": { platform: "ios", heightPct: 6.9 },
  "iphone-15-pro": { platform: "ios", heightPct: 6.9 },
  "iphone-17-pro-max": { platform: "ios", heightPct: 6.9 },
  "android-punch-hole": { platform: "android", heightPct: 5.9 },
  "android-notch": { platform: "android", heightPct: 5.9 },
  "android-bar": { platform: "android", heightPct: 5.9 },
};

export function statusBarSpec(deviceType: string): { platform: "ios" | "android"; heightPct: number } | null {
  return SPECS[deviceType] ?? null;
}
```

Add `export * from "./deviceStatusBar.ts";` to `index.ts`. Run the test — Expected: PASS.

- [ ] **Step 4: `packages/renderer/src/osg/elements/StatusBar.tsx`**

SVG/HTML port of PixelDeck `src/components/canvas/PhoneStatusBar.tsx` (MIT).

```tsx
import type { CSSProperties } from 'react';

/**
 * A simulated phone status bar laid over the top of the screen. Sized with container query
 * units so it scales with the screen. theme 'dark' = dark text and icons (for light screenshots).
 */
export function StatusBar({ platform, theme, background, color, time, heightPct }: {
  platform: 'ios' | 'android'; theme: 'light' | 'dark'; background: 'transparent' | 'solid'; color?: string; time: string; heightPct: number;
}) {
  const ink = theme === 'dark' ? '#000000' : '#ffffff';
  const box: CSSProperties = {
    position: 'absolute', top: 0, left: 0, right: 0, height: `${heightPct}%`, zIndex: 2, containerType: 'size',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: platform === 'ios' ? '0 7% 0 9%' : '0 5% 0 5%',
    background: background === 'solid' ? color ?? '#ffffff' : 'transparent', color: ink,
    fontFamily: platform === 'ios' ? '-apple-system, "SF Pro Text", Inter, sans-serif' : 'Roboto, Inter, sans-serif',
    fontWeight: platform === 'ios' ? 600 : 500, fontSize: platform === 'ios' ? '38cqh' : '34cqh', lineHeight: 1,
  };
  const icon: CSSProperties = { height: '32cqh', width: 'auto', display: 'block' };
  return (
    <div style={box} data-status-bar={platform} aria-hidden>
      <span>{time}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: '8cqh' }}>
        {platform === 'ios' ? (
          <>
            <svg viewBox="0 0 18 12" style={icon} fill={ink}>{[0, 1, 2, 3].map((i) => <rect key={i} x={i * 4.7} y={9 - i * 3} width="3.2" height={3 + i * 3} rx="0.8" />)}</svg>
            <svg viewBox="-2 0 20 12" style={icon} fill={ink}><path d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0L8 11.5Zm-4.2-4.3L2.1 5.5a8.4 8.4 0 0 1 11.8 0l-1.7 1.7a6 6 0 0 0-8.4 0ZM.4 3.8-1.3 2.1a13 13 0 0 1 18.6 0l-1.7 1.7A10.7 10.7 0 0 0 .4 3.8Z" /></svg>
            <svg viewBox="0 0 27 12" style={icon}><rect x="0.5" y="0.5" width="22" height="11" rx="3.2" fill="none" stroke={ink} strokeOpacity="0.4" /><rect x="2" y="2" width="19" height="8" rx="2" fill={ink} /><rect x="24" y="4" width="2" height="4" rx="1" fill={ink} fillOpacity="0.4" /></svg>
          </>
        ) : (
          <>
            <svg viewBox="0 0 16 12" style={icon} fill={ink}><path d="M8 12 0 3.6a11.6 11.6 0 0 1 16 0L8 12Z" /></svg>
            <svg viewBox="0 0 12 12" style={icon} fill={ink}><path d="M12 0v12H0L12 0Z" /></svg>
            <svg viewBox="0 0 8 14" style={{ ...icon, height: '40cqh' }} fill={ink}><rect x="2.5" y="0" width="3" height="1.5" /><rect x="0" y="1.5" width="8" height="12.5" rx="1.2" /></svg>
          </>
        )}
      </span>
    </div>
  );
}
```

- [ ] **Step 5: Mount in `DeviceFrameElement.tsx`**

Import `statusBarSpec` from `@chitrapx/document` and `StatusBar` from `./StatusBar`. Just before the final (non-3D) `return`, add:

```ts
  const bar = element.showStatusBar ? statusBarSpec(element.deviceType) : null;
  const solidShift = bar && element.statusBarBg === 'solid' ? bar.heightPct : 0;
```

Inside the screen `div` (`data-device-screen`), right after `{notchElement}`, add:

```tsx
            {bar && (
              <StatusBar platform={element.statusBarPlatform ?? bar.platform} theme={element.statusBarTheme ?? 'dark'}
                background={element.statusBarBg ?? 'transparent'} color={element.statusBarColor} time={element.statusBarTime ?? '9:41'} heightPct={bar.heightPct} />
            )}
```

In the screenshot container's style, change the `top` line to:

```ts
                  top: `${element.screenshotRect.top + solidShift}%`,
```

The 3D branch returns earlier, so 3D devices never draw the bar. If `@chitrapx/renderer` does not depend on `@chitrapx/document` at runtime (check its `package.json`), move `deviceStatusBar.ts` into `packages/renderer/src/osg/lib/` instead. In that case, import it in the inspector from `@chitrapx/renderer`, and note the move in the report.

- [ ] **Step 6: Inspector device fields**

In `Inspector.tsx`, inside the `el.type === "device"` block, add after the existing device fields:

```tsx
          {(() => {
            const spec = statusBarSpec(a.deviceType ?? "");
            if (!spec) return null;
            const is3d = /^3d-/.test(a.styleType ?? "");
            return (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" disabled={is3d} checked={!!a.showStatusBar && !is3d}
                    onChange={(e) => set(e.target.checked
                      ? { showStatusBar: true, statusBarPlatform: a.statusBarPlatform ?? spec.platform, statusBarTheme: a.statusBarTheme ?? "dark", statusBarBg: a.statusBarBg ?? "transparent", statusBarTime: a.statusBarTime ?? "9:41" }
                      : { showStatusBar: false })} />
                  Status bar
                </label>
                {is3d && <p className="text-xs text-neutral-500">Not available on 3D devices.</p>}
                {a.showStatusBar && !is3d && (
                  <div className="grid grid-cols-2 gap-2">
                    <SelectField id="i-sb-platform" label="Style" value={a.statusBarPlatform ?? spec.platform} options={[["ios", "iOS"], ["android", "Android"]] as const} onChange={(v) => set({ statusBarPlatform: v })} />
                    <SelectField id="i-sb-theme" label="Icons" value={a.statusBarTheme ?? "dark"} options={[["dark", "Dark"], ["light", "Light"]] as const} onChange={(v) => set({ statusBarTheme: v })} />
                    <SelectField id="i-sb-bg" label="Background" value={a.statusBarBg ?? "transparent"} options={[["transparent", "Transparent"], ["solid", "Solid"]] as const} onChange={(v) => set({ statusBarBg: v })} />
                    <Row label="Time" htmlFor="i-sb-time">
                      <input id="i-sb-time" className="input" value={a.statusBarTime ?? "9:41"} maxLength={5} {...g}
                        onChange={(e) => { if (/^\d{0,2}:?\d{0,2}$/.test(e.target.value)) set({ statusBarTime: e.target.value }); }} />
                    </Row>
                    {a.statusBarBg === "solid" && <ColorField id="i-sb-color" label="Bar colour" value={a.statusBarColor ?? "#ffffff"} onChange={(v) => set({ statusBarColor: v })} />}
                  </div>
                )}
              </div>
            );
          })()}
```

Add to the local `AnyFields` type: `showStatusBar?: boolean; statusBarPlatform?: "ios" | "android"; statusBarTheme?: "light" | "dark"; statusBarBg?: "transparent" | "solid"; statusBarColor?: string; statusBarTime?: string; styleType?: string; deviceType?: string`. Import `statusBarSpec`.

A half-typed time like `9:` fails `migrate` on save with a 400. Autosave shows the error and saves again after the next change, so finishing the time recovers.

- [ ] **Step 7: E2E — hidden element and status bar golden**

Append to `apps/worker/test-e2e/export.test.ts`, reusing its helpers `workspaceWithApp`, `newProject`, `pinnedExport`, `storageApi`, `compareGolden`, `jobRow` and `templateDoc`:

```ts
describe("editor essentials (SP9)", () => {
  async function singlePng(ws: string, appId: string, doc: ChitrapxDoc) {
    const g = doc.groups[0]!;
    const id = await newProject(ws, appId, doc);
    const j = await pinnedExport(ws, id, { targets: [g.target], locales: [doc.localization.baseLocale], board: { groupId: g.id, boardIndex: 0 } }, "export_single");
    await runJob(j, (input, job) => runExport(input, job, "single"));
    expect((await jobRow(j)).status).toBe("done");
    const { data, error } = await storageApi().from(EXPORTS_BUCKET).download(`${ws}/${j}.png`);
    if (error) throw error;
    return Buffer.from(await data.arrayBuffer());
  }

  it("a hidden element is not in the exported PNG", async () => {
    const doc = await templateDoc("amoura-dating");
    const { ws, appId } = await workspaceWithApp();
    const shown = PNG.sync.read(await singlePng(ws, appId, doc));
    const hiddenDoc = JSON.parse(JSON.stringify(doc)) as ChitrapxDoc;
    const t = hiddenDoc.groups[0]!.boards[0]!.elements.find((e) => e.type === "text") as { hidden?: boolean };
    t.hidden = true;
    const hidden = PNG.sync.read(await singlePng(ws, appId, hiddenDoc));
    expect(pixelmatch(shown.data, hidden.data, null, shown.width, shown.height, { threshold: 0.1 })).toBeGreaterThan(1000);
  }, 180_000);

  it("an iPhone with a solid iOS status bar matches its golden image", async () => {
    const doc = await templateDoc("amoura-dating");
    const dev = doc.groups[0]!.boards[0]!.elements.find((e) => e.type === "device") as Record<string, unknown>;
    Object.assign(dev, { deviceType: "iphone-15-pro", styleType: "normal", showStatusBar: true, statusBarPlatform: "ios", statusBarTheme: "dark", statusBarBg: "solid", statusBarColor: "#ffffff", statusBarTime: "9:41" });
    const { ws, appId } = await workspaceWithApp();
    compareGolden("status-bar-ios.png", await singlePng(ws, appId, doc));
  }, 120_000);
});
```

Generate and inspect the golden (the web dev server must be running on http://localhost:3000):
- Run `UPDATE_GOLDEN=1 pnpm --filter @chitrapx/worker exec vitest run --config vitest.e2e.config.ts -t "status bar"`.
- Open `packages/assets/golden/status-bar-ios.png` and confirm the bar shows "9:41", signal, Wi-Fi and battery above the screenshot, with the Dynamic Island visible.
- Then run the whole suite: `pnpm --filter @chitrapx/worker test:e2e`. Existing goldens must stay unchanged.

- [ ] **Step 8: Verify**

Run: `pnpm test && pnpm typecheck && pnpm lint`, then the e2e suite as above.
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages apps/web apps/worker
git commit -m "feat: simulated iOS and Android status bar on phones, in editor and exports"
```

---

## Manual browser checks (after all tasks; magic-link login blocks automation)

1. **Layers panel:** drag a layer to the top and confirm the canvas stacking changes. Press Space on a row, then the arrow keys, to reorder with the keyboard.
2. **Lock:** lock an element; clicking and dragging it on the canvas does nothing. Unlock it from the panel.
3. **Hide:** hide an element; it disappears from the canvas and from a Download PNG.
4. **Group:** select two elements and press ⌘/Ctrl+G; dragging one moves both, and Alt-click selects one. Then ⌘/Ctrl+Shift+G ungroups.
5. **Presets:** Phone → Tilt rotates the phone; Text → Bottom moves the headline.
6. **Apply to all:**
   - "Apply position to all boards" asks first, then moves the matching element on the other boards.
   - "Apply layout to all languages" keeps German text.
7. **Drop and import:**
   - Drop one PNG on a device; it fills the screen.
   - Drop three PNGs; the chooser appears.
   - Import a folder of five images; five new boards appear in name order.
8. **History:** Save a named version, make a change, then restore it. The design returns, and a "Before restore" entry appears.
9. **Status bar:** turn it on for an iPhone. Switch Solid/Transparent and Light/Dark; the export matches the canvas.
