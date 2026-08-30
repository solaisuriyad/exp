import { formatScore, formatTime } from '../core/math.js';
import type { ControlMode } from '../core/types.js';
import type { HudSnapshot, RunSummary } from '../game.js';

/**
 * DOM overlay UI.
 *
 * Rendered as HTML/CSS rather than in-scene geometry: it stays pixel-crisp at
 * every DPI, is far cheaper than extra draw calls, and reflows correctly when
 * the device rotates.
 */

const el = (tag: string, cls: string, parent?: HTMLElement): HTMLElement => {
  const node = document.createElement(tag);
  node.className = cls;
  parent?.appendChild(node);
  return node;
};

const btn = (cls: string, parent: HTMLElement): HTMLButtonElement =>
  el('button', cls, parent) as HTMLButtonElement;

export interface UiHandlers {
  onStart: () => void;
  onResume: () => void;
  onPause: () => void;
  onMenu: () => void;
  onToggleBloom: (on: boolean) => void;
  onToggleMusic: (on: boolean) => void;
  onToggleSfx: (on: boolean) => void;
  onToggleAutofire: (on: boolean) => void;
  onControlPreference: (pref: 'auto' | 'tilt' | 'touch') => void;
  onSelectShip: (ship: 'vector' | 'lance' | 'bastion') => void;
  onPower: () => void;
  onCalibrate: () => void;
  onCommitCalibration: () => void;
  onCancelCalibration: () => void;
}

export class Ui {
  readonly root: HTMLElement;

  private scoreNode!: HTMLElement;
  private highNode!: HTMLElement;
  private multNode!: HTMLElement;
  private comboBar!: HTMLElement;
  private waveNode!: HTMLElement;
  private waveBar!: HTMLElement;
  private pips!: HTMLElement;
  private weaponNode!: HTMLElement;
  private novaNode!: HTMLElement;
  private modeNode!: HTMLElement;
  private fpsNode!: HTMLElement;

  private hud!: HTMLElement;
  private menuScreen!: HTMLElement;
  private gameoverScreen!: HTMLElement;
  private pauseScreen!: HTMLElement;
  private calibrateScreen!: HTMLElement;
  private toastWrap!: HTMLElement;
  private damageFlash!: HTMLElement;
  private countdownNode!: HTMLElement;
  private bossWrap!: HTMLElement;
  private bossBar!: HTMLElement;
  private menuHighNode!: HTMLElement;
  private overScoreNode!: HTMLElement;
  private overStatsNode!: HTMLElement;
  private overBadgeNode!: HTMLElement;
  private tiltBubble!: HTMLElement;
  private tiltReadout!: HTMLElement;
  private tiltStatusNode!: HTMLElement;
  private modeChip!: HTMLElement;
  private powerWrap!: HTMLElement;
  private powerPips!: HTMLElement;
  private powerBar!: HTMLElement;
  private aegisNode!: HTMLElement;
  private lockChip!: HTMLElement;

  private toastTimer: number | null = null;
  private countdownValue = -1;

  constructor(parent: HTMLElement, private readonly handlers: UiHandlers) {
    this.root = el('div', 'ui-root', parent);
    this.buildHud();
    this.buildBossBar();
    this.buildToasts();
    this.buildMenu();
    this.buildPause();
    this.buildCalibrate();
    this.buildGameOver();
  }

  // ------------------------------------------------------------------ build

