/**
 * Seeded generator for starter logos: mulberry32 on a 32-bit seed. Not launch's 64-bit xorshift
 * (launch/src/generate_logo.rs:323-365): JavaScript numbers cannot hold 64-bit seeds exactly, so
 * seeds are not interchangeable with launch's CLI. Same seed, same sequence, on every machine.
 */
export class Rng {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0; }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max). */
  rangeInt(min: number, max: number): number { return min + Math.floor(this.next() * (max - min)); }
  /** Float in [min, max). */
  rangeFloat(min: number, max: number): number { return min + this.next() * (max - min); }
  nextBool(): boolean { return this.next() < 0.5; }
}
