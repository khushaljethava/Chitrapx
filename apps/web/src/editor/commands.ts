import { produce, type Draft } from "immer";
import {
  applyTexts, layoutFor, matchElements, LAYOUT_KEYS, presetKind, retarget, type LayoutPreset, type ArtboardElement, type ArtboardState, type BoardGroup, type ChitrapxDoc, type ElementLocaleOverride, type TargetId,
} from "@chitrapx/document";

/** An element: on a board, or a span element of its group when `boardId` is null (strip coordinates). */
export type Ref = { groupId: string; boardId: string | null; elementId: string };

export type Command =
  | { type: "applyToAllBoards"; groupId: string; sourceRef: Ref }
  | { type: "applyLayoutToLocales"; groupId: string; boardId: string }
  | { type: "applyLayoutPreset"; groupId: string; boardId: string; preset: LayoutPreset; elementIds?: string[] }
  | { type: "updateElement"; ref: Ref; props: Partial<ArtboardElement> }
  | { type: "moveElements"; refs: Ref[]; dx: number; dy: number }
  | { type: "addElement"; groupId: string; boardId: string | null; element: ArtboardElement }
  | { type: "deleteElements"; refs: Ref[] }
  | { type: "duplicateElements"; refs: Ref[]; newIds: string[]; offset: number }
  | { type: "reorderElement"; ref: Ref; to: "front" | "back" | "forward" | "backward" }
  | { type: "addBoard"; groupId: string; board: ArtboardState; index?: number }
  | { type: "addBoardsFromAssets"; groupId: string; sourceBoardId: string; assetIds: string[]; newBoardIds: string[] }
  | { type: "duplicateBoard"; groupId: string; boardId: string; newBoardId: string; idSuffix: string }
  | { type: "deleteBoard"; groupId: string; boardId: string }
  | { type: "moveBoard"; groupId: string; boardId: string; toIndex: number }
  | { type: "updateBoard"; groupId: string; boardId: string; props: Partial<ArtboardState> }
  | { type: "setOverride"; ref: Ref; locale: string; props: Partial<ElementLocaleOverride> }
  | { type: "resetOverride"; ref: Ref; locale: string; keys: string[] }
  | { type: "setScreenshot"; ref: Ref; src: string | undefined; locale?: string }
  | { type: "addLocale"; code: string }
  | { type: "removeLocale"; code: string }
  | { type: "addGroupFromTarget"; fromGroupId: string; target: TargetId; newGroupId: string }
  | { type: "deleteGroup"; groupId: string }
  | { type: "duplicateGroupAsVariant"; groupId: string; newGroupId: string }
  | { type: "reorderElementTo"; ref: Ref; toIndex: number; elementGroupId?: string | null }
  | { type: "setElementsLocked"; refs: Ref[]; locked: boolean }
  | { type: "setElementsHidden"; refs: Ref[]; hidden: boolean }
  | { type: "groupElements"; refs: Ref[]; elementGroupId: string; name?: string }
  | { type: "ungroupElements"; refs: Ref[] }
  | { type: "renameGroup"; groupId: string; boardId: string | null; elementGroupId: string; name: string }
  | { type: "setTexts"; texts: Array<{ id: string; text: string }> };

const FULL_SCREEN = { left: 0, top: 0, width: 100, height: 100 };

function list(d: Draft<ChitrapxDoc> | ChitrapxDoc, groupId: string, boardId: string | null): ArtboardElement[] | undefined {
  const g = d.groups.find((x) => x.id === groupId);
  if (!g) return undefined;
  return (boardId === null ? g.spanElements : g.boards.find((b) => b.id === boardId)?.elements) as ArtboardElement[] | undefined;
}

/** The element list a ref points into: a board's elements, or the group's span elements when `boardId` is null. */
export const elementsOf = (d: ChitrapxDoc, groupId: string, boardId: string | null): ArtboardElement[] | undefined => list(d, groupId, boardId);

/** A group tag with one member left in its list is meaningless: clear it. */
function dissolveSingletons(els: Array<{ groupId?: string; groupName?: string }>) {
  const counts = new Map<string, number>();
  for (const e of els) if (e.groupId) counts.set(e.groupId, (counts.get(e.groupId) ?? 0) + 1);
  for (const e of els) if (e.groupId && counts.get(e.groupId) === 1) { delete e.groupId; delete e.groupName; }
}

export function findElement(d: ChitrapxDoc, ref: Ref): ArtboardElement | undefined {
  return list(d, ref.groupId, ref.boardId)?.find((e) => e.id === ref.elementId);
}
const findBoard = (d: Draft<ChitrapxDoc>, groupId: string, boardId: string) =>
  d.groups.find((g) => g.id === groupId)?.boards.find((b) => b.id === boardId);

