import { WS_PATH, type ClientMsg, type ServerMsg } from '../shared/protocol';

type Handler = (msg: ServerMsg) => void;

/**
 * Multiplayer server URL. `VITE_WS_URL` (build-time) points a static build (e.g. GitHub Pages)
 * at a separately hosted server; otherwise the page's own host is used, except on static
 * hosts that cannot run one (github.io) — there the game stays in offline mode (bots).
 */
export function serverUrl(): string {
  const configured = import.meta.env.VITE_WS_URL as string | undefined;
  if (configured) return configured;
  if (location.hostname.endsWith('github.io')) return '';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}${WS_PATH}`;
}
type StatusHandler = (status: 'connecting' | 'open' | 'closed') => void;

/** Auto-reconnecting WebSocket client for the CRASH CATS server. */
export class Net {
  private ws: WebSocket | null = null;
  private readonly handlers = new Set<Handler>();
  private readonly statusHandlers = new Set<StatusHandler>();
  private retry = 0;
  private retryTimer: number | null = null;
  private wanted = false;
  private onOpenHello: (() => ClientMsg) | null = null;

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** `hello` is re-sent on every (re)connect. */
  connect(hello: () => ClientMsg): void {
    this.onOpenHello = hello;
    this.wanted = true;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.open();
  }

  private open(): void {
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const url = serverUrl();
    if (!url) {
      this.wanted = false;
      this.emitStatus('closed');
      return;
    }
    this.emitStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.emitStatus('open');
      if (this.onOpenHello) this.send(this.onOpenHello());
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      for (const h of this.handlers) h(msg);
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.emitStatus('closed');
      if (this.wanted) this.scheduleRetry();
    };
    ws.onerror = () => {
      // onclose follows
    };
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    const delay = Math.min(10000, 800 * 2 ** this.retry++);
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (this.wanted) this.open();
    }, delay);
  }

  send(msg: ClientMsg): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  on(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  private emitStatus(s: 'connecting' | 'open' | 'closed'): void {
    for (const h of this.statusHandlers) h(s);
  }

  /** Wait for the first message matching `pred`, or null on timeout. */
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
}
