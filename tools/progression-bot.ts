// Starter-car vs offline bots win rate at different trophy levels.
import { initPhysics, Battle } from '../src/shared/sim/Battle';
import { defaultBuild } from '../src/shared/parts';
import { makeBot } from '../src/app/bots';
await initPhysics();
for (const trophies of [0, 100, 250, 500]) {
  let wins = 0, total = 0, secs = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const bot = makeBot(trophies, seed * 7919);
    const r = new Battle({ seed, builds: [defaultBuild(), bot.build], arena: 'skate' }).runToEnd();
    total++; secs += r.ticks / 60; if (r.winner === 0) wins++;
  }
  console.log(`trophies ${trophies}: starter win rate ${(100 * wins / total).toFixed(0)}% avg ${(secs / total).toFixed(1)}s`);
}
