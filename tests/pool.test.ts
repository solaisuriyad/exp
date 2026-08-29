import { describe, expect, it } from 'vitest';
import { Pool } from '../src/core/pool.js';

interface Thing {
  id: number;
  used: boolean;
}

const makePool = (capacity: number): Pool<Thing> => {
  let nextId = 0;
  return new Pool<Thing>(
    () => ({ id: nextId++, used: false }),
    (t) => {
      t.used = false;
    },
    capacity,
  );
};

describe('Pool', () => {
  it('hands out fresh items up to capacity', () => {
    const p = makePool(3);
    expect(p.obtain()).not.toBeNull();
    expect(p.obtain()).not.toBeNull();
    expect(p.obtain()).not.toBeNull();
    expect(p.size).toBe(3);
  });

  it('returns null once exhausted rather than growing', () => {
    const p = makePool(2);
    p.obtain();
    p.obtain();
    expect(p.obtain()).toBeNull();
    expect(p.size).toBe(2);
  });

  it('recycles released items instead of allocating', () => {
    const p = makePool(1);
    const first = p.obtain()!;
    first.used = true;
    p.release(first);
    expect(p.size).toBe(0);
    const second = p.obtain()!;
    expect(second.id).toBe(first.id);
    expect(second.used).toBe(false); // reset ran
  });

  it('swap-removes so releaseAt keeps the array dense', () => {
    const p = makePool(5);
    const a = p.obtain()!;
    const b = p.obtain()!;
    const c = p.obtain()!;
    p.releaseAt(0);
    expect(p.size).toBe(2);
    expect(p.active).toContain(b);
    expect(p.active).toContain(c);
    expect(p.active).not.toContain(a);
  });

  it('tolerates an out-of-range releaseAt', () => {
    const p = makePool(3);
    p.obtain();
    p.releaseAt(42);
    expect(p.size).toBe(1);
  });

  it('releases everything on releaseAll', () => {
    const p = makePool(10);
    for (let i = 0; i < 7; i++) p.obtain();
    p.releaseAll();
    expect(p.size).toBe(0);
    expect(p.available).toBe(10);
  });

  it('reports available capacity correctly', () => {
    const p = makePool(4);
    expect(p.available).toBe(4);
    p.obtain();
    expect(p.available).toBe(3);
  });

  it('release() is a no-op for an item that is not active', () => {
    const p = makePool(2);
    const stray: Thing = { id: 99, used: true };
    p.release(stray);
    expect(p.size).toBe(0);
  });

  it('does not exceed capacity across churn', () => {
    const p = makePool(8);
    for (let round = 0; round < 200; round++) {
      for (let i = 0; i < 8; i++) expect(p.obtain()).not.toBeNull();
      expect(p.obtain()).toBeNull();
      p.releaseAll();
    }
    expect(p.size).toBe(0);
  });
});
