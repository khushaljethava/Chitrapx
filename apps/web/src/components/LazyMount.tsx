"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Mounts children only while near the viewport. Browsers keep about 16 WebGL contexts and
 * every 3D device owns one, so long grids must not mount them all at once.
 */
export function LazyMount({ width, height, children }: { width: number; height: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} style={{ width, height }} className="shrink-0 overflow-hidden rounded-md bg-neutral-100 dark:bg-neutral-800">{visible && children}</div>;
}
