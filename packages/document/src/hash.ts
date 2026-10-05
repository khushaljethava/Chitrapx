// Ported from open-screenshot-generator (MIT), src/lib/i18n/hash.ts. Moved here from packages/renderer in SP11
// so every writer of a translation (table, CSV import, AI) records the same fingerprint the renderer checks.
// FNV-1a, 32 bits: compared against a value written seconds earlier, so collision resistance buys nothing.

/** Short stable hex fingerprint of `input`. Always 8 characters. */
export function hash32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
