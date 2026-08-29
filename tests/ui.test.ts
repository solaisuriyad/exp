// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Ui, type UiHandlers } from '../src/ui/hud.js';

/**
 * Boots the DOM UI layer in jsdom exactly the way main.ts does.
 *
 * This test exists because a self-referencing helper once shipped and only a
 * real DOM construction would have caught the resulting stack overflow.
 */

const noopHandlers = (): UiHandlers => ({
  onStart: vi.fn(),
  onResume: vi.fn(),
  onPause: vi.fn(),
  onMenu: vi.fn(),
  onToggleBloom: vi.fn(),
  onToggleMusic: vi.fn(),
  onToggleSfx: vi.fn(),
  onToggleAutofire: vi.fn(),
  onControlPreference: vi.fn(),
  onCalibrate: vi.fn(),
  onCommitCalibration: vi.fn(),
  onCancelCalibration: vi.fn(),
});

let parent: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  parent = document.createElement('div');
  document.body.appendChild(parent);
});

describe('Ui construction', () => {
  it('constructs without throwing (no infinite recursion)', () => {
    expect(() => new Ui(parent, noopHandlers())).not.toThrow();
  });

  it('mounts the title menu with the launch button visible', () => {
    new Ui(parent, noopHandlers());
    const launch = [...parent.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('LAUNCH'),
    );
    expect(launch).toBeTruthy();
    const title = parent.querySelector('.title');
    expect(title?.textContent).toContain('STARFALL');
  });

  it('builds every screen the game switches between', () => {
    const ui = new Ui(parent, noopHandlers());
    for (const name of ['menu', 'gameover', 'paused', 'calibrate', 'none'] as const) {
      expect(() => ui.showScreen(name)).not.toThrow();
    }
  });

  it('shows the HUD when a run is live', () => {
    const ui = new Ui(parent, noopHandlers());
    ui.showScreen('none');
    expect(parent.querySelector('.hud')?.classList.contains('hidden')).toBe(false);
    expect(parent.querySelector('.hud-score')).toBeTruthy();
  });
});

describe('Ui live updates', () => {
  it('renders a HUD snapshot without throwing', () => {
    const ui = new Ui(parent, noopHandlers());
    ui.showScreen('none');
    expect(() =>
      ui.updateHud({
        score: 12345,
        highScore: 99999,
        shields: 2,
        maxShields: 5,
        wave: 3,
        multiplier: 1.75,
        comboFrac: 0.5,
        weaponLevel: 2,
        novaFrac: 0,
        waveFrac: 0.4,
        controlMode: 'touch',
        fps: 60,
      }),
    ).not.toThrow();
    expect(parent.querySelector('.hud-score')?.textContent).toBe('12,345');
    expect(parent.querySelector('.hud-wave')?.textContent).toBe('WAVE 3');
    // Shield pips: 5 built, 2 live, 3 spent.
    const pips = [...parent.querySelectorAll('.pip')];
    expect(pips).toHaveLength(5);
    expect(pips.filter((p) => p.classList.contains('live'))).toHaveLength(2);
    expect(pips.filter((p) => p.classList.contains('spent'))).toHaveLength(3);
  });

  it('updates the boss bar and hides it when max is null', () => {
    const ui = new Ui(parent, noopHandlers());
    ui.setBoss(120, 220);
    const wrap = parent.querySelector('.boss-wrap');
    expect(wrap?.classList.contains('hidden')).toBe(false);
    ui.setBoss(0, null);
    expect(wrap?.classList.contains('hidden')).toBe(true);
  });

  it('fills the game-over panel from a run summary', () => {
    const ui = new Ui(parent, noopHandlers());
    ui.showScreen('gameover');
    ui.showGameOver({
      score: 42000,
      highScore: 42000,
      isNewHighScore: true,
      wave: 6,
      kills: 87,
      bestCombo: 3.5,
      timeSurvived: 125,
      seed: 4242,
    });
    expect(parent.querySelector('.over-score')?.textContent).toBe('42,000');
    expect(parent.querySelector('.badge')?.classList.contains('hidden')).toBe(false);
    expect(parent.querySelector('.over-stats')?.textContent).toContain('2:05');
  });

  it('toasts without exploding', () => {
    vi.useFakeTimers();
    const ui = new Ui(parent, noopHandlers());
    expect(() => {
      ui.toast('WAVE 2', 'info');
      ui.toast('SHIELD HIT', 'bad');
    }).not.toThrow();
    expect(parent.querySelectorAll('.toast').length).toBe(2);
    vi.advanceTimersByTime(2000);
    expect(parent.querySelectorAll('.toast').length).toBe(0);
    vi.useRealTimers();
  });

  it('wires toggle rows to their callbacks', () => {
    const handlers = noopHandlers();
    const onBloom = handlers.onToggleBloom as ReturnType<typeof vi.fn>;
    new Ui(parent, handlers);
    const row = [...parent.querySelectorAll('.toggle-row')].find((r) =>
      r.textContent?.includes('GLOW (BLOOM)'),
    )!;
    const button = row.querySelector('.toggle-btn') as HTMLButtonElement;
    expect(button.classList.contains('on')).toBe(true);
    button.click();
    expect(onBloom).toHaveBeenCalledWith(false);
    button.click();
    expect(onBloom).toHaveBeenCalledWith(true);
  });

  it('streams calibration readouts into the bubble screen', () => {
    const ui = new Ui(parent, noopHandlers());
    ui.showScreen('calibrate');
    expect(() => ui.setTiltReadout(12.3, -4.1, 'Sensor live.', true)).not.toThrow();
    expect(parent.querySelector('.tilt-readout')?.textContent).toContain('12.3');
  });
});
