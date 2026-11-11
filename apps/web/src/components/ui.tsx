"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/** Stroke icons (24px grid). ponytail: a path map instead of an icon font; add a path when a screen needs one. */
const PATHS = {
  bell: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0",
  check: "M20 6 9 17l-5-5",
  chevronDown: "m6 9 6 6 6-6",
  chevronLeft: "m15 18-6-6 6-6",
  chevronRight: "m9 18 6-6-6-6",
  sparkle: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z",
  user: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  phone: "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2M11 18h2",
  search: "m21 21-4.3-4.3M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16",
  play: "M5 3l14 9-14 9z",
} as const;

export function Icon({ name, className = "size-5" }: { name: keyof typeof PATHS; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d={PATHS[name]} /></svg>
  );
}

/** 28px violet square with a white "C", plus the wordmark. */
export function Logo({ href = "/", className = "" }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={`inline-flex shrink-0 items-center gap-2 font-display text-lg font-bold tracking-[-0.02em] text-ink ${className}`}>
      <span aria-hidden className="grid size-7 place-items-center rounded-lg bg-primary text-sm font-extrabold text-white">C</span>
      Chitrapx
    </Link>
  );
}

/**
 * A button that toggles a dropdown panel. Closes on Escape (focus back to the button) and on a click outside.
 * `children` gets `close` so menu items can shut it after acting.
 */
export function Menu({ label, button, align = "left", buttonClassName = "", children }: {
  label: string; button: React.ReactNode; align?: "left" | "right"; buttonClassName?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button ref={trigger} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} className={buttonClassName} onClick={() => setOpen(!open)}>{button}</button>
      {open && <div role="menu" className={`menu ${align === "right" ? "right-0" : "left-0"}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

/** Horizontal snap-scroll row with arrow buttons and dots (the active dot is a wide violet bar). */
export function Carousel({ label, children }: { label: string; children: React.ReactNode[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const count = children.length;
  const slides = () => [...(track.current?.children ?? [])] as HTMLElement[];
  const go = (i: number) => slides()[Math.max(0, Math.min(count - 1, i))]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  // The slide whose centre is nearest the track's centre is the active one.
  const onScroll = () => {
    const t = track.current!;
    const mid = t.scrollLeft + t.clientWidth / 2;
    const dist = slides().map((el) => Math.abs(el.offsetLeft - t.offsetLeft + el.offsetWidth / 2 - mid));
    setActive(dist.indexOf(Math.min(...dist)));
  };
  return (
    <div role="region" aria-roledescription="carousel" aria-label={label} className="space-y-4">
      <div ref={track} onScroll={onScroll} className="relative flex snap-x snap-mandatory gap-4 overflow-x-auto pb-1 [scrollbar-width:none] *:shrink-0 *:snap-center">
        {children}
      </div>
      {count > 1 && (
        <div className="flex items-center justify-between gap-4">
          <button type="button" className="icon-btn border border-line disabled:opacity-40" aria-label="Previous screenshot" disabled={active === 0} onClick={() => go(active - 1)}><Icon name="chevronLeft" /></button>
          <div className="flex items-center gap-1.5">
            {children.map((_, i) => (
              <button key={i} type="button" aria-label={`Screenshot ${i + 1} of ${count}`} aria-current={i === active}
                className={`h-2 rounded-full transition-all ${i === active ? "w-8 bg-primary" : "w-2 bg-ink/15 hover:bg-ink/30"}`} onClick={() => go(i)} />
            ))}
          </div>
          <button type="button" className="icon-btn border border-line disabled:opacity-40" aria-label="Next screenshot" disabled={active === count - 1} onClick={() => go(active + 1)}><Icon name="chevronRight" /></button>
        </div>
      )}
    </div>
  );
}

/** Links separated by slashes; the last item is the current page. */
export function Breadcrumb({ items, className = "" }: { items: Array<{ label: string; href?: string; ariaLabel?: string }>; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={`min-w-0 truncate text-sm text-muted ${className}`}>
      {items.map((it, i) => (
        <span key={i}>
          {i > 0 && <span aria-hidden className="mx-2 text-ink/25">/</span>}
          {it.href
            ? <Link href={it.href} aria-label={it.ariaLabel} className="transition hover:text-ink">{it.label}</Link>
            : <span aria-current="page" className="font-medium text-ink">{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}

/** A number with a label and an optional one-line note (a positive trend is emerald). */
export function MetricCard({ label, value, note, tone = "muted" }: { label: string; value: React.ReactNode; note?: React.ReactNode; tone?: "muted" | "success" }) {
  return (
    <div className="card space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="font-display text-3xl font-bold tracking-[-0.02em] tabular-nums">{value}</p>
      {note && <p className={`text-xs ${tone === "success" ? "font-medium text-emerald-600 dark:text-emerald-400" : "text-muted"}`}>{note}</p>}
    </div>
  );
}
