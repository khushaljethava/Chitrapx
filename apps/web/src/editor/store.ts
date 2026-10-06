import { createStore } from "zustand/vanilla";
import type { ChitrapxDoc } from "@chitrapx/document";
import { applyCommand, findElement, type Command, type Ref } from "./commands.ts";
import { diffDocs, invertOps, squashOps, type PatchOp } from "./sync/patch.ts";

const HISTORY_LIMIT = 200;

/**
 * One undo step: this user's change from `before` to `after`. `ops` are set when other people's edits
 * arrived in the middle of the step (a gesture), so `diff(before, after)` would include theirs.
 */
export type UndoStep = { before: ChitrapxDoc; after: ChitrapxDoc; ops?: PatchOp[] };
/** Live co-editing (SP15): receives every local command so it can be sent to the server. */
export type CommandSink = {
  local(cmd: Command, opts: { transient: boolean; after: ChitrapxDoc }): void;
  gestureEnd(): void;
};

export type EditorState = {
  projectId: string;
  doc: ChitrapxDoc;
  /** Server revision the current document is based on. */
  revision: number;
  dirty: boolean;
  /** The last document the server confirmed (solo saves); null when unknown (a restored local draft). */
  savedDoc: ChitrapxDoc | null;
  selection: Ref[];
  activeGroupId: string;
  activeBoardId: string | null;
  locale: string;
  zoom: number;
  /** This user's undo steps (immutable documents, structurally shared by Immer), newest last. */
  past: UndoStep[];
  future: UndoStep[];
  gestureBase: ChitrapxDoc | null;
  /** The open gesture's own changes so far, when remote edits interrupted it. */
  gestureOps: PatchOp[];
  /** True while a save conflict is unresolved: nothing may change the document. */
  locked: boolean;
  /** Set while live co-editing: local commands go to the server through it. */
  sink: CommandSink | null;

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
  setLocked(locked: boolean): void;
  /** After a save: the server now holds this revision of `savedDoc`. */
  markSaved(revision: number, savedDoc: ChitrapxDoc): void;
  /** Replace everything (load from server or from the local buffer). */
  replaceDoc(doc: ChitrapxDoc, revision: number, dirty: boolean): void;
  setSink(sink: CommandSink | null): void;
  /** Live co-editing: the document now includes other people's edits. Undo history is kept. */
  remoteDoc(doc: ChitrapxDoc, opts: { revision: number; dirty: boolean }): void;
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

const stepOps = (step: UndoStep) => step.ops ?? diffDocs(step.before, step.after);

export function createEditorStore(init: { projectId: string; doc: ChitrapxDoc; revision: number }) {
  return createStore<EditorState>()((set, get) => {
    /**
     * Undo or redo by patch: each op only reverts (or re-applies) a property that still holds the value
     * this user left there, so other people's later edits survive. Sent to the server when live.
     */
    function patchStep(ops: PatchOp[], next: { past: UndoStep[]; future: UndoStep[] }) {
      const s = get();
      const cmd: Command = { type: "patch", ops };
      const doc = applyCommand(s.doc, cmd);
      set({ doc, ...next, dirty: s.dirty || doc !== s.doc, ...normalize({ ...s, doc }) });
      if (doc !== s.doc) s.sink?.local(cmd, { transient: false, after: doc });
    }

    return {
      projectId: init.projectId,
      doc: init.doc,
      revision: init.revision,
      dirty: false,
      savedDoc: init.doc,
      selection: [],
      activeGroupId: init.doc.groups[0]?.id ?? "",
      activeBoardId: init.doc.groups[0]?.boards[0]?.id ?? null,
      locale: init.doc.localization.baseLocale,
      zoom: 0.25,
      past: [],
      future: [],
      gestureBase: null,
      gestureOps: [],
      locked: false,
      sink: null,

      apply(cmd, opts) {
        const s = get();
        if (s.locked) return;
        const doc = applyCommand(s.doc, cmd);
        if (doc === s.doc) return;
        const history = opts?.transient || s.gestureBase ? {} : { past: [...s.past, { before: s.doc, after: doc }].slice(-HISTORY_LIMIT), future: [] };
        set({ doc, dirty: true, ...history, ...normalize({ ...s, doc }) });
        s.sink?.local(cmd, { transient: !!opts?.transient, after: doc });
      },
      undo() {
        const s = get();
        if (s.locked) return;
        const step = s.past.at(-1);
        if (!step) return;
        const next = { past: s.past.slice(0, -1), future: [step, ...s.future] };
        // Solo, and nothing else changed since: restore the exact previous document, as always.
        if (!s.sink && !step.ops && s.doc === step.after) {
          set({ doc: step.before, ...next, dirty: true, ...normalize({ ...s, doc: step.before }) });
          return;
        }
        patchStep(invertOps(stepOps(step)), next);
      },
      redo() {
        const s = get();
        if (s.locked) return;
        const step = s.future[0];
        if (!step) return;
        const next = { past: [...s.past, step], future: s.future.slice(1) };
        if (!s.sink && !step.ops && s.doc === step.before) {
          set({ doc: step.after, ...next, dirty: true, ...normalize({ ...s, doc: step.after }) });
          return;
        }
        patchStep(stepOps(step), next);
      },
      beginGesture() { set({ gestureBase: get().doc, gestureOps: [] }); },
      endGesture() {
        const s = get();
        if (s.gestureBase && (s.gestureBase !== s.doc || s.gestureOps.length)) {
          const ops = s.gestureOps.length ? squashOps([...s.gestureOps, ...diffDocs(s.gestureBase, s.doc)]) : undefined;
          const step: UndoStep = ops ? { before: s.gestureBase, after: s.doc, ops } : { before: s.gestureBase, after: s.doc };
          if (!ops || ops.length) set({ past: [...s.past, step].slice(-HISTORY_LIMIT), future: [] });
        }
        set({ gestureBase: null, gestureOps: [] });
        s.sink?.gestureEnd();
      },
      select(refs) { set({ selection: refs }); },
      setActiveGroup(id) { set({ ...normalize({ ...get(), activeGroupId: id, activeBoardId: null }), selection: [] }); },
      setActiveBoard(id) { set({ activeBoardId: id }); },
      setLocale(code) { set({ ...normalize({ ...get(), locale: code }) }); },
      setZoom(z) { set({ zoom: Math.min(2, Math.max(0.05, z)) }); },
      setLocked(locked) { set({ locked }); },
      markSaved(revision, savedDoc) { set({ revision, savedDoc, dirty: get().doc !== savedDoc }); },
      replaceDoc(doc, revision, dirty) {
        set({ doc, revision, dirty, savedDoc: dirty ? null : doc, past: [], future: [], gestureBase: null, gestureOps: [], ...normalize({ ...get(), doc }) });
      },
      setSink(sink) { set({ sink }); },
      remoteDoc(doc, { revision, dirty }) {
        const s = get();
        if (doc === s.doc) { set({ revision, dirty }); return; }
        // An open gesture keeps only its own changes: what it did so far, then a fresh base that includes the remote edits.
        const gesture = s.gestureBase ? { gestureOps: [...s.gestureOps, ...diffDocs(s.gestureBase, s.doc)], gestureBase: doc } : {};
        set({ doc, revision, dirty, ...gesture, ...normalize({ ...s, doc }) });
      },
    };
  });
}

export type EditorStore = ReturnType<typeof createEditorStore>;
