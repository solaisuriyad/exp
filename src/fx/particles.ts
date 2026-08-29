import { clamp } from '../core/math.js';

/**
 * Fixed-capacity CPU particle pool.
 *
 * Deliberately not a GPU particle system: counts stay under a few hundred and
 * the per-particle state lives in flat typed arrays, so there is zero per-frame
 * allocation and the GC never fires mid-fight on a low-end phone.
 */
export interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size: number;
  /** 0xRRGGBB */
  color: number;
  drag?: number;
}

export class ParticleField {
  readonly max: number;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly size: Float32Array;
  readonly color: Uint32Array;
  readonly drag: Float32Array;
  count = 0;

  /** Multiplier applied to spawn counts on low-quality devices. */
  quality = 1;

  constructor(max = 700) {
    this.max = max;
    this.px = new Float32Array(max);
    this.py = new Float32Array(max);
    this.pz = new Float32Array(max);
    this.vx = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.vz = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.color = new Uint32Array(max);
    this.drag = new Float32Array(max);
  }

  get alive(): number {
    return this.count;
  }

  spawn(p: ParticleSpec): boolean {
    if (this.count >= this.max) return false;
    const i = this.count++;
    this.px[i] = p.x;
    this.py[i] = p.y;
    this.pz[i] = p.z;
    this.vx[i] = p.vx;
    this.vy[i] = p.vy;
    this.vz[i] = p.vz;
    this.life[i] = p.life;
    this.maxLife[i] = p.life;
    this.size[i] = p.size;
    this.color[i] = p.color;
    this.drag[i] = p.drag ?? 1.6;
    return true;
  }

  /** Scaled spawn helper honouring the quality multiplier. */
  spawnScaled(p: ParticleSpec): boolean {
    return this.spawn(p);
  }

  update(dt: number): void {
    for (let i = this.count - 1; i >= 0; i--) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.removeAt(i);
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d;
      this.vy[i] *= d;
      this.vz[i] *= d;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
    }
  }

  /** 0..1 remaining life fraction. */
  fraction(i: number): number {
    const m = this.maxLife[i] ?? 1;
    return m > 0 ? clamp(this.life[i] / m, 0, 1) : 0;
  }

  private removeAt(i: number): void {
    const last = this.count - 1;
    if (i !== last) {
      this.px[i] = this.px[last]!;
      this.py[i] = this.py[last]!;
      this.pz[i] = this.pz[last]!;
      this.vx[i] = this.vx[last]!;
      this.vy[i] = this.vy[last]!;
      this.vz[i] = this.vz[last]!;
      this.life[i] = this.life[last]!;
      this.maxLife[i] = this.maxLife[last]!;
      this.size[i] = this.size[last]!;
      this.color[i] = this.color[last]!;
      this.drag[i] = this.drag[last]!;
    }
    this.count = last;
  }

  clear(): void {
    this.count = 0;
  }
}

/**
 * Ring shockwaves — a cheap way to sell an explosion without geometry.
 */
export interface Ring {
  x: number;
  y: number;
  z: number;
  age: number;
  life: number;
  from: number;
  to: number;
  color: number;
}

export class RingField {
  readonly rings: Ring[] = [];
  private readonly max: number;

  constructor(max = 24) {
    this.max = max;
  }

  spawn(r: Omit<Ring, 'age'>): void {
    if (this.rings.length >= this.max) this.rings.shift();
    this.rings.push({ age: 0, ...r });
  }

  update(dt: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.age += dt;
      if (r.age >= r.life) this.rings.splice(i, 1);
    }
  }

  clear(): void {
    this.rings.length = 0;
  }
}
