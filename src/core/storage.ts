/**
 * Tiny typed wrapper over localStorage with graceful degradation.
 *
 * Capacitor's WebView has localStorage, but private-mode Safari and some
 * locked-down Android WebViews throw on access — the game must still run.
 */
const KEY_PREFIX = 'starfall.';

let backend: Storage | null = null;
try {
  backend = typeof localStorage !== 'undefined' ? localStorage : null;
} catch {
  backend = null;
}

const memory = new Map<string, string>();

export const storage = {
  get<T>(key: string, fallback: T): T {
    const k = KEY_PREFIX + key;
    let raw: string | null = null;
    try {
      raw = backend ? backend.getItem(k) : (memory.get(k) ?? null);
    } catch {
      raw = memory.get(k) ?? null;
    }
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },

  set(key: string, value: unknown): void {
    const k = KEY_PREFIX + key;
    let raw: string;
    try {
      raw = JSON.stringify(value);
    } catch {
      return;
    }
    try {
      if (backend) backend.setItem(k, raw);
      else memory.set(k, raw);
    } catch {
      memory.set(k, raw);
    }
  },
};

export interface PersistedSettings {
  bloom: boolean;
  music: boolean;
  sfx: boolean;
  autofire: boolean;
  /** 'tilt' | 'touch' | 'auto' */
  controlPreference: ControlPreference;
}

export type ControlPreference = 'auto' | 'tilt' | 'touch';

export const DEFAULT_SETTINGS: PersistedSettings = {
  bloom: true,
  music: true,
  sfx: true,
  autofire: true,
  controlPreference: 'auto',
};

export const loadSettings = (): PersistedSettings => ({
  ...DEFAULT_SETTINGS,
  ...storage.get<Partial<PersistedSettings>>('settings', {}),
});

export const saveSettings = (s: PersistedSettings): void =>
  storage.set('settings', s);

export const loadHighScore = (): number => storage.get<number>('highScore', 0);
export const saveHighScore = (n: number): void => storage.set('highScore', n);

export const loadTiltCalibration = (): { gamma: number; beta: number } | null =>
  storage.get<{ gamma: number; beta: number } | null>('tiltCalibration', null);

export const saveTiltCalibration = (gamma: number, beta: number): void =>
  storage.set('tiltCalibration', { gamma, beta });
