import { describe, expect, it } from 'vitest';
import { PLAYER, WORLD } from '../src/core/config.js';
import { Player } from '../src/entities/player.js';

describe('Player movement', () => {
  it('starts at the origin with starting shields', () => {
    const p = new Player();
    p.reset();
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
    expect(p.shields).toBe(PLAYER.startShields);
    expect(p.weaponLevel).toBe(1);
    expect(p.alive).toBe(true);
  });

  it('moves toward full steering input', () => {
    const p = new Player();
    p.reset();
    p.invuln = 0;
    // Half a second of full right throttle: measured x ~4.30, vx ~15.16.
    for (let i = 0; i < 60; i++) p.update(1 / 120, 1, 0);
    expect(p.x).toBeCloseTo(4.2952, 2);
    expect(p.vx).toBeCloseTo(15.1636, 2);
    // Holding it pins the ship to the +12 wall and zeroes the velocity.
    for (let i = 0; i < 240; i++) p.update(1 / 120, 1, 0);
    expect(p.x).toBe(WORLD.boundX);
    expect(p.vx).toBe(0);
  });

  it('never leaves the playfield bounds', () => {
    const p = new Player();
    p.reset();
    for (let i = 0; i < 600; i++) p.update(1 / 120, 1, 1);
    expect(p.x).toBeLessThanOrEqual(WORLD.boundX);
    expect(p.y).toBeLessThanOrEqual(WORLD.boundY);
    expect(p.x).toBe(WORLD.boundX);
  });

  it('kills velocity when pinned against a wall so it cannot tunnel', () => {
    const p = new Player();
    p.reset();
    for (let i = 0; i < 600; i++) p.update(1 / 120, -1, 0);
    expect(p.x).toBe(-WORLD.boundX);
    expect(p.vx).toBe(0);
  });

  it('comes back to rest after steering is released', () => {
    const p = new Player();
    p.reset();
    for (let i = 0; i < 60; i++) p.update(1 / 120, 1, 0);
    const vBefore = Math.abs(p.vx);
    for (let i = 0; i < 240; i++) p.update(1 / 120, 0, 0);
    expect(Math.abs(p.vx)).toBeLessThan(vBefore * 0.05);
  });

  it('ignores steering outside -1..1', () => {
    const a = new Player();
    a.reset();
    const b = new Player();
    b.reset();
    for (let i = 0; i < 60; i++) {
      a.update(1 / 120, 1, 0);
      b.update(1 / 120, 9, 0);
    }
    expect(a.x).toBeCloseTo(b.x, 6);
  });

  it('banks into the turn', () => {
    const p = new Player();
    p.reset();
    for (let i = 0; i < 60; i++) p.update(1 / 120, 1, 0);
    expect(p.bank).toBeLessThan(0);
    const q = new Player();
    q.reset();
    for (let i = 0; i < 60; i++) q.update(1 / 120, -1, 0);
    expect(q.bank).toBeGreaterThan(0);
  });
});

describe('Player damage', () => {
  it('is invulnerable for a moment after reset so you do not die on spawn', () => {
    const p = new Player();
    p.reset();
    expect(p.isInvulnerable).toBe(true);
    expect(p.hit()).toBe('ignored');
    expect(p.shields).toBe(PLAYER.startShields);
  });

  it('loses a shield and gains i-frames on a hit', () => {
    const p = new Player();
    p.reset();
    p.invuln = 0;
    expect(p.hit()).toBe('damaged');
    expect(p.shields).toBe(PLAYER.startShields - 1);
    expect(p.isInvulnerable).toBe(true);
    // A second hit during i-frames does nothing.
    expect(p.hit()).toBe('ignored');
    expect(p.shields).toBe(PLAYER.startShields - 1);
  });

  it('dies when the last shield goes', () => {
    const p = new Player();
    p.reset();
    for (let i = 0; i < PLAYER.startShields - 1; i++) {
      p.invuln = 0;
      p.nova = 0;
      expect(p.hit()).toBe('damaged');
    }
    p.invuln = 0;
    p.nova = 0;
    expect(p.hit()).toBe('destroyed');
    expect(p.alive).toBe(false);
    expect(p.shields).toBe(0);
    // A dead ship cannot be hit again.
    expect(p.hit()).toBe('ignored');
  });

  it('treats Nova as invulnerability', () => {
    const p = new Player();
    p.reset();
    p.invuln = 0;
    p.activateNova();
    expect(p.isInvulnerable).toBe(true);
    expect(p.hit()).toBe('ignored');
    expect(p.shields).toBe(PLAYER.startShields);
  });

  it('heals but never past the cap', () => {
    const p = new Player();
    p.reset();
    p.invuln = 0;
    p.hit();
    p.heal(1);
    expect(p.shields).toBe(PLAYER.startShields);
    p.heal(10);
    expect(p.shields).toBe(PLAYER.maxShields);
  });

  it('upgrades weapons up to the cap and reports when it cannot', () => {
    const p = new Player();
    p.reset();
    expect(p.upgradeWeapon()).toBe(true);
    expect(p.weaponLevel).toBe(2);
    p.upgradeWeapon();
    p.upgradeWeapon();
    expect(p.weaponLevel).toBe(PLAYER.maxWeaponLevel);
    expect(p.upgradeWeapon()).toBe(false);
  });
});

describe('Player weapon patterns', () => {
  it('fires more barrels as the weapon levels up', () => {
    const p = new Player();
    p.reset();
    expect(p.muzzleOffsets()).toHaveLength(1);
    p.upgradeWeapon();
    expect(p.muzzleOffsets()).toHaveLength(2);
    p.upgradeWeapon();
    expect(p.muzzleOffsets()).toHaveLength(3);
    p.upgradeWeapon();
    expect(p.muzzleOffsets()).toHaveLength(4);
  });

  it('keeps every barrel symmetric about the centreline', () => {
    const p = new Player();
    p.reset();
    p.upgradeWeapon();
    p.upgradeWeapon();
    p.upgradeWeapon();
    const offsets = p.muzzleOffsets();
    const sum = offsets.reduce((acc, o) => acc + o.x, 0);
    expect(Math.abs(sum)).toBeLessThan(1e-9);
  });

  it('always deals at least 1 damage per barrel', () => {
    const p = new Player();
    p.reset();
    p.upgradeWeapon();
    p.upgradeWeapon();
    p.upgradeWeapon();
    for (const o of p.muzzleOffsets()) expect(o.damage).toBeGreaterThanOrEqual(1);
  });
});
