"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { foldCount, MAX_BOARD_EDGE, type ArtboardElement } from "@chitrapx/document";
import { BoardView, type ResolveSrc } from "@chitrapx/renderer";
import type { Ref } from "../commands.ts";
import { useEditor, useEditorStore } from "../context.tsx";
import { resizeBox, rotationFromPointer, snapMove, type Box, type Handle } from "../geometry.ts";

const SNAP_PX = 6;
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const HANDLE_POS: Record<Handle, [number, number]> = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
const sameRef = (a: Ref, b: Ref) => a.groupId === b.groupId && a.boardId === b.boardId && a.elementId === b.elementId;
const boxOf = (el: ArtboardElement, offsetX: number): Box =>
  ({ x: offsetX + el.position.x, y: el.position.y, w: el.size.width * (el.scale || 1), h: el.size.height * (el.scale || 1), rotation: el.rotation || 0 });

type Drag =
  | { kind: "move"; startX: number; startY: number; applied: { x: number; y: number }; boardW: number; boardH: number; boardOffset: number; primary: Box; others: Box[] }
  | { kind: "resize"; handle: Handle; startX: number; startY: number; start: Box; offset: number; ref: Ref; scale: number; lock: boolean }
  | { kind: "rotate"; center: { x: number; y: number }; ref: Ref };

