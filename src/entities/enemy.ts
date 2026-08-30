import type { Object3D } from 'three';
import { ENEMY } from '../core/config.js';
import type { EnemyKind } from '../core/types.js';

export interface Enemy {
  alive: boolean;
  kind: EnemyKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  hp: number;
  maxHp: number;
  radius: number;
  score: number;
  /** Movement personality phase. */
  phase: number;
  weave: number;
  speedScale: number;
  fireTimer: number;
  fireCooldown: number;
  spin: number;
  /** Boss: current attack pattern index. */
  pattern: number;
  patternTimer: number;
  mesh: Object3D | null;
  /** Set when spawned so the renderer can fade it in. */
  age: number;
}

export const createEnemy = (): Enemy => ({
  alive: false,
  kind: 'grunt',
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  hp: 1,
  maxHp: 1,
  radius: 1.7,
  score: 100,
  phase: 0,
  weave: 0,
  speedScale: 1,
  fireTimer: 0,
  fireCooldown: 2,
  spin: 0,
  pattern: 0,
  patternTimer: 0,
  mesh: null,
  age: 0,
});

export const resetEnemy = (e: Enemy): void => {
  e.alive = false;
  e.kind = 'grunt';
  e.x = e.y = e.z = 0;
  e.vx = e.vy = e.vz = 0;
  e.hp = e.maxHp = 1;
  e.phase = 0;
  e.weave = 0;
  e.speedScale = 1;
  e.fireTimer = 0;
  e.pattern = 0;
  e.patternTimer = 0;
  e.age = 0;
};

/**
 * Integrate one enemy for `dt`.
 *
 * Each archetype has a distinct read: grunts hold a lane and drift, darters
 * cut hard diagonals, tanks advance slowly while sweeping side to side, and the
 * boss strafes across the top of the screen on a sinusoid.
 */
export const updateEnemy = (e: Enemy, dt: number, elapsed: number): void => {
  e.age += dt;
  switch (e.kind) {
    case 'grunt': {
      e.z += e.vz * dt;
      e.x += Math.sin(e.phase + elapsed * 0.9) * e.weave * dt;
      break;
    }
    case 'darter': {
      e.z += e.vz * dt;
      e.x += e.vx * dt;
      e.y += Math.cos(e.phase + elapsed * 2.2) * e.weave * dt;
      break;
    }
    case 'tank': {
      e.z += e.vz * dt;
      e.x += Math.sin(e.phase + elapsed * 0.55) * e.weave * 2.2 * dt;
      break;
    }
    case 'boss': {
      // Hold station just inside the playfield, strafing the full width.
      const targetZ = -58;
      e.z += (targetZ - e.z) * Math.min(1, dt * 1.6);
      e.x = Math.sin(elapsed * 0.42 + e.phase) * 9.5;
      e.y = 3.2 + Math.sin(elapsed * 0.71) * 1.6;
      break;
    }
  }
};

/**
 * Shooter personality per archetype. Grunts fire single aimed shots, darters
 * fan a 3-way spread, tanks lob slow *powerful* mortars and bosses run their
 * pattern cycle with powerful fire.
 */
export type ShotKind = 'aim' | 'spread' | 'heavy' | 'boss';

export const shotKindFor = (kind: EnemyKind): ShotKind =>
  kind === 'grunt' ? 'aim' : kind === 'darter' ? 'spread' : kind === 'tank' ? 'heavy' : 'boss';

/** Powerful opponents: the aim-lock engages on these, and their hits erode AEGIS. */
export const isPowerfulShooter = (kind: EnemyKind): boolean =>
  kind === 'tank' || kind === 'boss';

export const statsFor = (kind: EnemyKind): (typeof ENEMY)[EnemyKind] =>
  ENEMY[kind];
