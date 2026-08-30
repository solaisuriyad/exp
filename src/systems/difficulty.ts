import { WAVES } from '../core/config.js';

export interface DifficultySnapshot {
  wave: number;
  /** Seconds between spawn attempts. */
  spawnInterval: number;
  /** Multiplier applied to each enemy archetype's base speed. */
  speedScale: number;
  /** Multiplier applied to enemy fire rate (lower = shoots more often). */
  fireScale: number;
  /** Relative likelihood weights per archetype for this wave. */
  mix: { grunt: number; darter: number; tank: number; stinger: number; mine: number };
}

const clampNum = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * Pure difficulty curve. Wave 1 starts gentle; by wave ~15 the curve is
 * saturated and later waves escalate through density rather than raw speed.
 */
export const difficultyForWave = (wave: number): DifficultySnapshot => {
  const w = Math.max(1, Math.floor(wave));
  const t = w - 1;

  const spawnInterval = Math.max(
    WAVES.minInterval,
    WAVES.baseInterval * Math.pow(0.925, t),
  );

  const speedScale = clampNum(
    1 + t * WAVES.speedScalePerWave,
    1,
    WAVES.maxSpeedScale,
  );

  const fireScale = clampNum(1 - t * 0.035, 0.45, 1);

  return {
    wave: w,
    spawnInterval,
    speedScale,
    fireScale,
    mix: {
      grunt: 1,
      // Stingers from wave 2, darters wave 3, mines + tanks wave 4.
      stinger: w >= 2 ? clampNum(0.3 + (w - 2) * 0.06, 0, 0.7) : 0,
      darter: w >= 3 ? clampNum(0.25 + (w - 3) * 0.09, 0, 0.85) : 0,
      tank: w >= 4 ? clampNum(0.1 + (w - 4) * 0.05, 0, 0.45) : 0,
      mine: w >= 4 ? clampNum(0.15 + (w - 4) * 0.04, 0, 0.5) : 0,
    },
  };
};

export const waveForElapsed = (elapsed: number): number =>
  Math.max(1, Math.floor(elapsed / WAVES.duration) + 1);

export const isBossWave = (wave: number): boolean =>
  wave > 0 && wave % WAVES.bossEveryNthWave === 0;

/** Seconds remaining in the current wave, for the HUD progress bar. */
export const waveProgress = (elapsed: number): number => {
  const into = elapsed % WAVES.duration;
  return 1 - into / WAVES.duration;
};
