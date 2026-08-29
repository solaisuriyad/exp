import { PLAYER, WORLD } from '../core/config.js';
import { clamp } from '../core/math.js';

/**
 * Player ship state — pure data, no Three.js dependency, so it unit-tests in
 * Node. The renderer reads these fields and drives the mesh.
 */
export class Player {
  x = 0;
  y = 0;
  z = WORLD.playerZ;
  vx = 0;
  vy = 0;
  shields: number = PLAYER.startShields;
  alive = true;
  weaponLevel: number = 1;
  radius: number = PLAYER.hullRadius;
  invuln = 0;
  nova = 0;
  fireCooldown = 0;
  /** Bank angle in radians, purely cosmetic, derived from lateral velocity. */
  bank = 0;
  /** Engine throttle 0..1 for the exhaust glow. */
  throttle = 0;

  reset(): void {
    this.x = 0;
    this.y = 0;
    this.z = WORLD.playerZ;
    this.vx = 0;
    this.vy = 0;
    this.shields = PLAYER.startShields;
    this.alive = true;
    this.weaponLevel = 1;
    this.invuln = PLAYER.invulnTime;
    this.nova = 0;
    this.fireCooldown = 0;
    this.bank = 0;
    this.throttle = 0;
  }

  get isInvulnerable(): boolean {
    return this.invuln > 0 || this.nova > 0;
  }

  /**
   * Integrate movement. Steering is -1..1 from tilt or touch; the ship
   * accelerates toward the requested velocity and decays back to rest, which
   * reads far better on a phone than direct position mapping.
   */
  update(dt: number, steerX: number, steerY: number): void {
    const sx = clamp(steerX, -1, 1);
    const sy = clamp(steerY, -1, 1);

    const targetVx = sx * PLAYER.maxSpeed;
    const targetVy = sy * PLAYER.maxSpeed;

    this.vx += (targetVx - this.vx) * Math.min(1, PLAYER.accel * dt / PLAYER.maxSpeed);
    this.vy += (targetVy - this.vy) * Math.min(1, PLAYER.accel * dt / PLAYER.maxSpeed);

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
  }

  /**
   * Apply a hit. Returns true if the hit landed (i.e. the player was actually
   * damaged), false if it was absorbed by invulnerability or Nova.
   */
  hit(): boolean {
    if (!this.alive || this.isInvulnerable) return false;
    this.shields -= 1;
    if (this.shields <= 0) {
      this.shields = 0;
      this.alive = false;
    } else {
      this.invuln = PLAYER.invulnTime;
    }
    return true;
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
