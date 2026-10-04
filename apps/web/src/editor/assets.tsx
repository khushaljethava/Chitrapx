"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ResolveSrc } from "@chitrapx/renderer";
import { api } from "@/server/api.ts";
import type { PickerAsset } from "./ui/fields.tsx";

type Row = PickerAsset & { videoUrl?: string };
type Value = { appId: string; assets: PickerAsset[]; resolveSrc: ResolveSrc; refresh(): Promise<PickerAsset[]> };
const Ctx = createContext<Value | null>(null);

/** The app's uploads and their signed URLs; refreshed after the editor uploads something. */
export function EditorAssetsProvider({ appId, assets: initial, urls: initialUrls, children }: {
  appId: string; assets: PickerAsset[]; urls: Record<string, string>; children: React.ReactNode;
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
  const value = useMemo(() => ({ appId, assets, resolveSrc, refresh }), [appId, assets, resolveSrc, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEditorAssets(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEditorAssets outside EditorAssetsProvider");
  return v;
}
