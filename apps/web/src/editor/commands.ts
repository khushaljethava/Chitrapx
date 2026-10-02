import { produce, type Draft } from "immer";
import {
  retarget, type ArtboardElement, type ArtboardState, type BoardGroup, type ChitrapxDoc, type ElementLocaleOverride, type TargetId,
} from "@chitrapx/document";

/** An element: on a board, or a span element of its group when `boardId` is null (strip coordinates). */
export type Ref = { groupId: string; boardId: string | null; elementId: string };

export type Command =
  | { type: "updateElement"; ref: Ref; props: Partial<ArtboardElement> }
  | { type: "moveElements"; refs: Ref[]; dx: number; dy: number }
  | { type: "addElement"; groupId: string; boardId: string | null; element: ArtboardElement }
  | { type: "deleteElements"; refs: Ref[] }
  | { type: "duplicateElements"; refs: Ref[]; newIds: string[]; offset: number }
  | { type: "reorderElement"; ref: Ref; to: "front" | "back" | "forward" | "backward" }
  | { type: "addBoard"; groupId: string; board: ArtboardState; index?: number }
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
  | { type: "deleteGroup"; groupId: string };

const FULL_SCREEN = { left: 0, top: 0, width: 100, height: 100 };

function list(d: Draft<ChitrapxDoc> | ChitrapxDoc, groupId: string, boardId: string | null): ArtboardElement[] | undefined {
  const g = d.groups.find((x) => x.id === groupId);
  if (!g) return undefined;
  return (boardId === null ? g.spanElements : g.boards.find((b) => b.id === boardId)?.elements) as ArtboardElement[] | undefined;
}

export function findElement(d: ChitrapxDoc, ref: Ref): ArtboardElement | undefined {
  return list(d, ref.groupId, ref.boardId)?.find((e) => e.id === ref.elementId);
}
const findBoard = (d: Draft<ChitrapxDoc>, groupId: string, boardId: string) =>
  d.groups.find((g) => g.id === groupId)?.boards.find((b) => b.id === boardId);

/** The only way the document changes. Pure: returns a new document (structurally shared), never mutates. */
export function applyCommand(doc: ChitrapxDoc, cmd: Command): ChitrapxDoc {
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
          if (els && i >= 0) els.splice(i, 1);
        }
        return;
      case "duplicateElements":
        cmd.refs.forEach((ref, n) => {
          const els = list(d, ref.groupId, ref.boardId);
          const i = els?.findIndex((e) => e.id === ref.elementId) ?? -1;
          if (!els || i < 0 || !cmd.newIds[n]) return;
          const src = els[i]!;
          const copy = { ...JSON.parse(JSON.stringify(src)), id: cmd.newIds[n], position: { x: src.position.x + cmd.offset, y: src.position.y + cmd.offset } };
          els.splice(i + 1, 0, copy);
        });
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
      case "addBoard": {
        const g = d.groups.find((x) => x.id === cmd.groupId);
        g?.boards.splice(cmd.index ?? g.boards.length, 0, cmd.board as Draft<ArtboardState>);
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
      case "deleteBoard": {
        const g = d.groups.find((x) => x.id === cmd.groupId);
        if (!g || g.boards.length <= 1) return; // a group always keeps one board
        g.boards = g.boards.filter((b) => b.id !== cmd.boardId);
        return;
      }
      case "moveBoard": {
        const g = d.groups.find((x) => x.id === cmd.groupId);
        const i = g?.boards.findIndex((b) => b.id === cmd.boardId) ?? -1;
        if (!g || i < 0) return;
        const [b] = g.boards.splice(i, 1);
        g.boards.splice(Math.max(0, Math.min(g.boards.length, cmd.toIndex)), 0, b!);
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
        if (cmd.type === "setOverride") Object.assign(current, cmd.props);
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
    }
  });
}
