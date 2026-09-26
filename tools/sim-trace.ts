import { initPhysics, Battle } from '../src/shared/sim/Battle';
import type { CarBuild } from '../src/shared/parts';
const B = (chassis: string, wheels: string[], weapons: (string | null)[], gadgets: (string | null)[] = []): CarBuild => ({
  chassis: { id: chassis, level: 1 }, wheels: wheels.map((id) => ({ id, level: 1 })),
  weapons: weapons.map((id) => (id ? { id, level: 1 } : null)), gadgets: gadgets.map((id) => (id ? { id, level: 1 } : null)) });
const a = B(process.argv[2] ?? 'scooter', ['wheel_basic', 'wheel_basic'], ['blade', null]);
const b = B('wedge', ['wheel_spiked', 'wheel_spiked'], ['blade', 'drill'], ['armor']);
await initPhysics();
const battle = new Battle({ seed: 1, builds: [a, b], arena: 'skate' });
for (let i = 0; i < 60 * 40 && !battle.isOver; i++) {
  const ev = battle.step();
  if (i % 30 === 0) {
    const s = battle.snapshot();
    const f = (c: typeof s.cars[0]) => `(${c.chassis.x.toFixed(2)},${c.chassis.y.toFixed(2)},a=${c.chassis.a.toFixed(2)} hp=${c.hp})`;
    console.log(s.time.toFixed(1), f(s.cars[0]), f(s.cars[1]), 'wpn0', JSON.stringify(s.cars[0].weapons[0]?.angle?.toFixed(2)));
  }
  for (const e of ev) if (e.type !== 'hit') console.log('  ev', JSON.stringify(e));
}
