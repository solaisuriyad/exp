import { AudioEngine } from './audio/synth.js';
import {
  AIMLOCK,
  ENEMY_BULLET,
  FIXED_DT,
  GUARD,
  MAX_FRAME_DT,
  PICKUP,
  PLAYER,
  POWER_WEAPON,
  WORLD,
  type ShipId,
} from './core/config.js';
import type { Mesh } from 'three';
import { clamp } from './core/math.js';
import { Pool } from './core/pool.js';
import { randomSeed, Rng } from './core/rng.js';
import {
  loadHighScore,
  loadSettings,
  loadTiltCalibration,
  saveHighScore,
  saveSettings,
  saveTiltCalibration,
  type ControlPreference,
  type PersistedSettings,
} from './core/storage.js';
import type {
  ControlMode,
  GameState,
  InputFrame,
} from './core/types.js';
import {
  createBullet,
  resetBullet,
  type Bullet,
} from './entities/bullet.js';
import {
  createEnemy,
  isPowerfulShooter,
  resetEnemy,
  shotKindFor,
  updateEnemy,
  type Enemy as EnemyT,
} from './entities/enemy.js';
import { createPickup, resetPickup, rollDrop, type Pickup } from './entities/pickup.js';
import { Player, type DamageResult } from './entities/player.js';
import { ParticleField, RingField } from './fx/particles.js';
import { CameraShake } from './fx/shake.js';
import { TiltInput, TouchSteer } from './input/tilt.js';
import { Renderer } from './renderer.js';
import {
  difficultyForWave,
  isBossWave,
  waveForElapsed,
  waveProgress,
  type DifficultySnapshot,
} from './systems/difficulty.js';
import { POWERFUL_KINDS, selectLockTarget } from './systems/lock.js';
import { Scoring } from './systems/scoring.js';
import {
  formationV,
  makeBossSpawn,
  makeSpawn,
  pickKind,
  type SpawnRequest,
} from './systems/spawner.js';

export interface GameEvents {
  onState?: (s: GameState) => void;
  onHud?: (h: HudSnapshot) => void;
  onBoss?: (hp: number, maxHp: number | null) => void;
  onToast?: (text: string, tone?: 'good' | 'bad' | 'info') => void;
  onWave?: (wave: number) => void;
  onGameOver?: (r: RunSummary) => void;
  onControlMode?: (mode: ControlMode) => void;
  onCountdown?: (n: number) => void;
}

export interface HudSnapshot {
  score: number;
  highScore: number;
  shields: number;
  maxShields: number;
  wave: number;
  multiplier: number;
  comboFrac: number;
  weaponLevel: number;
  novaFrac: number;
  waveFrac: number;
  controlMode: ControlMode;
  fps: number;
  powerCharges: number;
  powerMax: number;
  powerRechargeFrac: number;
  guardTime: number;
  locked: boolean;
}

export interface RunSummary {
  score: number;
  highScore: number;
  isNewHighScore: boolean;
  wave: number;
  kills: number;
  bestCombo: number;
  timeSurvived: number;
  seed: number;
}

/**
 * Owns the whole run: simulation state, pools, and the fixed-timestep loop.
 *
 * The loop separates *simulation* from *presentation*: logic always advances in
 * `FIXED_DT` slices regardless of display rate, so a 120 Hz phone and a 30 Hz
 * phone play an identical game. Rendering happens once per animation frame.
 */
