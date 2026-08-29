import { describe, expect, it } from 'vitest';
import { randomSeed, Rng } from '../src/core/rng.js';

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    for (let i = 0; i < 50; i++) expect(a.next()).toBe(b.next());
  });

  it('differs across seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('stays within [0, 1)', () => {
    const r = new Rng(987654321);
    for (let i = 0; i < 20000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces a roughly uniform spread', () => {
    const r = new Rng(4242);
    const buckets = new Array(10).fill(0) as number[];
    const n = 30000;
    for (let i = 0; i < n; i++) buckets[Math.floor(r.next() * 10)]!++;
    for (const count of buckets) {
      expect(count).toBeGreaterThan(n / 10 * 0.85);
      expect(count).toBeLessThan(n / 10 * 1.15);
    }
  });

  it('honours range bounds', () => {
    const r = new Rng(77);
    for (let i = 0; i < 5000; i++) {
      const v = r.range(-5, 5);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThan(5);
    }
  });

  it('honours inclusive integer bounds', () => {
    const r = new Rng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = r.int(1, 6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });

  it('pick returns undefined for an empty array and only real members otherwise', () => {
    const r = new Rng(5);
    expect(r.pick([])).toBeUndefined();
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 100; i++) expect(items).toContain(r.pick(items)!);
  });

  it('chance respects its probability roughly', () => {
    const r = new Rng(31337);
    let hits = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) if (r.chance(0.25)) hits++;
    expect(hits / n).toBeGreaterThan(0.22);
    expect(hits / n).toBeLessThan(0.28);
  });

  it('survives a zero seed without degenerating', () => {
    const r = new Rng(0);
    const first = r.next();
    const second = r.next();
    expect(first).not.toBe(second);
  });

  it('exposes its state for snapshotting', () => {
    const r = new Rng(1234);
    const before = r.seedState;
    r.next();
    expect(r.seedState).not.toBe(before);
  });
});

describe('randomSeed', () => {
  it('returns a 32-bit unsigned integer', () => {
    for (let i = 0; i < 20; i++) {
      const s = randomSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
