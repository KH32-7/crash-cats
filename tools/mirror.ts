import { initPhysics, Battle } from '../src/shared/sim/Battle';
import { defaultBuild, type CarBuild } from '../src/shared/parts';
await initPhysics();
const builds: Record<string, CarBuild> = {
  scooterBlade: defaultBuild(),
  scooterDrill: { ...defaultBuild(), weapons: [{ id: 'drill', level: 1 }, null] },
  scooterNoWeapon: { ...defaultBuild(), weapons: [null, null] },
};
for (const [n, b] of Object.entries(builds)) {
  const w = [0, 0, 0];
  let dealt0 = 0, dealt1 = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const r = new Battle({ seed, builds: [b, b], arena: 'skate' }).runToEnd();
    w[r.winner === -1 ? 2 : r.winner]++;
    dealt0 += r.dealt[0]; dealt1 += r.dealt[1];
  }
  console.log(n.padEnd(16), 'left', w[0], 'right', w[1], 'draw', w[2], 'dealt L/R', dealt0, dealt1);
}
