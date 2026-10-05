"use client";

import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { VIDEO_FORMATS, videoTimeline, type ChitrapxDoc, type VideoFormat } from "@chitrapx/document";
import { boardFor, VideoFrame, waitForRender, type RenderExtras } from "@chitrapx/renderer";

declare global {
  interface Window {
    __chitrapxVideo?: { ok: boolean; errors: string[]; duration: number; width: number; height: number };
    __chitrapxSeek?: (t: number) => Promise<void>;
  }
}

/** Headless-only: one video frame at a time; the worker seeks, waits, and captures each frame. */
export function VideoSheet({ doc, groupId, locale, format, secondsPerBoard, assetUrls, extras }: {
  doc: ChitrapxDoc; groupId: string; locale: string; format: VideoFormat; secondsPerBoard: number; assetUrls: Record<string, string>; extras?: RenderExtras;
}) {
  const [time, setTime] = useState(0);
  const { width, height } = VIDEO_FORMATS[format];
  const group = doc.groups.find((g) => g.id === groupId)!;
  const timeline = useMemo(() => videoTimeline(group.boards, secondsPerBoard), [group, secondsPerBoard]);
  // Only this workspace's signed assets (see RenderSheet): never a URL the document names.
  const resolveSrc = useMemo(() => (src: string) => assetUrls[src] ?? null, [assetUrls]);
  const missing = useMemo(() => [...new Set(group.boards.flatMap((_, i) => boardFor(doc, groupId, i, locale, resolveSrc).missing))],
    [doc, group, groupId, locale, resolveSrc]);

  useEffect(() => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
    const videosSettled = async () => {
      const until = Date.now() + 5000;
      for (;;) {
        const states = [...document.querySelectorAll<HTMLVideoElement>("main > div video[data-video-ready]")].map((v) => v.dataset.videoReady);
        if (states.includes("error")) throw new Error("video_failed");
        if (!states.includes("0")) return;
        if (Date.now() > until) throw new Error("video_seek_timeout");
        await new Promise((r) => setTimeout(r, 15));
      }
    };
    window.__chitrapxSeek = async (t: number) => { flushSync(() => setTime(t)); await frame(); await videosSettled(); };
    // Every board is mounted once up front so fonts, images and 3D devices are ready before frame 0.
    waitForRender(document).then((r) => {
      const errors = [...missing.map((m) => `asset_missing:${m}`), ...r.errors];
      window.__chitrapxVideo = { ok: errors.length === 0, errors, duration: timeline.duration, width, height };
    });
  }, [missing, timeline.duration, width, height]);

  return (
    <main style={{ margin: 0, padding: 0, width, height, overflow: "hidden" }}>
      <style>{"nextjs-portal{display:none!important} body{margin:0}"}</style>
      <VideoFrame doc={doc} groupId={groupId} locale={locale} timeline={timeline} time={time} width={width} height={height} resolveSrc={resolveSrc} extras={extras} />
      {/* Warm every board's images and devices off-screen so later frames never wait on loading. */}
      <div aria-hidden style={{ position: "absolute", left: -100000, top: 0 }}>
        {timeline.slides.map((s) => (
          <VideoFrame key={s.boardIndex} doc={doc} groupId={groupId} locale={locale} timeline={timeline} time={s.start + 5} width={40} height={80} resolveSrc={resolveSrc} extras={extras} />
        ))}
      </div>
    </main>
  );
}
