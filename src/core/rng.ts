/**
 * Mulberry32 — a tiny, fast, seedable PRNG.
 *
 * The whole simulation (spawns, weaves, drop rolls) draws from this instead of
 * Math.random() so a run can be replayed deterministically from its seed.
 * That is what makes the gameplay logic unit-testable.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Uniform integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number {
    return Math.floor(this.range(lo, hi + 1 - Number.EPSILON));
  }

  /** Pick one element; returns undefined only for an empty array. */
  pick<T>(items: readonly T[]): T | undefined {
    if (items.length === 0) return undefined;
    return items[Math.floor(this.next() * items.length)];
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Current internal state, for snapshotting a run. */
  get seedState(): number {
    return this.state;
  }
}

/** Non-deterministic seed for a fresh run. */
export const randomSeed = (): number => (Math.random() * 0xffffffff) >>> 0;
