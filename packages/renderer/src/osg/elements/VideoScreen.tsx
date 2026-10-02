// Chitrapx: a screen recording inside a device screen. Loops in the editor; with `time` it seeks to
// that exact moment and marks itself ready once the frame is decoded (export frames wait for it).
import { useEffect, useRef } from "react";

export function VideoScreen({ src, poster, time, fit }: { src: string; poster?: string; time?: number; fit: "cover" | "contain" | "fill" }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || time === undefined) return;
    v.pause();
    const seek = () => {
      const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
      const target = d ? time % d : 0;
      if (Math.abs(v.currentTime - target) < 0.005 && v.readyState >= 2) { v.dataset.videoReady = "1"; return; }
      v.dataset.videoReady = "0";
      v.currentTime = target;
    };
    const ready = () => { if (v.readyState >= 2) v.dataset.videoReady = "1"; };
    v.addEventListener("seeked", ready);
    if (v.readyState >= 1) seek(); else v.addEventListener("loadedmetadata", seek, { once: true });
    return () => v.removeEventListener("seeked", ready);
  }, [time, src]);
  return (
    <video ref={ref} src={src} poster={poster} muted playsInline preload="auto"
      autoPlay={time === undefined} loop={time === undefined} data-video-ready={time === undefined ? undefined : "0"}
      onError={(e) => { (e.currentTarget as HTMLVideoElement).dataset.videoReady = "error"; }}
      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: fit }} />
  );
}
