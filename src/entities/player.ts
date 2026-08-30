import { GUARD, PLAYER, POWER_WEAPON, SHIPS, WORLD, type ShipId } from '../core/config.js';
import { clamp } from '../core/math.js';

/**
 * What a hit attempt did, so the game layer can react appropriately:
 *  - 'ignored'   : invulnerability/nova/death absorbed it silently
 *  - 'absorbed'  : the AEGIS guard ate it (powerful hits burn guard time)
 *  - 'damaged'   : a hull shield was lost
 *  - 'destroyed' : the last shield went; the run is over
 */
export type DamageResult = 'ignored' | 'absorbed' | 'damaged' | 'destroyed';

/**
 * Player ship state — pure data, no Three.js dependency, so it unit-tests in
 * Node. The renderer reads these fields and drives the mesh.
 */
export class Player {
  shipId: ShipId = 'vector';
  x = 0;
  y = 0;
  z = WORLD.playerZ;
  vx = 0;
  vy = 0;
  shields: number = SHIPS.vector.startShields;
  alive = true;
  weaponLevel = 1;
  radius: number = SHIPS.vector.hullRadius;
  maxSpeed: number = SHIPS.vector.maxSpeed;
  accel: number = SHIPS.vector.accel;
  invuln = 0;
  nova = 0;
  /** AEGIS overshield seconds remaining; 0 = inactive. */
  guard = 0;
  fireCooldown = 0;
  /** POWER weapon magazine. */
  powerCharges: number = POWER_WEAPON.charges;
  /** 0..interval progress toward the next recharging POWER shot. */
  powerRecharge = 0;
  powerCooldown = 0;
  /** Bank angle in radians, purely cosmetic, derived from lateral velocity. */
  bank = 0;
  /** Engine throttle 0..1 for the exhaust glow. */
  throttle = 0;

  /** Switch interceptor; takes effect immediately and on the next reset. */
  applyShip(id: ShipId): void {
    const s = SHIPS[id];
    this.shipId = id;
    this.maxSpeed = s.maxSpeed;
    this.accel = s.accel;
    this.radius = s.hullRadius;
  }

  reset(): void {
    const s = SHIPS[this.shipId];
    this.x = 0;
    this.y = 0;
    this.z = WORLD.playerZ;
    this.vx = 0;
    this.vy = 0;
    this.shields = s.startShields;
    this.alive = true;
    this.weaponLevel = 1;
    this.radius = s.hullRadius;
    this.maxSpeed = s.maxSpeed;
    this.accel = s.accel;
    this.invuln = PLAYER.invulnTime;
    this.nova = 0;
    this.guard = 0;
    this.fireCooldown = 0;
    this.powerCharges = POWER_WEAPON.charges;
    this.powerRecharge = 0;
    this.powerCooldown = 0;
    this.bank = 0;
    this.throttle = 0;
  }

  get isInvulnerable(): boolean {
    return this.invuln > 0 || this.nova > 0;
  }

  get isGuarded(): boolean {
    return this.guard > 0;
  }

