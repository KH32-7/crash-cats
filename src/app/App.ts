import * as THREE from 'three';
import { AudioSystem } from '../audio/Audio';
import { BattleView, type BattleFinish, type BattleMeta } from '../game/BattleView';
import { GarageView } from '../game/GarageView';
import { Assets } from '../render/Assets';
import { renderPartThumbnail } from '../render/models/thumbnails';
import { getStudioEnvironment } from '../render/materials';
import { sanitizeBuild, type CarBuild } from '../shared/parts';
import type { PlayerCard, ServerMsg } from '../shared/protocol';
import { initPhysics } from '../shared/sim/Battle';
import { ARENAS, type ArenaId, type CarIndex, type MatchSetup } from '../shared/sim/types';
import type {
  AppApi,
  AppEvents,
  BattleMode,
  BattleOutcome,
  OnlineState,
  Screen,
  SfxName,
  Side,
} from './AppApi';
import { makeBot } from './bots';
import { Net, serverUrl, type NetLike } from './Net';
import { P2PNet } from './P2PNet';
import { AVATARS, Store, type AvatarId, type BattleReward, type SlotKind } from './Store';

type Listener<K extends keyof AppEvents> = (payload: AppEvents[K]) => void;

interface CurrentBattle {
  mode: BattleMode;
  seed: number;
  you: Side | null;
  names: [string, string];
  avatars: [string, string];
  finished: BattleFinish | null;
  round?: number;
  /** Test-hook showcase battles never touch the profile. */
  noReward?: boolean;
}

function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] >>> 0;
}

function catVariantFor(avatar: string): number {
  const i = AVATARS.indexOf(avatar as AvatarId);
  return i >= 0 ? i : 1;
}

