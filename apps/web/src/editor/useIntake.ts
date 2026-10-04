"use client";

import { useRef, useState } from "react";
import type { ArtboardElement } from "@chitrapx/document";
import { uploadAsset } from "@/lib/uploadAsset.ts";
import { useEditorAssets } from "./assets.tsx";
import type { Ref } from "./commands.ts";
import { useEditorStore } from "./context.tsx";
import { acceptImages } from "./intake.ts";

export type DropAt = { boardId: string; x: number; y: number; device?: Ref };
type Sizes = Map<string, { width: number; height: number }>;

/** Uploads dropped or picked images and places them: into a device, as images, or as new boards. */
export function useIntake() {
  const store = useEditorStore();
  const { appId, refresh } = useEditorAssets();
  const [progress, setProgress] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState<{ assetIds: string[]; at: DropAt } | null>(null);
  const sizes = useRef<Sizes>(new Map());

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
      const rows = await refresh();
      sizes.current = new Map(rows.map((r) => [r.id, { width: r.width ?? 1000, height: r.height ?? 2000 }]));
    }
    return ids;
  }

  function addImages(ids: string[], at: DropAt) {
    const s = store.getState();
    const board = s.doc.groups.find((g) => g.id === s.activeGroupId)?.boards.find((b) => b.id === at.boardId);
    if (!board) return;
    const w = board.size.width * 0.5;
    ids.forEach((id, n) => {
      const sz = sizes.current.get(id) ?? { width: 1000, height: 2000 };
      const h = (w * sz.height) / sz.width;
      const element = { id: crypto.randomUUID(), type: "image", name: "Screenshot", imageSrc: `asset:${id}`, objectFit: "contain",
        position: { x: at.x - w / 2 + n * 40, y: at.y - h / 2 + n * 40 }, size: { width: w, height: h }, rotation: 0, scale: 1 } as unknown as ArtboardElement;
      s.apply({ type: "addElement", groupId: s.activeGroupId, boardId: at.boardId, element });
    });
  }

  function addBoards(ids: string[], sourceBoardId: string) {
    const s = store.getState();
    s.apply({ type: "addBoardsFromAssets", groupId: s.activeGroupId, sourceBoardId, assetIds: ids, newBoardIds: ids.map(() => crypto.randomUUID()) });
  }

  async function dropFiles(files: File[], at: DropAt) {
    const ids = await upload(files);
    if (!ids.length) return;
    const s = store.getState();
    if (ids.length === 1 && at.device) {
      const base = s.doc.localization.baseLocale;
      s.apply({ type: "setScreenshot", ref: at.device, src: `asset:${ids[0]}`, locale: s.locale !== base ? s.locale : undefined });
    } else if (ids.length === 1) addImages(ids, at);
    else setPending({ assetIds: ids, at });
  }

  async function importBoards(files: File[]) {
    const ids = await upload(files);
    const boardId = store.getState().activeBoardId;
    if (ids.length && boardId) addBoards(ids, boardId);
  }

  function choose(mode: "here" | "boards" | "cancel") {
    if (pending && mode === "here") addImages(pending.assetIds, pending.at);
    if (pending && mode === "boards") addBoards(pending.assetIds, pending.at.boardId);
    setPending(null);
  }

  return { progress, errors, pending, dropFiles, importBoards, choose, clearErrors: () => setErrors([]) };
}
