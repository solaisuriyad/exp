import { describe, expect, it } from 'vitest';
import { WAVES } from '../src/core/config.js';
import {
  difficultyForWave,
  isBossWave,
  waveForElapsed,
  waveProgress,
} from '../src/systems/difficulty.js';

describe('difficulty curve', () => {
  it('starts at wave 1 with the base spawn interval', () => {
    const d = difficultyForWave(1);
    expect(d.wave).toBe(1);
    expect(d.spawnInterval).toBeCloseTo(WAVES.baseInterval, 6);
    expect(d.speedScale).toBe(1);
    expect(d.fireScale).toBe(1);
  });

  it('never returns a wave below 1 even for nonsense input', () => {
    expect(difficultyForWave(0).wave).toBe(1);
    expect(difficultyForWave(-7).wave).toBe(1);
    expect(difficultyForWave(2.9).wave).toBe(2);
  });

  it('spawns faster as waves climb, but never below the floor', () => {
    const intervals = [1, 3, 6, 10, 20, 60].map((w) => difficultyForWave(w).spawnInterval);
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]).toBeLessThanOrEqual(intervals[i - 1]!);
    }
    expect(intervals[intervals.length - 1]).toBeGreaterThanOrEqual(WAVES.minInterval);
  });

  it('caps the speed scale so wave 200 is not unplayable', () => {
    expect(difficultyForWave(200).speedScale).toBeLessThanOrEqual(WAVES.maxSpeedScale);
    expect(difficultyForWave(200).spawnInterval).toBe(WAVES.minInterval);
    expect(difficultyForWave(200).fireScale).toBeGreaterThanOrEqual(0.45);
  });

  it('introduces darters at wave 3 and tanks at wave 4', () => {
    expect(difficultyForWave(1).mix.darter).toBe(0);
    expect(difficultyForWave(2).mix.darter).toBe(0);
    expect(difficultyForWave(3).mix.darter).toBeGreaterThan(0);
    expect(difficultyForWave(1).mix.tank).toBe(0);
    expect(difficultyForWave(3).mix.tank).toBe(0);
    expect(difficultyForWave(4).mix.tank).toBeGreaterThan(0);
  });

  it('keeps grunts in the mix at every wave', () => {
    for (const w of [1, 5, 12, 40]) {
      expect(difficultyForWave(w).mix.grunt).toBe(1);
    }
  });
});

describe('wave timing', () => {
  it('maps elapsed time onto waves', () => {
    expect(waveForElapsed(0)).toBe(1);
    expect(waveForElapsed(WAVES.duration - 0.01)).toBe(1);
    expect(waveForElapsed(WAVES.duration)).toBe(2);
    expect(waveForElapsed(WAVES.duration * 3 + 1)).toBe(4);
  });

  it('never reports wave 0', () => {
    expect(waveForElapsed(-5)).toBe(1);
  });

  it('counts down within a wave', () => {
    expect(waveProgress(0)).toBeCloseTo(1, 6);
    expect(waveProgress(WAVES.duration / 2)).toBeCloseTo(0.5, 6);
    expect(waveProgress(WAVES.duration - 0.0001)).toBeLessThan(0.01);
  });

  it('flags every Nth wave as a boss wave', () => {
    expect(isBossWave(WAVES.bossEveryNthWave)).toBe(true);
    expect(isBossWave(WAVES.bossEveryNthWave * 2)).toBe(true);
    expect(isBossWave(1)).toBe(false);
    expect(isBossWave(0)).toBe(false);
    expect(isBossWave(-5)).toBe(false);
  });
});