  private buildHud(): void {
    this.hud = el('div', 'hud hidden', this.root);

    const topLeft = el('div', 'hud-block hud-tl', this.hud);
    el('div', 'hud-label', topLeft).textContent = 'SCORE';
    this.scoreNode = el('div', 'hud-score', topLeft);
    this.scoreNode.textContent = '0';
    this.highNode = el('div', 'hud-high', topLeft);
    this.highNode.textContent = 'BEST 0';

    const topRight = el('div', 'hud-block hud-tr', this.hud);
    el('div', 'hud-label', topRight).textContent = 'SHIELDS';
    this.pips = el('div', 'pips', topRight);
    this.waveNode = el('div', 'hud-wave', topRight);
    this.waveNode.textContent = 'WAVE 1';
    this.waveBar = el('div', 'wave-bar', topRight);
    const waveFill = el('div', 'wave-fill', this.waveBar);
    waveFill.style.width = '100%';

    const bottomLeft = el('div', 'hud-block hud-bl', this.hud);
    this.multNode = el('div', 'mult', bottomLeft);
    this.multNode.textContent = 'x1.00';
    this.comboBar = el('div', 'combo-bar', bottomLeft);
    const comboFill = el('div', 'combo-fill', this.comboBar);
    comboFill.style.width = '0%';
    this.weaponNode = el('div', 'weapon', bottomLeft);
    this.weaponNode.textContent = 'WPN LV 1';

    const bottomRight = el('div', 'hud-block hud-br', this.hud);
    this.novaNode = el('div', 'nova hidden', bottomRight);
    this.novaNode.textContent = 'NOVA';
    this.fpsNode = el('div', 'fps', bottomRight);
    this.fpsNode.textContent = '60 FPS';

    this.modeChip = el('div', 'mode-chip', this.hud);
    this.modeNode = el('span', 'mode-text', this.modeChip);
    this.modeNode.textContent = 'TILT';

    // AEGIS countdown under the shield pips.
    this.aegisNode = el('div', 'aegis hidden', topRight);
    this.aegisNode.textContent = 'AEGIS 30s';

    // POWER button with its 5-charge magazine.
    this.powerWrap = el('div', 'power-wrap', this.hud);
    const powerBtn = btn('power-btn', this.powerWrap);
    powerBtn.type = 'button';
    powerBtn.setAttribute('aria-label', 'Fire power shot');
    powerBtn.textContent = 'PWR';
    powerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handlers.onPower();
    });
    this.powerPips = el('div', 'power-pips', this.powerWrap);
    for (let i = 0; i < 5; i++) el('span', 'ppip', this.powerPips);
    this.powerBar = el('div', 'power-bar', this.powerWrap);
    el('div', 'power-fill', this.powerBar);

    this.lockChip = el('div', 'lock-chip hidden', this.hud);
    this.lockChip.textContent = '◈ LOCK';

    const pauseBtn = btn('pause-btn', this.hud);
    pauseBtn.type = 'button';
    pauseBtn.setAttribute('aria-label', 'Pause');
    pauseBtn.innerHTML = '<span></span><span></span>';
    pauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handlers.onPause();
    });

    this.countdownNode = el('div', 'countdown hidden', this.root);

    this.damageFlash = el('div', 'damage-flash', this.root);
  }

  private buildBossBar(): void {
    this.bossWrap = el('div', 'boss-wrap hidden', this.root);
    el('div', 'boss-label', this.bossWrap).textContent = 'CAPITAL SHIP';
    this.bossBar = el('div', 'boss-bar', this.bossWrap);
    const fill = el('div', 'boss-fill', this.bossBar);
    fill.style.width = '100%';
  }

  private buildToasts(): void {
    this.toastWrap = el('div', 'toast-wrap', this.root);
  }

  private toggleRow(
    parent: HTMLElement,
    label: string,
    initial: boolean,
    onChange: (on: boolean) => void,
  ): HTMLElement {
    const row = el('div', 'toggle-row', parent);
    el('span', 'toggle-label', row).textContent = label;
    const button = btn('toggle-btn' + (initial ? ' on' : ''), row);
    button.type = 'button';
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-checked', String(initial));
    const sync = (): void => {
      const on = button.classList.contains('on');
      button.textContent = on ? 'ON' : 'OFF';
      button.setAttribute('aria-checked', String(on));
    };
    sync();
    button.addEventListener('click', () => {
      button.classList.toggle('on');
      sync();
      onChange(button.classList.contains('on'));
    });
    return row;
  }

  private buildMenu(): void {
    this.menuScreen = el('div', 'screen', this.root);
    const panel = el('div', 'panel', this.menuScreen);
    el('div', 'eyebrow', panel).textContent = 'THREE.JS · WEBGL · TILT CONTROLS';
    el('h1', 'title', panel).innerHTML = 'STARFALL<br/><span>VECTOR</span>';
    el('p', 'tagline', panel).textContent =
      'Bank your interceptor with the tilt of your phone. Survive the swarm, chain kills for a multiplier, and take down the capital ships.';

    this.menuHighNode = el('div', 'menu-high', panel);
    this.menuHighNode.textContent = 'BEST 0';

    const start = btn('btn btn-primary', panel);
    start.type = 'button';
    start.textContent = 'LAUNCH';
    start.addEventListener('click', () => this.handlers.onStart());

    const hangar = el('div', 'controls-box', panel);
    el('div', 'controls-title', hangar).textContent = 'HANGAR — INTERCEPTOR';
    const shipSeg = el('div', 'segmented', hangar);
    const ships: Array<['vector' | 'lance' | 'bastion', string]> = [
      ['vector', 'VECTOR'],
      ['lance', 'LANCE'],
      ['bastion', 'BASTION'],
    ];
    for (const [id, label] of ships) {
      const b = btn('seg-btn' + (id === 'vector' ? ' active' : ''), shipSeg);
      b.type = 'button';
      b.textContent = label;
      b.dataset.ship = id;
      b.addEventListener('click', () => {
        shipSeg.querySelectorAll('.seg-btn').forEach((n) => n.classList.remove('active'));
        b.classList.add('active');
        this.handlers.onSelectShip(id);
      });
    }
    el('div', 'hint', hangar).textContent =
      'VECTOR is balanced. LANCE is faster with lighter shields. BASTION is slow but starts with 4 shields.';

    const controls = el('div', 'controls-box', panel);
    el('div', 'controls-title', controls).textContent = 'CONTROLS';
    const seg = el('div', 'segmented', controls);
    const prefs: Array<['auto' | 'tilt' | 'touch', string]> = [
      ['auto', 'AUTO'],
      ['tilt', 'TILT'],
      ['touch', 'TOUCH'],
    ];
    for (const [value, label] of prefs) {
      const b = btn('seg-btn' + (value === 'auto' ? ' active' : ''), seg);
      b.type = 'button';
      b.textContent = label;
      b.dataset.pref = value;
      b.addEventListener('click', () => {
        seg.querySelectorAll('.seg-btn').forEach((n) => n.classList.remove('active'));
        b.classList.add('active');
        this.handlers.onControlPreference(value);
      });
    }
    const calibBtn = btn('btn btn-ghost', controls);
    calibBtn.type = 'button';
    calibBtn.textContent = 'CALIBRATE TILT';
    calibBtn.addEventListener('click', () => this.handlers.onCalibrate());
    el('div', 'hint', controls).textContent =
      'Hold the phone naturally, then tap CALIBRATE to set your neutral centre. Desktop: arrows / WASD steer, space fires, F fires the POWER lance. Aim-lock engages automatically on tanks and bosses.';

    const opts = el('div', 'options', panel);
    this.toggleRow(opts, 'GLOW (BLOOM)', true, (v) => this.handlers.onToggleBloom(v));
    this.toggleRow(opts, 'MUSIC', true, (v) => this.handlers.onToggleMusic(v));
    this.toggleRow(opts, 'SFX', true, (v) => this.handlers.onToggleSfx(v));
    this.toggleRow(opts, 'AUTOFIRE', true, (v) => this.handlers.onToggleAutofire(v));
  }

  private buildPause(): void {
    this.pauseScreen = el('div', 'screen hidden', this.root);
    const panel = el('div', 'panel', this.pauseScreen);
    el('h2', 'title-sm', panel).textContent = 'PAUSED';

    const resume = btn('btn btn-primary', panel);
    resume.type = 'button';
    resume.textContent = 'RESUME';
    resume.addEventListener('click', () => this.handlers.onResume());

    const quit = btn('btn btn-ghost', panel);
    quit.type = 'button';
    quit.textContent = 'ABANDON RUN';
    quit.addEventListener('click', () => this.handlers.onMenu());

    const opts = el('div', 'options', panel);
    this.toggleRow(opts, 'GLOW (BLOOM)', true, (v) => this.handlers.onToggleBloom(v));
    this.toggleRow(opts, 'MUSIC', true, (v) => this.handlers.onToggleMusic(v));
    this.toggleRow(opts, 'SFX', true, (v) => this.handlers.onToggleSfx(v));
    this.toggleRow(opts, 'AUTOFIRE', true, (v) => this.handlers.onToggleAutofire(v));

    const calib = btn('btn btn-ghost', panel);
    calib.type = 'button';
    calib.textContent = 'RECALIBRATE TILT';
    calib.addEventListener('click', () => this.handlers.onCalibrate());
  }

  private buildCalibrate(): void {
    this.calibrateScreen = el('div', 'screen hidden', this.root);
    const panel = el('div', 'panel panel-narrow', this.calibrateScreen);
    el('h2', 'title-sm', panel).textContent = 'TILT CALIBRATION';
    el('p', 'tagline', panel).textContent =
      'Hold the phone the way you actually play — level, comfortable, both hands. Then lock it in as your neutral centre.';

    const bubbleBox = el('div', 'bubble-box', panel);
    this.tiltBubble = el('div', 'tilt-bubble', bubbleBox);
    const crossH = el('div', 'crosshair-h', bubbleBox);
    const crossV = el('div', 'crosshair-v', bubbleBox);
    void crossH;
    void crossV;

    this.tiltReadout = el('div', 'tilt-readout', panel);
    this.tiltReadout.textContent = 'γ 0.0°  β 0.0°';
    this.tiltStatusNode = el('div', 'tilt-status', panel);
    this.tiltStatusNode.textContent = 'Waiting for sensor…';

    const lock = btn('btn btn-primary', panel);
    lock.type = 'button';
    lock.textContent = 'SET CENTRE';
    lock.addEventListener('click', () => this.handlers.onCommitCalibration());

    const cancel = btn('btn btn-ghost', panel);
    cancel.type = 'button';
    cancel.textContent = 'CANCEL';
    cancel.addEventListener('click', () => this.handlers.onCancelCalibration());
  }

  private buildGameOver(): void {
    this.gameoverScreen = el('div', 'screen hidden', this.root);
    const panel = el('div', 'panel', this.gameoverScreen);
    el('h2', 'title-sm', panel).textContent = 'SHIP LOST';
    this.overBadgeNode = el('div', 'badge hidden', panel);
    this.overBadgeNode.textContent = 'NEW HIGH SCORE';
    this.overScoreNode = el('div', 'over-score', panel);
    this.overScoreNode.textContent = '0';
    this.overStatsNode = el('div', 'over-stats', panel);

    const retry = btn('btn btn-primary', panel);
    retry.type = 'button';
    retry.textContent = 'RETRY';
    retry.addEventListener('click', () => this.handlers.onStart());

    const menu = btn('btn btn-ghost', panel);
    menu.type = 'button';
    menu.textContent = 'MAIN MENU';
    menu.addEventListener('click', () => this.handlers.onMenu());
  }

  // ------------------------------------------------------------------ state

  showScreen(name: 'menu' | 'gameover' | 'paused' | 'calibrate' | 'none'): void {
    this.menuScreen.classList.toggle('hidden', name !== 'menu');
    this.gameoverScreen.classList.toggle('hidden', name !== 'gameover');
    this.pauseScreen.classList.toggle('hidden', name !== 'paused');
    this.calibrateScreen.classList.toggle('hidden', name !== 'calibrate');
    this.hud.classList.toggle('hidden', name !== 'none');
  }

  updateHud(h: HudSnapshot): void {
    this.scoreNode.textContent = formatScore(h.score);
    this.highNode.textContent = `BEST ${formatScore(h.highScore)}`;
    this.multNode.textContent = `x${h.multiplier.toFixed(2)}`;
    (this.comboBar.firstChild as HTMLElement).style.width = `${(h.comboFrac * 100).toFixed(1)}%`;
    this.waveNode.textContent = `WAVE ${h.wave}`;
    (this.waveBar.firstChild as HTMLElement).style.width = `${(h.waveFrac * 100).toFixed(1)}%`;
    this.weaponNode.textContent = `WPN LV ${h.weaponLevel}`;
    this.fpsNode.textContent = `${Math.round(h.fps)} FPS`;

    // Rebuild pips only when the count changes — avoids layout thrash.
    const want = h.maxShields;
    if (this.pips.childElementCount !== want) {
      this.pips.innerHTML = '';
      for (let i = 0; i < want; i++) el('span', 'pip', this.pips);
    }
    for (let i = 0; i < this.pips.childElementCount; i++) {
      const pip = this.pips.children[i] as HTMLElement;
      pip.classList.toggle('spent', i >= h.shields);
      pip.classList.toggle('live', i < h.shields);
    }

    this.novaNode.classList.toggle('hidden', h.novaFrac <= 0);
    if (h.novaFrac > 0) {
      this.novaNode.textContent = `NOVA ${(h.novaFrac * 100).toFixed(0)}%`;
    }

    // POWER magazine pips + recharge progress.
    const pips = this.powerPips.children;
    for (let i = 0; i < pips.length; i++) {
      (pips[i] as HTMLElement).classList.toggle('charged', i < h.powerCharges);
    }
    (this.powerBar.firstChild as HTMLElement).style.width =
      `${(h.powerRechargeFrac * 100).toFixed(1)}%`;
    this.powerWrap.classList.toggle('empty', h.powerCharges === 0);

    // AEGIS guard countdown.
    const guarded = h.guardTime > 0;
    this.aegisNode.classList.toggle('hidden', !guarded);
    if (guarded) this.aegisNode.textContent = `AEGIS ${Math.ceil(h.guardTime)}s`;

    this.lockChip.classList.toggle('hidden', !h.locked);
  }

  setControlMode(mode: ControlMode): void {
    const label = mode === 'tilt' ? 'TILT' : mode === 'touch' ? 'TOUCH' : 'NO INPUT';
    this.modeNode.textContent = label;
    this.modeChip.classList.toggle('warn', mode === 'none');
  }

  setBoss(hp: number, max: number | null): void {
    if (max === null || max <= 0) {
      this.bossWrap.classList.add('hidden');
      return;
    }
    this.bossWrap.classList.remove('hidden');
    (this.bossBar.firstChild as HTMLElement).style.width = `${Math.max(0, (hp / max) * 100)}%`;
  }

  setMenuHigh(score: number): void {
    this.menuHighNode.textContent = `BEST ${formatScore(score)}`;
  }

  showCountdown(n: number): void {
    if (n <= 0) {
      this.countdownNode.classList.add('hidden');
      this.countdownValue = -1;
      return;
    }
    if (n !== this.countdownValue) {
      this.countdownValue = n;
      this.countdownNode.classList.remove('hidden');
      this.countdownNode.textContent = String(n);
      // Restart the pop animation.
      this.countdownNode.animate?.(
        [
          { transform: 'scale(0.4)', opacity: 0 },
          { transform: 'scale(1.15)', opacity: 1, offset: 0.35 },
          { transform: 'scale(1)', opacity: 1 },
        ],
        { duration: 700, easing: 'cubic-bezier(.2,.9,.3,1)' },
      );
    }
  }

  flashDamage(): void {
    this.damageFlash.animate?.(
      [{ opacity: 0.85 }, { opacity: 0 }],
      { duration: 420, easing: 'ease-out' },
    );
  }

  toast(text: string, tone: 'good' | 'bad' | 'info' = 'info'): void {
    const node = el('div', `toast toast-${tone}`, this.toastWrap);
    node.textContent = text;
    node.animate?.(
      [
        { transform: 'translateY(14px)', opacity: 0 },
        { transform: 'translateY(0)', opacity: 1, offset: 0.15 },
        { transform: 'translateY(-10px)', opacity: 0 },
      ],
      { duration: 1500, easing: 'ease-out' },
    );
    window.setTimeout(() => node.remove(), 1550);
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
  }

  setTiltReadout(gamma: number, beta: number, status: string, ok: boolean): void {
    this.tiltReadout.textContent = `γ ${gamma.toFixed(1)}°  β ${beta.toFixed(1)}°`;
    this.tiltStatusNode.textContent = status;
    this.tiltStatusNode.classList.toggle('bad', !ok);
    // Move the bubble: clamp to the box so it never escapes.
    const max = 30;
    const nx = Math.max(-1, Math.min(1, gamma / max));
    const ny = Math.max(-1, Math.min(1, beta / max));
    this.tiltBubble.style.transform = `translate(${(nx * 42).toFixed(1)}%, ${(ny * 42).toFixed(1)}%)`;
  }

  showGameOver(r: RunSummary): void {
    this.overScoreNode.textContent = formatScore(r.score);
    this.overBadgeNode.classList.toggle('hidden', !r.isNewHighScore);
    this.overStatsNode.innerHTML = '';
    const rows: Array<[string, string]> = [
      ['BEST', formatScore(r.highScore)],
      ['WAVE REACHED', String(r.wave)],
      ['KILLS', String(r.kills)],
      ['BEST COMBO', `x${r.bestCombo.toFixed(2)}`],
      ['TIME SURVIVED', formatTime(r.timeSurvived)],
      ['RUN SEED', String(r.seed)],
    ];
    for (const [k, v] of rows) {
      const row = el('div', 'stat-row', this.overStatsNode);
      el('span', 'stat-k', row).textContent = k;
      el('span', 'stat-v', row).textContent = v;
    }
  }

  syncToggles(settings: {
    bloom: boolean;
    music: boolean;
    sfx: boolean;
    autofire: boolean;
  }): void {
    const labels = ['GLOW (BLOOM)', 'MUSIC', 'SFX', 'AUTOFIRE'];
    const values = [settings.bloom, settings.music, settings.sfx, settings.autofire];
    this.root.querySelectorAll<HTMLElement>('.toggle-row').forEach((row) => {
      const label = row.querySelector('.toggle-label')?.textContent ?? '';
      const idx = labels.indexOf(label);
      if (idx < 0) return;
      const btn = row.querySelector('.toggle-btn');
      if (!btn) return;
      const on = values[idx] as boolean;
      btn.classList.toggle('on', on);
      btn.textContent = on ? 'ON' : 'OFF';
      btn.setAttribute('aria-checked', String(on));
    });
  }

  syncShip(ship: 'vector' | 'lance' | 'bastion'): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-ship]').forEach((b) => {
      b.classList.toggle('active', b.dataset.ship === ship);
    });
  }

  syncControlPreference(pref: 'auto' | 'tilt' | 'touch'): void {
    this.root.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.pref === pref);
    });
  }
}
