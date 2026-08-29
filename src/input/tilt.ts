import { clamp, deadzoneSteer } from '../core/math.js';
import type { ControlMode } from '../core/types.js';

/**
 * Tilt (gyroscope/accelerometer) steering with a touch-drag fallback.
 *
 * Realities this has to survive on an actual Android phone:
 *
 *  1. **Permissions** — on iOS 13+ `DeviceOrientationEvent.requestPermission()`
 *     must be called from a user gesture, and it rejects if called twice. On
 *     Android Chrome no permission is needed, but a cross-origin iframe (like
 *     this in-chat preview) is blocked unless it carries the
 *     `allow="gyroscope; accelerometer"` Permissions-Policy.
 *  2. **Orientation** — `gamma` is only left/right tilt in portrait. In
 *     landscape the axes swap and one of them flips, so we remap using
 *     `screen.orientation.angle` rather than assuming portrait.
 *  3. **Handshake** — the player's natural resting angle is not zero, so we
 *     sample a baseline over a short window and subtract it.
 *  4. **Nulls** — desktop browsers and locked-down WebViews fire the event with
 *     null values, or never fire at all. Either way we must fall back to touch
 *     instead of freezing the ship at centre.
 *
 * The class is dependency-free and DOM-agnostic apart from the listener
 * attach/detach, so the maths is unit-testable in Node.
 */

type OrientationListener = (ev: DeviceOrientationEvent) => void;

type HostWindow = {
  addEventListener: (type: string, fn: (ev: never) => void, capture: boolean) => void;
  removeEventListener: (type: string, fn: (ev: never) => void, capture: boolean) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
};

const hostWindow = (): HostWindow | null =>
  typeof window === 'undefined' ? null : (window as unknown as HostWindow);

export interface TiltConfig {
  /** Degrees of tilt that maps to full deflection. */
  maxTilt: number;
  /** Degrees around the calibrated centre that read as "hands steady". */
  deadzone: number;
  /** Invert the horizontal axis. */
  invertX: boolean;
  invertY: boolean;
  /** Ignore events whose values are all null (treated as unsupported). */
  nullGraceEvents: number;
}

export const DEFAULT_TILT_CONFIG: TiltConfig = {
  maxTilt: 24,
  deadzone: 3,
  invertX: false,
  invertY: false,
  nullGraceEvents: 6,
};

export type TiltSupport = 'unknown' | 'supported' | 'denied' | 'unavailable';

export class TiltInput {
  private config: TiltConfig;
  private listening = false;
  private seenEvent = false;
  private nullStreak = 0;

  private gamma = 0;
  private beta = 0;
  private baselineGamma = 0;
  private baselineBeta = 0;
  private calibrated = false;

  private calibSamples = 0;
  private calibSumGamma = 0;
  private calibSumBeta = 0;
  private capturingCalibration = false;

  support: TiltSupport = 'unknown';

  private readonly listener: OrientationListener;

  constructor(config: Partial<TiltConfig> = {}) {
    this.config = { ...DEFAULT_TILT_CONFIG, ...config };
    this.listener = (ev) => this.onEvent(ev);
  }

