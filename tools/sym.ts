import { initPhysics, Battle } from '../src/shared/sim/Battle';
import { defaultBuild } from '../src/shared/parts';
import { makeBot } from '../src/app/bots';
await initPhysics();
const r = new Battle({ seed: 1, builds: [defaultBuild(), defaultBuild()], arena: 'skate' }).runToEnd();
console.log('mirror match', r.winner, r.ticks / 60, r.hp, r.dealt);
const tally: Record<string, [number, number]> = {};
for (let seed = 1; seed <= 40; seed++) {
  const bot = makeBot(0, seed * 7919);
  const key = `${bot.build.chassis.id}/${bot.build.wheels[0]?.id}/${bot.build.weapons.map((w) => w?.id ?? '-').join(',')}/${bot.build.gadgets.map((g) => g?.id ?? '-').join(',')}`;
  const res = new Battle({ seed, builds: [defaultBuild(), bot.build], arena: 'skate' }).runToEnd();
  tally[key] ??= [0, 0];
  tally[key][1]++;
  if (res.winner === 0) tally[key][0]++;
}
for (const [k, v] of Object.entries(tally)) console.log(k.padEnd(50), `${v[0]}/${v[1]}`);
