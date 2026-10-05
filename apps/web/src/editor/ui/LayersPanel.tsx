"use client";

import { useRef, useState } from "react";
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
      <div className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-neutral-500">
        <span className="w-4 text-center">▤</span><span className="flex-1">Background <span className="text-xs">(always at the bottom)</span></span>
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

function InlineName({ value, onCommit, onSelect }: { value: string; onCommit: (v: string) => void; onSelect?: (shift: boolean) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  /** Set once Enter, Escape or blur ended this edit, so a blur fired while the field unmounts cannot commit again. */
  const ended = useRef(false);
  const start = () => { ended.current = false; setDraft(value); };
  /** Escape cancels; Enter or leaving the field (blur) commits. */
  const finish = (commit: boolean) => {
    if (ended.current) return;
    ended.current = true;
    if (draft !== null && commit && draft.trim() !== value) onCommit(draft.trim());
    setDraft(null);
  };
  if (draft === null) {
    return (
      <button type="button" className="flex-1 truncate text-left" title="Double-click or press F2 to rename"
        onClick={(e) => onSelect?.(e.shiftKey)} onDoubleClick={start}
        onKeyDown={(e) => { if (e.key === "F2") { e.preventDefault(); start(); } }}>{value}</button>
    );
  }
  return (
    <input autoFocus aria-label="Layer name" className="input flex-1 py-0 text-sm" value={draft} onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); }}
      onBlur={() => finish(true)} />
  );
}

function Toggles({ locked, hidden, onLock, onHide, name }: { locked: boolean; hidden: boolean; onLock: (v: boolean) => void; onHide: (v: boolean) => void; name: string }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const stopKey = (e: React.KeyboardEvent) => e.stopPropagation();
  return (
    <span className="flex gap-0.5">
      <button type="button" className="px-1" aria-pressed={locked} aria-label={`${locked ? "Unlock" : "Lock"} ${name}`} onPointerDown={stop} onKeyDown={stopKey} onClick={(e) => { stop(e); onLock(!locked); }}>{locked ? "🔒" : "🔓"}</button>
      <button type="button" className="px-1" aria-pressed={hidden} aria-label={`${hidden ? "Show" : "Hide"} ${name}`} onPointerDown={stop} onKeyDown={stopKey} onClick={(e) => { stop(e); onHide(!hidden); }}>{hidden ? "◌" : "●"}</button>
    </span>
  );
}

function LayerRow({ el, indent, selected, onSelect, onRename, onLock, onHide }: {
  el: ArtboardElement; indent: boolean; selected: boolean; onSelect: (shift: boolean) => void;
  onRename: (name: string) => void; onLock: (v: boolean) => void; onHide: (v: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: el.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm ${indent ? "pl-6" : ""} ${selected ? "bg-indigo-50 dark:bg-indigo-950" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"} ${isDragging ? "opacity-60" : ""} ${el.hidden ? "text-neutral-400" : ""}`}>
      <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Reorder ${label(el)}`}
        className="cursor-grab touch-none px-0.5 text-neutral-400">⋮⋮</button>
      <span className="w-4 text-center text-neutral-500" aria-hidden>{TYPE_ICON[el.type] ?? "•"}</span>
      <InlineName value={label(el)} onCommit={onRename} onSelect={onSelect} />
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
