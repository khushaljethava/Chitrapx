"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { RenderExtras, ResolveSrc } from "@chitrapx/renderer";
import { facesOf } from "@/lib/fontFaces.ts";
import { api } from "@/server/api.ts";
import type { FontFamilyRow } from "@/server/fonts.ts";
import type { PickerAsset } from "./ui/fields.tsx";

type Row = PickerAsset & { videoUrl?: string };
type Value = { appId: string; assets: PickerAsset[]; resolveSrc: ResolveSrc; refresh(): Promise<PickerAsset[]>;
  fonts: FontFamilyRow[]; extras: RenderExtras; refreshFonts(): Promise<void> };
const Ctx = createContext<Value | null>(null);

/** The app's uploads, the workspace fonts and their signed URLs; refreshed after the editor uploads something. */
export function EditorAssetsProvider({ appId, assets: initial, urls: initialUrls, fonts: initialFonts, extras: initialExtras, children }: {
  appId: string; assets: PickerAsset[]; urls: Record<string, string>; fonts: FontFamilyRow[]; extras: RenderExtras; children: React.ReactNode;
}) {
  const [assets, setAssets] = useState(initial);
  const [urls, setUrls] = useState(initialUrls);
  const resolveSrc = useCallback<ResolveSrc>((src) => urls[src] ?? null, [urls]);
  const refresh = useCallback(async () => {
    const rows = await api<Row[]>(`/api/apps/${appId}/assets`);
    const usable = rows.filter((a) => a.kind !== "recording" || a.videoUrl);
    const picked = usable.map(({ id, url, width, height, kind }) => ({ id, url, width, height, kind }));
    setAssets(picked);
    setUrls((u) => ({ ...u, ...Object.fromEntries(usable.flatMap((a) => a.kind === "recording"
      ? [[`asset:${a.id}`, a.videoUrl!], [`asset:${a.id}#poster`, a.url]] : [[`asset:${a.id}`, a.url]])) }));
    return picked;
  }, [appId]);
  const [fonts, setFonts] = useState(initialFonts);
  const [extras, setExtras] = useState(initialExtras);
  const refreshFonts = useCallback(async () => {
    const rows = await api<FontFamilyRow[]>("/api/fonts");
    setFonts(rows);
    setExtras((e) => ({ ...e, faces: facesOf(rows) }));
  }, []);
  const value = useMemo(() => ({ appId, assets, resolveSrc, refresh, fonts, extras, refreshFonts }), [appId, assets, resolveSrc, refresh, fonts, extras, refreshFonts]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEditorAssets(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEditorAssets outside EditorAssetsProvider");
  return v;
}
