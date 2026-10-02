import { createStore } from "zustand/vanilla";
import type { ChitrapxDoc } from "@chitrapx/document";
import { applyCommand, findElement, type Command, type Ref } from "./commands.ts";

const HISTORY_LIMIT = 200;

export type EditorState = {
  projectId: string;
  doc: ChitrapxDoc;
  /** Server revision the current document is based on. */
  revision: number;
  dirty: boolean;
  selection: Ref[];
  activeGroupId: string;
  activeBoardId: string | null;
  locale: string;
  zoom: number;
  /** Previous documents (immutable, structurally shared by Immer), newest last. */
  past: ChitrapxDoc[];
  future: ChitrapxDoc[];
  gestureBase: ChitrapxDoc | null;

  apply(cmd: Command, opts?: { transient?: boolean }): void;
  undo(): void;
  redo(): void;
  beginGesture(): void;
  endGesture(): void;
  select(refs: Ref[]): void;
  setActiveGroup(id: string): void;
  setActiveBoard(id: string | null): void;
  setLocale(code: string): void;
  setZoom(z: number): void;
  /** After a save: the server now holds this revision of `savedDoc`. */
  markSaved(revision: number, savedDoc: ChitrapxDoc): void;
  /** Replace everything (load from server or from the local buffer). */
  replaceDoc(doc: ChitrapxDoc, revision: number, dirty: boolean): void;
};

/** Keeps selection, active group, board and locale pointing at things that still exist. */
function normalize(s: Pick<EditorState, "doc" | "selection" | "activeGroupId" | "activeBoardId" | "locale">) {
  const group = s.doc.groups.find((g) => g.id === s.activeGroupId) ?? s.doc.groups[0];
  const activeGroupId = group?.id ?? "";
  const activeBoardId = group?.boards.some((b) => b.id === s.activeBoardId) ? s.activeBoardId : group?.boards[0]?.id ?? null;
  const locales = [s.doc.localization.baseLocale, ...s.doc.localization.locales.map((l) => l.code)];
  return {
    activeGroupId, activeBoardId,
    locale: locales.includes(s.locale) ? s.locale : s.doc.localization.baseLocale,
    selection: s.selection.filter((r) => findElement(s.doc, r)),
  };
}

export function createEditorStore(init: { projectId: string; doc: ChitrapxDoc; revision: number }) {
  return createStore<EditorState>()((set, get) => ({
    projectId: init.projectId,
    doc: init.doc,
    revision: init.revision,
    dirty: false,
    selection: [],
    activeGroupId: init.doc.groups[0]?.id ?? "",
    activeBoardId: init.doc.groups[0]?.boards[0]?.id ?? null,
    locale: init.doc.localization.baseLocale,
    zoom: 0.25,
    past: [],
    future: [],
    gestureBase: null,

    apply(cmd, opts) {
      const s = get();
      const doc = applyCommand(s.doc, cmd);
      if (doc === s.doc) return;
      const history = opts?.transient || s.gestureBase ? {} : { past: [...s.past, s.doc].slice(-HISTORY_LIMIT), future: [] };
      set({ doc, dirty: true, ...history, ...normalize({ ...s, doc }) });
    },
    undo() {
      const s = get();
      const prev = s.past.at(-1);
      if (!prev) return;
      set({ doc: prev, past: s.past.slice(0, -1), future: [s.doc, ...s.future], dirty: true, ...normalize({ ...s, doc: prev }) });
    },
    redo() {
      const s = get();
      const next = s.future[0];
      if (!next) return;
      set({ doc: next, past: [...s.past, s.doc], future: s.future.slice(1), dirty: true, ...normalize({ ...s, doc: next }) });
    },
    beginGesture() { set({ gestureBase: get().doc }); },
    endGesture() {
      const s = get();
      if (s.gestureBase && s.gestureBase !== s.doc) set({ past: [...s.past, s.gestureBase].slice(-HISTORY_LIMIT), future: [] });
      set({ gestureBase: null });
    },
    select(refs) { set({ selection: refs }); },
    setActiveGroup(id) { set({ ...normalize({ ...get(), activeGroupId: id, activeBoardId: null }), selection: [] }); },
    setActiveBoard(id) { set({ activeBoardId: id }); },
    setLocale(code) { set({ ...normalize({ ...get(), locale: code }) }); },
    setZoom(z) { set({ zoom: Math.min(2, Math.max(0.05, z)) }); },
    markSaved(revision, savedDoc) { set({ revision, dirty: get().doc !== savedDoc }); },
    replaceDoc(doc, revision, dirty) { set({ doc, revision, dirty, past: [], future: [], ...normalize({ ...get(), doc }) }); },
  }));
}

export type EditorStore = ReturnType<typeof createEditorStore>;
