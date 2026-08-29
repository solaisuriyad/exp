import type { Rng } from '../core/rng.js';

/**
 * Decaying camera shake. `kick()` adds impulse; `sample()` returns the current
 * offset. Two decorrelated sine stacks are used instead of pure noise so the
 * motion feels weighty rather than jittery, and it costs nothing.
 */
export class CameraShake {
  private amplitude = 0;
  private t = 0;
  private seedOffset: number;

  constructor(rng: Rng) {
    this.seedOffset = rng.range(0, 100);
  }

  kick(amount: number): void {
    this.amplitude = Math.min(1.6, this.amplitude + amount);
  }

  update(dt: number): void {
    this.t += dt;
    this.amplitude *= Math.exp(-5.5 * dt);
    if (this.amplitude < 0.001) this.amplitude = 0;
  }

  get intensity(): number {
    return this.amplitude;
  }

  sample(): { x: number; y: number; roll: number } {
    if (this.amplitude === 0) return { x: 0, y: 0, roll: 0 };
    const t = this.t + this.seedOffset;
    return {
      x: (Math.sin(t * 47.3) * 0.6 + Math.sin(t * 23.1) * 0.4) * this.amplitude,
      y: (Math.sin(t * 39.7) * 0.6 + Math.cos(t * 31.3) * 0.4) * this.amplitude,
      roll: Math.sin(t * 17.9) * this.amplitude * 0.05,
    };
  }

  reset(): void {
    this.amplitude = 0;
    this.t = 0;
  }
}
