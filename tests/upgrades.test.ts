import { describe, expect, it } from 'vitest';
import { PLAYER, POWER_WEAPON } from '../src/core/config.js';
import { Rng } from '../src/core/rng.js';
import { Player } from '../src/entities/player.js';
import {
  CAPACITOR_STACK_MAX,
  RAPID_STACK_MAX,
  SPEED_STACK_MAX,
  rollUpgradeOffer,
  upgradeById,
  UPGRADES,
} from '../src/systems/upgrades.js';

const fresh = (): Player => {
  const p = new Player();
  p.reset();
  return p;
};

describe('upgrade offer drafting', () => {
  it('offers three distinct applicable upgrades', () => {
    const offer = rollUpgradeOffer(new Rng(1), fresh());
    expect(offer).toHaveLength(3);
    const ids = offer.map((u) => u.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('is deterministic per seed', () => {
    const a = rollUpgradeOffer(new Rng(77), fresh()).map((u) => u.id);
    const b = rollUpgradeOffer(new Rng(77), fresh()).map((u) => u.id);
    expect(a).toEqual(b);
  });

  it('never offers an upgrade that cannot apply', () => {
    const p = fresh();
    p.weaponLevel = PLAYER.maxWeaponLevel;
    p.shields = PLAYER.maxShields;
    const offer = rollUpgradeOffer(new Rng(2), p);
    expect(offer.map((u) => u.id)).not.toContain('core');
    expect(offer.map((u) => u.id)).not.toContain('plating');
  });

  it('returns fewer than three when the pool runs dry', () => {
    const p = fresh();
    p.weaponLevel = PLAYER.maxWeaponLevel;
    p.shields = PLAYER.maxShields;
    p.speedStacks = SPEED_STACK_MAX;
    p.rapidStacks = RAPID_STACK_MAX;
    p.magnetStacks = 3;
    p.powerMax = POWER_WEAPON.charges + CAPACITOR_STACK_MAX;
    expect(rollUpgradeOffer(new Rng(3), p)).toHaveLength(0);
  });

  it('exposes every def with a name and description for the UI', () => {
    for (const u of UPGRADES) {
      expect(u.name.length).toBeGreaterThan(0);
      expect(u.desc.length).toBeGreaterThan(0);
      expect(upgradeById(u.id)).toBe(u);
    }
  });
});

describe('upgrade effects', () => {
  it('HULL PLATING adds and repairs a shield up to the cap', () => {
    const p = fresh();
    p.invuln = 0;
    p.hit(false);
    const before = p.shields;
    upgradeById('plating')!.apply(p);
    expect(p.shields).toBe(Math.min(PLAYER.maxShields, before + 1));
  });

  it('WEAPON CORE raises the weapon level', () => {
    const p = fresh();
    upgradeById('core')!.apply(p);
    expect(p.weaponLevel).toBe(2);
  });

  it('ENGINE OVERDRIVE compounds speed and is capped', () => {
    const p = fresh();
    const base = p.maxSpeed;
    upgradeById('overdrive')!.apply(p);
    expect(p.maxSpeed).toBeCloseTo(base * 1.08, 6);
    expect(upgradeById('overdrive')!.available(p)).toBe(true);
    p.speedStacks = SPEED_STACK_MAX;
    expect(upgradeById('overdrive')!.available(p)).toBe(false);
  });

  it('RAPID COILS shorten the fire interval, floor-limited by stacks', () => {
    const p = fresh();
    const base = p.fireInterval;
    upgradeById('coils')!.apply(p);
    expect(p.fireInterval).toBeCloseTo(base * 0.92, 6);
    p.rapidStacks = RAPID_STACK_MAX;
    expect(upgradeById('coils')!.available(p)).toBe(false);
  });

  it('POWER CAPACITOR grows the magazine and refills one charge', () => {
    const p = fresh();
    p.powerCooldown = 0;
    p.consumePower();
    const charges = p.powerCharges;
    upgradeById('capacitor')!.apply(p);
    expect(p.powerMax).toBe(POWER_WEAPON.charges + 1);
    expect(p.powerCharges).toBe(charges + 1);
  });

  it('REPAIR DRONES restore two shields', () => {
    const p = fresh();
    p.invuln = 0;
    p.hit(false);
    p.invuln = 0;
    p.hit(false);
    const before = p.shields;
    upgradeById('drones')!.apply(p);
    expect(p.shields).toBe(Math.min(PLAYER.maxShields, before + 2));
  });

  it('TRACTOR MAGNET widens pickup attraction', () => {
    const p = fresh();
    const base = p.magnetRange;
    upgradeById('magnet')!.apply(p);
    expect(p.magnetRange).toBeCloseTo(base * 1.6, 6);
  });
});
