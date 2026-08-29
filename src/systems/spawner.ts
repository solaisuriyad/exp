import { ENEMY, WORLD } from '../core/config.js';
import { clamp } from '../core/math.js';
import type { Rng } from '../core/rng.js';
import type { EnemyKind } from '../core/types.js';
import type { DifficultySnapshot } from './difficulty.js';

export interface SpawnRequest {
  kind: EnemyKind;
  x: number;
  y: number;
  z: number;
  vz: number;
  vx: number;
  weave: number;
  phase: number;
  hp: number;
  radius: number;
  score: number;
  speedScale: number;
  fireCooldown: number;
}

/**
 * Chooses what to spawn next from the current difficulty mix.
 * Deterministic given the Rng.
 */
export const pickKind = (rng: Rng, diff: DifficultySnapshot): EnemyKind => {
  const total = diff.mix.grunt + diff.mix.darter + diff.mix.tank;
  const r = rng.next() * total;
  if (r < diff.mix.grunt) return 'grunt';
  if (r < diff.mix.grunt + diff.mix.darter) return 'darter';
  return 'tank';
};

/**
 * Build a spawn request for a given archetype.
 *
 * Positions are biased away from the exact centre on later waves so the player
 * is not constantly fed a straight-down-the-middle stream.
 */
export const makeSpawn = (rng: Rng, kind: EnemyKind, diff: DifficultySnapshot): SpawnRequest => {
  const stats = ENEMY[kind];
  const speed = stats.speed * diff.speedScale;

  // Bias spawn X toward the edges as waves climb.
  const edgeBias = clamp(0.15 + diff.wave * 0.03, 0, 0.8);
  const x = rng.chance(edgeBias)
    ? Math.sign(rng.next() - 0.5) * rng.range(WORLD.boundX * 0.55, WORLD.boundX * 0.95)
    : rng.range(-WORLD.boundX * 0.7, WORLD.boundX * 0.7);

  const y = rng.range(-WORLD.boundY * 0.75, WORLD.boundY * 0.75);
  const fireCooldown = rng.range(stats.fireCooldown[0], stats.fireCooldown[1]) * diff.fireScale;

  const weave =
    kind === 'grunt' ? rng.range(2.5, 6)
    : kind === 'darter' ? rng.range(1.5, 3.5)
    : kind === 'tank' ? rng.range(1.2, 2.6)
    : 0;

  return {
    kind,
    x,
    y,
    z: WORLD.spawnZ + rng.range(-14, 0),
    vz: speed,
    vx: kind === 'darter' ? Math.sign(rng.next() - 0.5) * speed * 0.35 : 0,
    weave,
    phase: rng.range(0, Math.PI * 2),
    hp: stats.hp,
    radius: stats.radius,
    score: stats.score,
    speedScale: diff.speedScale,
    fireCooldown,
  };
};

/** Boss spawns are centred and announced — no randomised position. */
export const makeBossSpawn = (diff: DifficultySnapshot): SpawnRequest => {
  const stats = ENEMY.boss;
  return {
    kind: 'boss',
    x: 0,
    y: 3.2,
    z: WORLD.spawnZ,
    vz: stats.speed,
    vx: 0,
    weave: 0,
    phase: 0,
    hp: Math.round(stats.hp * (1 + (diff.wave / 5 - 1) * 0.35)),
    radius: stats.radius,
    score: stats.score,
    speedScale: diff.speedScale,
    fireCooldown: stats.fireCooldown[0],
  };
};

/**
 * Formation helper: a short V of grunts, used to punctuate waves.
 * Returned in world order (centre first) so the caller can stagger spawns.
 */
export const formationV = (
  rng: Rng,
  diff: DifficultySnapshot,
  size = 5,
): SpawnRequest[] => {
  const out: SpawnRequest[] = [];
  const cx = rng.range(-WORLD.boundX * 0.4, WORLD.boundX * 0.4);
  const cy = rng.range(-WORLD.boundY * 0.3, WORLD.boundY * 0.4);
  const gap = 3.1;
  for (let i = 0; i < size; i++) {
    const row = Math.floor(i / 2);
    const side = i % 2 === 0 ? -1 : 1;
    const req = makeSpawn(rng, 'grunt', diff);
    req.x = clamp(cx + (i === 0 ? 0 : side * row * gap), -WORLD.boundX, WORLD.boundX);
    req.y = clamp(cy - row * 1.5, -WORLD.boundY, WORLD.boundY);
    req.z = WORLD.spawnZ - row * 6;
    req.weave = 0;
    out.push(req);
  }
  return out;
};
