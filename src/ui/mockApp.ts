/**
 * Mock AppApi for developing the DOM UI without the 3D/sim/net core.
 * Real Store; fake 2D garage render (canvas), slot anchors, battles and online flow.
 * Exposed as `window.mock` in ui-preview.html for driving states.
 */
import type {
  AppApi,
  AppEvents,
  BattleHudState,
  BattleMode,
  OnlineMatchState,
  OnlineState,
  Screen,
  SfxName,
  Side,
  SlotScreenAnchor,
} from '../app/AppApi';
import { Store, type SlotKind } from '../app/Store';
import {
  computeStats,
  defaultBuild,
  getChassis,
  getGadget,
  getPart,
  getWeapon,
  getWheel,
  sanitizeBuild,
  type CarBuild,
} from '../shared/parts';
import { ROUNDS_TO_WIN, type PlayerCard } from '../shared/protocol';

type Listener<K extends keyof AppEvents> = (p: AppEvents[K]) => void;
type Rect = { left: number; top: number; width: number; height: number };

const OPPONENTS: { card: PlayerCard; build: CarBuild }[] = [
  {
    card: { name: '턱시도', avatar: 'av_tomcat', trophies: 240 },
    build: { chassis: { id: 'box', level: 3 }, wheels: [{ id: 'wheel_heavy', level: 2 }, null, { id: 'wheel_heavy', level: 2 }], weapons: [{ id: 'drill', level: 3 }, { id: 'rocket', level: 2 }, null], gadgets: [{ id: 'armor', level: 2 }] },
  },
  {
    card: { name: '펑크냥', avatar: 'av_punk', trophies: 180 },
    build: { chassis: { id: 'wedge', level: 2 }, wheels: [{ id: 'wheel_spiked', level: 2 }, { id: 'wheel_spiked', level: 2 }], weapons: [{ id: 'blade', level: 3 }, { id: 'punch', level: 2 }], gadgets: [{ id: 'booster', level: 1 }] },
  },
  {
    card: { name: '샴샴이', avatar: 'av_siamese', trophies: 310 },
    build: { chassis: { id: 'tower', level: 2 }, wheels: [{ id: 'wheel_bigfoot', level: 2 }, { id: 'wheel_bigfoot', level: 2 }], weapons: [{ id: 'chainsaw', level: 3 }, { id: 'blade', level: 2 }, null], gadgets: [{ id: 'spring', level: 1 }] },
  },
];

interface FakeBattle {
  mode: BattleMode;
  hud: BattleHudState;
  builds: [CarBuild, CarBuild];
  t: number;
  hitT: number;
  step: number;
  ended: boolean;
  outroT: number;
  seed: number;
}

export class MockApp implements AppApi {
  readonly store = new Store();
  private _screen: Screen = 'home';
  private readonly listeners = new Map<keyof AppEvents, Set<(p: unknown) => void>>();
  private override: CarBuild | null = null;
  private frame: Rect = { left: 0, top: 0, width: innerWidth, height: innerHeight };
  private editing = false;
  private highlighted: { kind: SlotKind; index: number } | null = null;
  private readonly icons = new Map<string, string>();
  private battle: FakeBattle | null = null;
  private speed: 1 | 2 = 1;
  private onlineState: OnlineState = { status: 'offline', online: 0 };
  private onlineTimers: number[] = [];
  private oppIdx = 0;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private bg: HTMLImageElement | null = null;
  private lastT = performance.now();
  private raf = 0;
  /** Simulate a failing server connection. */
  failConnect = false;

  get screen(): Screen {
    return this._screen;
  }

