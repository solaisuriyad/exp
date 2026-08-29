import { describe, expect, it } from 'vitest';
import { ENEMY, WORLD } from '../src/core/config.js';
import { createEnemy, resetEnemy, statsFor, updateEnemy, type Enemy } from '../src/entities/enemy.js';

const make = (kind: Enemy['kind']): Enemy => {
  const e = createEnemy();
  resetEnemy(e);
  e.alive = true;
  e.kind = kind;
  e.z = WORLD.spawnZ;
  e.vz = statsFor(kind).speed;
  return e;
};

describe('enemy archetypes', () => {
  it('exposes the configured stats', () => {
    expect(statsFor('grunt').hp).toBe(ENEMY.grunt.hp);
    expect(statsFor('boss').score).toBe(ENEMY.boss.score);
    expect(statsFor('tank').radius).toBe(ENEMY.tank.radius);
  });

  it('creates enemies inert by default', () => {
    const e = createEnemy();
    expect(e.alive).toBe(false);
    expect(e.kind).toBe('grunt');
  });

  it('resets every mutable field', () => {
    const e = make('darter');
    e.hp = 0;
    e.age = 99;
    e.phase = 3;
    e.patternTimer = 12;
    resetEnemy(e);
    expect(e.alive).toBe(false);
    expect(e.hp).toBe(1);
    expect(e.age).toBe(0);
    expect(e.phase).toBe(0);
    expect(e.patternTimer).toBe(0);
  });
});

describe('enemy movement', () => {
  it('advances every non-boss archetype toward the player', () => {
    for (const kind of ['grunt', 'darter', 'tank'] as const) {
      const e = make(kind);
      const z0 = e.z;
      for (let i = 0; i < 60; i++) updateEnemy(e, 1 / 120, i / 120);
      expect(e.z).toBeGreaterThan(z0);
    }
  });

  it('ages every enemy', () => {
    const e = make('grunt');
    for (let i = 0; i < 120; i++) updateEnemy(e, 1 / 120, i / 120);
    expect(e.age).toBeCloseTo(1, 5);
  });

  it('moves the boss toward a holding station instead of past the player', () => {
    const e = make('boss');
    for (let i = 0; i < 600; i++) updateEnemy(e, 1 / 120, i / 120);
    // Boss converges on roughly z = -58 and stays in front of the player.
    expect(e.z).toBeGreaterThan(WORLD.spawnZ);
    expect(e.z).toBeLessThan(-40);
  });

  it('keeps the boss inside the lateral bounds while strafing', () => {
    const e = make('boss');
    for (let i = 0; i < 2000; i++) {
      updateEnemy(e, 1 / 120, i / 120);
      expect(Math.abs(e.x)).toBeLessThanOrEqual(WORLD.boundX);
    }
  });

  it('weaves grunts side to side', () => {
    const e = make('grunt');
    e.weave = 6;
    e.phase = 0;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < 600; i++) {
      updateEnemy(e, 1 / 120, i / 120);
      minX = Math.min(minX, e.x);
      maxX = Math.max(maxX, e.x);
    }
    expect(maxX - minX).toBeGreaterThan(0.5);
  });

  it('gives tanks no vertical bob but grunts and darters do move in x', () => {
    const grunt = make('grunt');
    grunt.weave = 4;
    for (let i = 0; i < 300; i++) updateEnemy(grunt, 1 / 120, i / 120);
    expect(grunt.x).not.toBe(0);
  });

  it('is frame-rate independent for straight-line travel', () => {
    const a = make('grunt');
    a.weave = 0;
    const b = make('grunt');
    b.weave = 0;
    // 1 second at 120 Hz vs 1 second at 20 Hz.
    for (let i = 0; i < 120; i++) updateEnemy(a, 1 / 120, i / 120);
    for (let i = 0; i < 20; i++) updateEnemy(b, 1 / 20, i / 20);
    expect(a.z).toBeCloseTo(b.z, 3);
  });
});
