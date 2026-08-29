import { SCORING } from '../core/config.js';

/**
 * Score + combo tracking.
 *
 * Combo rises by `comboStep` per kill and resets to 1x on taking a hit. It
 * decays back to 1x once the player goes `comboTimeout` seconds without a kill,
 * which rewards sustained aggression rather than a single lucky streak.
 */
export class Scoring {
  private _score = 0;
  private _multiplier = 1;
  private _kills = 0;
  private _bestCombo = 1;
  private _sinceKill = 0;

  get score(): number {
    return this._score;
  }
  get multiplier(): number {
    return this._multiplier;
  }
  get kills(): number {
    return this._kills;
  }
  get bestCombo(): number {
    return this._bestCombo;
  }

  reset(): void {
    this._score = 0;
    this._multiplier = 1;
    this._kills = 0;
    this._bestCombo = 1;
    this._sinceKill = 0;
  }

  /** Award a kill. Returns the points actually granted. */
  addKill(basePoints: number): number {
    this._kills += 1;
    this._sinceKill = 0;
    const points = Math.round(basePoints * this._multiplier);
    this._score += points;
    this._multiplier = Math.min(
      SCORING.comboMax,
      this._multiplier + SCORING.comboStep,
    );
    this._bestCombo = Math.max(this._bestCombo, this._multiplier);
    return points;
  }

  /** Award flat points with no combo interaction (pickups, survival). */
  addFlat(points: number): void {
    this._score += Math.round(points);
  }

  onPlayerHit(): void {
    this._multiplier = 1;
  }

  update(dt: number): void {
    if (this._multiplier <= 1) {
      this._sinceKill = 0;
      return;
    }
    this._sinceKill += dt;
    if (this._sinceKill >= SCORING.comboTimeout) {
      this._multiplier = 1;
      this._sinceKill = 0;
    }
  }

  /** 0..1 for the combo decay ring in the HUD. */
  comboTimerFraction(): number {
    if (this._multiplier <= 1) return 0;
    return Math.max(0, 1 - this._sinceKill / SCORING.comboTimeout);
  }
}
