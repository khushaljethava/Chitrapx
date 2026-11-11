"use client";

import { useCallback, useMemo, useState } from "react";
import { foldCount, getTarget, type BoardGroup, type ChitrapxDoc } from "@chitrapx/document";
import type { RenderExtras } from "@chitrapx/renderer";
import { BoardThumb } from "./BoardThumb.tsx";
import { Carousel, Icon } from "./ui.tsx";

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

  if (!group || !group.boards.length) return <p className="card border-dashed p-10 text-center text-muted">Add boards to this project to preview it in the stores.</p>;
  const portrait = group.boards[0]!.size.height >= group.boards[0]!.size.width;
  const thumb = (g: BoardGroup, i: number, height: number) => <BoardThumb key={`${g.id}-${i}`} doc={doc} groupId={g.id} boardIndex={i} locale={locale} height={height} resolveSrc={resolveSrc} extras={extras} />;
  const fg = dark ? "text-white" : "text-ink";
  const muted = dark ? "text-neutral-400" : "text-muted";
  // App icons may carry a gradient (artwork, not UI chrome).
  const icon = (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-coral text-2xl font-bold text-white" aria-hidden>
      {app.name.slice(0, 1).toUpperCase()}
    </div>
  );
  const stars = <span className="text-sm tracking-tight text-amber-500" aria-label="Rating">★★★★★</span>;
  const seen = portrait ? foldCount(group.target) : 1;
  const panel = `rounded-card border p-6 ${dark ? "border-white/10 bg-night" : "border-line bg-surface"}`;
  const stat = (value: React.ReactNode, label: string) => (
    <div className="min-w-0 flex-1 px-3 first:pl-0 last:pr-0"><p className={`text-sm font-semibold ${fg}`}>{value}</p><p className={`truncate text-xs ${muted}`}>{label}</p></div>
  );

  return (
    <div className="space-y-8">
      <div className="card flex flex-wrap items-center gap-x-6 gap-y-3 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">Store:</span>
          <div role="group" aria-label="Store" className="segmented">
            {STORES.map(([s, label]) => (
              <button key={s} type="button" aria-pressed={store === s} onClick={() => setStore(s)}>
                <Icon name={s === "play" ? "play" : s === "appstore-search" ? "search" : "phone"} className="size-4" />{label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
          {locales.length > 1 && (
            <label className="flex items-center gap-2 text-sm font-medium">Language
              <select className="input w-auto" value={locale} onChange={(e) => setLocale(e.target.value)}>
                {locales.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
          )}
          <button type="button" className="btn-ghost" aria-pressed={dark} onClick={() => setDark(!dark)}>{dark ? "Light" : "Dark"} mode</button>
        </div>
      </div>

      {store === "appstore-search" ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl">App Store search results</h2>
            <p className="text-sm text-muted">Search results show only the first {seen} screenshot{seen > 1 ? "s" : ""}.</p>
          </div>
          <div className={`${panel} space-y-5`}>
            <div className={`rounded-control px-3 py-2 text-sm ${dark ? "bg-white/10 text-neutral-400" : "bg-canvas text-muted"}`}>Search: {app.name.toLowerCase()}</div>
            <div className="flex items-center gap-4">
              {icon}
              <div className="min-w-0 flex-1">
                <p className={`truncate font-semibold ${fg}`}>{app.name}</p>
                <p className={`truncate text-sm ${muted}`}>{app.subtitle}</p>
                {stars}
              </div>
              <span className="rounded-full bg-primary/15 px-4 py-1 text-sm font-bold text-primary">Get</span>
            </div>
            <div className="flex snap-x gap-3 overflow-x-auto pb-1 *:shrink-0 *:snap-start">
              {group.boards.slice(0, seen).map((_, i) => thumb(group, i, portrait ? 320 : 200))}
            </div>
          </div>
        </section>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <div className={`${panel} space-y-5`}>
            <div className="flex items-center gap-4">
              {icon}
              <div className="min-w-0">
                <p className={`truncate font-display text-xl font-bold tracking-[-0.02em] ${fg}`}>{app.name}</p>
                <p className={`line-clamp-2 text-sm ${muted}`}>{app.subtitle}</p>
                {store === "play" && <p className="text-sm text-emerald-600">Your company</p>}
              </div>
            </div>
            <div className={`flex divide-x border-y py-3 ${dark ? "divide-white/10 border-white/10" : "divide-line border-line"}`}>
              {store === "play"
                ? <>{stat("4.8 ★", "Rating")}{stat("100K+", "Downloads")}{stat("Everyone", "Rated")}</>
                : <>{stat(<>4.8 {stars}</>, "Rating")}{stat("4+", "Age")}{stat("Free", "Price")}</>}
            </div>
            <span className="block rounded-full bg-primary py-2.5 text-center text-sm font-semibold text-white">{store === "play" ? "Install" : "Get"}</span>
            {store === "play" && feature && feature.boards.length > 0 && <div className="overflow-hidden rounded-control">{thumb(feature, 0, 160)}</div>}
            {store === "play" && <div className="space-y-1"><p className={`text-sm font-semibold ${fg}`}>About this app</p><p className={`line-clamp-3 text-sm ${muted}`}>{app.subtitle}</p></div>}
          </div>
          <section className={`${panel} min-w-0 space-y-4`}>
            <div>
              <h2 className={`text-lg ${fg}`}>Preview screenshots</h2>
              <p className={`text-sm ${muted}`}>Swipe or use the arrows to review the set in order.</p>
            </div>
            <div className={`rounded-xl border px-4 py-6 ${dark ? "border-white/10 bg-black" : "border-line bg-canvas"}`}>
              <Carousel label="Store screenshots">{group.boards.map((_, i) => thumb(group, i, portrait ? (store === "play" ? 380 : 420) : 240))}</Carousel>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
