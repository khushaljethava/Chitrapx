export type GradientStop = { color: string; at: number };
/** A text fill: linear (angle in degrees, 180 = top to bottom) or radial, 2 to 8 stops, `at` in 0..1. */
export type Gradient = { kind: "linear" | "radial"; angle?: number; stops: GradientStop[] };

/** A clean gradient (sorted, clamped, 2–8 stops) or undefined when there is nothing usable. Never throws. */
export function normalizeGradient(raw: unknown): Gradient | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const g = raw as { kind?: unknown; angle?: unknown; stops?: unknown };
  if ((g.kind !== "linear" && g.kind !== "radial") || !Array.isArray(g.stops)) return undefined;
  const stops = g.stops.flatMap((s): GradientStop[] => {
    const st = s as { color?: unknown; at?: unknown } | null;
    return typeof st?.color === "string" && st.color.trim() && typeof st.at === "number" && Number.isFinite(st.at)
      ? [{ color: st.color.trim(), at: Math.min(1, Math.max(0, st.at)) }] : [];
  }).sort((a, b) => a.at - b.at).slice(0, 8);
  if (stops.length < 2) return undefined;
  if (g.kind === "radial") return { kind: "radial", stops };
  const angle = typeof g.angle === "number" && Number.isFinite(g.angle) ? ((g.angle % 360) + 360) % 360 : 180;
  return { kind: "linear", angle, stops };
}

export function gradientCss(g: Gradient): string {
  const stops = g.stops.map((s) => `${s.color} ${Math.round(s.at * 1000) / 10}%`).join(", ");
  return g.kind === "radial" ? `radial-gradient(circle, ${stops})` : `linear-gradient(${g.angle ?? 180}deg, ${stops})`;
}
