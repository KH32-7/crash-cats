// Headless balance / determinism harness: npx tsx tools/sim-harness.ts
import { initPhysics, Battle } from '../src/shared/sim/Battle';
import type { CarBuild } from '../src/shared/parts';
import { dsin, dcos, datan2 } from '../src/shared/sim/dmath';

const B = (chassis: string, wheels: string[], weapons: (string | null)[], gadgets: (string | null)[] = []): CarBuild => ({
  chassis: { id: chassis, level: 1 },
  wheels: wheels.map((id) => ({ id, level: 1 })),
  weapons: weapons.map((id) => (id ? { id, level: 1 } : null)),
  gadgets: gadgets.map((id) => (id ? { id, level: 1 } : null)),
});

const builds: Record<string, CarBuild> = {
  scooterBlade: B('scooter', ['wheel_basic', 'wheel_basic'], ['blade', null]),
  scooterDrillRocket: B('scooter', ['wheel_basic', 'wheel_basic'], ['drill', 'rocket'], ['booster']),
  wedgeTop: B('wedge', ['wheel_spiked', 'wheel_spiked'], ['blade', 'drill'], ['armor']),
  boxTank: B('box', ['wheel_heavy', 'wheel_heavy', 'wheel_heavy'], ['punch', 'rocket', 'chainsaw'], ['armor']),
  dragFork: B('dragster', ['wheel_turbo', 'wheel_bigfoot'], ['fork', 'blade'], ['booster', 'spring']),
  towerSaw: B('tower', ['wheel_bigfoot', 'wheel_bigfoot'], ['chainsaw', 'blade', 'drill'], ['spring']),
};

async function main() {
  await initPhysics();
  // determinism check
  const a = new Battle({ seed: 7, builds: [builds.boxTank, builds.dragFork], arena: 'skate' }).runToEnd();
  const b = new Battle({ seed: 7, builds: [builds.boxTank, builds.dragFork], arena: 'skate' }).runToEnd();
  console.log('determinism', a.hash === b.hash ? 'OK' : 'MISMATCH', a.hash, b.hash);
  let maxErr = 0;
  for (let x = -20; x < 20; x += 0.001) {
    maxErr = Math.max(maxErr, Math.abs(dsin(x) - Math.sin(x)), Math.abs(dcos(x) - Math.cos(x)), Math.abs(datan2(Math.sin(x), Math.cos(x) * 1.3) - Math.atan2(Math.sin(x), Math.cos(x) * 1.3)));
  }
  console.log('dmath max error', maxErr.toExponential(2));
  const names = Object.keys(builds);
  const rows: string[] = [];
  const t0 = performance.now();
  let total = 0, count = 0, sd = 0;
  for (const n0 of names) for (const n1 of names) {
    if (n0 === n1) continue;
    for (const seed of [1, 2]) {
      const r = new Battle({ seed, builds: [builds[n0], builds[n1]], arena: 'skate' }).runToEnd();
      const secs = r.ticks / 60;
      total += secs; count++; if (secs > 30) sd++;
      rows.push(`${n0.padEnd(18)} vs ${n1.padEnd(18)} s${seed}: winner=${r.winner} t=${secs.toFixed(1)}s hp=${r.hp[0]}/${r.maxHp[0]} ${r.hp[1]}/${r.maxHp[1]} dealt=${r.dealt}`);
    }
  }
  console.log(rows.join('\n'));
  console.log(`avg ${ (total / count).toFixed(1)}s, sudden-death ${sd}/${count}, ${(performance.now() - t0).toFixed(0)}ms total`);
}
main();
