import { initPhysics, Battle } from '../src/shared/sim/Battle';
import type { CarBuild } from '../src/shared/parts';
import { makeBot } from '../src/app/bots';
await initPhysics();
const builds: Record<string, CarBuild> = {
  scooterDrill: { chassis: { id: 'scooter', level: 1 }, wheels: [{ id: 'wheel_spiked', level: 1 }, { id: 'wheel_basic', level: 1 }], weapons: [{ id: 'drill', level: 1 }, { id: 'blade', level: 1 }], gadgets: [{ id: 'armor', level: 1 }] },
  wedge: { chassis: { id: 'wedge', level: 1 }, wheels: [{ id: 'wheel_spiked', level: 1 }, { id: 'wheel_basic', level: 1 }], weapons: [{ id: 'blade', level: 1 }, { id: 'drill', level: 1 }], gadgets: [{ id: 'armor', level: 1 }] },
  wedgeL2: { chassis: { id: 'wedge', level: 2 }, wheels: [{ id: 'wheel_spiked', level: 2 }, { id: 'wheel_basic', level: 2 }], weapons: [{ id: 'blade', level: 2 }, { id: 'drill', level: 2 }], gadgets: [{ id: 'armor', level: 2 }] },
};
for (const [n, b] of Object.entries(builds)) for (const trophies of [100, 250, 500]) {
  let wins = 0;
  for (let seed = 1; seed <= 40; seed++) if (new Battle({ seed, builds: [b, makeBot(trophies, seed * 7919).build], arena: 'skate' }).runToEnd().winner === 0) wins++;
  console.log(n.padEnd(14), trophies, `${Math.round((wins / 40) * 100)}%`);
}
