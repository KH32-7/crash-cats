import { initPhysics, Battle } from '../src/shared/sim/Battle';
import { defaultBuild, type CarBuild } from '../src/shared/parts';
await initPhysics();
const blade = defaultBuild();
const drill: CarBuild = { ...defaultBuild(), weapons: [{ id: 'drill', level: 1 }, null] };
const b = new Battle({ seed: 3, builds: [blade, drill], arena: 'skate' });
const hits = [0, 0];
while (!b.isOver && b.tick < 3000) {
  const ev = b.step();
  for (const e of ev) if (e.type === 'hit') hits[e.attacker]++;
  if (b.tick % 30 === 0) {
    const s = b.snapshot();
    console.log(s.time.toFixed(1), s.cars.map((c) => `x=${c.chassis.x.toFixed(2)} y=${c.chassis.y.toFixed(2)} a=${c.chassis.a.toFixed(2)} hp=${c.hp} w=${c.weapons[0]?.angle.toFixed(2)}`).join(' | '), 'hits', hits.join('/'));
  }
}
