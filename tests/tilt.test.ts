import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TILT_CONFIG, orientationAxes, TiltInput } from '../src/input/tilt.js';

/**
 * TiltInput's maths is exercised directly via `feed()` + `sample()`. To make
 * `sample()` return real values it has to believe the sensor attached, so we
 * put it into the listening/supported state the same way `start()` would.
 */
const armed = (config: Partial<Parameters<typeof Object>[0]> = {}): TiltInput => {
  const t = new TiltInput(config as never);
  (t as unknown as { listening: boolean }).listening = true;
  (t as unknown as { support: string }).support = 'supported';
  (t as unknown as { seenEvent: boolean }).seenEvent = true;
  return t;
};

describe('TiltInput steering maths', () => {
  it('reads neutral at the calibrated centre', () => {
    const t = armed();
    t.feed(0, 40);
    t.beginCalibration();
    t.feed(0, 40);
    t.commitCalibration();
    t.feed(0, 40);
    const s = t.sample();
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
    expect(s.mode).toBe('tilt');
  });

  it('ignores small tilts inside the deadzone', () => {
    const t = armed();
    t.beginCalibration();
    t.feed(0, 0);
    t.commitCalibration();
    t.feed(2, 0);
    expect(t.sample().x).toBe(0);
  });

  it('reaches full deflection at maxTilt and clamps beyond it', () => {
    const t = armed({ maxTilt: 24, deadzone: 3 });
    t.beginCalibration();
    t.feed(0, 0);
    t.commitCalibration();
    t.feed(24, 0);
    expect(t.sample().x).toBeCloseTo(1, 6);
    t.feed(70, 0);
    expect(t.sample().x).toBe(1);
  });

  it('is sign-symmetric', () => {
    const t = armed();
    t.beginCalibration();
    t.feed(0, 0);
    t.commitCalibration();
    t.feed(12, 0);
    const right = t.sample().x;
    t.feed(-12, 0);
    const left = t.sample().x;
    expect(right).toBeCloseTo(-left, 6);
    expect(right).toBeGreaterThan(0);
  });

  it('maps tilting forward onto positive vertical steering', () => {
    const t = armed();
    t.beginCalibration();
    t.feed(0, 30);
    t.commitCalibration();
    t.feed(0, 30 - 20); // beta decreasing = nose down
    expect(t.sample().y).toBeGreaterThan(0);
    t.feed(0, 30 + 20); // beta increasing = nose up
    expect(t.sample().y).toBeLessThan(0);
  });

  it('subtracts a non-zero resting baseline', () => {
    const t = armed();
    t.beginCalibration();
    // Player naturally holds the phone 11 degrees right.
    for (let i = 0; i < 10; i++) t.feed(11, 45);
    const r = t.commitCalibration();
    expect(r).not.toBeNull();
    expect(r!.gamma).toBeCloseTo(11, 6);
    expect(r!.beta).toBeCloseTo(45, 6);
    t.feed(11, 45);
    expect(t.sample().x).toBe(0);
    t.feed(11 + 24, 45);
    expect(t.sample().x).toBeCloseTo(1, 6);
  });

  it('honours the invert flags', () => {
    const t = armed({ invertX: true, invertY: true });
    t.beginCalibration();
    t.feed(0, 0);
    t.commitCalibration();
    t.feed(20, 0);
    expect(t.sample().x).toBeLessThan(0);
  });

  it('restores a previously saved calibration', () => {
    const t = armed();
    t.restoreCalibration(7, 33);
    expect(t.isCalibrated).toBe(true);
    t.feed(7, 33);
    expect(t.sample().x).toBe(0);
    expect(t.rawX).toBeCloseTo(0, 6);
  });

  it('leaves the baseline alone when committed with no samples', () => {
    const t = armed();
    t.restoreCalibration(5, 5);
    t.beginCalibration();
    expect(t.commitCalibration()).toBeNull();
    t.feed(5, 5);
    expect(t.sample().x).toBe(0);
  });

  it('returns mode none when the sensor is not listening', () => {
    const t = new TiltInput();
    expect(t.sample().mode).toBe('none');
    expect(t.sample().x).toBe(0);
  });

  it('ignores null sensor readings instead of NaN-ing the ship position', () => {
    const t = armed();
    t.beginCalibration();
    t.feed(0, 0);
    t.commitCalibration();
    t.feed(20, 0);
    const before = t.sample().x;
    t.feed(Number.NaN, Number.NaN);
    expect(t.sample().x).toBe(before); // last good value retained
  });

  it('gives up after too many null events', () => {
    const removed: string[] = [];
    vi.stubGlobal('window', {
      addEventListener: () => {},
      removeEventListener: (type: string) => removed.push(type),
      setTimeout: () => 0,
    });
    const t = armed({ nullGraceEvents: 3 });
    for (let i = 0; i < 4; i++) t.feed(Number.NaN, Number.NaN);
    expect(t.support).toBe('unavailable');
    expect(t.isListening).toBe(false);
    expect(removed).toContain('deviceorientation');
    expect(t.sample().mode).toBe('none');
    vi.unstubAllGlobals();
  });
});

