import sharp from "sharp";
import { ANDROID_DENSITIES } from "./sizes.ts";

/** Adaptive icon layers are 108 dp; launchers only promise to show the central 66 dp. */
export const ADAPTIVE_DP = 108;
export const SAFE_ZONE_DP = 66;

const adaptiveXml = (name: string) => `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/${name}_background"/>
    <foreground android:drawable="@mipmap/${name}_foreground"/>
</adaptive-icon>
`;

const backgroundXml = (name: string, color: string) => `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="${name}_background">${color}</color>
</resources>
`;

const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");

/** The average of the source's four corner pixels, flattened on white: the usual backdrop colour of an icon. */
export async function cornerColour(src: Buffer): Promise<string> {
  const { data, info } = await sharp(src).flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => (y * info.width + x) * info.channels;
  const corners = [at(0, 0), at(info.width - 1, 0), at(0, info.height - 1), at(info.width - 1, info.height - 1)];
  return `#${[0, 1, 2].map((c) => hex(corners.reduce((s, i) => s + data[i + c]!, 0) / 4)).join("")}`;
}

/**
 * Android extras beyond the legacy mipmaps (original work; launch has none): per density a round
 * legacy icon and a 108 dp adaptive foreground with the artwork in the 66 dp safe zone, the
 * adaptive-icon XML (also used for the round icon) and the background colour resource.
 */
export async function androidExtras(src: Buffer, name: string, background: string, resized: (size: number, flatten: boolean) => Promise<Buffer>): Promise<Array<[string, Uint8Array]>> {
  const out: Array<[string, Uint8Array]> = [];
  for (const [density, px] of ANDROID_DENSITIES) {
    const circle = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"><circle cx="${px / 2}" cy="${px / 2}" r="${px / 2}" fill="#000"/></svg>`);
    const round = await sharp(await resized(px, false)).composite([{ input: circle, blend: "dest-in" }]).png().toBuffer();
    out.push([`android/mipmap-${density}/${name}_round.png`, round]);
    const layer = Math.round((px * ADAPTIVE_DP) / 48);
    const art = Math.round((layer * SAFE_ZONE_DP) / ADAPTIVE_DP);
    const pad = Math.floor((layer - art) / 2);
    const fg = await sharp(await resized(art, false))
      .extend({ top: pad, left: pad, bottom: layer - art - pad, right: layer - art - pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toBuffer();
    out.push([`android/mipmap-${density}/${name}_foreground.png`, fg]);
  }
  const xml = new TextEncoder().encode(adaptiveXml(name));
  out.push([`android/mipmap-anydpi-v26/${name}.xml`, xml], [`android/mipmap-anydpi-v26/${name}_round.xml`, xml]);
  out.push([`android/values/${name}_background.xml`, new TextEncoder().encode(backgroundXml(name, background))]);
  return out;
}
