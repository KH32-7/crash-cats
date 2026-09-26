/**
 * Best-of-3 live duel state machine, shared by the Node server (server/index.ts)
 * and the browser P2P host (src/app/P2PNet.ts). Transport-agnostic: players are
 * ports that can receive ServerMsg. Requires `initPhysics()` to have resolved.
 */
import { sanitizeBuild, type CarBuild } from './parts';
import {
  BUILD_PHASE_NEXT_SECONDS,
  BUILD_PHASE_SECONDS,
  ROUNDS_TO_WIN,
  type ClientMsg,
  type PlayerCard,
  type ServerMsg,
} from './protocol';
import { Battle } from './sim/Battle';
import { ARENAS, SIM, type CarIndex } from './sim/types';

export interface MatchPort {
  card: PlayerCard;
  build: CarBuild;
  send(msg: ServerMsg): void;
}

type Phase = 'build' | 'battle' | 'intermission' | 'done';
type Timer = ReturnType<typeof setTimeout>;

export interface MatchHooks {
  /** Called once when the match ends (players already notified). */
  onEnd?(winner: CarIndex | -1, reason: 'score' | 'forfeit'): void;
  /** A player's build changed (e.g. to update the ghost pool). */
  onBuild?(index: CarIndex, build: CarBuild): void;
  log?(line: string): void;
  random?(): number;
}

export class MatchCore {
  readonly id: string;
  private round = 0;
  private readonly score: [number, number] = [0, 0];
  private phase: Phase = 'build';
  private ready: [boolean, boolean] = [false, false];
  private readonly builds: [CarBuild, CarBuild];
  private timer: Timer | null = null;
  private watched: [boolean, boolean] = [false, false];
  private serverResult: { winner: CarIndex | -1; hash: string } | null = null;
  private clientHashes: [string | null, string | null] = [null, null];
  private readonly random: () => number;

  constructor(
    private readonly players: [MatchPort, MatchPort],
    private readonly hooks: MatchHooks = {},
  ) {
    this.random = hooks.random ?? Math.random;
    this.id = Math.floor(this.random() * 2 ** 40).toString(36);
    this.builds = [sanitizeBuild(players[0].build), sanitizeBuild(players[1].build)];
  }

  get done(): boolean {
    return this.phase === 'done';
  }

  start(): void {
    const [a, b] = this.players;
    a.send({ t: 'matchFound', matchId: this.id, you: 0, opponent: b.card, opponentBuild: this.builds[1], roundsToWin: ROUNDS_TO_WIN });
    b.send({ t: 'matchFound', matchId: this.id, you: 1, opponent: a.card, opponentBuild: this.builds[0], roundsToWin: ROUNDS_TO_WIN });
    this.hooks.log?.(`match ${this.id}: ${a.card.name} vs ${b.card.name}`);
    this.beginBuildPhase();
  }

  /** Route a client message from player `i`. */
  handle(i: CarIndex, msg: ClientMsg): void {
    if (this.phase === 'done') return;
    switch (msg.t) {
      case 'updateBuild': {
        // Garage edits count for the coming round until the player locks in.
        const build = sanitizeBuild(msg.build);
        this.players[i].build = build;
        if (this.phase === 'build' && !this.ready[i]) this.builds[i] = build;
        this.hooks.onBuild?.(i, build);
        break;
      }
      case 'ready': {
        if (this.phase !== 'build') return;
        this.builds[i] = sanitizeBuild(msg.build);
        this.players[i].build = this.builds[i];
        this.hooks.onBuild?.(i, this.builds[i]);
        this.ready[i] = true;
        this.players[1 - i].send({ t: 'opponentReady' });
        if (this.ready[0] && this.ready[1]) this.startRound();
        break;
      }
      case 'roundWatched': {
        if (this.phase !== 'battle' || msg.round !== this.round) return;
        this.watched[i] = true;
        this.clientHashes[i] = String(msg.hash).slice(0, 16);
        if (this.watched[0] && this.watched[1]) this.finishRound();
        break;
      }
      case 'emote':
        this.players[1 - i].send({ t: 'emote', from: i, id: Math.max(0, Math.min(7, Math.floor(Number(msg.id) || 0))) });
        break;
      case 'leave':
        this.leave(i);
        break;
      default:
        break;
    }
  }

