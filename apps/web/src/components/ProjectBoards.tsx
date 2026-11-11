"use client";

import { useCallback, useState } from "react";
import { getTarget, type ChitrapxDoc } from "@chitrapx/document";
import type { RenderExtras } from "@chitrapx/renderer";
import { BoardThumb } from "./BoardThumb.tsx";

/** Every board of every group, in one language at a time. */
export function ProjectBoards({ doc, assetUrls, extras }: { doc: ChitrapxDoc; assetUrls: Record<string, string>; extras?: RenderExtras }) {
  const locales = [doc.localization.baseLocale, ...doc.localization.locales.map((l) => l.code)];
  const [locale, setLocale] = useState(locales[0]!);
  const resolveSrc = useCallback((src: string) => assetUrls[src] ?? (/^(https?:|data:|blob:)/.test(src) ? src : null), [assetUrls]);

  if (doc.groups.length === 0) return <p className="card border-dashed py-10 text-center text-muted">This project is empty. The editor arrives soon; for now start from a template.</p>;
  return (
    <div className="space-y-6">
      {locales.length > 1 && (
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium" htmlFor="locale">Language</label>
          <select id="locale" className="input w-auto" value={locale} onChange={(e) => setLocale(e.target.value)}>
            {locales.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
      )}
      {doc.groups.map((g) => (
        <section key={g.id} className="card space-y-4">
          <h2 className="flex flex-wrap items-baseline gap-2 text-base">
            <span>{getTarget(g.target)?.label}</span>
            <span className="font-sans text-sm font-normal tracking-normal tabular-nums text-muted">{getTarget(g.target)?.width}×{getTarget(g.target)?.height} · {g.boards.length} board{g.boards.length === 1 ? "" : "s"}</span>
          </h2>
          <div className="flex snap-x gap-4 overflow-x-auto pb-2 *:shrink-0 *:snap-start">
            {g.boards.map((b, i) => (
              <BoardThumb key={b.id} doc={doc} groupId={g.id} boardIndex={i} locale={locale} height={b.size.width > b.size.height ? 200 : 360} resolveSrc={resolveSrc} extras={extras} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