export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: Renderer;
  private readonly audio = new AudioEngine();
  private readonly events: GameEvents;

  private rng: Rng;
  private readonly player = new Player();
  private readonly scoring = new Scoring();
  private readonly particles: ParticleField;
  private readonly rings = new RingField();
  private readonly shake: CameraShake;

  private readonly bullets: Pool<Bullet>;
  private readonly enemies: Pool<EnemyT>;
  private readonly pickups: Pool<Pickup>;

  private readonly tilt: TiltInput;
  private readonly touch: TouchSteer;
  private readonly keys = new Set<string>();
  private keyboardFire = false;

  private settings: PersistedSettings;
  private state: GameState = 'boot';
  private diff: DifficultySnapshot = difficultyForWave(1);
  private elapsed = 0;
  private wave = 1;
  private spawnTimer = 0;
  private countdown = 0;
  private boss: EnemyT | null = null;

  private accumulator = 0;
  private lastFrame = 0;
  private rafId = 0;
  private fps = 60;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private highScore = 0;
  private seed: number;

  private lastControlMode: ControlMode = 'none';
  private disposed = false;
  private lock: EnemyT | null = null;
  private powerQueued = false;

  constructor(canvas: HTMLCanvasElement, events: GameEvents = {}, seed?: number) {
    this.canvas = canvas;
    this.events = events;
    this.seed = seed ?? randomSeed();
    this.rng = new Rng(this.seed);
    this.settings = loadSettings();
    this.highScore = loadHighScore();

    const lowPower =
      (navigator.hardwareConcurrency ?? 4) <= 4 ||
      (window.devicePixelRatio || 1) > 2.5;

    this.renderer = new Renderer(canvas, {
      bloom: this.settings.bloom && !lowPower,
      pixelRatioCap: lowPower ? 1.5 : 2,
      particleScale: lowPower ? 0.6 : 1,
    });
    this.particles = new ParticleField(700);
    this.particles.quality = lowPower ? 0.6 : 1;
    this.shake = new CameraShake(this.rng);
    this.renderer.setShake(this.shake);

    this.bullets = new Pool<Bullet>(
      createBullet,
      resetBullet,
      320,
    );
    this.enemies = new Pool<EnemyT>(createEnemy, resetEnemy, 40);
    this.pickups = new Pool<Pickup>(createPickup, resetPickup, 24);

    this.tilt = new TiltInput();
    const savedTilt = loadTiltCalibration();
    if (savedTilt) this.tilt.restoreCalibration(savedTilt.gamma, savedTilt.beta);
    this.touch = new TouchSteer();
    this.touch.attach(canvas);

    this.audio.musicEnabled = this.settings.music;
    this.audio.sfxEnabled = this.settings.sfx;

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  // ------------------------------------------------------------- lifecycle

  start(): void {
    this.setState('menu');
    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.tilt.stop();
    this.touch.detach(this.canvas);
    this.audio.dispose();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.renderer.dispose();
  }

  private setState(s: GameState): void {
    if (this.state === s) return;
    this.state = s;
    this.events.onState?.(s);
  }

  get currentState(): GameState {
    return this.state;
  }

  get currentSettings(): PersistedSettings {
    return { ...this.settings };
  }

  get currentHighScore(): number {
    return this.highScore;
  }

  get tiltState(): TiltInput {
    return this.tilt;
  }

  updateSettings(patch: Partial<PersistedSettings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    this.audio.setMusic(this.settings.music);
    this.audio.setSfx(this.settings.sfx);
    this.renderer.setBloom(this.settings.bloom);
  }

  setShip(id: ShipId): void {
    this.updateSettings({ ship: id });
    this.player.applyShip(id);
  }

  requestPowerShot(): void {
    this.powerQueued = true;
  }

  setControlPreference(pref: ControlPreference): void {
    this.updateSettings({ controlPreference: pref });
    if (pref === 'touch') this.tilt.stop();
    else if (pref === 'tilt') void this.enableTilt();
  }

  // ----------------------------------------------------------------- input

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
    if (e.code === 'Space') {
      e.preventDefault();
      this.keyboardFire = true;
    }
    if (e.code === 'KeyF' || e.code === 'ShiftLeft') {
      this.requestPowerShot();
    }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    if (e.code === 'Space') this.keyboardFire = false;
  };

  private readonly onResize = (): void => {
    this.renderer.resize(window.innerWidth, window.innerHeight);
  };

  private readonly onVisibility = (): void => {
    if (document.hidden && this.state === 'playing') {
      this.pause();
      this.audio.suspend();
    } else {
      this.audio.resume();
    }
  };

  /** Attempt to switch to tilt steering. Returns the resulting support level. */
  async enableTilt(): Promise<'supported' | 'denied' | 'unavailable' | 'unknown'> {
    const support = await this.tilt.start();
    this.reportControlMode();
    return support;
  }

  private reportControlMode(): void {
    const mode = this.resolveControlMode();
    if (mode !== this.lastControlMode) {
      this.lastControlMode = mode;
      this.events.onControlMode?.(mode);
    }
  }

  private resolveControlMode(): ControlMode {
    const pref = this.settings.controlPreference;
    if (pref === 'touch') return 'touch';
    if (this.tilt.isListening && this.tilt.support === 'supported') return 'tilt';
    if (pref === 'tilt') return 'touch'; // requested tilt but it never attached
    return 'touch';
  }

  private gatherInput(): InputFrame {
    let x = 0;
    let y = 0;
    let mode = this.resolveControlMode();
    const rawX = this.tilt.rawX;
    const rawY = this.tilt.rawY;

    if (mode === 'tilt') {
      const s = this.tilt.sample();
      x = s.x;
      y = s.y;
    } else {
      const s = this.touch.sample();
      x = s.x;
      y = s.y;
      mode = 'touch';
    }

    // Keyboard always layers on top — it makes the desktop preview playable
    // and is handy for automated smoke tests.
    const kx = (this.keys.has('ArrowRight') || this.keys.has('KeyD') ? 1 : 0) -
      (this.keys.has('ArrowLeft') || this.keys.has('KeyA') ? 1 : 0);
    const ky = (this.keys.has('ArrowUp') || this.keys.has('KeyW') ? 1 : 0) -
      (this.keys.has('ArrowDown') || this.keys.has('KeyS') ? 1 : 0);
    if (kx !== 0) x = kx;
    if (ky !== 0) y = ky;

    return {
      x: clamp(x, -1, 1),
      y: clamp(y, -1, 1),
      firePressed: false,
      fireHeld: this.settings.autofire || this.keyboardFire || this.touch.isActive,
      mode,
      rawTiltX: rawX,
      rawTiltY: rawY,
    };
  }

  // ------------------------------------------------------------ run control

  async beginRun(): Promise<void> {
    this.audio.unlock();
    if (this.settings.music) this.audio.startMusic();

    // Re-seed deterministically from the run seed so a replay matches.
    this.seed = randomSeed();
    this.rng = new Rng(this.seed);

    this.player.applyShip(this.settings.ship);
    this.player.reset();
    this.scoring.reset();
    this.bullets.releaseAll();
    for (const e of [...this.enemies.active]) this.renderer.releaseEnemyMesh(e);
    this.enemies.releaseAll();
    for (const p of [...this.pickups.active]) this.renderer.releasePickupMesh(p);
    this.pickups.releaseAll();
    while (this.bullets.size > 0) this.killBullet(this.bullets.size - 1);
    this.particles.clear();
    this.rings.clear();
    this.shake.reset();

    this.elapsed = 0;
    this.wave = 1;
    this.diff = difficultyForWave(1);
    this.spawnTimer = 0.6;
    this.boss = null;
    this.accumulator = 0;

    // Try to attach the gyro before the countdown so the first frame already
    // knows which control scheme is live.
    if (this.settings.controlPreference !== 'touch') {
      await this.enableTilt();
    }
    this.reportControlMode();

    this.countdown = 3;
    this.events.onCountdown?.(3);
    this.setState('countdown');
  }

  pause(): void {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    this.audio.suspend();
    this.setState('paused');
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.audio.resume();
    this.lastFrame = performance.now();
    this.setState(this.countdown > 0 ? 'countdown' : 'playing');
  }

  toMenu(): void {
    this.audio.stopMusic();
    this.setState('menu');
  }

  private preCalibration: GameState = 'menu';

  enterCalibration(): void {
    if (this.state === 'playing' || this.state === 'countdown') this.pause();
    this.preCalibration = this.state === 'paused' ? 'paused' : 'menu';
    this.setState('calibrate');
  }

  leaveCalibration(): void {
    if (this.state !== 'calibrate') return;
    this.setState(this.preCalibration === 'paused' ? 'paused' : 'menu');
  }

  async calibrateTilt(): Promise<{ gamma: number; beta: number } | null> {
    if (!this.tilt.isListening) {
      const support = await this.tilt.start();
      if (support !== 'supported') return null;
    }
    this.tilt.beginCalibration();
    return null;
  }

  commitTiltCalibration(): { gamma: number; beta: number } | null {
    const result = this.tilt.commitCalibration();
    if (result) saveTiltCalibration(result.gamma, result.beta);
    this.reportControlMode();
    return result;
  }

  // -------------------------------------------------------------- main loop

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.frame);

    const dtRaw = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    const dt = Math.min(dtRaw, MAX_FRAME_DT);

    // FPS meter for the HUD.
    this.fpsAccum += dtRaw;
    this.fpsFrames += 1;
    if (this.fpsAccum >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    if (this.state === 'playing' || this.state === 'countdown') {
      this.accumulator += dt;
      let guard = 0;
      while (this.accumulator >= FIXED_DT && guard < 12) {
        this.step(FIXED_DT);
        this.accumulator -= FIXED_DT;
        guard += 1;
      }
      if (guard >= 12) this.accumulator = 0;
    } else if (this.state === 'gameover' || this.state === 'menu') {
      // Keep effects (the death explosion, idle sparks) alive after the run
      // ends instead of freezing the scene on its last simulation frame.
      this.particles.update(dt);
      this.rings.update(dt);
      this.shake.update(dt);
    }

    this.present(dt);
  };

  private step(dt: number): void {
    if (this.state === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== Math.ceil(this.countdown + dt)) this.events.onCountdown?.(Math.max(0, n));
      if (this.countdown <= 0) {
        this.countdown = 0;
        this.events.onCountdown?.(0);
        this.setState('playing');
        this.events.onWave?.(this.wave);
        this.audio.waveStart();
      }
      // Let the ship idle-animate during the countdown.
      this.player.update(dt, 0, 0);
      this.particles.update(dt);
      this.rings.update(dt);
      this.shake.update(dt);
      return;
    }

    const input = this.gatherInput();
    this.elapsed += dt;

    // Wave progression.
    const newWave = waveForElapsed(this.elapsed);
    if (newWave !== this.wave) {
      this.wave = newWave;
      this.diff = difficultyForWave(this.wave);
      this.events.onWave?.(this.wave);
      this.audio.waveStart();
      this.events.onToast?.(`WAVE ${this.wave}`, 'info');
      if (isBossWave(this.wave)) this.spawnBoss();
    }

    this.player.update(dt, input.x, input.y);
    this.scoring.update(dt);
    this.shake.update(dt);
    this.particles.update(dt);
    this.rings.update(dt);

    this.lock = this.settings.aimlock
      ? (selectLockTarget(
          this.enemies.active,
          POWERFUL_KINDS,
          this.player.x,
          this.player.y,
          this.player.z,
          AIMLOCK.engageRange,
        ) as EnemyT | null)
      : null;

    this.handleFiring(dt, input);
    this.handleSpawning(dt);
    this.updateBullets(dt);
    this.updateEnemies(dt);
    this.updatePickups(dt);
    this.resolveCollisions();

    this.emitHud();
  }

  // ---------------------------------------------------------------- firing

  private handleFiring(_dt: number, input: InputFrame): void {
    if (!this.player.alive) return;
    if (!input.fireHeld) return;
    if (this.player.fireCooldown > 0) return;

    this.player.fireCooldown = PLAYER.fireInterval / (this.player.nova > 0 ? 1.8 : 1);
    const offsets = this.player.muzzleOffsets();
    for (const o of offsets) {
      const b = this.bullets.obtain();
      if (!b) break;
      b.alive = true;
      b.faction = 0;
      b.x = this.player.x + o.x;
      b.y = this.player.y + o.y;
      b.z = this.player.z - 2;
      b.vz = -PLAYER.bulletSpeed * o.speed;
      b.vx = o.spread * PLAYER.bulletSpeed;
      b.vy = 0;
      b.radius = PLAYER.bulletRadius;
      b.damage = o.damage;
      b.mesh = this.renderer.obtainBulletMesh('player');
    }
    this.audio.shoot(this.player.weaponLevel);

    // POWER lance: queued from the HUD button / F key, spends a charge.
    if (this.powerQueued && this.player.consumePower()) {
      const b = this.bullets.obtain();
      if (b) {
        b.alive = true;
        b.faction = 0;
        b.isPower = true;
        b.x = this.player.x;
        b.y = this.player.y;
        b.z = this.player.z - 2.2;
        b.vz = -POWER_WEAPON.speed;
        b.vx = 0;
        b.vy = 0;
        b.radius = POWER_WEAPON.radius;
        b.damage = POWER_WEAPON.damage;
        b.mesh = this.renderer.obtainBulletMesh('playerPower');
      }
      this.audio.nova();
      this.shake.kick(0.22);
    }
    this.powerQueued = false;

    // Muzzle sparks.
    const sparks = Math.round(3 * this.particles.quality);
    for (let i = 0; i < sparks; i++) {
      this.particles.spawn({
        x: this.player.x,
        y: this.player.y,
        z: this.player.z - 2.4,
        vx: this.rng.range(-3, 3),
        vy: this.rng.range(-3, 3),
        vz: this.rng.range(-14, -6),
        life: 0.18,
        size: 0.5,
        color: 0x9dff6a,
        drag: 3,
      });
    }
  }

  private fireEnemyShot(
    e: EnemyT,
    targetX: number,
    targetY: number,
    opts: { powerful?: boolean; heavy?: boolean; angleY?: number } = {},
  ): void {
    const b = this.bullets.obtain();
    if (!b) return;
    const dx = targetX - e.x;
    const dy = targetY - e.y;
    const dz = WORLD.playerZ - e.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    let ux = dx / len;
    const uy = dy / len;
    let uz = dz / len;
    // Horizontal fan for spread shooters: rotate around the Y axis.
    const a = opts.angleY ?? 0;
    if (a !== 0) {
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const rx = ux * c + uz * sn;
      const rz = -ux * sn + uz * c;
      ux = rx;
      uz = rz;
    }
    const speed = opts.heavy ? ENEMY_BULLET.speed * 0.6 : ENEMY_BULLET.speed;
    b.alive = true;
    b.faction = 1;
    b.x = e.x;
    b.y = e.y;
    b.z = e.z + e.radius * 0.6;
    b.vx = ux * speed;
    b.vy = uy * speed;
    b.vz = uz * speed;
    b.radius = opts.heavy ? 1.05 : ENEMY_BULLET.radius;
    b.damage = 1;
    b.powerful = opts.powerful ?? false;
    b.mesh = this.renderer.obtainBulletMesh(opts.heavy ? 'enemyHeavy' : 'enemy');
    this.audio.enemyShoot();
  }

  private fireBossPattern(b: EnemyT): void {
    switch (b.pattern) {
      case 0: {
        // Radial burst.
        const n = 14;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + b.patternTimer;
          const shot = this.bullets.obtain();
          if (!shot) break;
          shot.alive = true;
          shot.faction = 1;
          shot.x = b.x;
          shot.y = b.y;
          shot.z = b.z + 4;
          shot.vx = Math.cos(a) * ENEMY_BULLET.speed * 0.7;
          shot.vy = Math.sin(a) * ENEMY_BULLET.speed * 0.7;
          shot.vz = ENEMY_BULLET.speed * 0.55;
          shot.radius = ENEMY_BULLET.radius;
          shot.damage = 1;
          shot.powerful = true;
          shot.mesh = this.renderer.obtainBulletMesh('enemyHeavy');
        }
        this.audio.enemyShoot();
        break;
      }
      case 1: {
        // Aimed triple.
        for (const off of [-1.6, 0, 1.6]) {
          this.fireEnemyShot(b, this.player.x + off, this.player.y, { powerful: true });
        }
        break;
      }
      default: {
        // Sweeping stream toward the player's current position.
        this.fireEnemyShot(b, this.player.x, this.player.y, { powerful: true });
        break;
      }
    }
  }

  // --------------------------------------------------------------- spawning

  private readonly spawnQueue: SpawnRequest[] = [];

  private handleSpawning(dt: number): void {
    // Drain queued formation spawns first.
    if (this.spawnQueue.length > 0) {
      const req = this.spawnQueue.shift()!;
      this.instantiate(req);
    }

    if (this.boss && this.boss.alive) return; // bosses hold the field

    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = this.diff.spawnInterval * this.rng.range(0.8, 1.2);

    if (this.enemies.active.length >= (this.boss ? 10 : 22)) return;

    // Every 7th spawn attempt on wave >= 3, send a V formation instead.
    if (this.wave >= 3 && this.rng.chance(0.16)) {
      const v = formationV(this.rng, this.diff, 5);
      for (const req of v) this.spawnQueue.push(req);
      return;
    }

    this.instantiate(makeSpawn(this.rng, pickKind(this.rng, this.diff), this.diff));
  }

  private spawnBoss(): void {
    if (this.boss && this.boss.alive) return;
    const req = makeBossSpawn(this.diff);
    const e = this.instantiate(req);
    if (e) {
      this.boss = e;
      this.events.onToast?.('WARNING — CAPITAL SHIP', 'bad');
      this.shake.kick(0.5);
      this.audio.explosion(true);
    }
  }

  private instantiate(req: SpawnRequest): EnemyT | null {
    const e = this.enemies.obtain();
    if (!e) return null;
    e.alive = true;
    e.kind = req.kind;
    e.x = req.x;
    e.y = req.y;
    e.z = req.z;
    e.vx = req.vx;
    e.vz = req.vz;
    e.vy = 0;
    e.hp = req.hp;
    e.maxHp = req.hp;
    e.radius = req.radius;
    e.score = req.score;
    e.weave = req.weave;
    e.phase = req.phase;
    e.speedScale = req.speedScale;
    e.fireTimer = this.rng.range(0.6, 1.6);
    e.fireCooldown = req.fireCooldown;
    e.age = 0;
    e.pattern = 0;
    e.patternTimer = 0;
    e.mesh = this.renderer.obtainEnemyMesh(e);
    return e;
  }

  // --------------------------------------------------------------- updates

  private updateBullets(dt: number): void {
    const arr = this.bullets.active;
    const lock = this.lock;
    for (let i = arr.length - 1; i >= 0; i--) {
      const b = arr[i]!;

      // Aim-lock homing: player shots curve toward the locked opponent.
      if (b.faction === 0 && lock && lock.alive) {
        const dx = lock.x - b.x;
        const dy = lock.y - b.y;
        const dz = lock.z - b.z;
        const dist = Math.hypot(dx, dy, dz) || 1;
        const speed = Math.hypot(b.vx, b.vy, b.vz) || 1;
        const k = Math.min(1, AIMLOCK.turnRate * dt);
        const nx = b.vx / speed + (dx / dist - b.vx / speed) * k;
        const ny = b.vy / speed + (dy / dist - b.vy / speed) * k;
        const nz = b.vz / speed + (dz / dist - b.vz / speed) * k;
        const nl = Math.hypot(nx, ny, nz) || 1;
        b.vx = (nx / nl) * speed;
        b.vy = (ny / nl) * speed;
        b.vz = (nz / nl) * speed;
      }

      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      const gone =
        b.z < WORLD.bulletLifeZ ||
        b.z > WORLD.despawnZ + 10 ||
        Math.abs(b.x) > WORLD.boundX + 22 ||
        Math.abs(b.y) > WORLD.boundY + 22;
      if (gone) this.killBullet(i);
    }
  }

  private killBullet(index: number): void {
    const arr = this.bullets.active;
    const b = arr[index]!;
    if (b.mesh) this.renderer.releaseBulletMesh(b.mesh as Mesh);
    b.mesh = null;
    this.bullets.releaseAt(index);
  }

  private updateEnemies(dt: number): void {
    const arr = this.enemies.active;
    for (let i = arr.length - 1; i >= 0; i--) {
      const e = arr[i]!;
      updateEnemy(e, dt, this.elapsed);

      // Firing.
      e.fireTimer -= dt;
      if (e.fireTimer <= 0 && e.z > WORLD.spawnZ + 20 && e.z < -8) {
        e.fireTimer = e.fireCooldown * this.rng.range(0.85, 1.15);
        const sk = shotKindFor(e.kind);
        if (sk === 'boss') {
          e.patternTimer += 1;
          if (e.patternTimer % 6 === 0) e.pattern = (e.pattern + 1) % 3;
          this.fireBossPattern(e);
        } else if (this.player.alive && this.rng.chance(e.kind === 'tank' ? 0.85 : 0.6)) {
          if (sk === 'spread') {
            // Darters fan a 3-way spread.
            for (const a of [-0.24, 0, 0.24]) {
              this.fireEnemyShot(e, this.player.x, this.player.y, { angleY: a });
            }
          } else if (sk === 'heavy') {
            // Tanks lob a slow, powerful mortar.
            this.fireEnemyShot(e, this.player.x, this.player.y, { powerful: true, heavy: true });
          } else {
            this.fireEnemyShot(e, this.player.x, this.player.y);
          }
        }
      }

      if (e.z > WORLD.despawnZ) {
        if (e.kind === 'boss') {
          this.boss = null;
        }
        this.killEnemy(i, false);
      }
    }
  }

  private updatePickups(dt: number): void {
    const arr = this.pickups.active;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i]!;
      p.age += dt;
      p.z += p.vz * dt;
      // Gentle attraction when close, so pickups feel fair.
      const dz = Math.abs(p.z - this.player.z);
      if (dz < 16) {
        p.x += (this.player.x - p.x) * Math.min(1, dt * 2.2);
        p.y += (this.player.y - p.y) * Math.min(1, dt * 2.2);
      }
      if (p.z > WORLD.despawnZ) this.killPickup(i);
    }
  }

  private killPickup(index: number): void {
    const p = this.pickups.active[index]!;
    this.renderer.releasePickupMesh(p);
    p.mesh = null;
    this.pickups.releaseAt(index);
  }

  // ------------------------------------------------------------ collisions

  private readonly pickupScratch: Pickup[] = [];

  private resolveCollisions(): void {
    const enemies = this.enemies.active;
    const bullets = this.bullets.active;

    // Player bullets vs enemies.
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i]!;
      if (!b.alive || b.faction !== 0) continue;
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j]!;
        if (!e.alive) continue;
        const dx = b.x - e.x;
        const dy = b.y - e.y;
        const dz = b.z - e.z;
        const r = b.radius + e.radius;
        if (dx * dx + dy * dy + dz * dz <= r * r) {
          if (b.isPower) this.powerDetonate(b, e, j);
          else this.damageEnemy(e, b.damage, j);
          this.killBullet(i);
          break;
        }
      }
    }

    if (!this.player.alive) return;

    // Enemy bullets vs player.
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i]!;
      if (!b.alive || b.faction !== 1) continue;
      const dx = b.x - this.player.x;
      const dy = b.y - this.player.y;
      const dz = b.z - this.player.z;
      const r = b.radius + this.player.radius;
      if (dx * dx + dy * dy + dz * dz <= r * r) {
        const powerful = b.powerful;
        this.killBullet(i);
        this.damagePlayer(powerful);
        break;
      }
    }

    // Enemies vs player (ramming).
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i]!;
      if (!e.alive) continue;
      const dx = e.x - this.player.x;
      const dy = e.y - this.player.y;
      const dz = e.z - this.player.z;
      const r = e.radius + this.player.radius;
      if (dx * dx + dy * dy + dz * dz <= r * r) {
        this.damagePlayer(isPowerfulShooter(e.kind));
        if (e.kind !== 'boss') this.killEnemy(i, true);
        break;
      }
    }

    // Pickups vs player.
    const got = sweepPickups(this.pickups.active, this.player, this.pickupScratch);
    for (const p of got) {
      this.collect(p);
      const idx = this.pickups.active.indexOf(p);
      if (idx >= 0) this.killPickup(idx);
    }

    // Nova vacuums nearby pickups automatically.
    if (this.player.nova > 0) {
      const arr = this.pickups.active;
      for (let i = arr.length - 1; i >= 0; i--) {
        const p = arr[i]!;
        if (Math.abs(p.z - this.player.z) < 26) {
          this.collect(p);
          this.killPickup(i);
        }
      }
    }
  }

  private damageEnemy(e: EnemyT, damage: number, indexHint: number): void {
    e.hp -= damage;
    this.audio.hit();
    // Small impact sparks.
    const n = Math.round(4 * this.particles.quality);
    for (let i = 0; i < n; i++) {
      this.particles.spawn({
        x: e.x,
        y: e.y,
        z: e.z,
        vx: this.rng.range(-10, 10),
        vy: this.rng.range(-10, 10),
        vz: this.rng.range(-4, 12),
        life: 0.24,
        size: 0.45,
        color: 0xffd08a,
        drag: 2.6,
      });
    }
    if (e.hp <= 0) {
      const idx = this.enemies.active.indexOf(e);
      this.killEnemy(idx >= 0 ? idx : indexHint, true);
    } else if (e.kind === 'boss') {
      this.events.onBoss?.(e.hp, e.maxHp);
    }
  }

  /**
   * POWER lance impact: full damage on the struck ship, splash damage to
   * everything inside the blast radius.
   */
  private powerDetonate(b: Bullet, primary: EnemyT, primaryIndex: number): void {
    this.explode(b.x, b.y, b.z, 1.4, 0xfff0b0);
    this.rings.spawn({ x: b.x, y: b.y, z: b.z, life: 0.5, from: 1, to: POWER_WEAPON.aoeRadius * 1.4, color: 0xffe14d });
    this.shake.kick(0.4);
    this.audio.explosion(true);
    const aoeSq = POWER_WEAPON.aoeRadius * POWER_WEAPON.aoeRadius;
    const enemies = this.enemies.active;
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j]!;
      if (!e.alive) continue;
      const isPrimary = e === primary;
      const dx = e.x - b.x;
      const dy = e.y - b.y;
      const dz = e.z - b.z;
      if (isPrimary || dx * dx + dy * dy + dz * dz <= aoeSq) {
        this.damageEnemy(e, isPrimary ? POWER_WEAPON.damage : POWER_WEAPON.splashDamage, j);
      }
    }
    void primaryIndex;
  }

  private killEnemy(index: number, exploded: boolean): void {
    const arr = this.enemies.active;
    const e = arr[index];
    if (!e) return;

    if (exploded) {
      const big = e.kind === 'boss' || e.kind === 'tank';
      this.explode(e.x, e.y, e.z, big ? 1.8 : 1, colorFor(e.kind));
      this.scoring.addKill(e.score);
      this.shake.kick(big ? 0.55 : 0.16);
      this.audio.explosion(big);

      const dropChance = e.kind === 'tank' ? PICKUP.tankDropChance : PICKUP.dropChance;
      const kind = rollDrop(this.rng, e.kind === 'boss' ? 1 : dropChance);
      if (kind) this.spawnPickup(kind, e.x, e.y, e.z);
      if (e.kind === 'boss') {
        this.boss = null;
        this.events.onBoss?.(0, null);
        this.events.onToast?.('CAPITAL SHIP DESTROYED', 'good');
        this.scoring.addFlat(2500);
      }
    }

    this.renderer.releaseEnemyMesh(e);
    e.mesh = null;
    this.enemies.releaseAt(index);
  }

  private damagePlayer(powerful = false): void {
    const result: DamageResult = this.player.hit(powerful);
    if (result === 'ignored') return;
    if (result === 'absorbed') {
      // The AEGIS guard ate the hit; powerful ones burn guard time.
      this.audio.hit();
      this.explode(this.player.x, this.player.y, this.player.z, 0.5, 0x59ffd8);
      if (powerful) {
        this.events.onToast?.(`AEGIS -${GUARD.powerfulHitPenalty}s`, 'info');
      }
      return;
    }
    this.scoring.onPlayerHit();
    this.shake.kick(0.85);
    this.audio.playerHurt();
    this.explode(this.player.x, this.player.y, this.player.z, 1.1, 0x6fe8ff);
    this.events.onToast?.(result === 'damaged' ? 'SHIELD HIT' : 'SHIP LOST', 'bad');

    if (result === 'destroyed') {
      this.explode(this.player.x, this.player.y, this.player.z, 2.4, 0xffffff);
      this.shake.kick(1.4);
      this.audio.explosion(true);
      this.audio.gameOver();
      this.audio.stopMusic();
      this.endRun();
    }
  }

  private spawnPickup(kind: Pickup['kind'], x: number, y: number, z: number): void {
    const p = this.pickups.obtain();
    if (!p) return;
    p.alive = true;
    p.kind = kind;
    p.x = clamp(x, -WORLD.boundX, WORLD.boundX);
    p.y = clamp(y, -WORLD.boundY, WORLD.boundY);
    p.z = z;
    p.vz = PICKUP.speed;
    p.age = 0;
    p.mesh = this.renderer.obtainPickupMesh(p);
  }

  private collect(p: Pickup): void {
    this.audio.pickup();
    this.explode(p.x, p.y, p.z, 0.5, colorForPickup(p.kind));
    switch (p.kind) {
      case 'weapon': {
        if (this.player.upgradeWeapon()) {
          this.events.onToast?.(`WEAPON LV ${this.player.weaponLevel}`, 'good');
        } else {
          this.scoring.addFlat(500);
          this.events.onToast?.('WEAPON MAXED — +500', 'good');
        }
        break;
      }
      case 'shield': {
        if (this.player.shields < PLAYER.maxShields) {
          this.player.heal(1);
          this.events.onToast?.('SHIELD RESTORED', 'good');
        } else {
          this.scoring.addFlat(400);
          this.events.onToast?.('SHIELDS FULL — +400', 'good');
        }
        break;
      }
      case 'nova': {
        this.player.activateNova();
        this.shake.kick(0.5);
        this.audio.nova();
        this.events.onToast?.('NOVA OVERDRIVE', 'good');
        break;
      }
      case 'aegis': {
        this.player.activateGuard();
        this.shake.kick(0.3);
        this.audio.nova();
        this.events.onToast?.(`AEGIS GUARD ${GUARD.duration}s`, 'good');
        break;
      }
    }
  }

  // ------------------------------------------------------------------- fx

  private explode(x: number, y: number, z: number, scale: number, color: number): void {
    const count = Math.round(26 * scale * this.particles.quality);
    for (let i = 0; i < count; i++) {
      const speed = this.rng.range(6, 30) * scale;
      const theta = this.rng.range(0, Math.PI * 2);
      const phi = Math.acos(this.rng.range(-1, 1));
      this.particles.spawn({
        x,
        y,
        z,
        vx: Math.sin(phi) * Math.cos(theta) * speed,
        vy: Math.sin(phi) * Math.sin(theta) * speed,
        vz: Math.cos(phi) * speed * 0.5 + 8,
        life: this.rng.range(0.3, 0.8) * (0.7 + scale * 0.3),
        size: this.rng.range(0.5, 1.5) * scale,
        color: this.rng.chance(0.35) ? 0xfff0b0 : color,
        drag: 2.1,
      });
    }
    this.rings.spawn({
      x,
      y,
      z,
      life: 0.42 * (0.7 + scale * 0.35),
      from: 0.6 * scale,
      to: 6.5 * scale,
      color,
    });
  }

  // -------------------------------------------------------------- run end

  private endRun(): void {
    const isNew = this.scoring.score > this.highScore;
    if (isNew) {
      this.highScore = this.scoring.score;
      saveHighScore(this.highScore);
    }
    const summary: RunSummary = {
      score: this.scoring.score,
      highScore: this.highScore,
      isNewHighScore: isNew,
      wave: this.wave,
      kills: this.scoring.kills,
      bestCombo: this.scoring.bestCombo,
      timeSurvived: this.elapsed,
      seed: this.seed,
    };
    // Small delay so the death explosion is visible before the panel arrives.
    window.setTimeout(() => {
      if (this.disposed) return;
      this.setState('gameover');
      this.events.onGameOver?.(summary);
    }, 900);
  }

  private emitHud(): void {
    this.events.onHud?.({
      score: this.scoring.score,
      highScore: this.highScore,
      shields: this.player.shields,
      maxShields: PLAYER.maxShields,
      wave: this.wave,
      multiplier: this.scoring.multiplier,
      comboFrac: this.scoring.comboTimerFraction(),
      weaponLevel: this.player.weaponLevel,
      novaFrac: this.player.nova / PLAYER.novaDuration,
      waveFrac: waveProgress(this.elapsed),
      controlMode: this.lastControlMode,
      fps: this.fps,
      powerCharges: this.player.powerCharges,
      powerMax: POWER_WEAPON.charges,
      powerRechargeFrac:
        this.player.powerCharges < POWER_WEAPON.charges
          ? this.player.powerRecharge / POWER_WEAPON.rechargeInterval
          : 0,
      guardTime: this.player.guard,
      locked: this.lock !== null,
    });
  }

  // -------------------------------------------------------------- present

  private present(_dt: number): void {
    const boost = clamp(Math.abs(this.player.vx) / PLAYER.maxSpeed, 0, 1) * 0.5 +
      (this.state === 'playing' ? 0.5 : 0.15);

    this.renderer.syncPlayer(this.player, _dt);
    this.renderer.syncBullets(this.bullets.active);
    this.renderer.syncEnemies(this.enemies.active, _dt);
    this.renderer.syncPickups(this.pickups.active, _dt);
    this.renderer.syncLock(this.lock, _dt);
    this.renderer.syncParticles(this.particles, this.rings);
    this.renderer.updateEnvironment(_dt, boost);
    this.renderer.updateCamera(this.player.x, this.player.y, _dt);
    this.renderer.render();
  }
}

/** Small helper kept out of the class so it stays trivially testable. */
export const sweepPickups = (
  pickups: readonly Pickup[],
  player: Player,
  out: Pickup[],
): Pickup[] => {
  out.length = 0;
  for (const p of pickups) {
    if (!p.alive) continue;
    const dx = p.x - player.x;
    const dy = p.y - player.y;
    const dz = p.z - player.z;
    const r = p.radius + player.radius + 0.6;
    if (dx * dx + dy * dy + dz * dz <= r * r) out.push(p);
  }
  return out;
};

export const colorFor = (kind: EnemyT['kind']): number =>
  kind === 'grunt'
    ? 0xff5566
    : kind === 'darter'
      ? 0xff49c8
      : kind === 'tank'
        ? 0xffa23a
        : 0xb44dff;

export const colorForPickup = (kind: Pickup['kind']): number =>
  kind === 'weapon'
    ? 0x9dff6a
    : kind === 'shield'
      ? 0x4dc3ff
      : kind === 'nova'
        ? 0xffe14d
        : 0x59ffd8;