  // ------------------------------------------------------------ events
  on<K extends keyof AppEvents>(event: K, fn: Listener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn as (p: unknown) => void);
    return () => set!.delete(fn as (p: unknown) => void);
  }
  emit<K extends keyof AppEvents>(event: K, payload: AppEvents[K]): void {
    for (const fn of this.listeners.get(event) ?? []) fn(payload);
  }

  showScreen(screen: Screen): void {
    if (screen === this._screen) return;
    this._screen = screen;
    if (screen !== 'battle' && this.battle && !this.battle.ended) this.battle = null;
    this.emit('screen', screen);
  }

  // ------------------------------------------------------------ garage view
  garage = {
    setBuildOverride: (build: CarBuild | null) => {
      this.override = build ? sanitizeBuild(build) : null;
    },
    getSlotAnchors: (): SlotScreenAnchor[] => {
      const b = this.displayBuild();
      const { cx, cy, s } = this.garageXf();
      const ch = getChassis(b.chassis.id);
      const out: SlotScreenAnchor[] = [];
      ch.wheelSlots.forEach((p, i) => out.push({ kind: 'wheel', index: i, x: cx + p.x * s, y: cy - p.y * s, filled: !!b.wheels[i] }));
      ch.weaponSlots.forEach((w, i) => {
        const off = w.mount === 'front' ? 0.12 : w.mount === 'back' ? -0.12 : 0;
        out.push({ kind: 'weapon', index: i, x: cx + (w.pos.x + off) * s, y: cy - (w.pos.y + (w.mount === 'top' ? 0.12 : 0)) * s, filled: !!b.weapons[i], mount: w.mount });
      });
      ch.gadgetSlots.forEach((p, i) => out.push({ kind: 'gadget', index: i, x: cx + p.x * s, y: cy - p.y * s, filled: !!b.gadgets[i] }));
      return out;
    },
    highlightSlot: (slot: { kind: SlotKind; index: number } | null) => {
      this.highlighted = slot;
    },
    setEditing: (editing: boolean) => {
      this.editing = editing;
    },
    setFrame: (rect: Rect) => {
      this.frame = rect;
    },
  };

  private displayBuild(): CarBuild {
    return this.override ?? this.store.build();
  }

  private garageXf() {
    const f = this.frame;
    const s = Math.max(40, Math.min(f.width / 3.1, f.height / 1.9));
    return { cx: f.left + f.width / 2, cy: f.top + f.height * 0.58, s };
  }

  // ------------------------------------------------------------ assets
  avatarUrl(avatar: string): string {
    return `${import.meta.env.BASE_URL}assets/img/${avatar}.png`;
  }

  partIcon(id: string): string {
    const cached = this.icons.get(id);
    if (cached) return cached;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.translate(64, 64);
    g.lineJoin = 'round';
    g.lineWidth = 6;
    g.strokeStyle = '#1d1916';
    const def = getPart(id);
    if (def.kind === 'chassis') {
      g.fillStyle = def.color;
      g.beginPath();
      def.shape.forEach((p, i) => (i ? g.lineTo(p.x * 48, -p.y * 48 + 8) : g.moveTo(p.x * 48, -p.y * 48 + 8)));
      g.closePath();
      g.fill();
      g.stroke();
      for (const w of def.wheelSlots) this.wheel(g, w.x * 48, -w.y * 48 + 8, 12, '#555');
    } else if (def.kind === 'wheel') {
      this.wheel(g, 0, 0, 20 + def.radius * 80, def.color);
    } else if (def.kind === 'weapon') {
      this.weaponIcon(g, def.weapon, def.color);
    } else {
      g.fillStyle = def.color;
      g.beginPath();
      g.roundRect(-30, -38, 60, 76, 12);
      g.fill();
      g.stroke();
      g.fillStyle = '#ffc234';
      g.beginPath();
      g.moveTo(6, -24);
      g.lineTo(-12, 4);
      g.lineTo(2, 4);
      g.lineTo(-6, 26);
      g.lineTo(14, -6);
      g.lineTo(0, -6);
      g.closePath();
      g.fill();
    }
    const url = c.toDataURL();
    this.icons.set(id, url);
    return url;
  }

  private wheel(g: CanvasRenderingContext2D, x: number, y: number, r: number, rim: string): void {
    g.fillStyle = '#2b2622';
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = rim;
    g.beginPath();
    g.arc(x, y, r * 0.5, 0, Math.PI * 2);
    g.fill();
  }

  private weaponIcon(g: CanvasRenderingContext2D, type: string, color: string): void {
    g.fillStyle = color;
    g.save();
    g.rotate(-0.5);
    switch (type) {
      case 'blade':
        g.fillStyle = '#6d6259';
        g.fillRect(-44, -6, 50, 12);
        g.strokeRect(-44, -6, 50, 12);
        g.fillStyle = color;
        g.beginPath();
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          const r = i % 2 ? 26 : 34;
          g.lineTo(18 + Math.cos(a) * r, Math.sin(a) * r);
        }
        g.closePath();
        g.fill();
        g.stroke();
        break;
      case 'drill':
      case 'rocket':
        g.beginPath();
        g.moveTo(-40, -20);
        g.lineTo(type === 'drill' ? 46 : 30, 0);
        g.lineTo(-40, 20);
        g.closePath();
        g.fill();
        g.stroke();
        break;
      case 'chainsaw':
        g.fillRect(-48, -12, 96, 24);
        g.strokeRect(-48, -12, 96, 24);
        break;
      case 'fork':
        g.fillRect(-44, -8, 40, 16);
        g.fillRect(-4, -18, 48, 8);
        g.fillRect(-4, 10, 48, 8);
        g.strokeRect(-44, -8, 40, 16);
        break;
      default:
        g.fillStyle = '#6d6259';
        g.fillRect(-44, -8, 50, 16);
        g.fillStyle = color;
        g.beginPath();
        g.arc(20, 0, 24, 0, Math.PI * 2);
        g.fill();
        g.stroke();
    }
    g.restore();
  }

  // ------------------------------------------------------------ battles
  async startQuickBattle(): Promise<void> {
    await new Promise((r) => setTimeout(r, 250));
    const opp = OPPONENTS[this.oppIdx++ % OPPONENTS.length];
    this.runBattle('quick', opp.card, opp.build);
  }

  async startLocalBattle(p2: CarBuild, p2Name = 'P2'): Promise<void> {
    this.runBattle('local', { name: p2Name, avatar: 'av_punk', trophies: 0 }, p2);
  }

  setBattleSpeed(speed: 1 | 2): void {
    this.speed = speed;
    if (this.battle) this.battle.hud.speed = speed;
  }

  skipBattle(): void {
    const b = this.battle;
    if (!b || b.ended) return;
    const k0 = b.hud.hp[0] / b.hud.maxHp[0];
    const k1 = b.hud.hp[1] / b.hud.maxHp[1];
    const loser: Side = k0 < k1 ? 0 : 1;
    b.hud.hp[loser] = 0;
    this.finish(b);
  }

  private runBattle(mode: BattleMode, opp: PlayerCard, oppBuild: CarBuild): void {
    const p = this.store.get();
    const b0 = this.store.build();
    const b1 = sanitizeBuild(oppBuild);
    const s0 = computeStats(b0);
    const s1 = computeStats(b1);
    const m = this.onlineState.match;
    this.battle = {
      mode,
      builds: [b0, b1],
      t: 0,
      hitT: 0,
      step: 0,
      ended: false,
      outroT: 0,
      seed: Math.floor(Math.random() * 1e9),
      hud: {
        mode,
        names: [mode === 'local' ? `${p.name} (1P)` : p.name, opp.name],
        avatars: [this.avatarUrl(p.avatar), this.avatarUrl(opp.avatar)],
        hp: [s0.hp, s1.hp],
        maxHp: [s0.hp, s1.hp],
        power: [s0.damage, s1.damage],
        time: 0,
        suddenDeathIn: 30,
        suddenDeath: false,
        speed: this.speed,
        you: mode === 'local' ? null : 0,
        round: mode === 'online' && m ? { n: m.round, score: [...m.score] as [number, number], roundsToWin: m.roundsToWin } : undefined,
        phase: 'intro',
      },
    };
    this.showScreen('battle');
    this.emit('battleHud', { ...this.battle.hud });
    this.emit('battleEvent', { type: 'banner', text: '준비!', tone: 'neutral', ms: 1100 });
  }

  private tickBattle(dt: number): void {
    const b = this.battle;
    if (!b) return;
    const d = dt * b.hud.speed;
    b.t += d;
    const hud = b.hud;
    if (b.ended) {
      b.outroT += d;
      if (b.outroT > 1.4 && b.step !== 99) {
        b.step = 99;
        this.emitEnd(b);
      }
      return;
    }
    const cd = [1.2, 1.9, 2.6, 3.3];
    while (b.step < 4 && b.t >= cd[b.step]) {
      if (b.step < 3) {
        hud.phase = 'countdown';
        this.emit('battleEvent', { type: 'countdown', value: 3 - b.step });
      } else {
        hud.phase = 'fight';
        this.emit('battleEvent', { type: 'countdown', value: 'FIGHT' });
      }
      b.step++;
    }
    if (hud.phase === 'fight') {
      hud.time += d;
      hud.suddenDeathIn = Math.max(0, 30 - hud.time);
      if (!hud.suddenDeath && hud.suddenDeathIn <= 0) {
        hud.suddenDeath = true;
        this.emit('battleEvent', { type: 'banner', text: '서든 데스!', tone: 'danger', ms: 1500 });
      }
      b.hitT -= d;
      if (b.hitT <= 0 && hud.time > 0.8) {
        b.hitT = 0.35 + Math.random() * 0.6;
        const side: Side = Math.random() < 0.52 ? 1 : 0;
        const amount = Math.max(1, Math.round(hud.maxHp[side] * (0.03 + Math.random() * 0.09) * (hud.suddenDeath ? 2 : 1)));
        hud.hp[side] = Math.max(0, hud.hp[side] - amount);
        const pos = this.carScreen(side);
        this.emit('battleEvent', { type: 'hit', side, amount, x: pos.x, y: pos.y });
        if (hud.mode === 'online' && Math.random() < 0.08) this.emit('battleEvent', { type: 'emote', side: 1, id: Math.floor(Math.random() * 4) });
        if (hud.hp[side] <= 0) this.finish(b);
      }
      if (hud.time >= 60) this.finish(b);
    }
    this.emit('battleHud', { ...hud, hp: [...hud.hp] as [number, number] });
  }

  private carScreen(side: Side): { x: number; y: number } {
    const b = this.battle;
    const approach = b ? Math.min(1, Math.max(0, (b.hud.time - 0) / 2)) : 1;
    const x = innerWidth / 2 + (side === 0 ? -1 : 1) * innerWidth * (0.3 - 0.18 * approach);
    return { x, y: innerHeight * 0.6 };
  }

  private finish(b: FakeBattle): void {
    if (b.ended) return;
    b.ended = true;
    b.hud.phase = 'outro';
    this.emit('battleHud', { ...b.hud, hp: [...b.hud.hp] as [number, number] });
    const ko = b.hud.hp[0] <= 0 || b.hud.hp[1] <= 0;
    this.emit('battleEvent', { type: 'banner', text: ko ? 'K.O.!' : '시간 종료!', tone: 'danger', ms: 1300 });
  }

  private emitEnd(b: FakeBattle): void {
    const hud = b.hud;
    const k0 = hud.hp[0] / hud.maxHp[0];
    const k1 = hud.hp[1] / hud.maxHp[1];
    const winner: Side | -1 = Math.abs(k0 - k1) < 0.001 ? -1 : k0 > k1 ? 0 : 1;
    const dealt: [number, number] = [Math.round(hud.maxHp[1] - hud.hp[1]), Math.round(hud.maxHp[0] - hud.hp[0])];
    if (b.mode === 'quick') {
      const reward = this.store.applyBattle(winner === -1 ? 'draw' : winner === 0 ? 'win' : 'loss', true, b.seed);
      this.emit('battleEnd', { mode: 'quick', winner, you: 0, names: hud.names, avatars: hud.avatars, dealt, reward });
    } else if (b.mode === 'local') {
      this.emit('battleEnd', { mode: 'local', winner, you: null, names: hud.names, avatars: hud.avatars, dealt });
    } else {
      const m = this.onlineState.match!;
      const score: [number, number] = [...m.score] as [number, number];
      if (winner !== -1) score[winner]++;
      const matchOver = score[0] >= m.roundsToWin || score[1] >= m.roundsToWin;
      const matchWinner: Side | -1 | undefined = matchOver ? (score[0] > score[1] ? 0 : 1) : undefined;
      const trophyDelta = matchOver ? (matchWinner === 0 ? 30 : -15) : undefined;
      if (matchOver && trophyDelta !== undefined) {
        this.store.applyBattle(matchWinner === 0 ? 'win' : 'loss', true, b.seed);
      }
      this.setMatch({ ...m, score, phase: matchOver ? 'done' : 'roundResult', lastRoundWinner: winner, matchWinner, trophyDelta });
      this.emit('battleEnd', {
        mode: 'online',
        winner,
        you: 0,
        names: hud.names,
        avatars: hud.avatars,
        dealt,
        online: { round: m.round, score, matchOver, matchWinner, trophyDelta },
      });
      if (!matchOver) {
        this.later(3500, () => {
          const cur = this.onlineState.match;
          if (!cur) return;
          this.setMatch({ ...cur, round: cur.round + 1, phase: 'build', buildDeadline: Date.now() + 15000, youReady: false, opponentReady: false });
          this.showScreen('online');
          this.scheduleOppReady();
        });
      }
    }
    this.battle = null;
  }

  // ------------------------------------------------------------ online
  online = {
    getState: (): OnlineState => this.onlineState,
    connect: () => {
      this.setOnline({ status: 'connecting', online: 0 });
      this.later(700, () => {
        if (this.failConnect) this.setOnline({ status: 'offline', online: 0, error: '서버에 연결할 수 없어요' });
        else this.setOnline({ status: 'idle', online: 37 });
      });
    },
    queue: () => {
      this.clearOnlineTimers();
      this.setOnline({ status: 'queued', online: this.onlineState.online || 37 });
      this.later(2600, () => this.startMatch());
    },
    cancel: () => {
      this.clearOnlineTimers();
      this.setOnline({ status: 'idle', online: this.onlineState.online });
    },
    createRoom: () => {
      this.clearOnlineTimers();
      this.setOnline({ status: 'room', online: this.onlineState.online, roomCode: 'MEOW' });
      this.later(8000, () => this.startMatch());
    },
    joinRoom: (code: string) => {
      if (!/^[A-Z]{4}$/.test(code)) {
        this.emit('toast', { text: '코드는 영문 4글자예요', tone: 'bad' });
        return;
      }
      if (code === 'XXXX') {
        this.emit('toast', { text: '방을 찾을 수 없어요', tone: 'bad' });
        return;
      }
      this.setOnline({ status: 'connecting', online: this.onlineState.online });
      this.later(800, () => this.startMatch());
    },
    ready: () => {
      const m = this.onlineState.match;
      if (!m || m.phase !== 'build') return;
      this.setMatch({ ...m, youReady: true });
      this.maybeStartRound();
    },
    leave: () => {
      this.clearOnlineTimers();
      this.setOnline({ status: 'idle', online: this.onlineState.online });
    },
    emote: (id: number) => {
      this.later(900, () => this.emit('battleEvent', { type: 'emote', side: 1, id: (id + 1) % 4 }));
    },
  };

  private startMatch(): void {
    const opp = OPPONENTS[this.oppIdx++ % OPPONENTS.length];
    const match: OnlineMatchState = {
      matchId: `m${Date.now()}`,
      opponent: opp.card,
      you: 0,
      round: 1,
      score: [0, 0],
      roundsToWin: ROUNDS_TO_WIN,
      phase: 'build',
      buildDeadline: Date.now() + 25000,
      youReady: false,
      opponentReady: false,
      opponentBuild: sanitizeBuild(opp.build),
    };
    this.setOnline({ status: 'match', online: this.onlineState.online, match });
    this.scheduleOppReady();
  }

  private scheduleOppReady(): void {
    this.later(4000 + Math.random() * 4000, () => {
      const m = this.onlineState.match;
      if (!m || m.phase !== 'build') return;
      this.setMatch({ ...m, opponentReady: true });
      this.maybeStartRound();
    });
  }

  private maybeStartRound(): void {
    const m = this.onlineState.match;
    if (!m || m.phase !== 'build') return;
    if ((m.youReady && m.opponentReady) || Date.now() >= m.buildDeadline) {
      this.setMatch({ ...m, phase: 'battle' });
      this.later(600, () => this.runBattle('online', m.opponent, m.opponentBuild));
    }
  }

  private setMatch(m: OnlineMatchState): void {
    this.setOnline({ ...this.onlineState, status: 'match', match: m });
  }

  private setOnline(s: OnlineState): void {
    this.onlineState = s;
    this.emit('online', s);
  }

  private later(ms: number, fn: () => void): void {
    this.onlineTimers.push(window.setTimeout(fn, ms));
  }

  private clearOnlineTimers(): void {
    for (const t of this.onlineTimers) clearTimeout(t);
    this.onlineTimers = [];
  }

  // ------------------------------------------------------------ misc
  sfx(name: SfxName): void {
    if (this.store.get().muted) return;
    (window as unknown as { __sfxLog?: string[] }).__sfxLog?.push(name);
  }

  setMuted(muted: boolean): void {
    this.store.setMuted(muted);
  }

  // ------------------------------------------------------------ fake renderer
  detach(): void {
    cancelAnimationFrame(this.raf);
  }

  attachCanvas(canvas: HTMLCanvasElement): void {
    this.ctx2d = canvas.getContext('2d');
    this.bg = new Image();
    this.bg.src = `${import.meta.env.BASE_URL}assets/img/bg_garage.jpg`;
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - this.lastT) / 1000);
      this.lastT = t;
      if (this._screen === 'online') this.maybeStartRound();
      this.tickBattle(dt);
      this.draw(canvas);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private draw(canvas: HTMLCanvasElement): void {
    const g = this.ctx2d;
    if (!g) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = innerWidth;
    const hgt = innerHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hgt * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.bg?.complete && this.bg.naturalWidth) {
      const k = Math.max(w / this.bg.naturalWidth, hgt / this.bg.naturalHeight);
      const iw = this.bg.naturalWidth * k;
      const ih = this.bg.naturalHeight * k;
      g.drawImage(this.bg, (w - iw) / 2, (hgt - ih) / 2, iw, ih);
    } else {
      g.fillStyle = '#5b4636';
      g.fillRect(0, 0, w, hgt);
    }
    if (this._screen === 'battle') {
      g.fillStyle = 'rgba(0,0,0,.15)';
      g.fillRect(0, hgt * 0.68, w, hgt * 0.32);
      const bt = this.battle;
      const builds = bt?.builds ?? [this.store.build(), defaultBuild()];
      const s = Math.min(w / 9, hgt / 4.5);
      for (const side of [0, 1] as const) {
        const p = this.carScreen(side);
        this.drawCar(g, builds[side], p.x, hgt * 0.68 - 0.5 * s, s, side === 0 ? 1 : -1);
      }
      return;
    }
    if (this._screen === 'league') return;
    const { cx, cy, s } = this.garageXf();
    this.drawCar(g, this.displayBuild(), cx, cy, s, 1);
    if (this.editing) {
      g.strokeStyle = 'rgba(255,255,255,.15)';
      g.setLineDash([6, 6]);
      const f = this.frame;
      g.strokeRect(f.left + 0.5, f.top + 0.5, f.width - 1, f.height - 1);
      g.setLineDash([]);
    }
    void this.highlighted;
  }

  private drawCar(g: CanvasRenderingContext2D, b: CarBuild, cx: number, cy: number, s: number, dir: 1 | -1): void {
    const ch = getChassis(b.chassis.id);
    const X = (x: number) => cx + x * s * dir;
    const Y = (y: number) => cy - y * s;
    g.lineWidth = Math.max(2, s * 0.03);
    g.strokeStyle = '#1d1916';
    g.lineJoin = 'round';
    // weapons
    ch.weaponSlots.forEach((slot, i) => {
      const ref = b.weapons[i];
      if (!ref) return;
      const wd = getWeapon(ref.id);
      const d = slot.mount === 'back' ? -1 : 1;
      const ang = slot.mount === 'top' ? -0.6 : 0;
      g.save();
      g.translate(X(slot.pos.x), Y(slot.pos.y));
      g.scale(dir * d, 1);
      g.rotate(ang);
      g.fillStyle = wd.color;
      g.fillRect(0, -wd.radius * s * 0.6, wd.length * s, wd.radius * s * 1.2);
      g.strokeRect(0, -wd.radius * s * 0.6, wd.length * s, wd.radius * s * 1.2);
      g.restore();
    });
    // body
    g.fillStyle = b.paint ?? ch.color;
    g.beginPath();
    ch.shape.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))));
    g.closePath();
    g.fill();
    g.stroke();
    // cat
    g.fillStyle = '#f08a2c';
    g.beginPath();
    g.arc(X(ch.cockpit.x), Y(ch.cockpit.y + 0.18), 0.16 * s, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    // gadgets
    ch.gadgetSlots.forEach((p, i) => {
      const ref = b.gadgets[i];
      if (!ref) return;
      const gd = getGadget(ref.id);
      g.fillStyle = gd.color;
      g.fillRect(X(p.x) - 0.1 * s, Y(p.y) - 0.14 * s, 0.2 * s, 0.28 * s);
      g.strokeRect(X(p.x) - 0.1 * s, Y(p.y) - 0.14 * s, 0.2 * s, 0.28 * s);
    });
    // wheels
    ch.wheelSlots.forEach((p, i) => {
      const ref = b.wheels[i];
      if (!ref) return;
      const wd = getWheel(ref.id);
      this.wheel(g, X(p.x), Y(p.y), wd.radius * s, wd.color);
    });
  }

  /** Test helpers for the preview. */
  debug = {
    giveCrates: () => {
      const p = this.store.get() as { crates: string[] };
      p.crates.splice(0, p.crates.length, 'wood', 'silver', 'gold');
      this.store.setMuted(this.store.get().muted);
    },
    richer: () => {
      const p = this.store.get() as { coins: number; trophies: number };
      p.coins += 1000;
      p.trophies += 320;
      this.store.setMuted(this.store.get().muted);
    },
    online: (status: OnlineState['status'], extra: Partial<OnlineState> = {}) => this.setOnline({ ...this.onlineState, status, ...extra }),
    matchPhase: (phase: OnlineMatchState['phase'], extra: Partial<OnlineMatchState> = {}) => {
      if (!this.onlineState.match) this.startMatch();
      this.clearOnlineTimers();
      this.setMatch({ ...this.onlineState.match!, phase, ...extra });
    },
  };
}
