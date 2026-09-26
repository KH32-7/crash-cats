import { CHASSIS, GADGETS, WEAPONS, WHEELS, MAX_LEVEL, type CarBuild, type PartRef, type Rarity } from '../shared/parts';
import { createRng } from '../shared/sim/dmath';
import type { PlayerCard } from '../shared/protocol';

const BOT_NAMES = ['톰캣', '콘라드', '냥펀치', '미야옹', '치즈대장', '까망이', '루시퍼', '나비', '고등어', '호랑이', '삼색이', '털뭉치'];
const BOT_AVATARS = ['av_tomcat', 'av_punk', 'av_siamese'];

/**
 * Offline opponent: a plausible garage scaled to the player's trophies
 * (used when the server has no ghost for Quick Battle).
 */
export function makeBot(trophies: number, seed: number): { card: PlayerCard; build: CarBuild; catVariant: number } {
  const rng = createRng(seed ^ 0x51ed270b);
  const pick = <T>(list: T[]): T => list[Math.floor(rng() * list.length)];
  // tier 0 ≈ a fresh starter garage, tier 1 ≈ champion league.
  const tier = Math.min(1, trophies / 1600);
  const rarityOk = (r: Rarity) => r === 'common' || (r === 'rare' && rng() < tier * 1.3) || (r === 'epic' && rng() < tier * 0.7 - 0.08);
  const baseLevel = 1 + Math.floor(trophies / 300);
  const lvl = () => Math.max(1, Math.min(MAX_LEVEL, baseLevel - (rng() < 0.5 ? 1 : 0)));

  // First matches: starter-scooter opponents so a new player can win with the starter garage.
  const chassisPool = trophies < 80 ? CHASSIS.filter((c) => c.id === 'scooter') : CHASSIS.filter((c) => rarityOk(c.rarity));
  const chassis = pick(chassisPool.length ? chassisPool : CHASSIS.slice(0, 2));
  const wheelPool = WHEELS.filter((w) => rarityOk(w.rarity) && (tier > 0.12 || w.style === 'basic'));
  const wheel = pick(wheelPool.length ? wheelPool : [WHEELS[0]]);
  const wheelLevel = lvl();
  const maxWeapons = 1 + (rng() < tier * 1.6 ? 1 : 0) + (rng() < tier - 0.35 ? 1 : 0);
  const order = chassis.weaponSlots.map((_, i) => i).sort((a, b) => {
    const pa = chassis.weaponSlots[a].mount === 'back' ? 1 : 0;
    const pb = chassis.weaponSlots[b].mount === 'back' ? 1 : 0;
    return pa - pb || a - b;
  });
  const weapons: (PartRef | null)[] = chassis.weaponSlots.map(() => null);
  let placed = 0;
  for (const i of order) {
    if (placed >= maxWeapons) break;
    const options = WEAPONS.filter((w) => w.mounts.includes(chassis.weaponSlots[i].mount) && rarityOk(w.rarity) && (trophies >= 80 || w.id === 'blade'));
    if (options.length === 0) continue;
    weapons[i] = { id: pick(options).id, level: lvl() };
    placed++;
  }
  if (placed === 0) {
    const slot = chassis.weaponSlots.findIndex((s) => s.mount !== 'back');
    weapons[slot >= 0 ? slot : 0] = { id: 'blade', level: lvl() };
  }
  const gadgets: (PartRef | null)[] = chassis.gadgetSlots.map((): PartRef | null => {
    if (rng() > tier * 0.9) return null;
    const options = GADGETS.filter((g) => rarityOk(g.rarity));
    return options.length ? { id: pick(options).id, level: lvl() } : null;
  });
  const avatarIndex = Math.floor(rng() * BOT_AVATARS.length);
  const card: PlayerCard = {
    name: pick(BOT_NAMES),
    avatar: BOT_AVATARS[avatarIndex],
    trophies: Math.max(0, Math.round(trophies + (rng() - 0.5) * 80)),
  };
  const paints = ['#d8413a', '#2fa39a', '#7b58c7', '#e8742c', '#3d7fb8', '#7d9a3a', undefined];
  return {
    card,
    build: {
      chassis: { id: chassis.id, level: lvl() },
      wheels: chassis.wheelSlots.map(() => ({ id: wheel.id, level: wheelLevel })),
      weapons,
      gadgets,
      paint: pick(paints),
    },
    catVariant: avatarIndex + 1,
  };
}
