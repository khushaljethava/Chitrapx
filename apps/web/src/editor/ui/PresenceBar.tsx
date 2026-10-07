"use client";

import { initials, type PeerPresence } from "../live/presence.ts";

const SHOWN = 3;

/** Who else is in the project (SP15): an avatar stack in each person's colour, a Live badge, and sync notices. */
export function PresenceBar({ peers, live, notice, onDismiss, selfId }: {
  peers: PeerPresence[]; live: boolean; notice: string; onDismiss(): void; selfId?: string;
}) {
  // One avatar per person, even with several tabs open; my own other tabs still make the editor live, but show no avatar.
  const people = [...new Map(peers.filter((p) => p.userId !== selfId).map((p) => [p.userId, p])).values()];
  if (!people.length && !live && !notice) return null;
  return (
    <div className="flex items-center gap-2">
      {notice && (
        <span role="status" className="flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100">
          {notice}
          <button type="button" aria-label="Dismiss" className="px-1" onClick={onDismiss}>x</button>
        </span>
      )}
      {live && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100" title="Edits sync with everyone in this project">Live</span>}
      <ul className="flex -space-x-2" aria-label="People in this project">
        {people.slice(0, SHOWN).map((p) => (
          <li key={p.userId} title={p.canEdit ? p.name : `${p.name} (viewing)`}
            className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-white dark:ring-neutral-900"
            style={{ backgroundColor: p.color }}>
            {initials(p.name)}
          </li>
        ))}
        {people.length > SHOWN && (
          <li className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-200 text-[11px] font-semibold text-neutral-700 ring-2 ring-white dark:bg-neutral-700 dark:text-neutral-200 dark:ring-neutral-900"
            title={people.slice(SHOWN).map((p) => p.name).join(", ")}>+{people.length - SHOWN}</li>
        )}
      </ul>
    </div>
  );
}
