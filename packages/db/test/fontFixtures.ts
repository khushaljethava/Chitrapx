import { readFileSync } from "node:fs";
import { join } from "node:path";

export const FONT_FIXTURES = join(import.meta.dirname, "fixtures/fonts");
export const fixtureFont = (name: string) => readFileSync(join(FONT_FIXTURES, name));

/** A copy of a TrueType font with OS/2 fsType set to `value` (bit 1 = restricted licence embedding). */
export function withFsType(ttf: Buffer, value: number): Buffer {
  const b = Buffer.from(ttf);
  const tables = b.readUInt16BE(4);
  for (let i = 0; i < tables; i++) {
    const rec = 12 + i * 16;
    if (b.toString("latin1", rec, rec + 4) === "OS/2") { b.writeUInt16BE(value, b.readUInt32BE(rec + 8) + 8); return b; }
  }
  throw new Error("no OS/2 table");
}
