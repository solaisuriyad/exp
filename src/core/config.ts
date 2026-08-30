/**
 * Tuning constants. Every balance-affecting number lives here so the game can
 * be re-tuned without touching logic, and so tests can assert against it.
 */

export const WORLD = {
  /** Half-width of the region the player may occupy. */
  boundX: 12,
  /** Half-height of the region the player may occupy. */
  boundY: 7,
  /** Z plane the camera sits on; the player hovers just in front of it. */
  playerZ: 0,
  /** Enemies materialise here. */
  spawnZ: -190,
  /** Anything past this is recycled. */
  despawnZ: 26,
  /** Player bullets die here. */
  bulletLifeZ: -210,
} as const;

/**
 * Playable interceptors. VECTOR is the baseline; LANCE trades armour for
 * speed; BASTION is the opposite. Stats are read by Player on reset.
 */
export const SHIPS = {
  vector:  { name: 'VECTOR',  maxSpeed: 30, accel: 42, startShields: 3, hullRadius: 1.35, color: 0x8fd3ff },
  lance:   { name: 'LANCE',   maxSpeed: 38, accel: 56, startShields: 2, hullRadius: 1.15, color: 0x9dff6a },
  bastion: { name: 'BASTION', maxSpeed: 24, accel: 32, startShields: 4, hullRadius: 1.6,  color: 0xffa23a },
} as const;

export type ShipId = keyof typeof SHIPS;

/**
 * Secondary "POWER" weapon: a 5-shot magazine of piercing AoE lances. Spent
 * charges recharge one at a time on a fixed interval, so emptying the mag
 * starts a reload clock rather than an instant refill.
 */
export const POWER_WEAPON = {
  charges: 5,
  rechargeInterval: 3,
  fireCooldown: 0.35,
  damage: 6,
  splashDamage: 3,
  aoeRadius: 6.5,
  speed: 175,
  radius: 1.1,
} as const;

/**
 * AEGIS guard: a timed overshield from a pickup. Normal hits are absorbed
 * for free; powerful hits (heavy mortars, bosses, rams by heavy ships) burn
 * `powerfulHitPenalty` seconds off the remaining guard time instead of
 * touching hull shields.
 */
export const GUARD = {
  duration: 30,
  powerfulHitPenalty: 2,
} as const;

export const AIMLOCK = {
  /** Which archetypes qualify as a lockable "powerful opponent". */
  engageRange: 240,
  /** How hard player shots curve toward the locked target (1/s). */
  turnRate: 4,
} as const;

export const PLAYER = {
  startShields: 3,
  maxShields: 5,
  /** Top speed in world units/sec at full tilt deflection. */
  maxSpeed: 30,
  accel: 42,
  drag: 6,
  /** Seconds of invulnerability after taking a hit. */
  invulnTime: 1.6,
  fireInterval: 0.135,
  bulletSpeed: 150,
  bulletRadius: 0.55,
  hullRadius: 1.35,
  maxWeaponLevel: 4,
  /** Seconds of Nova (invulnerable + autofire sweep) from a pickup. */
  novaDuration: 6,
} as const;

export const ENEMY = {
  grunt: { hp: 2, radius: 1.7, speed: 26, score: 100, fireCooldown: [1.4, 2.6] },
  darter: { hp: 1, radius: 1.35, speed: 42, score: 150, fireCooldown: [2.4, 4.2] },
  tank: { hp: 7, radius: 2.5, speed: 15, score: 300, fireCooldown: [1.1, 1.9] },
  boss: { hp: 220, radius: 7.5, speed: 9, score: 5000, fireCooldown: [0.55, 0.8] },
  stinger: { hp: 1, radius: 1.3, speed: 50, score: 175, fireCooldown: [1.6, 2.8] },
  mine: { hp: 3, radius: 1.8, speed: 12, score: 200, fireCooldown: [999, 999] },
} as const;

/** Fragment burst a mine releases when destroyed. */
export const MINE_BURST = {
  shards: 6,
  speed: 26,
  vz: 16,
} as const;

export const ENEMY_BULLET = {
  speed: 46,
  radius: 0.62,
} as const;

export const PICKUP = {
  speed: 20,
  radius: 1.5,
  /** Chance an enemy death drops something at all. */
  dropChance: 0.13,
  /** Guaranteed drop chance for tanks, which feel bad to kill for nothing. */
  tankDropChance: 0.45,
  weights: { weapon: 0.42, shield: 0.2, nova: 0.14, aegis: 0.24 },
} as const;

export const SCORING = {
  /** Consecutive kills without taking a hit bump the multiplier. */
  comboStep: 0.25,
  comboMax: 8,
  /** Combo decays after this many seconds without a kill. */
  comboTimeout: 3.5,
} as const;

export const WAVES = {
  /** Seconds per wave. */
  duration: 22,
  baseInterval: 1.15,
  minInterval: 0.32,
  speedScalePerWave: 0.07,
  maxSpeedScale: 2.3,
  /** A boss leads every Nth wave. */
  bossEveryNthWave: 5,
  /** Cap on simultaneously alive non-boss enemies. */
  maxAlive: 22,
} as const;

export const FIXED_DT = 1 / 120;
export const MAX_FRAME_DT = 0.05;
