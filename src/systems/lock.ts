import { distSq3 } from '../core/math.js';

export interface Lockable {
  kind: string;
  alive: boolean;
  x: number;
  y: number;
  z: number;
}

/**
 * Aim-lock target selection.
 *
 * The lock only engages on "powerful opponents" (tanks and bosses) and picks
 * the nearest one inside the engage range. Pure function so the behaviour is
 * trivially testable; the game calls it once per fixed step.
 */
export const selectLockTarget = (
  enemies: readonly Lockable[],
  powerfulKinds: readonly string[],
  px: number,
  py: number,
  pz: number,
  maxRange: number,
): Lockable | null => {
  const maxSq = maxRange * maxRange;
  let best: Lockable | null = null;
  let bestSq = Number.POSITIVE_INFINITY;
  for (const e of enemies) {
    if (!e.alive) continue;
    if (!powerfulKinds.includes(e.kind)) continue;
    const d = distSq3(e.x, e.y, e.z, px, py, pz);
    if (d > maxSq) continue;
    if (d < bestSq) {
      bestSq = d;
      best = e;
    }
  }
  return best;
};

export const POWERFUL_KINDS = ['tank', 'boss'] as const;
