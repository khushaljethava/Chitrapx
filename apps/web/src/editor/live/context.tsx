"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import { useEditorAssets } from "../assets.tsx";
import { useEditorStore } from "../context.tsx";
import { throttle, unknownAssetIds, type PeerCursor, type PeerPresence, type PeerPreview } from "./presence.ts";

/** What the canvas draws for other people in the project (SP15). Null outside a live-capable editor. */
export type LiveValue = {
  peers: PeerPresence[];
  cursors: PeerCursor[];
  previews: PeerPreview[];
  sendCursor(groupId: string, x: number, y: number): void;
};
export const LiveContext = createContext<LiveValue | null>(null);
export const useLive = () => useContext(LiveContext);

/**
 * A peer can place an image this editor has no signed URL for yet: refresh the app's assets (at most every
 * 3 s, and once per unknown id, so an asset deleted elsewhere never loops).
 */
export function LiveAssetWatcher() {
  const store = useEditorStore();
  const { resolveSrc, refresh } = useEditorAssets();
  const resolve = useRef(resolveSrc);
  const tried = useRef(new Set<string>());
  useEffect(() => { resolve.current = resolveSrc; }, [resolveSrc]);
  useEffect(() => {
    const check = throttle(() => {
      const fresh = unknownAssetIds(store.getState().doc, resolve.current).filter((id) => !tried.current.has(id));
      if (!fresh.length) return;
      fresh.forEach((id) => tried.current.add(id));
      void refresh().catch(() => {});
    }, 3000);
    const unsub = store.subscribe((s, prev) => { if (s.doc !== prev.doc) check(); });
    return () => { unsub(); check.cancel(); };
  }, [store, refresh]);
  return null;
}
