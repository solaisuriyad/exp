import type { Object3D } from 'three';

/**
 * Pooled projectile. Both player and enemy shots share this shape — the mesh
 * differs only by material, so one geometry serves the whole pool.
 */
export interface Bullet {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  damage: number;
  /** 0 = player shot, 1 = enemy shot. */
  faction: 0 | 1;
  mesh: Object3D | null;
}

export const createBullet = (): Bullet => ({
  alive: false,
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  radius: 0.55,
  damage: 1,
  faction: 0,
  mesh: null,
});

export const resetBullet = (b: Bullet): void => {
  b.alive = false;
  b.x = b.y = b.z = 0;
  b.vx = b.vy = b.vz = 0;
  b.damage = 1;
  b.faction = 0;
};
