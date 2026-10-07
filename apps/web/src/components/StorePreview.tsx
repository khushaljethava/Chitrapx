"use client";

import { useCallback, useMemo, useState } from "react";
import { foldCount, getTarget, type BoardGroup, type ChitrapxDoc } from "@chitrapx/document";
import type { RenderExtras } from "@chitrapx/renderer";
import { BoardThumb } from "./BoardThumb.tsx";

type Store = "appstore-search" | "appstore-page" | "play";
const STORES: Array<[Store, string]> = [["appstore-search", "App Store search"], ["appstore-page", "App Store page"], ["play", "Google Play"]];
const APPLE = new Set(["ios", "ipad", "mac", "watch", "tv", "vision"]);

function pickGroup(doc: ChitrapxDoc, store: Store): BoardGroup | undefined {
  const apple = store !== "play";
  return doc.groups.find((g) => !g.variant && APPLE.has(getTarget(g.target)?.platform ?? "") === apple && getTarget(g.target)?.platform !== "play")
    ?? doc.groups.find((g) => !g.variant) ?? doc.groups[0];
}

/** HTML/CSS mockups of store listings, filled with the project's own boards. No store artwork is used. */
export function StorePreview({ doc, assetUrls, app, extras }: { doc: ChitrapxDoc; assetUrls: Record<string, string>; app: { name: string; subtitle: string }; extras?: RenderExtras }) {
  const locales = [doc.localization.baseLocale, ...doc.localization.locales.map((l) => l.code)];
  const [store, setStore] = useState<Store>("appstore-search");
  const [dark, setDark] = useState(false);
  const [locale, setLocale] = useState(locales[0]!);
  const resolveSrc = useCallback((src: string) => assetUrls[src] ?? null, [assetUrls]);
  const group = useMemo(() => pickGroup(doc, store), [doc, store]);
  const feature = doc.groups.find((g) => g.target === "play-feature");

  if (!group || !group.boards.length) return <p className="rounded-2xl border border-dashed border-neutral-300 p-10 text-center text-neutral-500 dark:border-neutral-700">Add boards to this project to preview it in the stores.</p>;
  const portrait = group.boards[0]!.size.height >= group.boards[0]!.size.width;
  const thumb = (g: BoardGroup, i: number, height: number) => <BoardThumb key={`${g.id}-${i}`} doc={doc} groupId={g.id} boardIndex={i} locale={locale} height={height} resolveSrc={resolveSrc} extras={extras} />;
  const fg = dark ? "text-white" : "text-neutral-900";
  const muted = dark ? "text-neutral-400" : "text-neutral-500";
  const icon = (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-pink-500 text-2xl font-bold text-white" aria-hidden>
      {app.name.slice(0, 1).toUpperCase()}
    </div>
  );
  const stars = <span className="text-sm tracking-tight text-amber-500" aria-label="Rating">★★★★★</span>;
  const seen = portrait ? foldCount(group.target) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Store" className="flex flex-wrap gap-1 rounded-xl border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900">
          {STORES.map(([s, label]) => (
            <button key={s} type="button" aria-pressed={store === s} onClick={() => setStore(s)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${store === s
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/20"
                : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"}`}>{label}</button>
          ))}
        </div>
        <button type="button" className="btn-ghost" onClick={() => setDark(!dark)}>{dark ? "Light" : "Dark"} mode</button>
        {locales.length > 1 && (
          <select aria-label="Language" className="input w-auto" value={locale} onChange={(e) => setLocale(e.target.value)}>
            {locales.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
      </div>

      <div className="rounded-2xl border border-neutral-200 bg-neutral-100 bg-[radial-gradient(var(--color-neutral-300)_1px,transparent_1px)] [background-size:16px_16px] px-3 py-8 sm:px-8 sm:py-12 dark:border-neutral-800 dark:bg-neutral-900 dark:bg-[radial-gradient(var(--color-neutral-800)_1px,transparent_1px)]">
      <div className={`mx-auto max-w-md overflow-hidden rounded-[2.5rem] border-[10px] p-4 shadow-xl shadow-neutral-900/10 ${dark ? "border-neutral-800 bg-black" : "border-neutral-900 bg-white dark:border-neutral-700"}`}>
        <div aria-hidden className={`mx-auto mb-3 h-1.5 w-20 rounded-full ${dark ? "bg-neutral-800" : "bg-neutral-200"}`} />
        {store === "appstore-search" && (
          <div className="space-y-3">
            <div className={`rounded-xl px-3 py-2 text-sm ${dark ? "bg-neutral-900 text-neutral-400" : "bg-neutral-100 text-neutral-500"}`}>Search: {app.name.toLowerCase()}</div>
            <div className="flex items-center gap-3">
              {icon}
              <div className="min-w-0 flex-1">
                <p className={`truncate font-semibold ${fg}`}>{app.name}</p>
                <p className={`truncate text-sm ${muted}`}>{app.subtitle}</p>
                {stars}
              </div>
              <span className="rounded-full bg-blue-500/15 px-4 py-1 text-sm font-bold text-blue-500">Get</span>
            </div>
            <div className="flex gap-2 overflow-hidden">
              {group.boards.slice(0, seen).map((_, i) => thumb(group, i, portrait ? 220 : 180))}
            </div>
            <p className={`text-center text-xs ${muted}`}>Search results show only the first {seen} screenshot{seen > 1 ? "s" : ""}.</p>
          </div>
        )}

        {store === "appstore-page" && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {icon}
              <div className="min-w-0 flex-1">
                <p className={`truncate text-lg font-semibold ${fg}`}>{app.name}</p>
                <p className={`truncate text-sm ${muted}`}>{app.subtitle}</p>
              </div>
              <span className="rounded-full bg-blue-500 px-4 py-1 text-sm font-bold text-white">Get</span>
            </div>
            <div className={`flex justify-between border-t border-b py-2 text-xs ${dark ? "border-neutral-800" : "border-neutral-200"} ${muted}`}>
              <span>4.8 {stars}</span><span>Age 4+</span><span>Free</span>
            </div>
            <p className={`text-sm font-semibold ${fg}`}>Preview</p>
            <div className="flex gap-2 overflow-x-auto pb-2">{group.boards.map((_, i) => thumb(group, i, portrait ? 300 : 200))}</div>
          </div>
        )}

        {store === "play" && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {icon}
              <div className="min-w-0">
                <p className={`truncate text-lg font-semibold ${fg}`}>{app.name}</p>
                <p className="text-sm text-green-600">Your company</p>
                <p className={`text-xs ${muted}`}>4.8 ★ · 100K+ downloads</p>
              </div>
            </div>
            <span className="block rounded-lg bg-green-700 py-2 text-center text-sm font-medium text-white">Install</span>
            {feature && feature.boards.length > 0 && <div className="overflow-hidden rounded-lg">{thumb(feature, 0, 180)}</div>}
            <div className="flex gap-2 overflow-x-auto pb-2">{group.boards.map((_, i) => thumb(group, i, portrait ? 260 : 180))}</div>
            <p className={`text-sm font-semibold ${fg}`}>About this app</p>
            <p className={`line-clamp-3 text-sm ${muted}`}>{app.subtitle}</p>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
