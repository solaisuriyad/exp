export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * Rescale `v` from [inLo, inHi] into [-1, 1], then apply a symmetric deadzone
 * so a slightly-off calibration centre does not drift the ship.
 *
 * The deadzone is applied in *input* space and the remainder is re-normalised,
 * which keeps full deflection at exactly +/-1 instead of squashing the range.
 */
export const deadzoneSteer = (
  v: number,
  maxAbs: number,
  deadzone: number,
): number => {
  if (maxAbs <= 0) return 0;
  const dz = clamp(deadzone, 0, maxAbs * 0.9);
  const span = maxAbs - dz;
  if (span <= 0) return 0;
  const magnitude = Math.abs(v) - dz;
  if (magnitude <= 0) return 0;
  const signed = Math.sign(v) * (magnitude / span);
  return clamp(signed, -1, 1);
};

/** Frame-rate independent exponential smoothing. */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-lambda * dt));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const invLerp = (a: number, b: number, v: number): number =>
  b === a ? 0 : clamp((v - a) / (b - a), 0, 1);

export const distSq2 = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};

/** Sphere/sphere overlap test on the XZ-ish plane used by the playfield. */
export const overlaps = (
  ax: number,
  ay: number,
  az: number,
  ar: number,
  bx: number,
  by: number,
  bz: number,
  br: number,
): boolean => {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  const r = ar + br;
  return dx * dx + dy * dy + dz * dz <= r * r;
};

/** Squared 3D distance — allocation-free, used by the collision sweep. */
export const distSq3 = (
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number => {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
};

export const formatScore = (n: number): string =>
  Math.max(0, Math.floor(n)).toLocaleString('en-US');

/** mm:ss — used for the survival timer on the game-over screen. */
export const formatTime = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};