export class App implements AppApi {
  readonly store = new Store();
  readonly audio = new AudioSystem();
  readonly assets = new Assets();
  private readonly renderer: THREE.WebGLRenderer;
  private garageView!: GarageView;
  private battleView!: BattleView;
  /** ws server when one is reachable/configured, otherwise serverless P2P rooms (GitHub Pages). */
  private readonly net: NetLike = serverUrl() ? new Net() : new P2PNet();
  private currentScreen: Screen = 'home';
  private readonly listeners = new Map<keyof AppEvents, Set<Listener<keyof AppEvents>>>();
  private onlineState: OnlineState = { status: 'offline', online: 0, mode: serverUrl() ? 'server' : 'p2p' };
  private garageOverride: CarBuild | null = null;
  private battle: CurrentBattle | null = null;
  private pendingRound: { result?: Extract<ServerMsg, { t: 'roundResult' }>; end?: Extract<ServerMsg, { t: 'matchEnd' }>; at: number } | null = null;
  private onlineEndTimer: number | null = null;
  private battleEndEmittedAt = 0;
  private paused = false;
  private frame = 0;
  private lastTime = 0;
  private viewW = 1;
  private viewH = 1;
  private buildSyncTimer: number | null = null;
  private ready = false;
  private starting = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  async init(onProgress?: (p: number) => void): Promise<void> {
    await Promise.all([this.assets.loadCore(onProgress), initPhysics()]);
    this.garageView = new GarageView(this.assets);
    this.battleView = new BattleView(this.assets, this.audio, {
      hud: (s) => this.emit('battleHud', s),
      ui: (e) => this.emit('battleEvent', e),
      finished: (r) => this.onBattleFinished(r),
    });
    // Metals need an environment map to read as metal (see render/materials.ts).
    const env = getStudioEnvironment(this.renderer);
    for (const scene of [this.garageView.scene, this.battleView.scene]) {
      scene.environment = env;
      scene.environmentIntensity = 0.5;
    }
    this.audio.setMuted(this.store.get().muted);
    this.store.subscribe(() => this.onProfileChanged());
    this.onProfileChanged();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.net.on((m) => this.onServer(m));
    this.net.onStatus((s) => {
      if (s === 'connecting' && this.onlineState.status === 'offline') this.setOnline({ status: 'connecting' });
      if (s === 'open') this.setOnline({ status: this.onlineState.match ? 'match' : 'idle', error: undefined });
      if (s === 'closed') {
        const hadMatch = !!this.onlineState.match && this.onlineState.match.phase !== 'done';
        this.setOnline({ status: 'offline', roomCode: undefined, match: hadMatch ? { ...this.onlineState.match!, phase: 'done', forfeit: true } : this.onlineState.match });
        if (hadMatch) {
          // The server treats a dropped connection as a forfeit: settle the loss here too.
          this.store.applyOnlineMatch(-15, 'loss', randomSeed());
          this.toast('서버 연결이 끊겨 매치가 종료되었어요', 'bad');
          if (this.currentScreen === 'battle' && this.battle?.mode === 'online') this.showScreen('online');
        }
      }
    });
    this.online.connect();
    this.installTestHooks();
    this.ready = true;
    this.audio.startMusic('menu');
    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  // ------------------------------------------------------------------ events

  on<K extends keyof AppEvents>(event: K, fn: (payload: AppEvents[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<keyof AppEvents>);
    return () => set!.delete(fn as Listener<keyof AppEvents>);
  }

  private emit<K extends keyof AppEvents>(event: K, payload: AppEvents[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) (fn as Listener<K>)(payload);
  }

  private toast(text: string, tone: 'neutral' | 'good' | 'bad' = 'neutral'): void {
    this.emit('toast', { text, tone });
  }

  // ------------------------------------------------------------------ screens

  get screen(): Screen {
    return this.currentScreen;
  }

  showScreen(screen: Screen): void {
    const prev = this.currentScreen;
    this.currentScreen = screen;
    if (prev === 'battle' && screen !== 'battle') {
      this.battleView.stop();
      this.battle = null;
      this.audio.startMusic('menu');
    }
    if (screen === 'battle') this.audio.startMusic('battle');
    if (screen !== 'garage' && screen !== 'p2build') this.garageView?.setEditing(false);
    if (screen === 'home' || screen === 'garage' || screen === 'crates' || screen === 'league') this.garageOverride = null;
    this.emit('screen', screen);
  }

  // ------------------------------------------------------------------ garage api

  readonly garage = {
    setBuildOverride: (build: CarBuild | null) => {
      this.garageOverride = build ? sanitizeBuild(build) : null;
    },
    getSlotAnchors: () => (this.garageView ? this.garageView.getSlotAnchors() : []),
    highlightSlot: (slot: { kind: SlotKind; index: number } | null) => this.garageView?.setHighlight(slot),
    setEditing: (editing: boolean) => this.garageView?.setEditing(editing),
    setFrame: (rect: { left: number; top: number; width: number; height: number }) => this.garageView?.setFrame(rect),
  };

  partIcon(id: string): string {
    return renderPartThumbnail(id);
  }

  avatarUrl(avatar: string): string {
    return `${import.meta.env.BASE_URL}assets/img/${/^av_[a-z]+$/.test(avatar) ? avatar : 'av_player'}.png`;
  }

  sfx(name: SfxName): void {
    this.audio.ui(name);
  }

  setMuted(muted: boolean): void {
    this.store.setMuted(muted);
    this.audio.setMuted(muted);
  }

  private onProfileChanged(): void {
    const p = this.store.get();
    this.garageView?.setCatVariant(catVariantFor(p.avatar));
    if (this.buildSyncTimer !== null) window.clearTimeout(this.buildSyncTimer);
    this.buildSyncTimer = window.setTimeout(() => {
      this.net.send({ t: 'updateBuild', build: this.store.build() });
    }, 1200);
  }

  // ------------------------------------------------------------------ battles

  private async runBattle(
    mode: BattleMode,
    seed: number,
    builds: [CarBuild, CarBuild],
    cards: [PlayerCard, PlayerCard],
    cats: [number, number],
    you: Side | null,
    arena?: ArenaId,
    round?: BattleMeta['round'],
  ): Promise<void> {
    const setup: MatchSetup = { seed, builds, arena: arena ?? ARENAS[seed % ARENAS.length] };
    const names: [string, string] = [cards[0].name, cards[1].name];
    const avatars: [string, string] = [this.avatarUrl(cards[0].avatar), this.avatarUrl(cards[1].avatar)];
    this.battle = { mode, seed, you, names, avatars, finished: null, round: round?.n };
    this.showScreen('battle');
    await this.battleView.start(setup, { mode, names, avatars, catVariants: cats, you, round });
  }

  private myCard(): PlayerCard {
    const p = this.store.get();
    return { name: p.name, avatar: p.avatar, trophies: p.trophies };
  }

  async startQuickBattle(): Promise<void> {
    if (this.battleView.active || this.starting) return;
    this.starting = true;
    try {
      await this.startQuickBattleInner();
    } finally {
      this.starting = false;
    }
  }

  private async startQuickBattleInner(): Promise<void> {
    const seed = randomSeed();
    const me = this.myCard();
    let opp: { card: PlayerCard; build: CarBuild; cat: number } | null = null;
    if (this.net.connected) {
      this.net.send({ t: 'requestGhost', trophies: me.trophies });
      const m = await this.net.waitFor((x): x is Extract<ServerMsg, { t: 'ghost' }> => x.t === 'ghost', 1500);
      if (m?.found && m.card && m.build) opp = { card: m.card, build: m.build, cat: catVariantFor(m.card.avatar) };
    }
    if (!opp) {
      const bot = makeBot(me.trophies, seed);
      opp = { card: bot.card, build: bot.build, cat: bot.catVariant };
    }
    await this.runBattle('quick', seed, [this.store.build(), opp.build], [me, opp.card], [catVariantFor(me.avatar), opp.cat], 0);
  }

  async startLocalBattle(p2: CarBuild, p2Name = 'P2'): Promise<void> {
    if (this.battleView.active || this.starting) return;
    const seed = randomSeed();
    const me = this.myCard();
    await this.runBattle('local', seed, [this.store.build(), p2], [me, { name: p2Name, avatar: 'av_tomcat', trophies: 0 }], [catVariantFor(me.avatar), 1], null);
  }

  setBattleSpeed(speed: 1 | 2): void {
    this.battleView.setSpeed(speed);
  }

  skipBattle(): void {
    this.battleView.skip();
  }

  private onBattleFinished(r: BattleFinish): void {
    const b = this.battle;
    if (!b) return;
    b.finished = r;
    const youWon = b.you !== null && r.winner === b.you;
    if (b.mode === 'online') {
      const match = this.onlineState.match;
      if (match) this.net.send({ t: 'roundWatched', round: match.round, hash: r.hash, winner: r.winner });
      this.tryEmitOnlineRoundEnd();
      return;
    }
    let reward: BattleReward | undefined;
    if (b.mode === 'quick' && !b.noReward) {
      const outcome = r.winner === -1 ? 'draw' : youWon ? 'win' : 'loss';
      reward = this.store.applyBattle(outcome, true, b.seed);
      this.audio.voice(outcome === 'win' ? 'victory' : outcome === 'draw' ? 'draw' : 'defeat');
    } else {
      this.audio.voice(r.winner === -1 ? 'draw' : 'victory');
    }
    const outcome: BattleOutcome = { mode: b.mode, winner: r.winner, you: b.you, names: b.names, avatars: b.avatars, dealt: r.dealt, reward };
    this.battleEndEmittedAt = performance.now();
    this.emit('battleEnd', outcome);
  }

  private tryEmitOnlineRoundEnd(): void {
    const b = this.battle;
    const pr = this.pendingRound;
    if (!b || b.mode !== 'online' || !b.finished || !pr?.result) return;
    if (this.onlineEndTimer !== null) return;
    // Give a matchEnd that follows the roundResult a moment to arrive.
    const wait = pr.end ? 0 : Math.max(0, 350 - (performance.now() - pr.at));
    this.onlineEndTimer = window.setTimeout(() => {
      this.onlineEndTimer = null;
      const cur = this.pendingRound;
      if (!cur?.result || !this.battle?.finished) return;
      const match = this.onlineState.match;
      const you = (match?.you ?? 0) as Side;
      const end = cur.end;
      let reward: BattleReward | undefined;
      if (end) {
        const outcome = end.winner === -1 ? 'draw' : end.winner === you ? 'win' : 'loss';
        reward = this.store.applyOnlineMatch(end.trophyDelta, outcome, this.battle.seed);
      }
      const roundWinner = cur.result.winner;
      this.audio.voice(roundWinner === -1 ? 'draw' : roundWinner === you ? 'victory' : 'defeat');
      const outcome: BattleOutcome = {
        mode: 'online',
        winner: roundWinner,
        you,
        names: this.battle.names,
        avatars: this.battle.avatars,
        dealt: this.battle.finished.dealt,
        reward,
        online: {
          round: cur.result.round,
          score: cur.result.score,
          matchOver: !!end,
          matchWinner: end?.winner,
          trophyDelta: end?.trophyDelta,
        },
      };
      this.pendingRound = null;
      this.battleEndEmittedAt = performance.now();
      this.emit('battleEnd', outcome);
    }, wait);
  }

  // ------------------------------------------------------------------ online

  readonly online = {
    getState: () => this.onlineState,
    connect: () => {
      this.net.connect(() => ({ t: 'hello', playerId: this.store.get().playerId, card: this.myCard(), build: this.store.build() }));
    },
    queue: () => {
      if (!this.net.send({ t: 'queue' })) return this.toast('서버에 연결되지 않았어요', 'bad');
      this.setOnline({ status: 'queued', error: undefined, match: undefined });
    },
    cancel: () => {
      this.net.send({ t: 'cancelQueue' });
      this.setOnline({ status: 'idle', roomCode: undefined });
    },
    createRoom: () => {
      if (!this.net.send({ t: 'createRoom' })) this.toast('서버에 연결되지 않았어요', 'bad');
    },
    joinRoom: (code: string) => {
      if (!this.net.send({ t: 'joinRoom', code: code.trim().toUpperCase() })) this.toast('서버에 연결되지 않았어요', 'bad');
    },
    ready: () => {
      const match = this.onlineState.match;
      if (!match || match.phase !== 'build') return;
      this.net.send({ t: 'ready', build: this.store.build() });
      this.setOnline({ match: { ...match, youReady: true } });
    },
    leave: () => {
      const m = this.onlineState.match;
      // Leaving a live match is a forfeit (the server sends the leaver no matchEnd).
      if (m && m.phase !== 'done') this.store.applyOnlineMatch(-15, 'loss', randomSeed());
      this.net.send({ t: 'leave' });
      this.setOnline({ status: this.net.connected ? 'idle' : 'offline', match: undefined, roomCode: undefined });
      if (this.currentScreen === 'battle') this.showScreen('online');
    },
    emote: (id: number) => {
      this.net.send({ t: 'emote', id });
      const you = this.onlineState.match?.you;
      if (you !== undefined) this.emit('battleEvent', { type: 'emote', side: you, id });
    },
  };

  private setOnline(patch: Partial<OnlineState>): void {
    this.onlineState = { ...this.onlineState, ...patch };
    this.emit('online', this.onlineState);
  }

  private onServer(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome':
      case 'online':
        this.setOnline({ online: m.online });
        break;
      case 'queued':
        this.setOnline({ status: 'queued' });
        break;
      case 'roomCreated':
        this.setOnline({ status: 'room', roomCode: m.code });
        break;
      case 'error':
        this.setOnline({ error: m.message });
        this.toast(m.message, 'bad');
        break;
      case 'matchFound':
        this.audio.ui('reveal');
        this.setOnline({
          status: 'match',
          roomCode: undefined,
          match: {
            matchId: m.matchId,
            opponent: m.opponent,
            you: m.you,
            round: 0,
            score: [0, 0],
            roundsToWin: m.roundsToWin,
            phase: 'build',
            buildDeadline: Date.now() + 25000,
            youReady: false,
            opponentReady: false,
            opponentBuild: m.opponentBuild,
          },
        });
        if (this.currentScreen !== 'garage') this.showScreen('online');
        break;
      case 'buildPhase': {
        const match = this.onlineState.match;
        if (!match) return;
        this.setOnline({
          match: { ...match, round: m.round, score: m.score, phase: 'build', buildDeadline: Date.now() + m.seconds * 1000, youReady: false, opponentReady: false, opponentBuild: m.opponentBuild },
        });
        if (this.currentScreen === 'battle') {
          const since = performance.now() - this.battleEndEmittedAt;
          window.setTimeout(() => {
            if (this.currentScreen === 'battle' && this.onlineState.match?.phase === 'build') this.showScreen('online');
          }, Math.max(0, 2600 - since));
        }
        break;
      }
      case 'opponentReady': {
        const match = this.onlineState.match;
        if (match) this.setOnline({ match: { ...match, opponentReady: true } });
        break;
      }
      case 'roundStart': {
        const match = this.onlineState.match;
        if (!match) return;
        this.setOnline({ match: { ...match, phase: 'battle', round: m.round } });
        this.pendingRound = null;
        const me = this.myCard();
        const cards: [PlayerCard, PlayerCard] = match.you === 0 ? [me, match.opponent] : [match.opponent, me];
        const cats: [number, number] = [catVariantFor(cards[0].avatar), catVariantFor(cards[1].avatar)];
        if (this.battleView.active) this.battleView.stop();
        void this.runBattle('online', m.seed, m.builds, cards, cats, match.you, m.arena, { n: m.round, score: match.score, roundsToWin: match.roundsToWin });
        break;
      }
      case 'roundResult': {
        const match = this.onlineState.match;
        if (match) this.setOnline({ match: { ...match, score: m.score, lastRoundWinner: m.winner, phase: 'roundResult' } });
        this.pendingRound = { ...(this.pendingRound ?? {}), result: m, at: performance.now() };
        this.tryEmitOnlineRoundEnd();
        break;
      }
      case 'matchEnd': {
        const match = this.onlineState.match;
        if (!match) break; // we already left this match
        if (match) this.setOnline({ match: { ...match, phase: 'done', matchWinner: m.winner, trophyDelta: m.trophyDelta, score: m.score, forfeit: m.reason === 'forfeit' } });
        if (m.reason === 'forfeit') {
          // No round result will follow; settle immediately.
          const you = match.you;
          const outcome = m.winner === -1 ? 'draw' : m.winner === you ? 'win' : 'loss';
          this.store.applyOnlineMatch(m.trophyDelta, outcome, randomSeed());
          this.toast(outcome === 'win' ? '상대가 나갔어요 — 부전승!' : '매치가 종료되었어요', outcome === 'win' ? 'good' : 'neutral');
          if (this.currentScreen === 'battle') this.showScreen('online');
        } else {
          this.pendingRound = { ...(this.pendingRound ?? { at: performance.now() }), end: m };
          this.tryEmitOnlineRoundEnd();
        }
        break;
      }
      case 'opponentLeft':
        this.toast('상대가 연결을 끊었어요', 'bad');
        break;
      case 'ghost':
        break;
      case 'emote': {
        this.emit('battleEvent', { type: 'emote', side: m.from, id: m.id });
        break;
      }
    }
  }

  // ------------------------------------------------------------------ loop

  private resize(): void {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.viewW = w;
    this.viewH = h;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.garageView?.onResize(w, h);
    this.battleView?.onResize(w, h);
  }

  private readonly tick = (now: number) => {
    requestAnimationFrame(this.tick);
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.frame++;
    if (this.canvas.clientWidth !== this.viewW || this.canvas.clientHeight !== this.viewH) this.resize();
    const inBattle = this.currentScreen === 'battle' && this.battleView.active;
    if (!this.paused) {
      if (inBattle) {
        this.battleView.update(dt);
      } else {
        this.garageView.setBuild(this.garageOverride ?? this.store.build());
        this.garageView.update(dt);
      }
    }
    if (inBattle) this.renderer.render(this.battleView.scene, this.battleView.camera);
    else this.renderer.render(this.garageView.scene, this.garageView.camera);
    this.publishDiagnostics();
  };

  // ------------------------------------------------------------------ test hooks

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    const snap = this.battleView?.snapshot();
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      screen: this.currentScreen,
      ready: this.ready,
      battle: snap
        ? { time: snap.time, over: snap.over, winner: snap.winner, hp: [snap.cars[0].hp, snap.cars[1].hp], suddenDeath: snap.suddenDeath, x: [snap.cars[0].chassis.x, snap.cars[1].chassis.x] }
        : null,
      online: { status: this.onlineState.status, online: this.onlineState.online, phase: this.onlineState.match?.phase ?? null, mode: this.onlineState.mode ?? 'server', roomCode: this.onlineState.roomCode ?? null, score: this.onlineState.match?.score ?? null },
      profile: { trophies: this.store.get().trophies, coins: this.store.get().coins, crates: this.store.get().crates.length },
      renderer: { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures },
      canvas: { clientWidth: this.canvas.clientWidth, clientHeight: this.canvas.clientHeight, width: this.canvas.width, height: this.canvas.height, dpr: this.renderer.getPixelRatio() },
    };
  }

  private installTestHooks(): void {
    const box: CarBuild = {
      chassis: { id: 'box', level: 3 },
      wheels: [{ id: 'wheel_heavy', level: 3 }, { id: 'wheel_heavy', level: 3 }, { id: 'wheel_heavy', level: 3 }],
      weapons: [{ id: 'punch', level: 3 }, { id: 'rocket', level: 3 }, { id: 'chainsaw', level: 3 }],
      gadgets: [{ id: 'armor', level: 3 }],
    };
    const tower: CarBuild = {
      chassis: { id: 'tower', level: 4 },
      wheels: [{ id: 'wheel_bigfoot', level: 4 }, { id: 'wheel_bigfoot', level: 4 }],
      weapons: [{ id: 'chainsaw', level: 4 }, { id: 'blade', level: 4 }, { id: 'drill', level: 3 }],
      gadgets: [{ id: 'armor', level: 4 }],
      paint: '#3d7fb8',
    };
    // Weapons that cannot reach each other → guaranteed sudden death (bulldozers).
    const turtle = (paint?: string): CarBuild => ({
      chassis: { id: 'wedge', level: 3 },
      wheels: [{ id: 'wheel_spiked', level: 3 }, { id: 'wheel_spiked', level: 3 }],
      weapons: [null, { id: 'drill', level: 3 }],
      gadgets: [{ id: 'armor', level: 3 }],
      paint,
    });
    let seed = 7;
    const startShowcase = async (builds: [CarBuild, CarBuild], arena: ArenaId, advance: number) => {
      if (this.battleView.active) this.battleView.stop();
      await this.runBattle('quick', seed, builds, [this.myCard(), { name: '톰캣', avatar: 'av_tomcat', trophies: 300 }], [0, 1], 0, arena);
      if (this.battle) this.battle.noReward = true;
      this.battleView.warp(advance);
    };
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        seed = value >>> 0;
      },
      setState: async (name: string) => {
        switch (name) {
          case 'home':
          case 'garage':
          case 'crates':
          case 'league':
          case 'online':
            if (this.battleView.active) this.battleView.stop();
            this.showScreen(name as Screen);
            break;
          case 'active-play':
            await startShowcase([box, tower], 'harbor', 2.6);
            break;
          case 'sudden-death':
            await startShowcase([turtle(), turtle('#d8413a')], 'skate', 34.5);
            break;
          default:
            throw new Error(`Unknown test state: ${name}`);
        }
        // Let the UI and garage settle one frame.
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        return { state: name };
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.paused = paused;
      },
      setReducedMotion: () => {},
      hideDebugUi: () => {},
    };
  }
}

export type { CarIndex };
