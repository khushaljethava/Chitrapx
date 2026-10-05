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

  if (doc.groups.length === 0) return <p className="text-neutral-500">This project is empty. The editor arrives soon; for now start from a template.</p>;
  return (
    <div className="space-y-6">
      {locales.length > 1 && (
        <div className="flex items-center gap-2">
          <label className="label mb-0" htmlFor="locale">Language</label>
          <select id="locale" className="input w-auto" value={locale} onChange={(e) => setLocale(e.target.value)}>
            {locales.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
      )}
      {doc.groups.map((g) => (
        <section key={g.id} className="space-y-2">
          <h2 className="text-sm font-medium text-neutral-500">{getTarget(g.target)?.label} · {g.boards.length} board{g.boards.length === 1 ? "" : "s"}</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {g.boards.map((b, i) => (
              <BoardThumb key={b.id} doc={doc} groupId={g.id} boardIndex={i} locale={locale} height={b.size.width > b.size.height ? 200 : 360} resolveSrc={resolveSrc} extras={extras} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
