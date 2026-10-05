"use client";

import { useRef, useState } from "react";
import type { ArtboardElement } from "@chitrapx/document";
import { uploadAsset } from "@/lib/uploadAsset.ts";
import { useEditorAssets } from "./assets.tsx";
import type { Ref } from "./commands.ts";
import { useEditorStore } from "./context.tsx";
import { acceptImages } from "./intake.ts";

export type DropAt = { groupId: string; boardId: string; x: number; y: number; device?: Ref };
type Sizes = Map<string, { width: number; height: number }>;

/** Uploads dropped or picked images and places them: into a device, as images, or as new boards. */
export function useIntake() {
  const store = useEditorStore();
  const { appId, refresh } = useEditorAssets();
  const [progress, setProgress] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState<{ assetIds: string[]; at: DropAt } | null>(null);
  const sizes = useRef<Sizes>(new Map());
  const busy = useRef(false);

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
      try {
        const rows = await refresh();
        sizes.current = new Map(rows.map((r) => [r.id, { width: r.width ?? 1000, height: r.height ?? 2000 }]));
      } catch {
        setErrors((e) => [...e, "Uploaded, but the image list could not refresh. Reload to see new images."]);
      }
    }
    return ids;
  }

  const NOT_PLACED = "Images were uploaded to your library but could not be placed: the board changed. Add them from the Images panel.";

  /** The board a pending drop targets, or undefined (with a message) when it is gone, the group changed or the store is locked. */
  function targetBoard(at: DropAt) {
    const s = store.getState();
    const board = s.locked || s.activeGroupId !== at.groupId ? undefined : s.doc.groups.find((g) => g.id === at.groupId)?.boards.find((b) => b.id === at.boardId);
    if (!board) setErrors([NOT_PLACED]);
    return board;
  }

  function addImages(ids: string[], at: DropAt) {
    const s = store.getState();
    const board = targetBoard(at);
    if (!board) return;
    const w = board.size.width * 0.5;
    const cx = Math.min(board.size.width, Math.max(0, at.x));
    const cy = Math.min(board.size.height, Math.max(0, at.y));
    const elements = ids.map((id, n) => {
      const sz = sizes.current.get(id) ?? { width: 1000, height: 2000 };
      const h = (w * sz.height) / sz.width;
      return { id: crypto.randomUUID(), type: "image", name: "Screenshot", imageSrc: `asset:${id}`, objectFit: "contain",
        position: { x: cx - w / 2 + n * 40, y: cy - h / 2 + n * 40 }, size: { width: w, height: h }, rotation: 0, scale: 1 } as unknown as ArtboardElement;
    });
    // One command, so adding N images is one undo step.
    s.apply({ type: "addElements", groupId: at.groupId, boardId: at.boardId, elements });
  }

  function addBoards(ids: string[], at: { groupId: string; boardId: string }) {
    const s = store.getState();
    if (!targetBoard({ ...at, x: 0, y: 0 })) return;
    const sourceBoardId = at.boardId;
    s.apply({ type: "addBoardsFromAssets", groupId: at.groupId, sourceBoardId, assetIds: ids, newBoardIds: ids.map(() => crypto.randomUUID()) });
  }

  /** One upload or choice at a time; returns false (with a message) when busy. */
  function claim(): boolean {
    if (busy.current || pending) { setErrors(["Wait for the current upload to finish."]); return false; }
    busy.current = true;
    return true;
  }

  async function dropFiles(files: File[], at: DropAt) {
    if (!claim()) return;
    try { await place(files, at); }
    catch (err) { setErrors([(err as Error).message]); setProgress(""); }
    finally { busy.current = false; }
  }

  async function place(files: File[], at: DropAt) {
    const ids = await upload(files);
    if (!ids.length) return;
    const s = store.getState();
    if (s.locked && ids.length === 1) { setErrors([NOT_PLACED]); return; }
    if (ids.length === 1 && at.device) {
      const base = s.doc.localization.baseLocale;
      s.apply({ type: "setScreenshot", ref: at.device, src: `asset:${ids[0]}`, locale: s.locale !== base ? s.locale : undefined });
    } else if (ids.length === 1) addImages(ids, at);
    else setPending({ assetIds: ids, at });
  }

  async function importBoards(files: File[]) {
    if (!claim()) return;
    try {
      const { activeGroupId: groupId, activeBoardId: boardId } = store.getState(); // captured before the upload
      const ids = await upload(files);
      if (ids.length && boardId) addBoards(ids, { groupId, boardId });
    } catch (err) { setErrors([(err as Error).message]); setProgress(""); }
    finally { busy.current = false; }
  }

  function choose(mode: "here" | "boards" | "cancel") {
    if (pending && mode === "here") addImages(pending.assetIds, pending.at);
    if (pending && mode === "boards") addBoards(pending.assetIds, pending.at);
    setPending(null);
  }

  return { progress, errors, pending, dropFiles, importBoards, choose, clearErrors: () => setErrors([]) };
}
