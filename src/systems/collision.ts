import { overlaps } from '../core/math.js';

/**
 * Broadphase-lite collision resolution.
 *
 * Entity counts here are small (tens of enemies, low hundreds of bullets), so a
 * single O(n*m) sweep per fixed step is comfortably within budget on mobile and
 * keeps the code allocation-free and easy to reason about. Both loops run
 * backwards so callers can swap-remove hits safely.
 */

export interface SphereLike {
  x: number;
  y: number;
  z: number;
  radius: number;
  alive: boolean;
}

export type HitPair<A, B> = { a: A; b: B };

/** Test every A against every B, invoking `onHit` for each overlapping pair. */
export const sweep = <A extends SphereLike, B extends SphereLike>(
  as: readonly A[],
  bs: readonly B[],
  onHit: (a: A, b: B) => void,
): void => {
  for (let i = as.length - 1; i >= 0; i--) {
    const a = as[i];
    if (a === undefined || !a.alive) continue;
    for (let j = bs.length - 1; j >= 0; j--) {
      const b = bs[j];
      if (b === undefined || !b.alive) continue;
      if (overlaps(a.x, a.y, a.z, a.radius, b.x, b.y, b.z, b.radius)) {
        onHit(a, b);
      }
    }
  }
};

/** Test every A against a single target. Returns the first hit, if any. */
export const firstHitAgainst = <A extends SphereLike>(
  as: readonly A[],
  target: SphereLike,
): A | null => {
  if (!target.alive) return null;
  for (let i = as.length - 1; i >= 0; i--) {
    const a = as[i];
    if (a === undefined || !a.alive) continue;
    if (overlaps(a.x, a.y, a.z, a.radius, target.x, target.y, target.z, target.radius)) {
      return a;
    }
  }
  return null;
};

/** Collect every A overlapping a target (used for Nova sweeping pickups). */
export const allHitsAgainst = <A extends SphereLike>(
  as: readonly A[],
  target: SphereLike,
  out: A[] = [],
): A[] => {
  out.length = 0;
  if (!target.alive) return out;
  for (let i = as.length - 1; i >= 0; i--) {
    const a = as[i];
    if (a === undefined || !a.alive) continue;
    if (overlaps(a.x, a.y, a.z, a.radius, target.x, target.y, target.z, target.radius)) {
      out.push(a);
    }
  }
  return out;
};