/** The only way the document changes. Pure: returns a new document (structurally shared), never mutates. */
export function applyCommand(doc: ChitrapxDoc, cmd: Command): ChitrapxDoc {
  if (cmd.type === "setTexts") return applyTexts(doc, cmd.texts);
  return produce(doc, (d) => {
    switch (cmd.type) {
      case "updateElement": {
        const el = list(d, cmd.ref.groupId, cmd.ref.boardId)?.find((e) => e.id === cmd.ref.elementId);
        if (el) Object.assign(el, cmd.props);
        return;
      }
      case "moveElements":
        for (const ref of cmd.refs) {
          const el = list(d, ref.groupId, ref.boardId)?.find((e) => e.id === ref.elementId);
          if (el) el.position = { x: el.position.x + cmd.dx, y: el.position.y + cmd.dy };
        }
        return;
      case "addElement":
        list(d, cmd.groupId, cmd.boardId)?.push(cmd.element as Draft<ArtboardElement>);
        return;
      case "deleteElements":
        for (const ref of cmd.refs) {
          const els = list(d, ref.groupId, ref.boardId);
          const i = els?.findIndex((e) => e.id === ref.elementId) ?? -1;
          if (els && i >= 0) { els.splice(i, 1); dissolveSingletons(els); }
        }
        return;
      case "duplicateElements":
        cmd.refs.forEach((ref, n) => {
          const els = list(d, ref.groupId, ref.boardId);
          const i = els?.findIndex((e) => e.id === ref.elementId) ?? -1;
          if (!els || i < 0 || !cmd.newIds[n]) return;
          const src = els[i]!;
          const copy = { ...JSON.parse(JSON.stringify(src)), id: cmd.newIds[n], position: { x: src.position.x + cmd.offset, y: src.position.y + cmd.offset } };
          // Copies of a group form their own group; one copied member alone is dissolved below.
          if (src.groupId) copy.groupId = `${src.groupId}-${cmd.newIds[0]}`;
          els.splice(i + 1, 0, copy);
          // Translations follow the copy.
          const b = ref.boardId ? findBoard(d, ref.groupId, ref.boardId) : undefined;
          for (const byEl of Object.values(b?.localized ?? {})) {
            if (byEl[src.id]) byEl[cmd.newIds[n]!] = JSON.parse(JSON.stringify(byEl[src.id]));
          }
        });
        for (const ref of cmd.refs) { const els = list(d, ref.groupId, ref.boardId); if (els) dissolveSingletons(els); }
        return;
      case "reorderElement": {
        const els = list(d, cmd.ref.groupId, cmd.ref.boardId);
        const i = els?.findIndex((e) => e.id === cmd.ref.elementId) ?? -1;
        if (!els || i < 0) return;
        const [el] = els.splice(i, 1);
        const to = { front: els.length, back: 0, forward: Math.min(els.length, i + 1), backward: Math.max(0, i - 1) }[cmd.to];
        els.splice(to, 0, el!);
        return;
      }
      case "reorderElementTo": {
        const els = list(d, cmd.ref.groupId, cmd.ref.boardId);
        const i = els?.findIndex((e) => e.id === cmd.ref.elementId) ?? -1;
        if (!els || i < 0) return;
        const cur = els[i]!;
        const target = Math.max(0, Math.min(els.length - 1, cmd.toIndex));
        const newName = typeof cmd.elementGroupId === "string" ? els.find((e) => e !== cur && e.groupId === cmd.elementGroupId)?.groupName : undefined;
        const sameGroup = cmd.elementGroupId === undefined
          || (cmd.elementGroupId === null ? !cur.groupId : cur.groupId === cmd.elementGroupId && cur.groupName === newName);
        if (target === i && sameGroup) return; // nothing changes: no undo step
        const [el] = els.splice(i, 1);
        els.splice(target, 0, el!);
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
        if (next.some((e, i) => e !== els[i])) els.splice(0, els.length, ...next);
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
      case "addBoard": {
        const g = d.groups.find((x) => x.id === cmd.groupId);
        g?.boards.splice(cmd.index ?? g.boards.length, 0, cmd.board as Draft<ArtboardState>);
        return;
      }
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
          const devId = deviceEl?.id;
          g.boards.push({
            ...plain, id, name: `Screen ${g.boards.length + 1}`, elements,
            localized: plain.localized && Object.fromEntries(Object.entries(plain.localized).map(([loc, byEl]) =>
              [loc, Object.fromEntries(Object.entries(byEl).flatMap(([eid, ov]) => {
                const nid = idMap[eid] ?? eid;
                if (nid !== devId) return [[nid, ov]];
                const { screenshotSrc: _drop, ...rest } = ov as Record<string, unknown>;
                return Object.keys(rest).length ? [[nid, rest]] : [];
              }))])),
          } as Draft<ArtboardState>);
        });
        return;
      }
      case "duplicateBoard": {
        const g = d.groups.find((x) => x.id === cmd.groupId);
        const i = g?.boards.findIndex((b) => b.id === cmd.boardId) ?? -1;
        if (!g || i < 0) return;
        const src = JSON.parse(JSON.stringify(g.boards[i])) as ArtboardState;
        const idMap = Object.fromEntries(src.elements.map((e) => [e.id, `${e.id}-${cmd.idSuffix}`]));
        const copy: ArtboardState = {
          ...src, id: cmd.newBoardId, name: `${src.name} copy`,
          elements: src.elements.map((e) => ({ ...e, id: idMap[e.id]! })),
          localized: src.localized && Object.fromEntries(Object.entries(src.localized).map(([loc, byEl]) =>
            [loc, Object.fromEntries(Object.entries(byEl).map(([id, ov]) => [idMap[id] ?? id, ov]))])),
        };
        g.boards.splice(i + 1, 0, copy as Draft<ArtboardState>);
        return;
      }
      case "deleteBoard":
      case "moveBoard": {
        const g = d.groups.find((x) => x.id === cmd.groupId);
        const i = g?.boards.findIndex((b) => b.id === cmd.boardId) ?? -1;
        if (!g || i < 0) return;
        if (cmd.type === "deleteBoard" && g.boards.length <= 1) return; // a group always keeps one board
        const w = g.boards[0]!.size.width;
        const before = g.boards.map((b) => b.id);
        if (cmd.type === "deleteBoard") g.boards.splice(i, 1);
        else {
          const [b] = g.boards.splice(i, 1);
          g.boards.splice(Math.max(0, Math.min(g.boards.length, cmd.toIndex)), 0, b!);
        }
        // Span elements are in strip coordinates: keep each on the board it started on.
        const after = g.boards.map((b) => b.id);
        for (const el of g.spanElements) {
          const from = Math.max(0, Math.min(before.length - 1, Math.floor(el.position.x / w)));
          const to = after.indexOf(before[from]!);
          const target = to >= 0 ? to : Math.min(from, after.length - 1); // its board is gone: stay in that slot
          el.position = { ...el.position, x: el.position.x + (target - from) * w };
        }
        return;
      }
      case "applyToAllBoards": {
        const g = d.groups.find((x) => x.id === cmd.groupId);
        const src = cmd.sourceRef.boardId ? g?.boards.find((b) => b.id === cmd.sourceRef.boardId) : undefined;
        const el = src?.elements.find((e) => e.id === cmd.sourceRef.elementId) as (ArtboardElement & Record<string, unknown>) | undefined;
        if (!g || !src || !el) return;
        // Write only what differs, so a board that already matches leaves the document untouched.
        const put = (t: Record<string, unknown>, k: string, v: unknown) => {
          if (JSON.stringify(t[k]) !== JSON.stringify(v)) t[k] = JSON.parse(JSON.stringify(v));
        };
        for (const b of g.boards) {
          if (b === src) continue;
          const id = matchElements(src as ArtboardState, b as ArtboardState).get(el.id);
          const t = b.elements.find((e) => e.id === id) as Record<string, unknown> | undefined;
          if (!t || t.locked) continue; // locked counterparts stay as they are
          for (const k of LAYOUT_KEYS) put(t, k, el[k] ?? (k === "scale" ? 1 : 0));
          if (el.type === "device" && t.type === "device" && el.screenshotRect) put(t, "screenshotRect", el.screenshotRect);
        }
        return;
      }
      case "applyLayoutToLocales": {
        const b = findBoard(d, cmd.groupId, cmd.boardId);
        if (!b?.localized) return;
        const layout = LAYOUT_KEYS as readonly string[];
        for (const [loc, byEl] of Object.entries(b.localized)) {
          for (const [id, raw] of Object.entries(byEl)) {
            const ov = raw as Record<string, unknown> & { detached?: string[] };
            // Only touch overrides that actually keep their own layout.
            if (!ov.detached?.some((k) => layout.includes(k))) continue;
            for (const k of LAYOUT_KEYS) delete ov[k];
            ov.detached = ov.detached.filter((k) => !layout.includes(k));
            if (!ov.detached.length) delete ov.detached;
            if (!Object.keys(ov).length) delete byEl[id];
          }
          if (!Object.keys(byEl).length) delete b.localized[loc];
        }
        return;
      }
      case "applyLayoutPreset": {
        const b = findBoard(d, cmd.groupId, cmd.boardId);
        if (!b) return;
        const fits = (e: ArtboardElement) => (presetKind(cmd.preset) === "text" ? e.type === "text" : e.type === "device" || e.type === "video-device");
        const chosen = cmd.elementIds?.length ? b.elements.filter((e) => cmd.elementIds!.includes(e.id) && fits(e as ArtboardElement)) : [];
        const targets = chosen.length ? chosen : b.elements.filter((e) => fits(e as ArtboardElement) && !e.locked && !e.hidden).slice(0, 1);
        for (const e of targets) {
          // Write only what differs, so re-applying a preset leaves the document (and undo stack) untouched.
          const next = layoutFor(cmd.preset, b.size, e);
          if (e.position.x !== next.position.x || e.position.y !== next.position.y) e.position = next.position;
          if (e.size.width !== next.size.width || e.size.height !== next.size.height) e.size = next.size;
          if (e.rotation !== next.rotation) e.rotation = next.rotation;
        }
        return;
      }
      case "updateBoard": {
        const b = findBoard(d, cmd.groupId, cmd.boardId);
        if (b) Object.assign(b, cmd.props);
        return;
      }
      case "setOverride":
      case "resetOverride": {
        if (!cmd.ref.boardId) return; // span elements are not localized
        const b = findBoard(d, cmd.ref.groupId, cmd.ref.boardId);
        if (!b) return;
        const byLocale = (b.localized ??= {});
        const byEl = (byLocale[cmd.locale] ??= {});
        const current = (byEl[cmd.ref.elementId] ??= {}) as Record<string, unknown>;
        if (cmd.type === "setOverride") {
          Object.assign(current, cmd.props);
          // A person typed this: machine translation must never overwrite it.
          if ("content" in cmd.props && !("origin" in cmd.props)) current.origin = "manual";
        }
        else for (const k of cmd.keys) delete current[k];
        if (!Object.keys(current).length) delete byEl[cmd.ref.elementId];
        if (!Object.keys(byEl).length) delete byLocale[cmd.locale];
        return;
      }
      case "setScreenshot": {
        if (cmd.locale && cmd.ref.boardId) {
          const b = findBoard(d, cmd.ref.groupId, cmd.ref.boardId);
          if (!b) return;
          const byEl = ((b.localized ??= {})[cmd.locale] ??= {});
          const ov = (byEl[cmd.ref.elementId] ??= {}) as Record<string, unknown>;
          if (cmd.src) ov.screenshotSrc = cmd.src; else delete ov.screenshotSrc;
          return;
        }
        const el = list(d, cmd.ref.groupId, cmd.ref.boardId)?.find((e) => e.id === cmd.ref.elementId) as Record<string, unknown> | undefined;
        if (!el) return;
        el.screenshotSrc = cmd.src;
        el.screenshotRect ??= FULL_SCREEN;
        return;
      }
      case "addLocale":
        if (cmd.code !== d.localization.baseLocale && !d.localization.locales.some((l) => l.code === cmd.code)) d.localization.locales.push({ code: cmd.code });
        return;
      case "removeLocale":
        d.localization.locales = d.localization.locales.filter((l) => l.code !== cmd.code);
        for (const g of d.groups) for (const b of g.boards) if (b.localized) delete b.localized[cmd.code];
        return;
      case "addGroupFromTarget": {
        const src = d.groups.find((g) => g.id === cmd.fromGroupId);
        if (!src) return;
        const plain = JSON.parse(JSON.stringify(src)) as BoardGroup;
        const fresh = retarget({ ...plain, boards: plain.boards.map((b, i) => ({ ...b, id: `${cmd.newGroupId}-b${i + 1}` })) }, cmd.target);
        d.groups.push({ ...fresh, id: cmd.newGroupId } as Draft<BoardGroup>);
        return;
      }
      case "deleteGroup":
        if (d.groups.length > 1) d.groups = d.groups.filter((g) => g.id !== cmd.groupId);
        return;
      case "duplicateGroupAsVariant": {
        const src = d.groups.find((g) => g.id === cmd.groupId);
        if (!src) return;
        const taken = new Set(d.groups.filter((g) => g.target === src.target).map((g) => g.variant ?? "A"));
        const letter = "BCDEFGHIJKLMNOPQRSTUVWXYZ".split("").find((l) => !taken.has(l));
        if (!letter) return;
        const copy = JSON.parse(JSON.stringify(src)) as BoardGroup;
        d.groups.push({ ...copy, id: cmd.newGroupId, variant: letter, boards: copy.boards.map((b, i) => ({ ...b, id: `${cmd.newGroupId}-b${i + 1}` })) } as Draft<BoardGroup>);
        return;
      }
    }
  });
}
