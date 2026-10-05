/** Downscaled screenshot pixels → up to `max` dominant colours. Pure and deterministic; no network. */
export function paletteFromPixels(images: Array<{ data: Uint8ClampedArray | Uint8Array }>, max = 6): string[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (const { data } of images) {
    for (let i = 0; i + 3 < data.length; i += 4) {
      const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!, a = data[i + 3]!;
      if (a < 128) continue;
      if (r > 235 && g > 235 && b > 235) continue; // near white
      if (r < 20 && g < 20 && b < 20) continue; // near black
      if (saturation(r, g, b) < 0.15) continue; // grey
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3); // 32 levels per channel
      const bk = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      bk.n++; bk.r += r; bk.g += g; bk.b += b;
      buckets.set(key, bk);
    }
  }
  const ranked = [...buckets].map(([key, bk]) => ({ key, n: bk.n, rgb: [bk.r / bk.n, bk.g / bk.n, bk.b / bk.n] as [number, number, number] }))
    .sort((x, y) => y.n - x.n || x.key - y.key);
  const kept: Array<{ n: number; rgb: [number, number, number]; lab: [number, number, number] }> = [];
  for (const c of ranked) {
    const lab = toLab(c.rgb);
    const near = kept.find((k) => deltaE(k.lab, lab) < 10);
    if (near) near.n += c.n; else kept.push({ n: c.n, rgb: c.rgb, lab });
  }
  return kept.sort((x, y) => y.n - x.n).slice(0, max).map((k) => hex(k.rgb));
}

function saturation(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, l = (mx + mn) / 2, d = mx - mn;
  return d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
}
const hex = (rgb: [number, number, number]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
function toLab([r, g, b]: [number, number, number]): [number, number, number] {
  const lin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), y = f(0.2126 * R + 0.7152 * G + 0.0722 * B), z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const deltaE = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

/** Draws each screenshot at 64 px on its longest side and extracts the palette. Signed URLs are CORS-enabled for the web origin. */
export async function extractPalette(urls: string[]): Promise<string[]> {
  const images = await Promise.all(urls.map((url) => new Promise<{ data: Uint8ClampedArray } | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const s = 64 / Math.max(img.naturalWidth, img.naturalHeight, 1);
      const w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0, w, h);
      resolve({ data: ctx.getImageData(0, 0, w, h).data });
    };
    img.onerror = () => resolve(null);
    img.src = url;
  })));
  return paletteFromPixels(images.filter((x): x is { data: Uint8ClampedArray } => !!x));
}
