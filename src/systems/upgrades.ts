import { PLAYER, POWER_WEAPON } from '../core/config.js';
import type { Rng } from '../core/rng.js';
import type { UpgradeChoice } from '../core/types.js';
import type { Player } from '../entities/player.js';

/**
 * Between-level ship upgrades.
 *
 * Every completed wave ("level") pauses the run and offers three random,
 * distinct upgrades drawn from this pool. Each def knows when it is still
 * applicable (`available`) and how to mutate the run's Player (`apply`), so
 * the draft UI stays dumb and everything is unit-testable.
 */
export interface UpgradeDef extends UpgradeChoice {
  available: (p: Player) => boolean;
  apply: (p: Player) => void;
}

export const SPEED_STACK_MAX = 4;
export const RAPID_STACK_MAX = 4;
export const CAPACITOR_STACK_MAX = 3;

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'plating',
    name: 'HULL PLATING',
    desc: '+1 max shield and repair 1 shield now.',
    available: (p) => p.shields < PLAYER.maxShields,
    apply: (p) => p.heal(1),
  },
  {
    id: 'core',
    name: 'WEAPON CORE',
    desc: '+1 weapon level: more barrels, more lead.',
    available: (p) => p.weaponLevel < PLAYER.maxWeaponLevel,
    apply: (p) => {
      p.upgradeWeapon();
    },
  },
  {
    id: 'overdrive',
    name: 'ENGINE OVERDRIVE',
    desc: '+8% top speed and thruster response.',
    available: (p) => p.speedStacks < SPEED_STACK_MAX,
    apply: (p) => {
      p.speedStacks += 1;
      p.maxSpeed *= 1.08;
      p.accel *= 1.08;
    },
  },
  {
    id: 'coils',
    name: 'RAPID COILS',
    desc: 'Primary cannons fire 8% faster.',
    available: (p) => p.rapidStacks < RAPID_STACK_MAX,
    apply: (p) => {
      p.rapidStacks += 1;
      p.fireInterval *= 0.92;
    },
  },
  {
    id: 'capacitor',
    name: 'POWER CAPACITOR',
    desc: '+1 POWER lance charge and refill 1 now.',
    available: (p) => p.powerMax < POWER_WEAPON.charges + CAPACITOR_STACK_MAX,
    apply: (p) => {
      p.powerMax += 1;
      p.powerCharges = Math.min(p.powerMax, p.powerCharges + 1);
    },
  },
  {
    id: 'drones',
    name: 'REPAIR DRONES',
    desc: 'Restore 2 shields immediately.',
    available: (p) => p.shields < PLAYER.maxShields - 1 || p.shields < PLAYER.maxShields,
    apply: (p) => p.heal(2),
  },
  {
    id: 'magnet',
    name: 'TRACTOR MAGNET',
    desc: 'Pickups are pulled in from 60% further away.',
    available: (p) => p.magnetStacks < 3,
    apply: (p) => {
      p.magnetStacks += 1;
      p.magnetRange *= 1.6;
    },
  },
];

/**
 * Roll three distinct applicable upgrades. Returns fewer (even zero) if the
 * pool is nearly exhausted — the caller simply skips the draft in that case.
 */
export const rollUpgradeOffer = (rng: Rng, p: Player): UpgradeDef[] => {
  const pool = UPGRADES.filter((u) => u.available(p));
  const offer: UpgradeDef[] = [];
  while (offer.length < 3 && pool.length > 0) {
    const idx = rng.int(0, pool.length - 1);
    offer.push(pool.splice(idx, 1)[0] as UpgradeDef);
  }
  return offer;
};

export const upgradeById = (id: string): UpgradeDef | undefined =>
  UPGRADES.find((u) => u.id === id);