  /** True when the platform exposes a permission gate that must be unlocked. */
  static needsPermission(): boolean {
    return (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown })
        .requestPermission === 'function'
    );
  }

  static hasApi(): boolean {
    return typeof DeviceOrientationEvent !== 'undefined';
  }

  /**
   * Begin listening. Call from a user gesture so the iOS permission prompt is
   * allowed to appear.
   */
  async start(): Promise<TiltSupport> {
    if (!TiltInput.hasApi()) {
      this.support = 'unavailable';
      return this.support;
    }
    if (this.listening) return this.support === 'unknown' ? 'supported' : this.support;

    if (TiltInput.needsPermission()) {
      try {
        const result = await (
          DeviceOrientationEvent as unknown as {
            requestPermission: () => Promise<PermissionState>;
          }
        ).requestPermission();
        if (result !== 'granted') {
          this.support = 'denied';
          return this.support;
        }
      } catch {
        this.support = 'denied';
        return this.support;
      }
    }

    try {
      hostWindow()?.addEventListener('deviceorientation', this.listener, true);
      this.listening = true;
    } catch {
      this.support = 'unavailable';
      return this.support;
    }

    // Give the sensor a moment; if nothing arrives, it is not really usable.
    await new Promise<void>((resolve) => {
      const w = hostWindow();
      if (w) w.setTimeout(() => resolve(), 400);
      else setTimeout(() => resolve(), 400);
    });

    if (!this.seenEvent) {
      this.support = 'unavailable';
      this.stop();
      return this.support;
    }
    if (this.nullStreak >= this.config.nullGraceEvents) {
      this.support = 'unavailable';
      this.stop();
      return this.support;
    }

    this.support = 'supported';
    return this.support;
  }

  stop(): void {
    if (!this.listening) return;
    // Guarded: the sensor can drop out (or the class can be unit-tested in a
    // DOM-less environment) and stop() must never throw.
    hostWindow()?.removeEventListener('deviceorientation', this.listener, true);
    this.listening = false;
  }

  get isListening(): boolean {
    return this.listening;
  }

  /** Begin averaging samples into a new resting baseline. */
  beginCalibration(): void {
    this.capturingCalibration = true;
    this.calibSamples = 0;
    this.calibSumGamma = 0;
    this.calibSumBeta = 0;
  }

  get isCalibrating(): boolean {
    return this.capturingCalibration;
  }

  /**
   * Lock in whatever has been sampled as the neutral centre.
   * Safe to call with zero samples — the baseline is left untouched.
   */
  commitCalibration(): { gamma: number; beta: number } | null {
    this.capturingCalibration = false;
    if (this.calibSamples === 0) return null;
    this.baselineGamma = this.calibSumGamma / this.calibSamples;
    this.baselineBeta = this.calibSumBeta / this.calibSamples;
    this.calibrated = true;
    return { gamma: this.baselineGamma, beta: this.baselineBeta };
  }

  restoreCalibration(gamma: number, beta: number): void {
    this.baselineGamma = gamma;
    this.baselineBeta = beta;
    this.calibrated = true;
  }

  get isCalibrated(): boolean {
    return this.calibrated;
  }

  /** Raw signed degrees after baseline subtraction, for the calibration HUD. */
  get rawX(): number {
    return this.gamma - this.baselineGamma;
  }
  get rawY(): number {
    return this.beta - this.baselineBeta;
  }

  private onEvent(ev: DeviceOrientationEvent): void {
    this.seenEvent = true;
    const g = ev.gamma;
    const b = ev.beta;
    if (g === null || b === null || Number.isNaN(g) || Number.isNaN(b)) {
      this.nullStreak += 1;
      if (this.nullStreak >= this.config.nullGraceEvents) {
        this.support = 'unavailable';
        this.stop();
      }
      return;
    }
    this.nullStreak = 0;
    this.gamma = g;
    this.beta = b;

    if (this.capturingCalibration) {
      this.calibSumGamma += g;
      this.calibSumBeta += b;
      this.calibSamples += 1;
    }
  }

  /** Feed a synthetic sample — used by tests and by the debug overlay. */
  feed(gamma: number, beta: number): void {
    this.onEvent({ gamma, beta, alpha: null, absolute: false } as DeviceOrientationEvent);
  }

  /** Current steering as -1..1 on each axis. */
  sample(): { x: number; y: number; mode: ControlMode } {
    if (!this.listening || this.support === 'unavailable' || this.support === 'denied') {
      return { x: 0, y: 0, mode: 'none' };
    }
    const { axisGamma, axisBeta } = orientationAxes();
    const gx = this.rawX * axisGamma.signX;
    const by = this.rawY * axisBeta.signY;
    return {
      x: deadzoneSteer(
        this.config.invertX ? -gx : gx,
        this.config.maxTilt,
        this.config.deadzone,
      ),
      y: deadzoneSteer(
        this.config.invertY ? by : -by,
        this.config.maxTilt,
        this.config.deadzone,
      ),
      mode: 'tilt' as ControlMode,
    };
  }

  updateConfig(patch: Partial<TiltConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  get maxTilt(): number {
    return this.config.maxTilt;
  }
}

