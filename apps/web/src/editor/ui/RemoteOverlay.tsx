"use client";

import { useLive } from "../live/context.tsx";

type Box = { x: number; y: number; w: number; h: number; rotation: number };

/**
 * Other people on the canvas (SP15): their selections (solid outline), the boxes they are dragging right now
 * (dashed, from throttled previews) and their pointers with their names. Strip coordinates, scaled by zoom.
 */
export function RemoteOverlay({ groupId, zoom, boxOf }: { groupId: string; zoom: number; boxOf(elementId: string): Box | null }) {
  const live = useLive();
  if (!live || !live.peers.length) return null;
  const byClient = new Map(live.peers.map((p) => [p.clientId, p]));
  const frame = (b: Box) => ({ left: b.x * zoom, top: b.y * zoom, width: b.w * zoom, height: b.h * zoom, transform: `rotate(${b.rotation}deg)` });
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {live.peers.filter((p) => p.groupId === groupId).flatMap((p) => p.selection.flatMap((id) => {
        const b = boxOf(id);
        return b ? [<div key={`sel-${p.clientId}-${id}`} className="absolute outline outline-2" style={{ ...frame(b), outlineColor: p.color }} />] : [];
      }))}
      {live.previews.filter((v) => v.groupId === groupId).flatMap((v) => v.boxes.map((b) => (
        <div key={`pre-${v.clientId}-${b.elementId}`} className="absolute border-2 border-dashed" style={{ ...frame(b), borderColor: byClient.get(v.clientId)?.color }} />
      )))}
      {live.cursors.filter((c) => c.groupId === groupId).map((c) => {
        const peer = byClient.get(c.clientId);
        if (!peer) return null;
        return (
          <div key={`cur-${c.clientId}`} className="absolute" style={{ left: c.x * zoom, top: c.y * zoom }}>
            <svg width="16" height="16" viewBox="0 0 16 16" className="-translate-x-0.5 -translate-y-0.5"><path d="M1 1 L1 13 L5 9.5 L8 15 L10 14 L7.2 8.6 L12 8.6 Z" fill={peer.color} stroke="white" strokeWidth="1" /></svg>
            <span className="ml-3 whitespace-nowrap rounded px-1 py-0.5 text-[10px] font-medium text-white" style={{ backgroundColor: peer.color }}>{peer.name}</span>
          </div>
        );
      })}
    </div>
  );
}