  /** Player `i` left or disconnected → forfeit. The leaver gets no matchEnd. */
  leave(i: CarIndex): void {
    if (this.phase === 'done') return;
    this.players[1 - i].send({ t: 'opponentLeft' });
    this.end((1 - i) as CarIndex, 'forfeit', i);
  }

  dispose(): void {
    this.clearTimer();
    this.phase = 'done';
  }

  // ---------------------------------------------------------------- internals

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private beginBuildPhase(): void {
    this.round += 1;
    this.phase = 'build';
    this.ready = [false, false];
    this.watched = [false, false];
    this.clientHashes = [null, null];
    this.serverResult = null;
    const seconds = this.round === 1 ? BUILD_PHASE_SECONDS : BUILD_PHASE_NEXT_SECONDS;
    this.players.forEach((p, i) =>
      p.send({ t: 'buildPhase', round: this.round, seconds, opponentBuild: this.builds[1 - i], score: [this.score[0], this.score[1]] }),
    );
    this.clearTimer();
    this.timer = setTimeout(() => this.startRound(), (seconds + 1) * 1000);
  }

  private startRound(): void {
    if (this.phase !== 'build') return;
    this.clearTimer();
    this.phase = 'battle';
    const seed = Math.floor(this.random() * 0xffffffff) >>> 0;
    const arena = ARENAS[seed % ARENAS.length];
    const builds: [CarBuild, CarBuild] = [sanitizeBuild(this.builds[0]), sanitizeBuild(this.builds[1])];
    // Authoritative re-simulation (a few ms to ~0.2 s).
    const battle = new Battle({ seed, builds, arena });
    const result = battle.runToEnd();
    battle.free();
    this.serverResult = { winner: result.winner, hash: result.hash };
    for (const p of this.players) p.send({ t: 'roundStart', round: this.round, seed, arena, builds });
    // Clients report when they finished watching; cap the wait (countdown + fight + outro).
    const watchMs = (3 + result.ticks * SIM.dt + 8) * 1000;
    this.timer = setTimeout(() => this.finishRound(), watchMs + 15000);
  }

  private finishRound(): void {
    if (this.phase !== 'battle' || !this.serverResult) return;
    this.clearTimer();
    const { winner, hash } = this.serverResult;
    const mismatch = this.clientHashes.some((h) => h !== null && h !== hash);
    if (mismatch) this.hooks.log?.(`match ${this.id} round ${this.round}: client hash mismatch ${this.clientHashes.join(',')} vs ${hash}`);
    if (winner !== -1) this.score[winner] += 1;
    const score: [number, number] = [this.score[0], this.score[1]];
    for (const p of this.players) p.send({ t: 'roundResult', round: this.round, winner, score, mismatch });
    const champion = this.score[0] >= ROUNDS_TO_WIN ? 0 : this.score[1] >= ROUNDS_TO_WIN ? 1 : null;
    if (champion !== null || this.round >= 5) {
      const w: CarIndex | -1 = champion ?? (this.score[0] === this.score[1] ? -1 : this.score[0] > this.score[1] ? 0 : 1);
      this.end(w, 'score');
      return;
    }
    // Intermission: no ready/roundWatched is accepted until the next build phase.
    this.phase = 'intermission';
    this.ready = [false, false];
    this.watched = [false, false];
    this.clientHashes = [null, null];
    this.timer = setTimeout(() => this.beginBuildPhase(), 3500);
  }

  private end(winner: CarIndex | -1, reason: 'score' | 'forfeit', leaver?: CarIndex): void {
    this.clearTimer();
    this.phase = 'done';
    const score: [number, number] = [this.score[0], this.score[1]];
    this.players.forEach((p, i) => {
      if (i === leaver) return;
      const delta = winner === -1 ? 0 : winner === i ? 35 : -15;
      p.send({ t: 'matchEnd', winner, score, trophyDelta: delta, reason });
    });
    this.hooks.log?.(`match ${this.id} ended: winner=${winner} (${reason})`);
    this.hooks.onEnd?.(winner, reason);
  }
}
