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
import { Battle, initPhysics } from '../src/shared/sim/Battle';
import { ARENAS, SIM, type CarIndex } from '../src/shared/sim/types';
import { sanitizeBuild, type CarBuild } from '../src/shared/parts';
import {
  BUILD_PHASE_NEXT_SECONDS,
  BUILD_PHASE_SECONDS,
  ROUNDS_TO_WIN,
  WS_PATH,
  type ClientMsg,
  type PlayerCard,
  type ServerMsg,
} from '../src/shared/protocol';

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
  match: Match | null;
  alive: boolean;
}

interface Ghost {
  playerId: string;
  card: PlayerCard;
  build: CarBuild;
  updated: number;
}

interface Match {
  id: string;
  players: [Client, Client];
  round: number;
  score: [number, number];
  phase: 'build' | 'battle' | 'intermission' | 'done';
  ready: [boolean, boolean];
  builds: [CarBuild, CarBuild];
  timer: NodeJS.Timeout | null;
  watched: [boolean, boolean];
  serverResult: { winner: CarIndex | -1; hash: string } | null;
  clientHashes: [string | null, string | null];
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

function cleanCard(card: Partial<PlayerCard> | undefined): PlayerCard {
  const name = String(card?.name ?? '냥이').replace(/[<>]/g, '').slice(0, 12) || '냥이';
  const avatar = /^av_[a-z]+$/.test(String(card?.avatar)) ? String(card?.avatar) : 'av_player';
  const trophies = Math.max(0, Math.min(99999, Math.floor(Number(card?.trophies) || 0)));
  return { name, avatar, trophies };
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
  const match: Match = {
    id: Math.random().toString(36).slice(2, 10),
    players: [a, b],
    round: 0,
    score: [0, 0],
    phase: 'build',
    ready: [false, false],
    builds: [a.build, b.build],
    timer: null,
    watched: [false, false],
    serverResult: null,
    clientHashes: [null, null],
  };
  a.match = match;
  b.match = match;
  send(a, { t: 'matchFound', matchId: match.id, you: 0, opponent: b.card, opponentBuild: b.build, roundsToWin: ROUNDS_TO_WIN });
  send(b, { t: 'matchFound', matchId: match.id, you: 1, opponent: a.card, opponentBuild: a.build, roundsToWin: ROUNDS_TO_WIN });
  console.log(`match ${match.id}: ${a.card.name} vs ${b.card.name}`);
  beginBuildPhase(match);
}

function beginBuildPhase(match: Match): void {
  match.round += 1;
  match.phase = 'build';
  match.ready = [false, false];
  match.watched = [false, false];
  match.clientHashes = [null, null];
  match.serverResult = null;
  const seconds = match.round === 1 ? BUILD_PHASE_SECONDS : BUILD_PHASE_NEXT_SECONDS;
  match.players.forEach((p, i) =>
    send(p, { t: 'buildPhase', round: match.round, seconds, opponentBuild: match.builds[1 - i], score: match.score }),
  );
  clearTimer(match);
  match.timer = setTimeout(() => startRound(match), (seconds + 1) * 1000);
}

function clearTimer(match: Match): void {
  if (match.timer) clearTimeout(match.timer);
  match.timer = null;
}

function startRound(match: Match): void {
  if (match.phase !== 'build') return;
  clearTimer(match);
  match.phase = 'battle';
  const seed = (Math.random() * 0xffffffff) >>> 0;
  const arena = ARENAS[seed % ARENAS.length];
  const builds: [CarBuild, CarBuild] = [sanitizeBuild(match.builds[0]), sanitizeBuild(match.builds[1])];
  // Authoritative re-simulation (takes a few ms).
  const battle = new Battle({ seed, builds, arena });
  const result = battle.runToEnd();
  battle.free();
  match.serverResult = { winner: result.winner, hash: result.hash };
  for (const p of match.players) send(p, { t: 'roundStart', round: match.round, seed, arena, builds });
  // Clients report when they finished watching; cap the wait (countdown + fight + outro).
  const watchMs = (3 + result.ticks * SIM.dt + 8) * 1000;
  match.timer = setTimeout(() => finishRound(match), watchMs + 15000);
}

function finishRound(match: Match): void {
  if (match.phase !== 'battle' || !match.serverResult) return;
  clearTimer(match);
  const { winner, hash } = match.serverResult;
  const mismatch = match.clientHashes.some((h) => h !== null && h !== hash);
  if (mismatch) console.warn(`match ${match.id} round ${match.round}: client hash mismatch`, match.clientHashes, hash);
  if (winner !== -1) match.score[winner] += 1;
  for (const p of match.players) send(p, { t: 'roundResult', round: match.round, winner, score: match.score, mismatch });
  const champion = match.score[0] >= ROUNDS_TO_WIN ? 0 : match.score[1] >= ROUNDS_TO_WIN ? 1 : null;
  if (champion !== null || match.round >= 5) {
    const w: CarIndex | -1 = champion ?? (match.score[0] === match.score[1] ? -1 : match.score[0] > match.score[1] ? 0 : 1);
    endMatch(match, w, 'score');
    return;
  }
  // Intermission: no ready/roundWatched is accepted until the next build phase.
  match.phase = 'intermission';
  match.ready = [false, false];
  match.watched = [false, false];
  match.clientHashes = [null, null];
  match.timer = setTimeout(() => beginBuildPhase(match), 3500);
}

function endMatch(match: Match, winner: CarIndex | -1, reason: 'score' | 'forfeit', leaver?: Client): void {
  clearTimer(match);
  match.phase = 'done';
  match.players.forEach((p, i) => {
    const delta = winner === -1 ? 0 : winner === i ? 35 : -15;
    // The leaver already settled the loss locally; never tell it anything it could misread as a win.
    if (p !== leaver) send(p, { t: 'matchEnd', winner, score: match.score, trophyDelta: delta, reason });
    if (p.match === match) p.match = null;
  });
  console.log(`match ${match.id} ended: winner=${winner} (${reason})`);
}

function leaveMatch(c: Client): void {
  const match = c.match;
  if (!match || match.phase === 'done') {
    c.match = null;
    return;
  }
  const i = match.players.indexOf(c) as CarIndex;
  const other = match.players[1 - i];
  send(other, { t: 'opponentLeft' });
  endMatch(match, (1 - i) as CarIndex, 'forfeit', c);
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
      const m = c.match;
      if (m && m.phase === 'build') {
        const i = m.players.indexOf(c);
        if (i >= 0 && !m.ready[i]) m.builds[i] = c.build;
      }
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
    case 'ready': {
      const match = c.match;
      if (!match || match.phase !== 'build') return;
      const i = match.players.indexOf(c) as CarIndex;
      match.builds[i] = sanitizeBuild(msg.build);
      c.build = match.builds[i];
      rememberGhost(c);
      match.ready[i] = true;
      send(match.players[1 - i], { t: 'opponentReady' });
      if (match.ready[0] && match.ready[1]) startRound(match);
      break;
    }
    case 'roundWatched': {
      const match = c.match;
      if (!match || match.phase !== 'battle' || msg.round !== match.round) return;
      const i = match.players.indexOf(c) as CarIndex;
      match.watched[i] = true;
      match.clientHashes[i] = String(msg.hash).slice(0, 16);
      if (match.watched[0] && match.watched[1]) finishRound(match);
      break;
    }
    case 'requestGhost': {
      const g = pickGhost(c, Number(msg.trophies) || 0);
      send(c, g ? { t: 'ghost', found: true, card: g.card, build: g.build } : { t: 'ghost', found: false });
      break;
    }
    case 'emote': {
      const match = c.match;
      if (!match) return;
      const i = match.players.indexOf(c) as CarIndex;
      send(match.players[1 - i], { t: 'emote', from: i, id: Math.max(0, Math.min(7, Math.floor(msg.id))) });
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
