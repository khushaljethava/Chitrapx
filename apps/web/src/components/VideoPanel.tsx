"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getTarget, VIDEO_FORMATS, videoTimeline, type ChitrapxDoc, type VideoFormat } from "@chitrapx/document";
import { VideoFrame, type RenderExtras } from "@chitrapx/renderer";
import { api } from "@/server/api.ts";
import { jobError } from "./jobText.ts";

type Job = { id: string; type: string; status: string; error: string | null; createdAt: string; output: { duration?: number; bytes?: number } | null };
const PREVIEW_WIDTH = 240;

/** Live preview (same timeline and renderer as the export) and the video export action. */
export function VideoPanel({ projectId, doc, assetUrls, extras }: { projectId: string; doc: ChitrapxDoc; assetUrls: Record<string, string>; extras?: RenderExtras }) {
  const router = useRouter();
  const locales = [doc.localization.baseLocale, ...doc.localization.locales.map((l) => l.code)];
  const [groupId, setGroupId] = useState(doc.groups[0]?.id ?? "");
  const [format, setFormat] = useState<VideoFormat>("app-preview-portrait");
  const [locale, setLocale] = useState(locales[0]!);
  const [seconds, setSeconds] = useState(3);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const group = doc.groups.find((g) => g.id === groupId);
  const timeline = useMemo(() => videoTimeline(group?.boards ?? [], seconds), [group, seconds]);
  const resolveSrc = useCallback((src: string) => assetUrls[src] ?? null, [assetUrls]);
  const { width, height } = VIDEO_FORMATS[format];
  const scale = PREVIEW_WIDTH / width;

  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      setTime((t) => { const n = t + (now - last) / 1000; return n >= timeline.duration ? 0 : n; });
      last = now;
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing, timeline.duration]);

  const load = useCallback(() => api<Job[]>(`/api/projects/${projectId}/jobs`).then((all) => setJobs(all.filter((j) => j.type === "video"))), [projectId]);
  const active = jobs.some((j) => j.status === "queued" || j.status === "running");
  useEffect(() => { load().catch(() => {}); }, [load]);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => load().catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [active, load]);

  async function make() {
    setError("");
    try { await api(`/api/projects/${projectId}/video`, "POST", { groupId, format, locale, secondsPerBoard: seconds }); await load(); router.refresh(); }
    catch (err) { setError((err as Error).message); }
  }

  if (!group) return null;
  return (
    <section className="card space-y-4">
      <h2 className="font-semibold">Preview video</h2>
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="shrink-0 space-y-2">
          <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800" style={{ width: PREVIEW_WIDTH, height: height * scale }}>
            <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width, height }}>
              <VideoFrame doc={doc} groupId={groupId} locale={locale} timeline={timeline} time={time} width={width} height={height} resolveSrc={resolveSrc} extras={extras} />
            </div>
          </div>
          <div className="flex items-center gap-2" style={{ width: PREVIEW_WIDTH }}>
            <button type="button" className="btn-ghost px-3 py-1" onClick={() => setPlaying(!playing)}>{playing ? "Pause" : "Play"}</button>
            <input aria-label="Position" type="range" min={0} max={timeline.duration} step={0.05} value={time} className="flex-1"
              onChange={(e) => { setPlaying(false); setTime(Number(e.target.value)); }} />
            <span className="w-10 text-right text-xs tabular-nums text-neutral-500">{time.toFixed(1)}s</span>
          </div>
        </div>
        <div className="flex-1 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="v-size">Boards from</label>
              <select id="v-size" className="input" value={groupId} onChange={(e) => { setGroupId(e.target.value); setTime(0); }}>
                {doc.groups.map((g) => <option key={g.id} value={g.id}>{getTarget(g.target)?.label}{g.variant ? ` (${g.variant})` : ""}</option>)}
              </select></div>
            <div><label className="label" htmlFor="v-format">Video size</label>
              <select id="v-format" className="input" value={format} onChange={(e) => setFormat(e.target.value as VideoFormat)}>
                {Object.entries(VIDEO_FORMATS).map(([id, f]) => <option key={id} value={id}>{f.label} {f.width}x{f.height}</option>)}
              </select></div>
            {locales.length > 1 && <div><label className="label" htmlFor="v-locale">Language</label>
              <select id="v-locale" className="input" value={locale} onChange={(e) => setLocale(e.target.value)}>
                {locales.map((l) => <option key={l} value={l}>{l}</option>)}
              </select></div>}
            <div><label className="label" htmlFor="v-seconds">Seconds per board: {seconds}</label>
              <input id="v-seconds" type="range" min={2} max={6} step={0.5} value={seconds} className="w-full" onChange={(e) => setSeconds(Number(e.target.value))} /></div>
          </div>
          <p className="text-sm text-neutral-500">{timeline.duration.toFixed(1)} seconds, {timeline.slides.length} boards. App Store previews must be 15 to 30 seconds.</p>
          <button type="button" className="btn" disabled={active} onClick={make}>{active ? "Rendering video" : "Make video (3 credits)"}</button>
          {error && <p role="alert" className="error">{error}</p>}
          {jobs.length > 0 && (
            <ul className="divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
              {jobs.map((j) => (
                <li key={j.id} className="flex justify-between gap-3 py-2">
                  <span className="text-neutral-500">{new Date(j.createdAt).toLocaleString()}</span>
                  {j.status === "done" ? <a className="font-medium text-indigo-600 hover:underline" href={`/api/jobs/${j.id}/download`}>Download MP4 ({((j.output?.bytes ?? 0) / 1048576).toFixed(1)} MB)</a>
                    : j.status === "failed" ? <span className="text-red-600" title={j.error ?? ""}>{jobError(j.error)} Credits refunded.</span>
                      : <span>{j.status === "queued" ? "Waiting" : "Rendering"}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
