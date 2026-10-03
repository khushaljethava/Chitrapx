import { inflateRawSync } from "node:zlib";

/** `too_large` when declared counts or sizes pass the limits, `invalid` for anything malformed. */
export class ZipError extends Error {
  constructor(readonly code: "invalid" | "too_large") { super(code); }
}

export type ZipEntry = { name: string; method: number; compressedSize: number; size: number; offset: number };

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;
const bad = (code: "invalid" | "too_large" = "invalid"): never => { throw new ZipError(code); };

/**
 * Reads only the central directory. Entry count and total declared size are checked as the
 * directory is walked, so a hostile file is rejected before anything is inflated. Zip64,
 * encrypted entries and duplicate names are refused.
 */
export function readZipDirectory(buf: Buffer, limits: { entries: number; totalBytes: number }): Map<string, ZipEntry> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) return bad();
  const declared = buf.readUInt16LE(eocd + 10);
  if (declared > limits.entries) return bad("too_large");
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset + cdSize > eocd) return bad();

  const out = new Map<string, ZipEntry>();
  let total = 0, p = cdOffset;
  for (let i = 0; i < declared; i++) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== CENTRAL) return bad();
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), skip = nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    if (p + 46 + skip > eocd) return bad();
    if (compressedSize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff || flags & 1) return bad();
    total += size;
    if (total > limits.totalBytes) return bad("too_large");
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (out.has(name)) return bad();
    out.set(name, { name, method, compressedSize, size, offset });
    p += 46 + skip;
  }
  return out;
}

/** Inflates one entry, never producing more than its declared size. */
export function extractZipEntry(buf: Buffer, e: ZipEntry): Buffer {
  const h = e.offset;
  if (h + 30 > buf.length || buf.readUInt32LE(h) !== LOCAL) return bad();
  const start = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
  const end = start + e.compressedSize;
  if (end > buf.length) return bad();
  const data = buf.subarray(start, end);
  if (e.method === 0) return e.compressedSize === e.size ? data : bad();
  if (e.method !== 8) return bad();
  if (e.size === 0) return e.compressedSize <= 2 ? Buffer.alloc(0) : bad();
  let out: Buffer;
  try { out = inflateRawSync(data, { maxOutputLength: e.size }); } catch { return bad(); }
  return out.length === e.size ? out : bad();
}
