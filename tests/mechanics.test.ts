import { describe, expect, it } from 'vitest';
import { GUARD, POWER_WEAPON, SHIPS } from '../src/core/config.js';
import {
  createEnemy,
  isPowerfulShooter,
  resetEnemy,
  shotKindFor,
  updateEnemy,
} from '../src/entities/enemy.js';
import { difficultyForWave } from '../src/systems/difficulty.js';
import { Player } from '../src/entities/player.js';
import { selectLockTarget, POWERFUL_KINDS, type Lockable } from '../src/systems/lock.js';

describe('ship roster', () => {
  it('gives each interceptor distinct handling', () => {
    expect(SHIPS.lance.maxSpeed).toBeGreaterThan(SHIPS.vector.maxSpeed);
    expect(SHIPS.vector.maxSpeed).toBeGreaterThan(SHIPS.bastion.maxSpeed);
    expect(SHIPS.lance.accel).toBeGreaterThan(SHIPS.bastion.accel);
  });

  it('trades shields against speed', () => {
    expect(SHIPS.lance.startShields).toBeLessThan(SHIPS.vector.startShields);
    expect(SHIPS.bastion.startShields).toBeGreaterThan(SHIPS.vector.startShields);
  });

  it('applies stats on selection and reset', () => {
    const p = new Player();
    p.applyShip('bastion');
    p.reset();
    expect(p.shipId).toBe('bastion');
    expect(p.shields).toBe(SHIPS.bastion.startShields);
    expect(p.maxSpeed).toBe(SHIPS.bastion.maxSpeed);
    expect(p.radius).toBe(SHIPS.bastion.hullRadius);

    p.applyShip('lance');
    p.reset();
    expect(p.shields).toBe(SHIPS.lance.startShields);
    expect(p.maxSpeed).toBe(SHIPS.lance.maxSpeed);
  });

  it('keeps the default ship identical to the legacy baseline', () => {
    const p = new Player();
    p.reset();
    expect(p.maxSpeed).toBe(30);
    expect(p.shields).toBe(3);
  });
});

describe('AEGIS guard shield', () => {
  const fresh = (): Player => {
    const p = new Player();
    p.reset();
    p.invuln = 0;
    return p;
  };

  it('starts inactive and grants exactly the configured duration', () => {
    const p = fresh();
    expect(p.isGuarded).toBe(false);
    p.activateGuard();
    expect(p.guard).toBe(GUARD.duration);
    expect(p.guard).toBe(30);
  });

  it('absorbs normal hits for free', () => {
    const p = fresh();
    p.activateGuard();
    const shieldsBefore = p.shields;
    expect(p.hit(false)).toBe('absorbed');
    expect(p.shields).toBe(shieldsBefore);
    expect(p.guard).toBe(GUARD.duration);
  });

  it('burns 2 seconds of guard time per powerful hit (30 -> 28)', () => {
    const p = fresh();
    p.activateGuard();
    expect(p.hit(true)).toBe('absorbed');
    expect(p.guard).toBe(28);
    expect(p.shields).toBe(p.shields); // hull untouched
    p.hit(true);
    expect(p.guard).toBe(26);
  });

  it('never drops below zero guard time from powerful hits', () => {
    const p = fresh();
    p.activateGuard();
    // 30s of guard burns at 2s per powerful hit: exactly 15 hits to empty it.
    for (let i = 0; i < 15; i++) expect(p.hit(true)).toBe('absorbed');
    expect(p.guard).toBe(0);
    expect(p.isGuarded).toBe(false);
    expect(p.shields).toBe(SHIPS.vector.startShields); // hull never touched
    // Once the guard is gone the next hit reaches hull shields.
    expect(p.hit(false)).toBe('damaged');
  });

  it('ticks down in real time inside update()', () => {
    const p = fresh();
    p.activateGuard();
    for (let i = 0; i < 120; i++) p.update(1 / 120, 0, 0); // 1 second
    expect(p.guard).toBeCloseTo(29, 5);
  });

  it('resets on a new run', () => {
    const p = fresh();
    p.activateGuard();
    p.reset();
    expect(p.guard).toBe(0);
  });
});

describe('POWER weapon magazine', () => {
  const fresh = (): Player => {
    const p = new Player();
    p.reset();
    return p;
  };

  it('starts with a full 5-shot magazine', () => {
    expect(fresh().powerCharges).toBe(POWER_WEAPON.charges);
    expect(POWER_WEAPON.charges).toBe(5);
  });

  it('spends one charge per shot and refuses when empty', () => {
    const p = fresh();
    for (let i = 0; i < 5; i++) {
      p.powerCooldown = 0;
      expect(p.consumePower()).toBe(true);
    }
    expect(p.powerCharges).toBe(0);
    expect(p.consumePower()).toBe(false);
  });

  it('honours the fire cooldown between shots', () => {
    const p = fresh();
    expect(p.consumePower()).toBe(true);
    expect(p.consumePower()).toBe(false); // still cooling down
    expect(p.powerCharges).toBe(4);
  });

  it('recharges one charge per interval after shots are spent', () => {
    const p = fresh();
    p.powerCooldown = 0;
    p.consumePower();
    expect(p.powerCharges).toBe(4);
    // Run the recharge clock for one interval (+a few steps past the fp edge).
    for (let i = 0; i < 120 * POWER_WEAPON.rechargeInterval + 4; i++) p.update(1 / 120, 0, 0);
    expect(p.powerCharges).toBe(5);
  });

  it('caps the magazine at 5 even after long idle', () => {
    const p = fresh();
    for (let i = 0; i < 120 * 20; i++) p.update(1 / 120, 0, 0);
    expect(p.powerCharges).toBe(5);
    expect(p.powerRecharge).toBe(0);
  });

  it('recharges spent shots one interval at a time', () => {
    const p = fresh();
    for (let i = 0; i < 5; i++) {
      p.powerCooldown = 0;
      p.consumePower();
    }
    // Half an interval: still empty.
    for (let i = 0; i < 60 * POWER_WEAPON.rechargeInterval; i++) p.update(1 / 120, 0, 0);
    expect(p.powerCharges).toBe(0);
    // Another half interval: first charge back.
    for (let i = 0; i < 60 * POWER_WEAPON.rechargeInterval + 4; i++) p.update(1 / 120, 0, 0);
    expect(p.powerCharges).toBe(1);
  });
});

