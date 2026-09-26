/**
 * CRASH CATS multiplayer server.
 *  - WebSocket at /ws: matchmaking queue, private rooms, best-of-3 live duels
 *    (seed lockstep; the server re-simulates every round and is authoritative),
 *    and an async "ghost" pool of players' saved cars for Quick Battle.
 *  - In production also serves the Vite build from ../dist.
 * Run: npx tsx server/index.ts   (PORT env, default 5189)
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { initPhysics } from '../src/shared/sim/Battle';
import type { CarIndex } from '../src/shared/sim/types';
import { sanitizeBuild, type CarBuild } from '../src/shared/parts';
import { cleanCard, WS_PATH, type ClientMsg, type PlayerCard, type ServerMsg } from '../src/shared/protocol';
import { MatchCore } from '../src/shared/match';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5189);
const DIST = path.resolve(__dirname, '../dist');
const DATA_DIR = path.resolve(__dirname, 'data');
const GHOST_FILE = path.join(DATA_DIR, 'ghosts.json');
const MAX_GHOSTS = 2000;

interface Client {
  ws: WebSocket;
  playerId: string;
  card: PlayerCard;
  build: CarBuild;
  queued: boolean;
  roomCode: string | null;
  match: { core: MatchCore; index: CarIndex } | null;
  alive: boolean;
}

interface Ghost {
  playerId: string;
  card: PlayerCard;
  build: CarBuild;
  updated: number;
}

const clients = new Set<Client>();
const queue: Client[] = [];
const rooms = new Map<string, Client>();
const ghosts = new Map<string, Ghost>();

// ------------------------------------------------------------------ helpers

function send(c: Client, msg: ServerMsg): void {
  if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
}

function broadcastOnline(): void {
  const online = [...clients].filter((c) => c.playerId).length;
  for (const c of clients) send(c, { t: 'online', online });
}

function randomCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function removeFromQueue(c: Client): void {
  const i = queue.indexOf(c);
  if (i >= 0) queue.splice(i, 1);
  c.queued = false;
}

function closeRoom(c: Client): void {
  if (c.roomCode && rooms.get(c.roomCode) === c) rooms.delete(c.roomCode);
  c.roomCode = null;
}

// ------------------------------------------------------------------ ghosts

let saveTimer: NodeJS.Timeout | null = null;
function rememberGhost(c: Client): void {
  if (!c.playerId) return;
  ghosts.set(c.playerId, { playerId: c.playerId, card: c.card, build: c.build, updated: Date.now() });
  if (ghosts.size > MAX_GHOSTS) {
    const oldest = [...ghosts.values()].sort((a, b) => a.updated - b.updated).slice(0, ghosts.size - MAX_GHOSTS);
    for (const g of oldest) ghosts.delete(g.playerId);
  }
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await mkdir(DATA_DIR, { recursive: true });
      const list = [...ghosts.values()].sort((a, b) => b.updated - a.updated).slice(0, 2000);
      await writeFile(GHOST_FILE, JSON.stringify(list));
    } catch (err) {
      console.warn('ghost save failed', err);
    }
  }, 2000);
}

async function loadGhosts(): Promise<void> {
  try {
    const raw = await readFile(GHOST_FILE, 'utf8');
    for (const g of JSON.parse(raw) as Ghost[]) ghosts.set(g.playerId, { ...g, build: sanitizeBuild(g.build), card: cleanCard(g.card) });
    console.log(`loaded ${ghosts.size} ghosts`);
  } catch {
    // first run
  }
}

function pickGhost(c: Client, trophies: number): Ghost | null {
  const others = [...ghosts.values()].filter((g) => g.playerId !== c.playerId);
  if (others.length === 0) return null;
  others.sort((a, b) => Math.abs(a.card.trophies - trophies) - Math.abs(b.card.trophies - trophies));
  const pool = others.slice(0, Math.min(6, others.length));
  return pool[Math.floor(Math.random() * pool.length)];
}

// ------------------------------------------------------------------ matches

function startMatch(a: Client, b: Client): void {
  removeFromQueue(a);
  removeFromQueue(b);
  closeRoom(a);
  closeRoom(b);
  const pair: [Client, Client] = [a, b];
  const core = new MatchCore(
    [
      { card: a.card, build: a.build, send: (m) => send(a, m) },
      { card: b.card, build: b.build, send: (m) => send(b, m) },
    ],
    {
      log: (line) => console.log(line),
      onBuild: (i, build) => {
        pair[i].build = build;
        rememberGhost(pair[i]);
      },
      onEnd: () => {
        for (const p of pair) if (p.match?.core === core) p.match = null;
      },
    },
  );
  a.match = { core, index: 0 };
  b.match = { core, index: 1 };
  core.start();
}

function leaveMatch(c: Client): void {
  const m = c.match;
  c.match = null;
  if (m && !m.core.done) m.core.leave(m.index);
}

// ------------------------------------------------------------------ messages

function handle(c: Client, msg: ClientMsg): void {
  switch (msg.t) {
    case 'hello': {
      if (c.playerId) return; // one identity per connection
      c.playerId = String(msg.playerId).slice(0, 40);
      c.card = cleanCard(msg.card);
      c.build = sanitizeBuild(msg.build);
      rememberGhost(c);
      send(c, { t: 'welcome', online: clients.size });
      broadcastOnline();
      break;
    }
    case 'updateBuild': {
      c.build = sanitizeBuild(msg.build);
      if (c.match) c.match.core.handle(c.match.index, msg);
      rememberGhost(c);
      break;
    }
    case 'queue': {
      if (c.match || c.queued) return;
      closeRoom(c);
      const partner = queue.find((q) => q !== c && q.ws.readyState === WebSocket.OPEN);
      if (partner) {
        startMatch(partner, c);
      } else {
        queue.push(c);
        c.queued = true;
        send(c, { t: 'queued', position: queue.length });
      }
      break;
    }
    case 'cancelQueue':
      removeFromQueue(c);
      closeRoom(c);
      break;
    case 'createRoom': {
      if (c.match) return;
      removeFromQueue(c);
      closeRoom(c);
      const code = randomCode();
      rooms.set(code, c);
      c.roomCode = code;
      send(c, { t: 'roomCreated', code });
      break;
    }
    case 'joinRoom': {
      if (c.match) return;
      const code = String(msg.code ?? '').toUpperCase().trim();
      const host = rooms.get(code);
      if (!host || host === c || host.ws.readyState !== WebSocket.OPEN) {
        send(c, { t: 'error', message: '방을 찾을 수 없어요' });
        return;
      }
      startMatch(host, c);
      break;
    }
    case 'ready':
    case 'roundWatched':
    case 'emote':
      if (c.match) c.match.core.handle(c.match.index, msg);
      break;
    case 'requestGhost': {
      const g = pickGhost(c, Number(msg.trophies) || 0);
      send(c, g ? { t: 'ghost', found: true, card: g.card, build: g.build } : { t: 'ghost', found: false });
      break;
    }
    case 'leave':
      removeFromQueue(c);
      closeRoom(c);
      leaveMatch(c);
      break;
  }
}

// ------------------------------------------------------------------ http + ws

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.glb': 'model/gltf-binary',
  '.mp3': 'audio/mpeg',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!existsSync(DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('CRASH CATS server is running. In dev, open the Vite client (npm run dev).');
    return;
  }
  const url = new URL(req.url ?? '/', 'http://x');
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = path.normalize(path.join(DIST, decoded));
  const rel = path.relative(DIST, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = path.join(file, 'index.html');
  } catch {
    file = path.join(DIST, 'index.html');
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}

async function main(): Promise<void> {
  await initPhysics();
  await loadGhosts();
  const http = createServer((req, res) => {
    serveStatic(req, res).catch((err) => {
      console.warn('static error', err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  const wss = new WebSocketServer({ server: http, path: WS_PATH, maxPayload: 64 * 1024 });

  wss.on('connection', (ws) => {
    const c: Client = { ws, playerId: '', card: cleanCard(undefined), build: sanitizeBuild(null), queued: false, roomCode: null, match: null, alive: true };
    clients.add(c);
    ws.on('pong', () => (c.alive = true));
    ws.on('message', (data) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(data)) as ClientMsg;
      } catch {
        return;
      }
      try {
        handle(c, msg);
      } catch (err) {
        console.warn('handler error', err);
      }
    });
    ws.on('close', () => {
      clients.delete(c);
      removeFromQueue(c);
      closeRoom(c);
      leaveMatch(c);
      broadcastOnline();
    });
  });

  setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, 15000);

  http.listen(PORT, () => console.log(`CRASH CATS server on http://127.0.0.1:${PORT} (ws ${WS_PATH})`));
}

void main();