/** The active group's boards edge to edge (seams marked), with an interaction layer on top. */
export function Canvas({ resolveSrc }: { resolveSrc: ResolveSrc }) {
  const store = useEditorStore();
  const doc = useEditor((s) => s.doc);
  const groupId = useEditor((s) => s.activeGroupId);
  const locale = useEditor((s) => s.locale);
  const zoom = useEditor((s) => s.zoom);
  const selection = useEditor((s) => s.selection);
  const viewport = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });

  const group = doc.groups.find((g) => g.id === groupId);
  const boardW = group?.boards[0]?.size.width ?? 1;
  const boardH = group?.boards[0]?.size.height ?? 1;

  // Fit the strip's height to the viewport the first time each group is shown, never on edits.
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    const h = viewport.current?.clientHeight;
    if (!h || !groupId || fitted.current === groupId) return;
    fitted.current = groupId;
    store.getState().setZoom((h - 64) / boardH);
  }, [groupId, boardH, store]);

  /** A focused inspector field owns the open gesture; end it before the canvas starts its own. */
  const releaseField = () => (document.activeElement as HTMLElement | null)?.blur?.();

  // ctrl/cmd + wheel zooms; plain wheel scrolls.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const s = store.getState();
      s.setZoom(s.zoom * (1 - e.deltaY * 0.0015));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [store]);

  /** Pointer position in strip (board) pixels. */
  const toStrip = useCallback((e: { clientX: number; clientY: number }) => {
    const r = layer.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  }, [zoom]);

  if (!group) return <div className="flex flex-1 items-center justify-center text-neutral-500">No boards yet</div>;

  const items: Array<{ ref: Ref; el: ArtboardElement; offset: number }> = [
    ...group.spanElements.map((el) => ({ ref: { groupId, boardId: null, elementId: el.id }, el, offset: 0 })),
    ...group.boards.flatMap((b, i) => b.elements.map((el) => ({ ref: { groupId, boardId: b.id, elementId: el.id }, el, offset: i * boardW }))),
  ];
  const single = selection.length === 1 ? items.find((it) => sameRef(it.ref, selection[0]!)) : undefined;

  function startMove(e: React.PointerEvent, ref: Ref) {
    e.stopPropagation();
    const s = store.getState();
    const already = s.selection.some((r) => sameRef(r, ref));
    const next = e.shiftKey ? (already ? s.selection.filter((r) => !sameRef(r, ref)) : [...s.selection, ref]) : already ? s.selection : [ref];
    s.select(next);
    if (ref.boardId) s.setActiveBoard(ref.boardId);
    if (e.shiftKey && already) return;
    releaseField();
    const it = items.find((x) => sameRef(x.ref, ref))!;
    const boardOffset = ref.boardId ? it.offset : Math.floor(it.el.position.x / boardW) * boardW;
    const others = items.filter((x) => !next.some((r) => sameRef(r, x.ref)) && x.offset === it.offset).map((x) => boxOf(x.el, x.offset));
    const p = toStrip(e);
    drag.current = { kind: "move", startX: p.x, startY: p.y, applied: { x: 0, y: 0 }, boardW, boardH, boardOffset, primary: boxOf(it.el, it.offset), others };
    s.beginGesture();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function startResize(e: React.PointerEvent, handle: Handle) {
    e.stopPropagation();
    if (!single) return;
    const p = toStrip(e);
    releaseField();
    const lock = single.el.type === "device" || single.el.type === "image";
    drag.current = { kind: "resize", handle, startX: p.x, startY: p.y, start: boxOf(single.el, single.offset), offset: single.offset, ref: single.ref, scale: single.el.scale || 1, lock };
    store.getState().beginGesture();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function startRotate(e: React.PointerEvent) {
    e.stopPropagation();
    if (!single) return;
    releaseField();
    const b = boxOf(single.el, single.offset);
    drag.current = { kind: "rotate", center: { x: b.x + b.w / 2, y: b.y + b.h / 2 }, ref: single.ref };
    store.getState().beginGesture();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = toStrip(e);
    const s = store.getState();
    if (d.kind === "move") {
      let dx = p.x - d.startX, dy = p.y - d.startY;
      const moved = { ...d.primary, x: d.primary.x + dx - d.boardOffset, y: d.primary.y + dy };
      const snap = e.altKey ? { dx: 0, dy: 0, guides: { x: [], y: [] } }
        : snapMove(moved, d.others.map((o) => ({ ...o, x: o.x - d.boardOffset })), d.boardW, d.boardH, SNAP_PX / zoom);
      dx += snap.dx; dy += snap.dy;
      setGuides({ x: snap.guides.x.map((x) => x + d.boardOffset), y: snap.guides.y });
      const step = { x: dx - d.applied.x, y: dy - d.applied.y };
      if (step.x || step.y) s.apply({ type: "moveElements", refs: s.selection, dx: step.x, dy: step.y }, { transient: true });
      d.applied = { x: dx, y: dy };
    } else if (d.kind === "resize") {
      const r = resizeBox(d.start, d.handle, p.x - d.startX, p.y - d.startY, d.lock || e.shiftKey);
      const b = { ...r, w: Math.min(r.w, MAX_BOARD_EDGE), h: Math.min(r.h, MAX_BOARD_EDGE) };
      s.apply({ type: "updateElement", ref: d.ref, props: { position: { x: b.x - d.offset, y: b.y }, size: { width: b.w / d.scale, height: b.h / d.scale } } }, { transient: true });
    } else {
      s.apply({ type: "updateElement", ref: d.ref, props: { rotation: rotationFromPointer(d.center, p, e.shiftKey) } }, { transient: true });
    }
  }

  function onUp() {
    if (!drag.current) return;
    drag.current = null;
    setGuides({ x: [], y: [] });
    store.getState().endGesture();
  }

  function onBackground(e: React.PointerEvent) {
    const s = store.getState();
    s.select([]);
    const i = Math.floor(toStrip(e).x / boardW);
    const b = group?.boards[i];
    if (b) s.setActiveBoard(b.id);
  }

  return (
    <div ref={viewport} className="relative flex-1 overflow-auto bg-neutral-200 dark:bg-neutral-900">
      <div className="p-8" style={{ width: boardW * group.boards.length * zoom + 64 }}>
        <div className="relative" style={{ width: boardW * group.boards.length * zoom, height: boardH * zoom }}>
          <div className="flex">
            {group.boards.map((b, i) => (
              <div key={b.id} className="relative">
                <BoardView doc={doc} groupId={groupId} boardIndex={i} locale={locale} scale={zoom} resolveSrc={resolveSrc} />
              </div>
            ))}
          </div>
          <div ref={layer} className="absolute inset-0 touch-none" onPointerDown={onBackground} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            {group.boards.slice(0, foldCount(group.target)).map((b, i) => (
              <span key={`fold-${b.id}`} className="pointer-events-none absolute -top-6 rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-medium text-white" style={{ left: i * boardW * zoom }}
                title="Shoppers see these boards in search results without scrolling">Seen first</span>
            ))}
            {group.boards.slice(1).map((b, i) => (
              <div key={b.id} className="pointer-events-none absolute top-0 h-full border-l border-dashed border-indigo-400/60" style={{ left: (i + 1) * boardW * zoom }} />
            ))}
            {items.map(({ ref, el, offset }) => {
              const b = boxOf(el, offset);
              const selected = selection.some((r) => sameRef(r, ref));
              return (
                <div key={`${ref.boardId}:${ref.elementId}`} data-hit={el.id}
                  onPointerDown={(e) => startMove(e, ref)}
                  onDoubleClick={() => el.type === "text" && window.dispatchEvent(new CustomEvent("chitrapx:edit-text"))}
                  className={`absolute cursor-move ${selected ? "outline outline-2 outline-indigo-500" : "hover:outline hover:outline-1 hover:outline-indigo-300"}`}
                  style={{ left: b.x * zoom, top: b.y * zoom, width: b.w * zoom, height: b.h * zoom, transform: `rotate(${b.rotation}deg)` }} />
              );
            })}
            {single && (() => {
              const b = boxOf(single.el, single.offset);
              return (
                <div className="pointer-events-none absolute" style={{ left: b.x * zoom, top: b.y * zoom, width: b.w * zoom, height: b.h * zoom, transform: `rotate(${b.rotation}deg)` }}>
                  {HANDLES.map((h) => (
                    <div key={h} data-handle={h} onPointerDown={(e) => startResize(e, h)}
                      className="pointer-events-auto absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-indigo-600 bg-white"
                      style={{ left: `${HANDLE_POS[h][0] * 100}%`, top: `${HANDLE_POS[h][1] * 100}%`, cursor: `${h}-resize` }} />
                  ))}
                  <div data-handle="rotate" onPointerDown={startRotate} title="Rotate (shift: 15 degree steps)"
                    className="pointer-events-auto absolute left-1/2 -top-8 h-3.5 w-3.5 -translate-x-1/2 cursor-grab rounded-full border border-indigo-600 bg-white" />
                </div>
              );
            })()}
            {guides.x.map((x) => <div key={`gx${x}`} className="pointer-events-none absolute top-0 h-full w-px bg-pink-500" style={{ left: x * zoom }} />)}
            {guides.y.map((y) => <div key={`gy${y}`} className="pointer-events-none absolute left-0 h-px w-full bg-pink-500" style={{ top: y * zoom }} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