describe('enemy shooter archetypes', () => {
  it('maps each archetype to its shooting style', () => {
    expect(shotKindFor('grunt')).toBe('aim');
    expect(shotKindFor('darter')).toBe('spread');
    expect(shotKindFor('tank')).toBe('heavy');
    expect(shotKindFor('boss')).toBe('boss');
  });

  it('flags tanks and bosses as the powerful opponents', () => {
    expect(isPowerfulShooter('tank')).toBe(true);
    expect(isPowerfulShooter('boss')).toBe(true);
    expect(isPowerfulShooter('grunt')).toBe(false);
    expect(isPowerfulShooter('darter')).toBe(false);
  });
});

describe('aim-lock target selection', () => {
  const enemy = (kind: string, x: number, z: number, alive = true): Lockable => ({
    kind,
    alive,
    x,
    y: 0,
    z,
  });

  it('locks the nearest powerful opponent', () => {
    const enemies = [
      enemy('tank', 5, -60),
      enemy('boss', 0, -120),
      enemy('tank', -5, -40),
    ];
    const lock = selectLockTarget(enemies, POWERFUL_KINDS, 0, 0, 0, 240);
    expect(lock).not.toBeNull();
    expect(lock!.x).toBe(-5); // closest tank
  });

  it('ignores grunts and darters entirely', () => {
    const enemies = [enemy('grunt', 0, -20), enemy('darter', 1, -25)];
    expect(selectLockTarget(enemies, POWERFUL_KINDS, 0, 0, 0, 240)).toBeNull();
  });

  it('ignores dead targets', () => {
    const enemies = [enemy('tank', 0, -50, false)];
    expect(selectLockTarget(enemies, POWERFUL_KINDS, 0, 0, 0, 240)).toBeNull();
  });

  it('respects the engage range', () => {
    const enemies = [enemy('boss', 0, -500)];
    expect(selectLockTarget(enemies, POWERFUL_KINDS, 0, 0, 0, 240)).toBeNull();
    expect(selectLockTarget(enemies, POWERFUL_KINDS, 0, 0, 0, 600)).not.toBeNull();
  });

  it('returns null for an empty field', () => {
    expect(selectLockTarget([], POWERFUL_KINDS, 0, 0, 0, 240)).toBeNull();
  });
});

describe('new enemy archetypes', () => {
  it('stingers fire twin shots and mines never fire', () => {
    expect(shotKindFor('stinger')).toBe('twin');
    expect(shotKindFor('mine')).toBe('none');
  });

  it('mines home toward the player lane while drifting in', () => {
    const e = createEnemy();
    resetEnemy(e);
    e.alive = true;
    e.kind = 'mine';
    e.x = 8;
    e.y = -4;
    e.z = -100;
    e.vz = 12;
    for (let i = 0; i < 240; i++) updateEnemy(e, 1 / 120, i / 120, { x: 0, y: 0 });
    expect(Math.abs(e.x)).toBeLessThan(8); // pulled toward centre
    expect(Math.abs(e.y)).toBeLessThan(4);
    expect(e.z).toBeGreaterThan(-100); // still drifting in
  });

  it('stingers weave harder and faster than grunts', () => {
    const mk = (kind: 'stinger' | 'grunt') => {
      const e = createEnemy();
      resetEnemy(e);
      e.alive = true;
      e.kind = kind;
      e.z = -120;
      e.weave = 4;
      e.vz = kind === 'stinger' ? 50 : 26;
      return e;
    };
    const st = mk('stinger');
    const gr = mk('grunt');
    for (let i = 0; i < 240; i++) updateEnemy(st, 1 / 120, i / 120);
    for (let i = 0; i < 240; i++) updateEnemy(gr, 1 / 120, i / 120);
    expect(st.z).toBeGreaterThan(gr.z); // faster approach
  });
});

describe('difficulty mix for new archetypes', () => {
  it('unlocks stingers at wave 2 and mines at wave 4', () => {
    expect(difficultyForWave(1).mix.stinger).toBe(0);
    expect(difficultyForWave(2).mix.stinger).toBeGreaterThan(0);
    expect(difficultyForWave(3).mix.mine).toBe(0);
    expect(difficultyForWave(4).mix.mine).toBeGreaterThan(0);
  });

  it('keeps the mix sane on deep waves', () => {
    const m = difficultyForWave(30).mix;
    for (const v of [m.grunt, m.stinger, m.darter, m.tank, m.mine]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
