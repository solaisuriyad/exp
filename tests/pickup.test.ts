import { describe, expect, it } from 'vitest';
import { PICKUP } from '../src/core/config.js';
import { Rng } from '../src/core/rng.js';
import { createPickup, resetPickup, rollDrop } from '../src/entities/pickup.js';

describe('rollDrop', () => {
  it('never drops when the chance is zero', () => {
    const rng = new Rng(1);
    for (let i = 0; i < 500; i++) expect(rollDrop(rng, 0)).toBeNull();
  });

  it('always drops when the chance is one', () => {
    const rng = new Rng(2);
    for (let i = 0; i < 500; i++) expect(rollDrop(rng, 1)).not.toBeNull();
  });

  it('respects the configured drop rate roughly', () => {
    const rng = new Rng(3);
    const n = 20000;
    let drops = 0;
    for (let i = 0; i < n; i++) if (rollDrop(rng, PICKUP.dropChance) !== null) drops++;
    expect(drops / n).toBeGreaterThan(PICKUP.dropChance * 0.85);
    expect(drops / n).toBeLessThan(PICKUP.dropChance * 1.15);
  });

  it('drops more often from tanks than from grunts', () => {
    const countFor = (chance: number): number => {
      const rng = new Rng(4);
      let c = 0;
      for (let i = 0; i < 20000; i++) if (rollDrop(rng, chance) !== null) c++;
      return c;
    };
    expect(countFor(PICKUP.tankDropChance)).toBeGreaterThan(countFor(PICKUP.dropChance));
  });

  it('produces all three kinds, weighted toward weapon upgrades', () => {
    const rng = new Rng(5);
    const tally: Record<string, number> = { weapon: 0, shield: 0, nova: 0 };
    for (let i = 0; i < 30000; i++) {
      const k = rollDrop(rng, 1);
      if (k) tally[k] += 1;
    }
    expect(tally.weapon).toBeGreaterThan(0);
    expect(tally.shield).toBeGreaterThan(0);
    expect(tally.nova).toBeGreaterThan(0);
    expect(tally.weapon!).toBeGreaterThan(tally.shield!);
    expect(tally.shield!).toBeGreaterThan(tally.nova!);
  });

  it('matches the configured weight ratios', () => {
    const rng = new Rng(6);
    const tally: Record<string, number> = { weapon: 0, shield: 0, nova: 0 };
    const n = 60000;
    for (let i = 0; i < n; i++) {
      const k = rollDrop(rng, 1);
      if (k) tally[k] += 1;
    }
    const w = PICKUP.weights;
    const total = w.weapon + w.shield + w.nova;
    expect(tally.weapon! / n).toBeCloseTo(w.weapon / total, 1);
    expect(tally.shield! / n).toBeCloseTo(w.shield / total, 1);
    expect(tally.nova! / n).toBeCloseTo(w.nova / total, 1);
  });
});

describe('pickup lifecycle', () => {
  it('creates pickups inert with the configured radius and speed', () => {
    const p = createPickup();
    expect(p.alive).toBe(false);
    expect(p.radius).toBe(PICKUP.radius);
    expect(p.vz).toBe(PICKUP.speed);
  });

  it('resets position and age', () => {
    const p = createPickup();
    p.alive = true;
    p.x = 5;
    p.y = 6;
    p.z = 7;
    p.age = 42;
    resetPickup(p);
    expect(p.alive).toBe(false);
    expect(p.x).toBe(0);
    expect(p.age).toBe(0);
  });
});
