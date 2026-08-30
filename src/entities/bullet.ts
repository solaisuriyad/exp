import type { Object3D } from 'three';

/**
 * Pooled projectile. Player shots, POWER lances and both enemy shot weights
 * share this shape — the renderer picks the mesh flavour from the flags.
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
  /** Enemy "powerful" shot: erodes AEGIS guard time instead of being free. */
  powerful: boolean;
  /** Player POWER lance: explodes with an AoE on impact. */
  isPower: boolean;
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
  powerful: false,
  isPower: false,
  mesh: null,
});

export const resetBullet = (b: Bullet): void => {
  b.alive = false;
  b.x = b.y = b.z = 0;
  b.vx = b.vy = b.vz = 0;
  b.damage = 1;
  b.faction = 0;
  b.powerful = false;
  b.isPower = false;
};

/** Renderer flavour key, kept next to the data so both layers agree. */
export const bulletVariant = (b: Bullet): 'player' | 'playerPower' | 'enemy' | 'enemyHeavy' =>
  b.faction === 0
    ? b.isPower
      ? 'playerPower'
      : 'player'
    : b.powerful
      ? 'enemyHeavy'
      : 'enemy';
