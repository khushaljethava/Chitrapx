"use client";

import { getTarget, TARGETS, type ArtboardElement, type TargetId } from "@chitrapx/document";
import { useEditor, useEditorStore } from "../context.tsx";
import { Checks } from "./Checks.tsx";
import { CopyIdeas } from "./CopyIdeas.tsx";

type NewElement = (w: number, h: number) => Record<string, unknown>;
const base = (w: number, h: number, ew: number, eh: number) =>
  ({ id: crypto.randomUUID(), position: { x: (w - ew) / 2, y: (h - eh) / 2 }, size: { width: ew, height: eh }, rotation: 0, scale: 1 });

const ADDERS: Array<[string, NewElement]> = [
  ["Text", (w, h) => ({ ...base(w, h, w * 0.8, h * 0.08), type: "text", name: "Text", content: "Your headline", fontSize: Math.round(w * 0.075 * 0.3) /* OSG text renders at fontSize / 0.3 px */, fontFamily: "Bricolage Grotesque", fontWeight: "700", color: "#111111", textAlign: "center", lineHeight: 1.1 })],
  ["Rectangle", (w, h) => ({ ...base(w, h, w * 0.5, w * 0.3), type: "shape", name: "Rectangle", shapeType: "rectangle", fillColor: "#4f46e5", strokeColor: "#000000", strokeWidth: 0, borderRadius: Math.round(w * 0.03) })],
  ["Circle", (w, h) => ({ ...base(w, h, w * 0.3, w * 0.3), type: "shape", name: "Circle", shapeType: "circle", fillColor: "#f59e0b", strokeColor: "#000000", strokeWidth: 0 })],
  ["Star", (w, h) => ({ ...base(w, h, w * 0.2, w * 0.2), type: "shape", name: "Star", shapeType: "star", fillColor: "#facc15", strokeColor: "#000000", strokeWidth: 0, customPoints: 5, innerRadius: 45 })],
];
const DEVICE_ADDERS: Array<[string, string, number]> = [
  ["iPhone", "iphone-17-pro-max", 2.17], ["Android", "android-punch-hole", 2.1], ["iPad", "ipad-pro-13", 1.33], ["MacBook", "macbook", 0.62], ["Watch", "apple-watch", 1.2],
];

