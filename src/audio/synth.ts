/**
 * Zero-asset audio: everything is synthesised with the Web Audio API.
 *
 * That keeps the APK small (no .ogg/.wav payload) and means no network fetches,
 * which matters because Capacitor serves the app from a local scheme where a
 * failed audio fetch is silent and hard to debug.
 *
 * Every method is a no-op until `unlock()` is called from a user gesture —
 * mobile browsers refuse to start an AudioContext any earlier.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private musicTimer: number | null = null;
  private step = 0;
  private nextNoteTime = 0;

  musicEnabled = true;
  sfxEnabled = true;

  get isUnlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture (tap on Start). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    try {
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
      return;
    }

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.sfxEnabled ? 0.85 : 0;
    this.sfxGain.connect(this.master);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicEnabled ? 0.3 : 0;
    this.musicGain.connect(this.master);

    // Pre-bake one second of white noise for explosions.
    const len = Math.floor(this.ctx.sampleRate * 1);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMusic(on: boolean): void {
    this.musicEnabled = on;
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setTargetAtTime(on ? 0.3 : 0, this.ctx.currentTime, 0.05);
    }
    if (!on) this.stopMusic();
    else this.startMusic();
  }

  setSfx(on: boolean): void {
    this.sfxEnabled = on;
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setTargetAtTime(on ? 0.85 : 0, this.ctx.currentTime, 0.05);
    }
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    slideTo?: number,
    dest?: AudioNode,
  ): void {
    if (!this.ctx || !this.sfxGain) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(dest ?? this.sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, gain: number, filterFrom: number, filterTo: number): void {
    if (!this.ctx || !this.sfxGain || !this.noiseBuffer) return;
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFrom, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, filterTo), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfxGain);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  shoot(level: number): void {
    const base = 620 + level * 60;
    this.tone(base, 0.09, 'square', 0.075, base * 0.42);
    this.tone(base * 2, 0.05, 'sawtooth', 0.028, base * 0.9);
  }

  enemyShoot(): void {
    this.tone(240, 0.14, 'sawtooth', 0.045, 110);
  }

  explosion(big = false): void {
    this.noise(big ? 0.75 : 0.34, big ? 0.5 : 0.3, big ? 2400 : 1800, 90);
    this.tone(big ? 90 : 150, big ? 0.5 : 0.24, 'sine', big ? 0.22 : 0.12, 38);
  }

  hit(): void {
    this.tone(320, 0.07, 'triangle', 0.07, 180);
  }

  pickup(): void {
    this.tone(660, 0.09, 'triangle', 0.11, 990);
    window.setTimeout(() => this.tone(990, 0.13, 'triangle', 0.09, 1480), 70);
  }

  playerHurt(): void {
    this.tone(180, 0.32, 'sawtooth', 0.16, 60);
    this.noise(0.3, 0.24, 900, 120);
  }

  nova(): void {
    this.tone(220, 0.5, 'sine', 0.16, 1320);
    this.noise(0.5, 0.16, 400, 3000);
  }

  waveStart(): void {
    this.tone(392, 0.16, 'triangle', 0.1, 523);
    window.setTimeout(() => this.tone(523, 0.22, 'triangle', 0.09, 784), 130);
  }

  gameOver(): void {
    this.tone(392, 0.4, 'sawtooth', 0.13, 196);
    window.setTimeout(() => this.tone(262, 0.7, 'sawtooth', 0.12, 98), 260);
  }

  /**
   * Minimal sequenced bassline — a four-note loop with a look-ahead scheduler
   * driven from the game loop, so it stays in time without a worker.
   */
  startMusic(): void {
    if (!this.ctx || !this.musicGain || this.musicTimer !== null) return;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    const pattern = [55, 55, 82.4, 55, 65.4, 55, 98, 73.4];
    const tick = (): void => {
      if (!this.ctx || !this.musicGain) return;
      while (this.nextNoteTime < this.ctx.currentTime + 0.2) {
        const freq = pattern[this.step % pattern.length]!;
        const t = this.nextNoteTime;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
        osc.connect(g);
        g.connect(this.musicGain);
        osc.start(t);
        osc.stop(t + 0.38);

        if (this.step % 4 === 2) {
          const pad = this.ctx.createOscillator();
          const pg = this.ctx.createGain();
          pad.type = 'sine';
          pad.frequency.setValueAtTime(freq * 4, t);
          pg.gain.setValueAtTime(0.0001, t);
          pg.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
          pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
          pad.connect(pg);
          pg.connect(this.musicGain);
          pad.start(t);
          pad.stop(t + 0.55);
        }

        this.nextNoteTime += 0.26;
        this.step += 1;
      }
    };
    this.musicTimer = window.setInterval(tick, 60);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  dispose(): void {
    this.stopMusic();
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
  }
}
