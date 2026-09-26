/**
 * Serverless multiplayer for static hosting (GitHub Pages): WebRTC data channels via
 * PeerJS (free public signaling at 0.peerjs.com). The room creator's browser runs the
 * shared MatchCore (the same best-of-3 state machine the Node server uses) and is the
 * authority; the guest just relays protocol messages. Same interface as `Net`, so the
 * App's online flow is unchanged.
 */
import Peer, { type DataConnection } from 'peerjs';
import { MatchCore } from '../shared/match';
import { cleanCard, type ClientMsg, type ServerMsg } from '../shared/protocol';
import { sanitizeBuild } from '../shared/parts';
import type { NetLike } from './Net';

const PREFIX = 'crash-cats-v1-';
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const JOIN_TIMEOUT_MS = 15000;

type Handler = (msg: ServerMsg) => void;
type StatusHandler = (status: 'connecting' | 'open' | 'closed') => void;

function randomCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_LETTERS[b % CODE_LETTERS.length]).join('');
}

function isClientMsg(v: unknown): v is ClientMsg {
  return !!v && typeof v === 'object' && typeof (v as { t?: unknown }).t === 'string';
}
function isServerMsg(v: unknown): v is ServerMsg {
  return isClientMsg(v);
}

export class P2PNet implements NetLike {
  readonly mode = 'p2p' as const;
  private readonly handlers = new Set<Handler>();
  private readonly statusHandlers = new Set<StatusHandler>();
  private hello: (() => ClientMsg) | null = null;
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private core: MatchCore | null = null;
  private role: 'none' | 'host' | 'guest' = 'none';
  private inMatch = false;
  private lastScore: [number, number] = [0, 0];
  private joinTimer: number | null = null;
  private outbox: ServerMsg[] = [];
  private flushing = false;

  get connected(): boolean {
    return true;
  }

  connect(hello: () => ClientMsg): void {
    this.hello = hello;
    window.setTimeout(() => this.emitStatus('open'), 0);
  }

