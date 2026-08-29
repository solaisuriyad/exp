import { describe, expect, it } from 'vitest';
import { SCORING } from '../src/core/config.js';
import { Scoring } from '../src/systems/scoring.js';

describe('Scoring', () => {
  it('starts at zero with a 1x multiplier', () => {
    const s = new Scoring();
    s.reset();
    expect(s.score).toBe(0);
    expect(s.multiplier).toBe(1);
    expect(s.kills).toBe(0);
  });

  it('awards base points on the first kill', () => {
    const s = new Scoring();
    s.reset();
    expect(s.addKill(100)).toBe(100);
    expect(s.score).toBe(100);
    expect(s.kills).toBe(1);
  });

  it('ramps the multiplier on a streak and applies it to the next kill', () => {
    const s = new Scoring();
    s.reset();
    s.addKill(100); // mult 1.00 -> 1.25
    expect(s.multiplier).toBeCloseTo(1 + SCORING.comboStep, 6);
    const pts = s.addKill(100);
    expect(pts).toBe(Math.round(100 * (1 + SCORING.comboStep)));
    expect(s.score).toBe(100 + pts);
  });

  it('caps the multiplier at comboMax', () => {
    const s = new Scoring();
    s.reset();
    for (let i = 0; i < 200; i++) s.addKill(10);
    expect(s.multiplier).toBe(SCORING.comboMax);
    expect(s.bestCombo).toBe(SCORING.comboMax);
  });

  it('resets the multiplier when the player is hit', () => {
    const s = new Scoring();
    s.reset();
    for (let i = 0; i < 10; i++) s.addKill(10);
    expect(s.multiplier).toBeGreaterThan(1);
    s.onPlayerHit();
    expect(s.multiplier).toBe(1);
  });

  it('decays the multiplier after the combo timeout', () => {
    const s = new Scoring();
    s.reset();
    s.addKill(100);
    expect(s.multiplier).toBeGreaterThan(1);
    s.update(SCORING.comboTimeout + 0.01);
    expect(s.multiplier).toBe(1);
  });

  it('does not decay while kills keep coming', () => {
    const s = new Scoring();
    s.reset();
    s.addKill(100);
    s.update(SCORING.comboTimeout * 0.9);
    expect(s.multiplier).toBeGreaterThan(1);
    s.addKill(100); // resets the decay timer
    s.update(SCORING.comboTimeout * 0.9);
    expect(s.multiplier).toBeGreaterThan(1);
  });

  it('reports the combo timer as a 0..1 fraction', () => {
    const s = new Scoring();
    s.reset();
    expect(s.comboTimerFraction()).toBe(0);
    s.addKill(100);
    expect(s.comboTimerFraction()).toBe(1);
    s.update(SCORING.comboTimeout / 2);
    expect(s.comboTimerFraction()).toBeCloseTo(0.5, 5);
  });

  it('adds flat points without touching the combo', () => {
    const s = new Scoring();
    s.reset();
    s.addFlat(250.6);
    expect(s.score).toBe(251);
    expect(s.multiplier).toBe(1);
  });

  it('rounds awarded points to whole numbers', () => {
    const s = new Scoring();
    s.reset();
    s.addKill(100);
    const pts = s.addKill(33); // 33 * 1.25 = 41.25
    expect(Number.isInteger(pts)).toBe(true);
    expect(pts).toBe(41);
  });
});
