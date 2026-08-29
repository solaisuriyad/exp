import type { Object3D } from 'three';
import { PICKUP } from '../core/config.js';
import type { Rng } from '../core/rng.js';
import type { PickupKind } from '../core/types.js';

export interface Pickup {
  alive: boolean;
  kind: PickupKind;
  x: number;
  y: number;
  z: number;
  vz: number;
  radius: number;
  age: number;
  mesh: Object3D | null;
}

export const createPickup = (): Pickup => ({
  alive: false,
  kind: 'weapon',
  x: 0,
  y: 0,
  z: 0,
  vz: PICKUP.speed,
  radius: PICKUP.radius,
  age: 0,
  mesh: null,
});

export const resetPickup = (p: Pickup): void => {
  p.alive = false;
  p.x = p.y = p.z = 0;
  p.age = 0;
};

/**
 * Roll a drop. Returns null when nothing drops.
 *
 * Weights come from config; the roll is deterministic given the Rng so a seeded
 * run always yields the same drops.
 */
export const rollDrop = (rng: Rng, dropChance: number): PickupKind | null => {
  if (!rng.chance(dropChance)) return null;
  const w = PICKUP.weights;
  const total = w.weapon + w.shield + w.nova;
  const r = rng.next() * total;
  if (r < w.weapon) return 'weapon';
  if (r < w.weapon + w.shield) return 'shield';
  return 'nova';
};
