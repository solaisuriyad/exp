import { describe, expect, it } from 'vitest';
import { allHitsAgainst, firstHitAgainst, sweep, type SphereLike } from '../src/systems/collision.js';

const sphere = (x: number, y: number, z: number, radius: number, alive = true): SphereLike => ({
  x,
  y,
  z,
  radius,
  alive,
});

describe('sweep', () => {
  it('reports every overlapping pair', () => {
    const as = [sphere(0, 0, 0, 1), sphere(50, 0, 0, 1)];
    const bs = [sphere(0.5, 0, 0, 1), sphere(50.2, 0, 0, 1), sphere(900, 0, 0, 1)];
    const hits: Array<[number, number]> = [];
    sweep(as, bs, (a, b) => hits.push([a.x, b.x]));
    expect(hits).toHaveLength(2);
  });

  it('ignores dead entities on either side', () => {
    const as = [sphere(0, 0, 0, 1, false)];
    const bs = [sphere(0, 0, 0, 1)];
    let count = 0;
    sweep(as, bs, () => count++);
    expect(count).toBe(0);
  });

  it('handles empty collections', () => {
    let count = 0;
    sweep([], [sphere(0, 0, 0, 1)], () => count++);
    sweep([sphere(0, 0, 0, 1)], [], () => count++);
    expect(count).toBe(0);
  });

  it('counts touching edges as a hit', () => {
    let count = 0;
    sweep([sphere(0, 0, 0, 1)], [sphere(2, 0, 0, 1)], () => count++);
    expect(count).toBe(1);
  });
});

describe('firstHitAgainst', () => {
  it('returns a collider when one overlaps the target', () => {
    const target = sphere(0, 0, 0, 1.5);
    const as = [sphere(9, 0, 0, 1), sphere(0.4, 0, 0, 1)];
    const hit = firstHitAgainst(as, target);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBe(0.4);
  });

  it('returns null when nothing overlaps', () => {
    expect(firstHitAgainst([sphere(9, 0, 0, 1)], sphere(0, 0, 0, 1))).toBeNull();
  });

  it('returns null for a dead target', () => {
    expect(firstHitAgainst([sphere(0, 0, 0, 1)], sphere(0, 0, 0, 1, false))).toBeNull();
  });
});

describe('allHitsAgainst', () => {
  it('collects every overlapping item and clears the output buffer', () => {
    const out: SphereLike[] = [sphere(999, 999, 999, 1)];
    const as = [sphere(0, 0, 0, 1), sphere(0.2, 0, 0, 1), sphere(40, 0, 0, 1)];
    const res = allHitsAgainst(as, sphere(0, 0, 0, 1.5), out);
    expect(res).toHaveLength(2);
    expect(res).toBe(out); // reuses the scratch array, no allocation
  });

  it('returns empty for a dead target', () => {
    expect(allHitsAgainst([sphere(0, 0, 0, 1)], sphere(0, 0, 0, 1, false))).toHaveLength(0);
  });
});
