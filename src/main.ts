import { Game } from './game.js';
import { Ui } from './ui/hud.js';
import './ui/style.css';

/**
 * Entry point: boot the renderer, wire the UI to the simulation, and register
 * the Capacitor lifecycle hooks (if the Capacitor bridge is present).
 */

const canvas = document.getElementById('gl') as HTMLCanvasElement | null;
const app = document.getElementById('app') as HTMLElement | null;
const fatal = document.getElementById('fatal') as HTMLElement | null;

const fail = (title: string, body: string): void => {
  if (fatal) {
    fatal.querySelector('h2')!.textContent = title;
    fatal.querySelector('p')!.textContent = body;
    fatal.classList.add('show');
  } else {
    window.alert(`${title}\n\n${body}`);
  }
};

const boot = async (): Promise<void> => {
  if (!canvas || !app) {
    fail('STARTUP FAILED', 'The game canvas is missing from the page.');
    return;
  }

  // Fail loudly rather than showing a black screen.
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2') ?? probe.getContext('webgl');
  if (!gl) {
    fail(
      'WEBGL UNAVAILABLE',
      'This device or browser could not create a WebGL context. Starfall Vector needs hardware-accelerated WebGL. On Android, update Chrome or enable hardware acceleration in the WebView.',
    );
    return;
  }

  let game: Game;
  let ui: Ui;

  try {
    ui = new Ui(app, {
      onStart: () => {
        void game.beginRun();
        ui.showScreen('none');
      },
      onResume: () => {
        game.resume();
        ui.showScreen('none');
      },
      onPause: () => {
        game.pause();
        ui.showScreen('paused');
      },
      onMenu: () => {
        game.toMenu();
        ui.setMenuHigh(game.currentHighScore);
        ui.showScreen('menu');
      },
      onToggleBloom: (v) => game.updateSettings({ bloom: v }),
      onToggleMusic: (v) => game.updateSettings({ music: v }),
      onToggleSfx: (v) => game.updateSettings({ sfx: v }),
      onToggleAutofire: (v) => game.updateSettings({ autofire: v }),
      onControlPreference: (pref) => {
        game.setControlPreference(pref);
        ui.syncControlPreference(pref);
        if (pref === 'tilt') void warnIfNoTilt();
      },
      onSelectShip: (ship) => game.setShip(ship),
      onPower: () => game.requestPowerShot(),
      onPickUpgrade: (id) => game.pickUpgrade(id),
      onCalibrate: async () => {
        game.enterCalibration();
        const result = await game.calibrateTilt();
        if (result === null && !game.tiltState.isListening) {
          ui.setTiltReadout(
            0,
            0,
            'Gyro unavailable — steering will fall back to touch drag.',
            false,
          );
        }
      },
      onCommitCalibration: () => {
        const r = game.commitTiltCalibration();
        if (r) {
          ui.setTiltReadout(r.gamma, r.beta, 'Centre locked in.', true);
          window.setTimeout(() => game.leaveCalibration(), 700);
        } else {
          game.leaveCalibration();
        }
      },
      onCancelCalibration: () => {
        game.leaveCalibration();
      },
    });
  } catch (err) {
    fail('UI FAILED TO START', String(err));
    return;
  }

  const warnIfNoTilt = async (): Promise<void> => {
    const support = await game.enableTilt();
    if (support !== 'supported') {
      ui.toast('TILT UNAVAILABLE — USING TOUCH', 'bad');
    }
  };

  try {
    game = new Game(canvas, {
      onState: (s) => {
        if (s === 'menu') ui.showScreen('menu');
        else if (s === 'calibrate') ui.showScreen('calibrate');
        else if (s === 'upgrade') ui.showScreen('upgrade');
        else if (s === 'paused') ui.showScreen('paused');
        else if (s === 'gameover') ui.showScreen('gameover');
        else if (s === 'countdown' || s === 'playing') ui.showScreen('none');
      },
      onHud: (h) => ui.updateHud(h),
      onBoss: (hp, max) => ui.setBoss(hp, max),
      onToast: (text, tone) => {
        ui.toast(text, tone);
        if (tone === 'bad') ui.flashDamage();
      },
      onWave: (w) => ui.toast(`WAVE ${w}`, 'info'),
      onCountdown: (n) => ui.showCountdown(n),
      onControlMode: (m) => ui.setControlMode(m),
      onGameOver: (r) => ui.showGameOver(r),
      onUpgrades: (wave, choices) => ui.showUpgrades(wave, choices),
    });
  } catch (err) {
    fail('RENDERER FAILED TO START', String(err));
    return;
  }

  // Reflect persisted settings in the UI before showing anything.
  ui.syncToggles(game.currentSettings);
  ui.syncControlPreference(game.currentSettings.controlPreference);
  ui.syncShip(game.currentSettings.ship);
  ui.setMenuHigh(game.currentHighScore);
  ui.setControlMode(game.currentSettings.controlPreference === 'touch' ? 'touch' : 'tilt');

  game.start();

  // Live calibration readout: while the calibration screen is up, stream the
  // current signed tilt into the HUD bubble so the player can see their own
  // resting angle before locking it in.
  const pollCalibration = (): void => {
    if (game.currentState !== 'calibrate') return;
    const t = game.tiltState;
    if (t.isListening && t.support === 'supported') {
      ui.setTiltReadout(
        t.rawX,
        t.rawY,
        t.isCalibrated
          ? 'Hold steady, then tap SET CENTRE.'
          : 'Sensor live — hold your natural grip, then SET CENTRE.',
        true,
      );
    } else if (t.support === 'denied') {
      ui.setTiltReadout(0, 0, 'Motion permission denied — touch steering will be used.', false);
    } else {
      ui.setTiltReadout(0, 0, 'Waiting for sensor…', false);
    }
  };
  window.setInterval(pollCalibration, 90);

  // Keep the canvas sized to the real viewport (handles notches + rotation).
  const resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.floor(w * Math.min(window.devicePixelRatio || 1, 2));
    canvas.height = Math.floor(h * Math.min(window.devicePixelRatio || 1, 2));
  };
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();

  // Keep the screen awake and hide the status bar on a real device.
  await initCapacitor(game, () => ui.showScreen('paused'));

  // Expose for the automated smoke test and for debugging on-device.
  (window as unknown as { __starfall: { game: Game; ui: Ui } }).__starfall = { game, ui };
};

/**
 * Wire the native bridge when running inside the Capacitor WebView.
 * Outside it (browser dev server) this is a silent no-op.
 */
const initCapacitor = async (
  game: Game,
  onBackground: () => void,
): Promise<void> => {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;

    const [{ StatusBar }, { App }] = await Promise.all([
      import('@capacitor/status-bar'),
      import('@capacitor/app'),
    ]);

    try {
      await StatusBar.hide();
    } catch {
      /* some devices disallow */
    }

    App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        game.pause();
        onBackground();
      }
    });

    App.addListener('pause', () => {
      game.pause();
      onBackground();
    });
  } catch {
    // Not running under Capacitor — nothing to do.
  }
};

void boot();
