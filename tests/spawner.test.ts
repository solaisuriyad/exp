import { describe, expect, it } from 'vitest';
import { ENEMY, WORLD } from '../src/core/config.js';
import { Rng } from '../src/core/rng.js';
import { difficultyForWave } from '../src/systems/difficulty.js';
import { formationV, makeBossSpawn, makeSpawn, pickKind } from '../src/systems/spawner.js';

describe('pickKind', () => {
  it('only returns grunts on wave 1, where nothing else is unlocked', () => {
    const rng = new Rng(1);
    const diff = difficultyForWave(1);
    for (let i = 0; i < 200; i++) expect(pickKind(rng, diff)).toBe('grunt');
  });

  it('introduces darters and tanks on later waves', () => {
    const rng = new Rng(2);
    const diff = difficultyForWave(10);
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(pickKind(rng, diff));
    expect(seen.has('grunt')).toBe(true);
    expect(seen.has('darter')).toBe(true);
    expect(seen.has('tank')).toBe(true);
  });
});

describe('makeSpawn', () => {
  it('spawns ahead of the player and inside the lateral bounds', () => {
    const rng = new Rng(3);
    const diff = difficultyForWave(5);
    for (let i = 0; i < 300; i++) {
      const kind = pickKind(rng, diff);
      const s = makeSpawn(rng, kind, diff);
      expect(s.z).toBeLessThan(0);
      expect(Math.abs(s.x)).toBeLessThanOrEqual(WORLD.boundX);
      expect(Math.abs(s.y)).toBeLessThanOrEqual(WORLD.boundY);
    }
  });

  it('uses the archetype stats from config', () => {
    const rng = new Rng(4);
    const diff = difficultyForWave(1);
    const s = makeSpawn(rng, 'grunt', diff);
    expect(s.hp).toBe(ENEMY.grunt.hp);
    expect(s.radius).toBe(ENEMY.grunt.radius);
    expect(s.score).toBe(ENEMY.grunt.score);
  });

  it('scales speed with difficulty', () => {
    const rng = new Rng(5);
    const early = makeSpawn(rng, 'grunt', difficultyForWave(1));
    const late = makeSpawn(rng, 'grunt', difficultyForWave(12));
    expect(late.vz).toBeGreaterThan(early.vz);
  });

  it('gives darters lateral velocity and grunts none', () => {
    const rng = new Rng(6);
    const diff = difficultyForWave(6);
    const grunt = makeSpawn(rng, 'grunt', diff);
    expect(grunt.vx).toBe(0);
    let sawDarterMotion = false;
    for (let i = 0; i < 50; i++) {
      if (makeSpawn(rng, 'darter', diff).vx !== 0) {
        sawDarterMotion = true;
        break;
      }
    }
    expect(sawDarterMotion).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    const a = new Rng(777);
    const b = new Rng(777);
    const diff = difficultyForWave(7);
    for (let i = 0; i < 40; i++) {
      expect(makeSpawn(a, pickKind(a, diff), diff)).toEqual(
        makeSpawn(b, pickKind(b, diff), diff),
      );
    }
  });
});

describe('makeBossSpawn', () => {
  it('enters dead centre with boss stats', () => {
    const s = makeBossSpawn(difficultyForWave(5));
    expect(s.kind).toBe('boss');
    expect(s.x).toBe(0);
    expect(s.radius).toBe(ENEMY.boss.radius);
    expect(s.z).toBe(WORLD.spawnZ);
  });

  it('grows tougher on later boss waves', () => {
    const w5 = makeBossSpawn(difficultyForWave(5));
    const w15 = makeBossSpawn(difficultyForWave(15));
    expect(w15.hp).toBeGreaterThan(w5.hp);
  });
});

describe('formationV', () => {
  it('returns the requested size and keeps everything in bounds', () => {
    const rng = new Rng(8);
    const diff = difficultyForWave(6);
    const v = formationV(rng, diff, 5);
    expect(v).toHaveLength(5);
    for (const s of v) {
      expect(Math.abs(s.x)).toBeLessThanOrEqual(WORLD.boundX);
      expect(Math.abs(s.y)).toBeLessThanOrEqual(WORLD.boundY);
    }
  });

  it('stagger the rows in depth so the V reads as a formation', () => {
    const rng = new Rng(9);
    const v = formationV(rng, difficultyForWave(6), 5);
    expect(v[0]!.z).toBeGreaterThan(v[4]!.z);
  });

  it('does not weave, so the shape holds together', () => {
    const rng = new Rng(10);
    for (const s of formationV(rng, difficultyForWave(6), 5)) {
      expect(s.weave).toBe(0);
    }
  });
});