/**
 * Map device tilt axes onto screen axes for the current display rotation.
 *
 * Portrait (0):   gamma = left/right, beta = forward/back
 * Landscape (90): axes swap; beta becomes left/right and inverts
 * Portrait upside-down (180): both invert
 * Landscape (270): axes swap, gamma inverts
 */
export const orientationAxes = (angle?: number): {
  axisGamma: { signX: number };
  axisBeta: { signY: number };
} => {
  const a = angle ?? screenAngle();
  switch (((a % 360) + 360) % 360) {
    case 90:
      return { axisGamma: { signX: -1 }, axisBeta: { signY: -1 } };
    case 180:
      return { axisGamma: { signX: -1 }, axisBeta: { signY: 1 } };
    case 270:
      return { axisGamma: { signX: 1 }, axisBeta: { signY: -1 } };
    default:
      return { axisGamma: { signX: 1 }, axisBeta: { signY: 1 } };
  }
};

const screenAngle = (): number => {
  try {
    if (typeof screen !== 'undefined' && screen.orientation) {
      return screen.orientation.angle ?? 0;
    }
    if (typeof window !== 'undefined') return window.orientation ?? 0;
  } catch {
    /* ignore */
  }
  return 0;
};

/**
 * Touch-drag steering: drag anywhere on the lower two-thirds of the screen and
 * the ship follows the finger relative to where the drag started. Works in every
 * browser, which makes it the reliable fallback (and the way to play in the
 * desktop preview).
 */
export class TouchSteer {
  private active = false;
  private startX = 0;
  private startY = 0;
  private curX = 0;
  private curY = 0;
  private pointerId: number | null = null;
  /** Pixels of drag that map to full deflection. */
  private readonly span: number;

  private readonly onDown: (e: PointerEvent) => void;
  private readonly onMove: (e: PointerEvent) => void;
  private readonly onUp: (e: PointerEvent) => void;

  constructor(span = 130) {
    this.span = span;
    this.onDown = (e) => this.down(e);
    this.onMove = (e) => this.move(e);
    this.onUp = (e) => this.up(e);
  }

  attach(target: HTMLElement): void {
    target.addEventListener('pointerdown', this.onDown);
    target.addEventListener('pointermove', this.onMove);
    target.addEventListener('pointerup', this.onUp);
    target.addEventListener('pointercancel', this.onUp);
  }

  detach(target: HTMLElement): void {
    target.removeEventListener('pointerdown', this.onDown);
    target.removeEventListener('pointermove', this.onMove);
    target.removeEventListener('pointerup', this.onUp);
    target.removeEventListener('pointercancel', this.onUp);
  }

  private down(e: PointerEvent): void {
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.active = true;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.curX = e.clientX;
    this.curY = e.clientY;
  }

  private move(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.curX = e.clientX;
    this.curY = e.clientY;
  }

  private up(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.active = false;
  }

  get isActive(): boolean {
    return this.active;
  }

  sample(): { x: number; y: number } {
    if (!this.active) return { x: 0, y: 0 };
    return {
      x: clamp((this.curX - this.startX) / this.span, -1, 1),
      // Screen Y grows downward; steering up should be +1.
      y: clamp((this.startY - this.curY) / this.span, -1, 1),
    };
  }

  /** Force-release, e.g. when the app backgrounds mid-drag. */
  reset(): void {
    this.pointerId = null;
    this.active = false;
  }
}
