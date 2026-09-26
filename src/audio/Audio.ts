/**
 * Audio: procedural Web Audio SFX (synthesized per event, pitch-varied) +
 * Higgsfield announcer voice lines (public/assets/audio/vo_*.mp3) + a small
 * procedural music loop for menus and battles.
 */
export type VoLine = 'ready' | 'fight' | 'knockout' | 'victory' | 'defeat' | 'suddendeath' | 'draw' | 'newpart';
const VO_LINES: VoLine[] = ['ready', 'fight', 'knockout', 'victory', 'defeat', 'suddendeath', 'draw', 'newpart'];

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly vo = new Map<VoLine, AudioBuffer>();
  private muted = false;
  private engines: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode }[] = [];
  private musicTimer: number | null = null;
  private musicStep = 0;
  private musicMode: 'menu' | 'battle' | null = null;
  private grindCooldown = 0;
  private seed = 1;

  constructor() {
    const unlock = () => {
      this.ensure();
      void this.ctx?.resume();
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = 0.8;
      this.sfxBus.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0.22;
      this.musicBus.connect(this.master);
      const len = ctx.sampleRate * 1.5;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      void this.loadVo();
      if (this.musicMode) this.startMusic(this.musicMode);
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  private async loadVo(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    await Promise.all(
      VO_LINES.map(async (line) => {
        try {
          const res = await fetch(`${import.meta.env.BASE_URL}assets/audio/vo_${line}.mp3`);
          const buf = await ctx.decodeAudioData(await res.arrayBuffer());
          this.vo.set(line, buf);
        } catch {
          // missing line → silent
        }
      }),
    );
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  voice(line: VoLine): void {
    const ctx = this.ensure();
    const buf = this.vo.get(line);
    if (!ctx || !buf || !this.sfxBus) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 1.4;
    src.connect(g).connect(this.sfxBus);
    src.start();
  }

  // ------------------------------------------------------------ primitives

  private env(g: GainNode, t: number, a: number, peak: number, d: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    const ctx = this.ensure();
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.005, vol, dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(filterType: BiquadFilterType, f0: number, f1: number, q: number, dur: number, vol: number, delay = 0): void {
    const ctx = this.ensure();
    if (!ctx || !this.sfxBus || !this.noise) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + this.rand() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.004, vol, dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, this.rand() * 0.5);
    src.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------ game sfx

  hit(weapon: string, amount: number): void {
    const v = Math.min(1, 0.35 + amount / 40);
    const p = 0.9 + this.rand() * 0.2;
    switch (weapon) {
      case 'blade':
      case 'chainsaw':
      case 'drill':
        if (this.grindCooldown > 0) return;
        this.grindCooldown = 0.05;
        this.burst('bandpass', 3200 * p, 1800 * p, 6, 0.16, 0.5 * v);
        this.tone('sawtooth', 900 * p, 600 * p, 0.12, 0.12 * v);
        this.metal(0.25 * v);
        break;
      case 'punch':
        this.tone('sine', 180, 45, 0.25, 0.9 * v);
        this.burst('lowpass', 1800, 200, 1, 0.18, 0.6 * v);
        break;
      case 'fork':
        this.metal(0.6 * v);
        this.tone('square', 220 * p, 110, 0.18, 0.2 * v);
        break;
      default:
        this.metal(0.5 * v);
    }
  }

  metal(vol: number): void {
    const p = 0.85 + this.rand() * 0.3;
    for (const [f, d] of [
      [520, 0.25],
      [1380, 0.18],
      [2210, 0.12],
    ] as const)
      this.tone('triangle', f * p, f * p * 0.97, d, vol * 0.35);
    this.burst('highpass', 4000, 2500, 0.7, 0.06, vol * 0.4);
  }

  clash(strength: number): void {
    this.metal(0.4 + strength * 0.5);
    this.tone('sine', 120, 50, 0.2, 0.5 * strength);
  }

  flip(): void {
    this.tone('square', 160, 520, 0.14, 0.18);
    this.metal(0.5);
  }

  punchFire(): void {
    this.burst('bandpass', 700, 250, 2, 0.12, 0.35);
  }

  rocketLaunch(): void {
    this.burst('bandpass', 400, 2600, 1.2, 0.45, 0.45);
    this.tone('sawtooth', 110, 60, 0.3, 0.15);
  }

  explosion(size: number): void {
    const s = Math.min(2.5, size);
    this.burst('lowpass', 2400, 60, 0.8, 0.5 + s * 0.35, 0.7 + s * 0.15);
    this.tone('sine', 90, 28, 0.6 + s * 0.2, 0.9);
    this.burst('highpass', 6000, 3000, 0.5, 0.08, 0.3);
  }

  boost(): void {
    this.burst('bandpass', 300, 1500, 1.5, 0.55, 0.4);
  }

  jump(): void {
    this.tone('sine', 220, 660, 0.18, 0.35);
    this.tone('triangle', 330, 900, 0.14, 0.15, 0.02);
  }

  suddenDeathSiren(): void {
    for (let i = 0; i < 3; i++) {
      this.tone('square', 440, 660, 0.25, 0.12, i * 0.5);
      this.tone('square', 660, 440, 0.25, 0.12, i * 0.5 + 0.25);
    }
  }

  countdownBeep(final: boolean): void {
    this.tone('square', final ? 1046 : 523, final ? 1046 : 523, final ? 0.35 : 0.12, 0.2);
  }

  ui(name: 'click' | 'equip' | 'unequip' | 'error' | 'coin' | 'crate' | 'reveal' | 'fuse' | 'whoosh'): void {
    switch (name) {
      case 'click':
        this.tone('triangle', 900, 700, 0.05, 0.25);
        break;
      case 'equip':
        this.metal(0.35);
        this.tone('square', 300, 600, 0.08, 0.12);
        break;
      case 'unequip':
        this.tone('triangle', 500, 250, 0.1, 0.2);
        break;
      case 'error':
        this.tone('square', 180, 150, 0.18, 0.18);
        break;
      case 'coin':
        this.tone('square', 1318, 1318, 0.08, 0.12);
        this.tone('square', 1760, 1760, 0.18, 0.12, 0.08);
        break;
      case 'crate':
        this.tone('sine', 140, 60, 0.3, 0.8);
        this.burst('lowpass', 1500, 100, 1, 0.35, 0.5);
        break;
      case 'reveal':
        [523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, 0.22, 0.2, i * 0.06));
        break;
      case 'fuse':
        [392, 523, 659, 784, 1046].forEach((f, i) => this.tone('square', f, f, 0.12, 0.1, i * 0.07));
        this.metal(0.4);
        break;
      case 'whoosh':
        this.burst('bandpass', 400, 2000, 1, 0.25, 0.3);
        break;
    }
  }

  // ------------------------------------------------------------ engines

  startEngines(count: number): void {
    const ctx = this.ensure();
    this.stopEngines();
    if (!ctx || !this.sfxBus) return;
    for (let i = 0; i < count; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 50;
      const osc2 = ctx.createOscillator();
      osc2.type = 'square';
      osc2.frequency.value = 25;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 500;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(gain).connect(this.sfxBus);
      osc.start();
      osc2.start();
      this.engines.push({ osc, osc2, gain, filter });
    }
  }

  setEngine(i: number, speed01: number, alive: boolean): void {
    const e = this.engines[i];
    if (!e || !this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 42 + speed01 * 70 + i * 6;
    e.osc.frequency.setTargetAtTime(f, t, 0.08);
    e.osc2.frequency.setTargetAtTime(f / 2, t, 0.08);
    e.filter.frequency.setTargetAtTime(350 + speed01 * 900, t, 0.1);
    e.gain.gain.setTargetAtTime(alive ? 0.06 + speed01 * 0.05 : 0, t, 0.1);
  }

  stopEngines(): void {
    for (const e of this.engines) {
      try {
        e.osc.stop();
        e.osc2.stop();
      } catch {
        // already stopped
      }
      e.gain.disconnect();
    }
    this.engines = [];
  }

  tick(dt: number): void {
    if (this.grindCooldown > 0) this.grindCooldown -= dt;
  }

  // ------------------------------------------------------------ music

  startMusic(mode: 'menu' | 'battle'): void {
    this.musicMode = mode;
    if (!this.ctx) return;
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicStep = 0;
    const bpm = mode === 'battle' ? 150 : 104;
    const stepMs = 60000 / bpm / 2;
    this.musicTimer = window.setInterval(() => this.musicTick(mode), stepMs);
  }

  stopMusic(): void {
    this.musicMode = null;
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  private musicTick(mode: 'menu' | 'battle'): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus || ctx.state !== 'running') return;
    const s = this.musicStep++;
    const t = ctx.currentTime + 0.02;
    const bar = Math.floor(s / 8) % 4;
    const roots = mode === 'battle' ? [55, 55, 65.4, 49] : [65.4, 55, 73.4, 49];
    const root = roots[bar];
    const play = (type: OscillatorType, f: number, dur: number, vol: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.musicBus!);
      o.start(t);
      o.stop(t + dur + 0.02);
    };
    // bass
    if (s % 2 === 0) play(mode === 'battle' ? 'sawtooth' : 'triangle', root * (s % 4 === 2 ? 2 : 1), 0.18, 0.5);
    // kick / snare / hat
    if (this.noise) {
      if (s % 4 === 0) {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.9, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
        o.connect(g).connect(this.musicBus);
        o.start(t);
        o.stop(t + 0.2);
      }
      const hat = (vol: number, f: number, dur: number) => {
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const flt = ctx.createBiquadFilter();
        flt.type = 'highpass';
        flt.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(flt).connect(g).connect(this.musicBus!);
        src.start(t, (s * 0.07) % 1);
        src.stop(t + dur + 0.02);
      };
      if (s % 8 === 4) hat(0.5, 1200, 0.14);
      if (mode === 'battle' || s % 2 === 1) hat(0.12, 7000, 0.04);
    }
    // lead riff
    const riff = mode === 'battle' ? [0, 3, 5, 7, 5, 3, 7, 10] : [7, 0, 4, 7, 12, 7, 4, 0];
    if (s % 2 === 0 || mode === 'battle') {
      const n = riff[s % riff.length];
      if ((s + bar) % 3 !== 2) play('square', root * 4 * Math.pow(2, n / 12), 0.12, mode === 'battle' ? 0.07 : 0.05);
    }
  }
}