  on(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  waitFor<T extends ServerMsg>(pred: (m: ServerMsg) => m is T, timeoutMs: number): Promise<T | null> {
    return new Promise((resolve) => {
      const off = this.on((m) => {
        if (pred(m)) {
          off();
          window.clearTimeout(timer);
          resolve(m);
        }
      });
      const timer = window.setTimeout(() => {
        off();
        resolve(null);
      }, timeoutMs);
    });
  }

  send(msg: ClientMsg): boolean {
    switch (msg.t) {
      case 'hello':
        return true;
      case 'queue':
        this.deliver({ t: 'error', message: '이 버전은 빠른 매칭 대신 방 코드로 친구와 대전해요. "방 만들기"를 눌러 주세요!' });
        return true;
      case 'requestGhost':
        this.deliver({ t: 'ghost', found: false });
        return true;
      case 'createRoom':
        this.createRoom();
        return true;
      case 'joinRoom':
        this.joinRoom(msg.code);
        return true;
      case 'cancelQueue':
        this.cleanup();
        return true;
      case 'leave':
        if (this.role === 'host') this.core?.leave(0);
        else if (this.role === 'guest') this.conn?.send(msg);
        {
          const peer = this.peer;
          // Give the leave message time to go out; don't tear down a room created meanwhile.
          window.setTimeout(() => {
            if (this.peer === peer) this.cleanup();
          }, 300);
        }
        return true;
      default:
        // updateBuild / ready / roundWatched / emote
        if (this.role === 'host') this.core?.handle(0, msg);
        else if (this.role === 'guest' && this.conn?.open) this.conn.send(msg);
        return true;
    }
  }

  // ------------------------------------------------------------------ host

  private createRoom(attempt = 0): void {
    this.cleanup();
    this.role = 'host';
    const code = randomCode();
    const peer = new Peer(PREFIX + code, { debug: 0 });
    this.peer = peer;
    peer.on('open', () => {
      if (this.peer === peer) this.deliver({ t: 'roomCreated', code });
    });
    peer.on('error', (err) => {
      if (this.peer !== peer) return;
      const type = (err as { type?: string }).type;
      if (type === 'unavailable-id' && attempt < 4) {
        this.createRoom(attempt + 1);
        return;
      }
      this.fail(type === 'network' || type === 'server-error' || type === 'socket-error' ? '연결 중개 서버에 접속하지 못했어요. 잠시 후 다시 시도해 주세요.' : '방을 만들지 못했어요.');
    });
    peer.on('connection', (conn) => {
      if (this.core || this.conn) {
        conn.on('open', () => conn.close());
        return;
      }
      this.conn = conn;
      conn.on('data', (data) => this.onHostData(conn, data));
      conn.on('close', () => this.onHostLost(conn));
      conn.on('error', () => this.onHostLost(conn));
    });
  }

  private onHostData(conn: DataConnection, data: unknown): void {
    if (conn !== this.conn || !isClientMsg(data)) return;
    if (!this.core) {
      if (data.t !== 'hello' || !this.hello) return;
      const mine = this.hello();
      if (mine.t !== 'hello') return;
      const guestCard = cleanCard(data.card);
      this.core = new MatchCore(
        [
          { card: cleanCard(mine.card), build: sanitizeBuild(mine.build), send: (m) => this.deliver(m) },
          { card: guestCard, build: sanitizeBuild(data.build), send: (m) => conn.open && conn.send(m) },
        ],
        {
          log: (line) => console.info('[p2p]', line),
          onEnd: () => {
            this.inMatch = false;
          },
        },
      );
      this.inMatch = true;
      // Let the peer ever connect only once: the room code is now taken.
      this.core.start();
      return;
    }
    if (data.t === 'leave') this.core.leave(1);
    else this.core.handle(1, data);
  }

  private onHostLost(conn: DataConnection): void {
    if (conn !== this.conn) return;
    if (this.core && !this.core.done) this.core.leave(1);
    this.conn = null;
  }

  // ------------------------------------------------------------------ guest

  private joinRoom(rawCode: string): void {
    const code = rawCode.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) {
      this.deliver({ t: 'error', message: '방 코드는 영문 4글자예요' });
      return;
    }
    this.cleanup();
    this.role = 'guest';
    this.emitStatus('connecting');
    const peer = new Peer({ debug: 0 });
    this.peer = peer;
    this.joinTimer = window.setTimeout(() => {
      if (this.peer === peer && !this.inMatch) this.fail('방에 연결하지 못했어요. 코드를 확인하거나 다른 네트워크에서 시도해 주세요.');
    }, JOIN_TIMEOUT_MS);
    peer.on('open', () => {
      if (this.peer !== peer) return;
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      this.conn = conn;
      conn.on('open', () => {
        if (this.hello) conn.send(this.hello());
      });
      conn.on('data', (data) => {
        if (conn !== this.conn || !isServerMsg(data)) return;
        if (data.t === 'matchFound') {
          this.inMatch = true;
          this.clearJoinTimer();
          this.emitStatus('open');
        }
        if (data.t === 'roundResult' || data.t === 'buildPhase') this.lastScore = data.score;
        if (data.t === 'matchEnd') this.inMatch = false;
        this.deliver(data);
      });
      conn.on('close', () => this.onGuestLost(conn));
      conn.on('error', () => this.onGuestLost(conn));
    });
    peer.on('error', (err) => {
      if (this.peer !== peer) return;
      const type = (err as { type?: string }).type;
      if (this.inMatch) {
        this.onGuestLost(this.conn);
        return;
      }
      this.fail(type === 'peer-unavailable' ? '방을 찾을 수 없어요. 코드를 확인해 주세요.' : '방에 연결하지 못했어요.');
    });
  }

  private onGuestLost(conn: DataConnection | null): void {
    if (conn !== this.conn) return;
    this.conn = null;
    if (this.inMatch) {
      // We can't tell who dropped: settle as a no-trophy draw.
      this.inMatch = false;
      this.deliver({ t: 'matchEnd', winner: -1, score: this.lastScore, trophyDelta: 0, reason: 'forfeit' });
    }
  }

  // ------------------------------------------------------------------ shared

  private fail(message: string): void {
    this.cleanup();
    this.emitStatus('open');
    this.deliver({ t: 'error', message });
  }

  private clearJoinTimer(): void {
    if (this.joinTimer !== null) window.clearTimeout(this.joinTimer);
    this.joinTimer = null;
  }

  private cleanup(): void {
    this.clearJoinTimer();
    this.core?.dispose();
    this.core = null;
    try {
      this.conn?.close();
    } catch {
      // ignore
    }
    this.conn = null;
    try {
      this.peer?.destroy();
    } catch {
      // ignore
    }
    this.peer = null;
    this.role = 'none';
    this.inMatch = false;
    this.lastScore = [0, 0];
  }

  /** Deliver a ServerMsg to the local App asynchronously and in order (avoids re-entrancy into MatchCore). */
  private deliver(msg: ServerMsg): void {
    this.outbox.push(msg);
    if (this.flushing) return;
    this.flushing = true;
    window.setTimeout(() => {
      const batch = this.outbox;
      this.outbox = [];
      this.flushing = false;
      for (const m of batch) for (const h of this.handlers) h(m);
    }, 0);
  }

  private emitStatus(s: 'connecting' | 'open' | 'closed'): void {
    for (const h of this.statusHandlers) h(s);
  }
}