describe('orientationAxes', () => {
  it('maps portrait straight through', () => {
    const a = orientationAxes(0);
    expect(a.axisGamma.signX).toBe(1);
    expect(a.axisBeta.signY).toBe(1);
  });

  it('swaps and flips in landscape', () => {
    expect(orientationAxes(90).axisGamma.signX).toBe(-1);
    expect(orientationAxes(270).axisGamma.signX).toBe(1);
  });

  it('flips both axes upside down', () => {
    expect(orientationAxes(180).axisGamma.signX).toBe(-1);
  });

  it('normalises out-of-range angles', () => {
    expect(orientationAxes(450).axisGamma.signX).toBe(orientationAxes(90).axisGamma.signX);
    expect(orientationAxes(-270).axisGamma.signX).toBe(orientationAxes(90).axisGamma.signX);
  });
});

describe('TiltInput environment probing', () => {
  it('reports no API and no permission gate when DeviceOrientationEvent is absent', () => {
    // Node has no DeviceOrientationEvent, which is exactly the desktop case.
    expect(TiltInput.hasApi()).toBe(false);
    expect(TiltInput.needsPermission()).toBe(false);
  });

  it('start() resolves to unavailable when there is no sensor API', async () => {
    const t = new TiltInput();
    await expect(t.start()).resolves.toBe('unavailable');
    expect(t.isListening).toBe(false);
  });

  it('exposes the default config for the UI to display', () => {
    expect(DEFAULT_TILT_CONFIG.maxTilt).toBeGreaterThan(DEFAULT_TILT_CONFIG.deadzone);
    expect(DEFAULT_TILT_CONFIG.deadzone).toBeGreaterThan(0);
  });

  it('updateConfig patches without dropping other fields', () => {
    const t = new TiltInput({ maxTilt: 30, deadzone: 5 });
    t.updateConfig({ deadzone: 2 });
    expect(t.maxTilt).toBe(30);
  });
});

describe('TiltInput.start with a stubbed sensor', () => {
  it('attaches and reports supported when events arrive', async () => {
    const listeners: Array<(ev: unknown) => void> = [];
    const win = {
      addEventListener: (_type: string, fn: (ev: unknown) => void) => listeners.push(fn),
      removeEventListener: (type: string, fn: (ev: unknown) => void) => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
        void type;
      },
      setTimeout: (fn: () => void) => {
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      },
    };
    vi.stubGlobal('window', win);
    vi.stubGlobal('DeviceOrientationEvent', class {});
    vi.stubGlobal('screen', { orientation: { angle: 0 } });

    const t = new TiltInput();
    const promise = t.start();
    // Simulate the sensor firing before the 400ms probe window closes.
    for (const fn of listeners) fn({ gamma: 3, beta: 40, alpha: null, absolute: false });
    await expect(promise).resolves.toBe('supported');
    expect(t.isListening).toBe(true);

    vi.unstubAllGlobals();
  });

  it('reports unavailable when the sensor never fires', async () => {
    const win = {
      addEventListener: () => {},
      removeEventListener: () => {},
      setTimeout: (fn: () => void) => {
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      },
    };
    vi.stubGlobal('window', win);
    vi.stubGlobal('DeviceOrientationEvent', class {});
    vi.stubGlobal('screen', { orientation: { angle: 0 } });

    const t = new TiltInput();
    await expect(t.start()).resolves.toBe('unavailable');
    expect(t.isListening).toBe(false);

    vi.unstubAllGlobals();
  });
});