export function LeftPanel() {
  const store = useEditorStore();
  const doc = useEditor((s) => s.doc);
  const groupId = useEditor((s) => s.activeGroupId);
  const boardId = useEditor((s) => s.activeBoardId);
  const group = doc.groups.find((g) => g.id === groupId);
  const board = group?.boards.find((b) => b.id === boardId) ?? group?.boards[0];

  function add(element: Record<string, unknown>) {
    if (!group || !board) return;
    store.getState().apply({ type: "addElement", groupId, boardId: board.id, element: element as unknown as ArtboardElement });
    store.getState().select([{ groupId, boardId: board.id, elementId: element.id as string }]);
  }
  const addDevice = (deviceType: string, ratio: number) => {
    if (!board) return;
    const { width: w, height: h } = board.size;
    const ew = ratio > 1 ? Math.min(w * 0.6, (h * 0.6) / ratio) : w * 0.7;
    add({ ...base(w, h, ew, ew * ratio), type: "device", name: deviceType, deviceType, styleType: "normal", screenshotRect: { left: 0, top: 0, width: 100, height: 100 } });
  };
  const addBoard = () => {
    if (!group) return;
    const t = getTarget(group.target)!;
    const id = crypto.randomUUID();
    store.getState().apply({ type: "addBoard", groupId, board: { id, name: `Screen ${group.boards.length + 1}`, position: { x: 0, y: 0 }, size: { width: t.width, height: t.height }, backgroundColor: "#ffffff", zoom: 1, elements: [] } });
    store.getState().setActiveBoard(id);
  };
  const usedTargets = new Set(doc.groups.map((g) => g.target));

  return (
    <aside className="w-60 shrink-0 space-y-5 overflow-y-auto border-r border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <section className="space-y-2">
        <h2 className="label">Add</h2>
        <div className="grid grid-cols-2 gap-1.5">
          {ADDERS.map(([label, make]) => (
            <button key={label} type="button" className="btn-ghost px-2 py-1.5" disabled={!board} onClick={() => board && add(make(board.size.width, board.size.height))}>{label}</button>
          ))}
          {DEVICE_ADDERS.map(([label, type, ratio]) => (
            <button key={label} type="button" className="btn-ghost px-2 py-1.5" disabled={!board} onClick={() => addDevice(type, ratio)}>{label}</button>
          ))}
          <button type="button" className="btn-ghost px-2 py-1.5" disabled={!board}
            onClick={() => board && add({ ...base(board.size.width, board.size.height, board.size.width * 0.4, board.size.width * 0.4), type: "image", name: "Image", objectFit: "cover" })}>Image</button>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="label">Sizes</h2>
        <div className="flex flex-wrap gap-1">
          {doc.groups.map((g) => (
            <span key={g.id} className="inline-flex">
              <button type="button" className={g.id === groupId ? "btn px-2 py-1 text-xs" : "btn-ghost px-2 py-1 text-xs"} onClick={() => store.getState().setActiveGroup(g.id)}>
                {getTarget(g.target)?.label}{g.variant ? ` · ${g.variant}` : ""}
              </button>
              {doc.groups.length > 1 && g.id === groupId && (
                <button type="button" className="px-1 text-xs text-neutral-500 hover:text-red-600" aria-label={`Remove ${getTarget(g.target)?.label}`}
                  onClick={() => store.getState().apply({ type: "deleteGroup", groupId: g.id })}>x</button>
              )}
            </span>
          ))}
        </div>
        {group && (
          <button type="button" className="text-xs text-indigo-600 hover:underline"
            title="A copy of this size to test different screenshots in App Store Product Page Optimization or Play store listing experiments"
            onClick={() => { const id = crypto.randomUUID(); store.getState().apply({ type: "duplicateGroupAsVariant", groupId, newGroupId: id }); store.getState().setActiveGroup(id); }}>
            Make an A/B variant of this size
          </button>
        )}
        {group && (
          <select aria-label="Add a store size" className="input text-xs" value="" onChange={(e) => {
            const target = e.target.value as TargetId;
            if (!target) return;
            const id = crypto.randomUUID();
            store.getState().apply({ type: "addGroupFromTarget", fromGroupId: groupId, target, newGroupId: id });
            store.getState().setActiveGroup(id);
          }}>
            <option value="">Add a size from this design</option>
            {TARGETS.filter((t) => !usedTargets.has(t.id)).map((t) => <option key={t.id} value={t.id}>{t.label} ({t.width}x{t.height})</option>)}
          </select>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="label mb-0">Boards</h2>
          <button type="button" className="text-xs text-indigo-600 hover:underline" onClick={addBoard} disabled={!group}>Add board</button>
        </div>
        <ol className="space-y-1">
          {group?.boards.map((b, i) => (
            <li key={b.id} className={`group flex items-center gap-1 rounded-md px-2 py-1 text-sm ${b.id === board?.id ? "bg-indigo-50 dark:bg-indigo-950" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>
              <button type="button" className="flex-1 truncate text-left" onClick={() => { store.getState().setActiveBoard(b.id); store.getState().select([]); }}>
                <span className="mr-1 text-neutral-400">{i + 1}</span>{b.name}
              </button>
              <span className="flex gap-0.5 opacity-60 group-hover:opacity-100">
                <button type="button" aria-label="Move up" className="px-1" disabled={i === 0} onClick={() => store.getState().apply({ type: "moveBoard", groupId, boardId: b.id, toIndex: i - 1 })}>↑</button>
                <button type="button" aria-label="Move down" className="px-1" disabled={i === group.boards.length - 1} onClick={() => store.getState().apply({ type: "moveBoard", groupId, boardId: b.id, toIndex: i + 1 })}>↓</button>
                <button type="button" aria-label="Duplicate board" className="px-1" onClick={() => store.getState().apply({ type: "duplicateBoard", groupId, boardId: b.id, newBoardId: crypto.randomUUID(), idSuffix: crypto.randomUUID().slice(0, 8) })}>⧉</button>
                <button type="button" aria-label="Remove board" className="px-1 hover:text-red-600" disabled={group.boards.length <= 1} onClick={() => store.getState().apply({ type: "deleteBoard", groupId, boardId: b.id })}>✕</button>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <Checks />

      <CopyIdeas />
    </aside>
  );
}
