import { initPhysics, Battle } from '../src/shared/sim/Battle';
import type { CarBuild } from '../src/shared/parts';
const box: CarBuild = { chassis: { id: 'box', level: 3 }, wheels: [{ id: 'wheel_heavy', level: 3 }, { id: 'wheel_heavy', level: 3 }, { id: 'wheel_heavy', level: 3 }], weapons: [{ id: 'punch', level: 3 }, { id: 'rocket', level: 3 }, { id: 'chainsaw', level: 3 }], gadgets: [{ id: 'armor', level: 3 }] };
const cands: Record<string, CarBuild> = {
  tower: { chassis: { id: 'tower', level: 4 }, wheels: [{ id: 'wheel_bigfoot', level: 4 }, { id: 'wheel_bigfoot', level: 4 }], weapons: [{ id: 'chainsaw', level: 4 }, { id: 'blade', level: 4 }, { id: 'drill', level: 3 }], gadgets: [{ id: 'armor', level: 4 }], paint: '#3d7fb8' },
  drag: { chassis: { id: 'dragster', level: 4 }, wheels: [{ id: 'wheel_bigfoot', level: 4 }, { id: 'wheel_spiked', level: 4 }], weapons: [{ id: 'fork', level: 4 }, { id: 'blade', level: 4 }], gadgets: [{ id: 'armor', level: 4 }, { id: 'spring', level: 3 }], paint: '#3d7fb8' },
  wedge: { chassis: { id: 'wedge', level: 5 }, wheels: [{ id: 'wheel_heavy', level: 4 }, { id: 'wheel_heavy', level: 4 }], weapons: [{ id: 'blade', level: 5 }, { id: 'punch', level: 4 }], gadgets: [{ id: 'armor', level: 5 }], paint: '#3d7fb8' },
};
await initPhysics();
for (const [n, b] of Object.entries(cands)) for (let seed = 1; seed <= 12; seed++) {
  const bt = new Battle({ seed, builds: [box, b], arena: 'harbor' });
  let hpAt3 = [0, 0];
  while (!bt.isOver && bt.tick < 3600) { bt.step(); if (bt.tick === 180) { const s = bt.snapshot(); hpAt3 = [s.cars[0].hp, s.cars[1].hp]; } }
  const s = bt.snapshot();
  console.log(n, 'seed', seed, 't', s.time.toFixed(1), 'winner', s.winner, 'hp@3s', hpAt3, 'max', s.cars[0].maxHp, s.cars[1].maxHp);
}
