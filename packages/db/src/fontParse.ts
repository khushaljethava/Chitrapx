import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { cleanFamilyName, isReservedFamily, type FontFormat } from "@chitrapx/document";

export type ParsedFont = { family: string; weight: number; italic: boolean; format: FontFormat; embeddable: boolean };
export class FontRejected extends Error {
  constructor(public code: "font_restricted" | "font_unreadable") { super(code); this.name = "FontRejected"; }
}

/** fontkit is only ever loaded inside the worker thread, by path (works unbundled and in Next's server bundle). */
function fontkitPath(): string {
  for (const base of [import.meta.url, pathToFileURL(join(process.cwd(), "package.json")).href]) {
    try { return createRequire(base).resolve("fontkit"); } catch { /* try the next base */ }
  }
  throw new Error("fontkit is not installed");
}

// Runs in its own thread with a 256 MB heap: a hostile font can crash or hang only that thread.
// Only the family/subfamily names and OS/2 weight, style and embedding bits leave it.
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
try {
  const fontkit = require(workerData.fontkit);
  let font = fontkit.create(Buffer.from(workerData.bytes));
  if (Array.isArray(font.fonts)) font = font.fonts[0];
  const os2 = font["OS/2"] || {};
  const name = (k) => { try { return font.getName(k) || ""; } catch { return ""; } };
  const fs = os2.fsType;
  parentPort.postMessage({ ok: true,
    family: name("preferredFamily") || font.familyName || "",
    subfamily: name("preferredSubfamily") || font.subfamilyName || "",
    weight: os2.usWeightClass || 400,
    italicFlag: !!(os2.fsSelection && os2.fsSelection.italic),
    restricted: typeof fs === "number" ? (fs & 2) !== 0 : !!(fs && fs.noEmbedding),
  });
} catch { parentPort.postMessage({ ok: false }); }
`;

type Raw = { ok: false } | { ok: true; family: string; subfamily: string; weight: number; italicFlag: boolean; restricted: boolean };

/** Family, weight and style of an uploaded font. Throws FontRejected("font_unreadable") on any failure or after `timeoutMs`. */
export async function parseFont(bytes: Uint8Array, format: FontFormat, opts: { timeoutMs?: number } = {}): Promise<ParsedFont> {
  const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { fontkit: fontkitPath(), bytes }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
  try {
    const raw = await new Promise<Raw>((resolve, reject) => {
      const fail = () => reject(new FontRejected("font_unreadable"));
      const timer = setTimeout(fail, opts.timeoutMs ?? 5000);
      worker.once("message", (m: Raw) => { clearTimeout(timer); resolve(m); });
      worker.once("error", () => { clearTimeout(timer); fail(); });
      worker.once("exit", () => { clearTimeout(timer); fail(); });
    });
    if (!raw.ok) throw new FontRejected("font_unreadable");
    const family = cleanFamilyName(raw.family);
    if (!family) throw new FontRejected("font_unreadable");
    const weight = Math.min(1000, Math.max(1, Math.round(Number(raw.weight) || 400)));
    return { family, weight, italic: raw.italicFlag || /italic|oblique/i.test(raw.subfamily), format, embeddable: !raw.restricted };
  } finally {
    await worker.terminate();
  }
}

/** parseFont plus the licence rule: OS/2 fsType bit 1 (restricted licence embedding) is refused. */
export async function checkFont(bytes: Uint8Array, format: FontFormat): Promise<ParsedFont> {
  const parsed = await parseFont(bytes, format);
  if (!parsed.embeddable) throw new FontRejected("font_restricted");
  return parsed;
}

/** The family an upload is listed under: a name that would shadow a built-in or catalogue font gets " (custom)". */
export const fontFamilyFor = (family: string) => (isReservedFamily(family) ? `${family} (custom)` : family);
