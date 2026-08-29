import { describe, expect, it } from 'vitest';
import {
  clamp,
  deadzoneSteer,
  distSq2,
  distSq3,
  formatScore,
  formatTime,
  invLerp,
  lerp,
  overlaps,
} from '../src/core/math.js';

describe('clamp', () => {
  it('bounds values on both ends', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});

describe('deadzoneSteer', () => {
  it('reads zero inside the deadzone', () => {
    expect(deadzoneSteer(0, 24, 3)).toBe(0);
    expect(deadzoneSteer(2.9, 24, 3)).toBe(0);
    expect(deadzoneSteer(-2.9, 24, 3)).toBe(0);
  });

  it('reaches full deflection at the limit, not beyond', () => {
    expect(deadzoneSteer(24, 24, 3)).toBeCloseTo(1, 6);
    expect(deadzoneSteer(-24, 24, 3)).toBeCloseTo(-1, 6);
    expect(deadzoneSteer(90, 24, 3)).toBe(1);
    expect(deadzoneSteer(-90, 24, 3)).toBe(-1);
  });

  it('re-normalises after the deadzone so mid-range is not squashed', () => {
    // With max 24 and deadzone 3, 13.5deg should sit just past halfway.
    const v = deadzoneSteer(13.5, 24, 3);
    expect(v).toBeCloseTo(10.5 / 21, 6);
  });

  it('preserves sign symmetry', () => {
    expect(deadzoneSteer(10, 24, 3)).toBeCloseTo(-deadzoneSteer(-10, 24, 3), 6);
  });

  it('degrades safely with a zero range or oversized deadzone', () => {
    expect(deadzoneSteer(5, 0, 3)).toBe(0);
    // Deadzone clamped to 90% of the range so a 1-unit span still steers.
    expect(deadzoneSteer(1.5, 3, 3)).toBe(0);
    expect(deadzoneSteer(3, 3, 3)).toBeCloseTo(1, 6);
  });
});

describe('lerp / invLerp', () => {
  it('interpolates', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(10, 0, 0.25)).toBe(7.5);
  });

  it('inverts and clamps', () => {
    expect(invLerp(0, 10, 5)).toBe(0.5);
    expect(invLerp(0, 10, -4)).toBe(0);
    expect(invLerp(0, 10, 40)).toBe(1);
    expect(invLerp(5, 5, 5)).toBe(0);
  });
});

describe('distance helpers', () => {
  it('computes squared 2D distance', () => {
    expect(distSq2(0, 0, 3, 4)).toBe(25);
  });

  it('computes squared 3D distance', () => {
    expect(distSq3(0, 0, 0, 1, 2, 2)).toBe(9);
  });

  it('detects sphere overlap including touching edges', () => {
    expect(overlaps(0, 0, 0, 1, 2, 0, 0, 1)).toBe(true);
    expect(overlaps(0, 0, 0, 1, 2.01, 0, 0, 1)).toBe(false);
    expect(overlaps(0, 0, 0, 1, 0, 0, 5, 4.5)).toBe(true); // r=5.5 > d=5
    expect(overlaps(0, 0, 0, 1, 0, 0, 5, 3.5)).toBe(false); // r=4.5 < d=5
  });
});

describe('formatters', () => {
  it('formats scores with separators and floors negatives', () => {
    expect(formatScore(1234567)).toBe('1,234,567');
    expect(formatScore(0)).toBe('0');
    expect(formatScore(-40)).toBe('0');
  });

  it('formats time as m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(-3)).toBe('0:00');
  });
});