  /**
   * Integrate movement. Steering is -1..1 from tilt or touch; the ship
   * accelerates toward the requested velocity and decays back to rest, which
   * reads far better on a phone than direct position mapping.
   */
  update(dt: number, steerX: number, steerY: number): void {
    const sx = clamp(steerX, -1, 1);
    const sy = clamp(steerY, -1, 1);

    const targetVx = sx * this.maxSpeed;
    const targetVy = sy * this.maxSpeed;

    this.vx += (targetVx - this.vx) * Math.min(1, (this.accel * dt) / this.maxSpeed);
    this.vy += (targetVy - this.vy) * Math.min(1, (this.accel * dt) / this.maxSpeed);

    // Drag so releasing tilt actually stops the ship instead of sliding.
    const dragF = Math.exp(-PLAYER.drag * dt);
    if (sx === 0) this.vx *= dragF;
    if (sy === 0) this.vy *= dragF;

    this.x = clamp(this.x + this.vx * dt, -WORLD.boundX, WORLD.boundX);
    this.y = clamp(this.y + this.vy * dt, -WORLD.boundY, WORLD.boundY);

    // Clamp again after integrating so we never tunnel through the bounds.
    if (this.x === -WORLD.boundX || this.x === WORLD.boundX) this.vx = 0;
    if (this.y === -WORLD.boundY || this.y === WORLD.boundY) this.vy = 0;

    const targetBank = -sx * 0.62;
    this.bank += (targetBank - this.bank) * Math.min(1, dt * 9);
    this.throttle = 0.35 + Math.min(1, Math.hypot(sx, sy)) * 0.65;

    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
    if (this.nova > 0) this.nova = Math.max(0, this.nova - dt);
    if (this.fireCooldown > 0) this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (this.powerCooldown > 0) this.powerCooldown = Math.max(0, this.powerCooldown - dt);

    // AEGIS burns down in real time.
    if (this.guard > 0) this.guard = Math.max(0, this.guard - dt);

    // POWER magazine recharges one shot per interval while below capacity.
    if (this.powerCharges < POWER_WEAPON.charges) {
      this.powerRecharge += dt;
      if (this.powerRecharge >= POWER_WEAPON.rechargeInterval) {
        this.powerRecharge = 0;
        this.powerCharges += 1;
      }
    } else {
      this.powerRecharge = 0;
    }
  }

  /**
   * Apply a hit. `powerful` marks heavy mortars / boss fire / heavy rams,
   * which are the only thing that erodes the AEGIS guard (2 s per hit).
   */
  hit(powerful = false): DamageResult {
    if (!this.alive) return 'ignored';
    if (this.isInvulnerable) return 'ignored';
    if (this.guard > 0) {
      if (powerful) {
        this.guard = Math.max(0, this.guard - GUARD.powerfulHitPenalty);
      }
      return 'absorbed';
    }
    this.shields -= 1;
    if (this.shields <= 0) {
      this.shields = 0;
      this.alive = false;
      return 'destroyed';
    }
    this.invuln = PLAYER.invulnTime;
    return 'damaged';
  }

  heal(amount = 1): void {
    this.shields = Math.min(PLAYER.maxShields, this.shields + amount);
  }

  upgradeWeapon(): boolean {
    if (this.weaponLevel >= PLAYER.maxWeaponLevel) return false;
    this.weaponLevel += 1;
    return true;
  }

  activateNova(): void {
    this.nova = PLAYER.novaDuration;
  }

  activateGuard(): void {
    this.guard = GUARD.duration;
  }

  /**
   * Spend a POWER charge. False when the magazine is empty or the shot is
   * still cooling down — the request is simply dropped, never queued.
   */
  consumePower(): boolean {
    if (this.powerCharges <= 0 || this.powerCooldown > 0) return false;
    this.powerCharges -= 1;
    this.powerCooldown = POWER_WEAPON.fireCooldown;
    return true;
  }

  /** Muzzle offsets for the current weapon level. */
  muzzleOffsets(): ReadonlyArray<{ x: number; y: number; speed: number; spread: number; damage: number }> {
    switch (this.weaponLevel) {
      case 1:
        return [{ x: 0, y: 0, speed: 1, spread: 0, damage: 1 }];
      case 2:
        return [
          { x: -1.05, y: -0.1, speed: 1, spread: 0, damage: 1 },
          { x: 1.05, y: -0.1, speed: 1, spread: 0, damage: 1 },
        ];
      case 3:
        return [
          { x: 0, y: 0.35, speed: 1.05, spread: 0, damage: 1 },
          { x: -1.35, y: -0.15, speed: 1, spread: -0.045, damage: 1 },
          { x: 1.35, y: -0.15, speed: 1, spread: 0.045, damage: 1 },
        ];
      default:
        return [
          { x: -0.6, y: 0.3, speed: 1.05, spread: -0.02, damage: 1 },
          { x: 0.6, y: 0.3, speed: 1.05, spread: 0.02, damage: 1 },
          { x: -1.7, y: -0.2, speed: 0.95, spread: -0.09, damage: 1 },
          { x: 1.7, y: -0.2, speed: 0.95, spread: 0.09, damage: 1 },
        ];
    }
  }
}
