// Two headless clients play a full best-of-3 online match against the real server.
// Usage: PORT=5199 npx tsx server/index.ts & ; npx tsx tools/online-e2e.ts ws://127.0.0.1:5199/ws
import WebSocket from 'ws';
import { initPhysics, Battle } from '../src/shared/sim/Battle';
import { defaultBuild, type CarBuild } from '../src/shared/parts';
import type { ClientMsg, ServerMsg } from '../src/shared/protocol';

const url = process.argv[2] ?? 'ws://127.0.0.1:5199/ws';
const box: CarBuild = {
  chassis: { id: 'box', level: 2 },
  wheels: [{ id: 'wheel_heavy', level: 1 }, { id: 'wheel_heavy', level: 1 }, { id: 'wheel_heavy', level: 1 }],
  weapons: [{ id: 'punch', level: 1 }, { id: 'rocket', level: 1 }, null],
  gadgets: [null],
};

function client(name: string, build: CarBuild, mode: 'queue' | 'host' | 'join', code?: () => string | undefined) {
  return new Promise<{ name: string; log: string[]; end: ServerMsg | null }>((resolve, reject) => {
    const ws = new WebSocket(url);
    const log: string[] = [];
    const send = (m: ClientMsg) => ws.send(JSON.stringify(m));
    const timer = setTimeout(() => reject(new Error(`${name} timeout; log=${log.join(' | ')}`)), 90000);
    ws.on('open', () => {
      send({ t: 'hello', playerId: `test-${name}`, card: { name, avatar: 'av_player', trophies: 100 }, build });
      if (mode === 'queue') send({ t: 'queue' });
      if (mode === 'host') send({ t: 'createRoom' });
      if (mode === 'join') {
        const tryJoin = () => { const c = code?.(); if (c) send({ t: 'joinRoom', code: c }); else setTimeout(tryJoin, 50); };
        tryJoin();
      }
    });
    ws.on('message', (data) => {
      const m = JSON.parse(String(data)) as ServerMsg;
      if (m.t !== 'online') log.push(m.t + (m.t === 'roundResult' ? `(w=${m.winner},${m.score},mm=${m.mismatch})` : m.t === 'roomCreated' ? `(${m.code})` : ''));
      if (m.t === 'roomCreated') (globalThis as any).__room = m.code;
      if (m.t === 'buildPhase') setTimeout(() => send({ t: 'ready', build }), 100);
      if (m.t === 'roundStart') {
        const b = new Battle({ seed: m.seed, builds: m.builds, arena: m.arena });
        const r = b.runToEnd();
        b.free();
        send({ t: 'roundWatched', round: m.round, hash: r.hash, winner: r.winner });
      }
      if (m.t === 'ghost') log.push(`ghost:${m.found}`);
      // Exploit probe: a rogue 'ready' during the intermission must NOT start a round.
      if (m.t === 'roundResult' && name === 'alice') send({ t: 'ready', build });
      if (m.t === 'matchEnd') {
        clearTimeout(timer);
        send({ t: 'requestGhost', trophies: 100 });
        setTimeout(() => { ws.close(); resolve({ name, log, end: m }); }, 300);
      }
    });
    ws.on('error', reject);
  });
}

await initPhysics();
const t0 = Date.now();
const [a, b] = await Promise.all([client('alice', defaultBuild(), 'queue'), client('bob', box, 'queue')]);
console.log('QUEUE MATCH', ((Date.now() - t0) / 1000).toFixed(1) + 's');
console.log(' ', a.name, a.log.join(' → '), JSON.stringify(a.end));
console.log(' ', b.name, b.log.join(' → '), JSON.stringify(b.end));
const [c, d] = await Promise.all([client('carol', box, 'host'), client('dave', defaultBuild(), 'join', () => (globalThis as any).__room)]);
console.log('ROOM MATCH');
console.log(' ', c.name, c.log.join(' → '));
console.log(' ', d.name, d.log.join(' → '), JSON.stringify(d.end));
const seqOk = [a, b, c, d].every((x) => { const l = x.log.filter((e) => /^(buildPhase|roundStart)/.test(e)); return l.every((e, i) => (i % 2 === 0 ? e === 'buildPhase' : e === 'roundStart')); });
console.log(seqOk ? 'phase sequence OK (every roundStart preceded by buildPhase)' : 'PHASE SEQUENCE BROKEN');
const mism = [a, b, c, d].some((x) => x.log.some((l) => l.includes('mm=true')));
console.log(mism ? 'HASH MISMATCH' : 'hashes consistent');
process.exit(0);
