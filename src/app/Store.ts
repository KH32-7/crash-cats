import {
  ALL_PARTS,
  MAX_LEVEL,
  computeStats,
  getChassis,
  getPart,
  weaponFits,
  type CarBuild,
  type CarStats,
  type PartDef,
  type PartKind,
  type Rarity,
} from '../shared/parts';
import { createRng } from '../shared/sim/dmath';

export type AvatarId = 'av_player' | 'av_tomcat' | 'av_punk' | 'av_siamese';
export const AVATARS: AvatarId[] = ['av_player', 'av_tomcat', 'av_punk', 'av_siamese'];
export type CrateKind = 'wood' | 'silver' | 'gold';
export type SlotKind = 'wheel' | 'weapon' | 'gadget';

/** One owned part instance. */
export interface InventoryItem {
  uid: string;
  id: string;
  level: number;
}

export interface GarageRefs {
  chassis: string; // uid
  wheels: (string | null)[];
  weapons: (string | null)[];
  gadgets: (string | null)[];
  paint?: string;
}

export interface Profile {
  version: 1;
  playerId: string;
  name: string;
  avatar: AvatarId;
  coins: number;
  trophies: number;
  wins: number;
  losses: number;
  inventory: InventoryItem[];
  garage: GarageRefs;
  crates: CrateKind[];
  nextUid: number;
  muted: boolean;
}

export interface CrateReward {
  crate: CrateKind;
  coins: number;
  items: InventoryItem[];
}

export interface BattleReward {
  win: boolean;
  draw: boolean;
  trophies: number;
  coins: number;
  crate: CrateKind | null;
}

export interface League {
  name: string;
  min: number;
  next: number | null;
  color: string;
}

export const LEAGUES: League[] = [
  { name: '브론즈 리그', min: 0, next: 200, color: '#c9824a' },
  { name: '실버 리그', min: 200, next: 500, color: '#b9c6d2' },
  { name: '골드 리그', min: 500, next: 900, color: '#f2b233' },
  { name: '플래티넘 리그', min: 900, next: 1400, color: '#6fd7d0' },
  { name: '다이아 리그', min: 1400, next: 2000, color: '#7fb2ff' },
  { name: '챔피언 리그', min: 2000, next: null, color: '#ff6b5a' },
];

export function leagueFor(trophies: number): League {
  let league = LEAGUES[0];
  for (const l of LEAGUES) if (trophies >= l.min) league = l;
  return league;
}

export const MAX_CRATES = 4;
export const CRATE_NAME: Record<CrateKind, string> = { wood: '나무 상자', silver: '강철 상자', gold: '황금 상자' };

/** Coins required to fuse two level-L parts into L+1. */
export function fuseCost(level: number): number {
  return 40 * level;
}

const STORAGE_KEY = 'crash-cats.profile.v1';

function randomId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function starterProfile(): Profile {
  const inventory: InventoryItem[] = [
    { uid: 'u1', id: 'scooter', level: 1 },
    { uid: 'u2', id: 'wedge', level: 1 },
    { uid: 'u3', id: 'wheel_basic', level: 1 },
    { uid: 'u4', id: 'wheel_basic', level: 1 },
    { uid: 'u5', id: 'blade', level: 1 },
    { uid: 'u6', id: 'drill', level: 1 },
    { uid: 'u7', id: 'armor', level: 1 },
    { uid: 'u8', id: 'wheel_spiked', level: 1 },
  ];
  return {
    version: 1,
    playerId: randomId(),
    name: `냥이${Math.floor(Math.random() * 9000 + 1000)}`,
    avatar: 'av_player',
    coins: 150,
    trophies: 0,
    wins: 0,
    losses: 0,
    inventory,
    garage: { chassis: 'u1', wheels: ['u3', 'u4'], weapons: ['u5', null], gadgets: [null] },
    crates: ['wood', 'silver'],
    nextUid: 9,
    muted: false,
  };
}

type Listener = (profile: Profile) => void;

/**
 * Player profile + garage + inventory. Single source of truth for the UI;
 * every mutation persists to localStorage and notifies subscribers.
 */
export class Store {
  private profile: Profile;
  private readonly listeners = new Set<Listener>();

  constructor() {
    this.profile = this.load();
    this.repairGarage();
  }

  get(): Readonly<Profile> {
    return this.profile;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---------------------------------------------------------------- derived

  item(uid: string | null | undefined): InventoryItem | undefined {
    if (!uid) return undefined;
    return this.profile.inventory.find((i) => i.uid === uid);
  }

  /** Current garage as a CarBuild the sim/renderer understand. */
  build(): CarBuild {
    const g = this.profile.garage;
    const ref = (uid: string | null) => {
      const it = this.item(uid);
      return it ? { id: it.id, level: it.level } : null;
    };
    const chassis = this.item(g.chassis)!;
    return {
      chassis: { id: chassis.id, level: chassis.level },
      wheels: g.wheels.map(ref),
      weapons: g.weapons.map(ref),
      gadgets: g.gadgets.map(ref),
      paint: g.paint,
    };
  }

  stats(): CarStats {
    return computeStats(this.build());
  }

  isEquipped(uid: string): boolean {
    const g = this.profile.garage;
    return g.chassis === uid || g.wheels.includes(uid) || g.weapons.includes(uid) || g.gadgets.includes(uid);
  }

  /** Inventory filtered by kind, sorted by rarity/level. */
  itemsOfKind(kind: PartKind): InventoryItem[] {
    const order: Record<Rarity, number> = { epic: 0, rare: 1, common: 2 };
    return this.profile.inventory
      .filter((i) => getPart(i.id).kind === kind)
      .sort((a, b) => {
        const pa = getPart(a.id);
        const pb = getPart(b.id);
        return order[pa.rarity] - order[pb.rarity] || b.level - a.level || a.id.localeCompare(b.id);
      });
  }

  /** Items that could be fused with `uid` (same id & level, different uid). */
  fusePartners(uid: string): InventoryItem[] {
    const it = this.item(uid);
    if (!it || it.level >= MAX_LEVEL) return [];
    return this.profile.inventory.filter((o) => o.uid !== uid && o.id === it.id && o.level === it.level);
  }

  league(): League {
    return leagueFor(this.profile.trophies);
  }

  // ---------------------------------------------------------------- garage

  setChassis(uid: string): boolean {
    const it = this.item(uid);
    if (!it || getPart(it.id).kind !== 'chassis') return false;
    const def = getChassis(it.id);
    const old = this.profile.garage;
    const keepFirst = <T>(list: T[], n: number): (T | null)[] => Array.from({ length: n }, (_, i) => list[i] ?? null);
    // Carry parts over where slots exist; weapons must still fit the mount.
    const wheels = keepFirst(old.wheels.filter(Boolean), def.wheelSlots.length);
    const oldWeapons = old.weapons.filter((w): w is string => !!w);
    const weapons: (string | null)[] = def.weaponSlots.map(() => null);
    for (const w of oldWeapons) {
      const wi = this.item(w);
      if (!wi) continue;
      const idx = def.weaponSlots.findIndex((s, i) => weapons[i] === null && weaponFits(wi.id, s.mount));
      if (idx >= 0) weapons[idx] = w;
    }
    const gadgets = keepFirst(old.gadgets.filter(Boolean), def.gadgetSlots.length);
    this.profile.garage = { chassis: uid, wheels, weapons, gadgets, paint: old.paint };
    this.commit();
    return true;
  }

  /** Can this item go into this slot of the current chassis? */
  canEquip(kind: SlotKind, index: number, uid: string): boolean {
    const it = this.item(uid);
    if (!it) return false;
    const def = getPart(it.id);
    if (def.kind !== kind) return false;
    const chassis = getChassis(this.item(this.profile.garage.chassis)!.id);
    if (kind === 'weapon') {
      const slot = chassis.weaponSlots[index];
      return !!slot && weaponFits(it.id, slot.mount);
    }
    if (kind === 'wheel') return index < chassis.wheelSlots.length;
    return index < chassis.gadgetSlots.length;
  }

  /** Put `uid` (or null to clear) into a slot. Moves the item if it was equipped elsewhere. */
  equip(kind: SlotKind, index: number, uid: string | null): boolean {
    const g = this.profile.garage;
    const list = kind === 'wheel' ? g.wheels : kind === 'weapon' ? g.weapons : g.gadgets;
    if (index < 0 || index >= list.length) return false;
    if (uid !== null && !this.canEquip(kind, index, uid)) return false;
    if (uid !== null) {
      for (const l of [g.wheels, g.weapons, g.gadgets]) {
        const at = l.indexOf(uid);
        if (at >= 0) l[at] = null;
      }
    }
    list[index] = uid;
    this.commit();
    return true;
  }

  /** Equip into the first compatible empty slot (or replace the first compatible). Returns slot or null. */
  autoEquip(uid: string): { kind: SlotKind; index: number } | null {
    const it = this.item(uid);
    if (!it) return null;
    const def = getPart(it.id);
    if (def.kind === 'chassis') {
      this.setChassis(uid);
      return null;
    }
    const kind = def.kind as SlotKind;
    const g = this.profile.garage;
    const list = kind === 'wheel' ? g.wheels : kind === 'weapon' ? g.weapons : g.gadgets;
    let target = list.findIndex((v, i) => v === null && this.canEquip(kind, i, uid));
    if (target < 0) target = list.findIndex((_, i) => this.canEquip(kind, i, uid));
    if (target < 0) return null;
    this.equip(kind, target, uid);
    return { kind, index: target };
  }

  unequipUid(uid: string): void {
    const g = this.profile.garage;
    for (const l of [g.wheels, g.weapons, g.gadgets]) {
      const at = l.indexOf(uid);
      if (at >= 0) l[at] = null;
    }
    this.commit();
  }

  setPaint(hex: string | undefined): void {
    this.profile.garage.paint = hex;
    this.commit();
  }

  // ---------------------------------------------------------------- economy

  /** Fuse two identical parts → keeps `a` at level+1, removes `b`. */
  fuse(a: string, b: string): { ok: boolean; reason?: string; item?: InventoryItem } {
    const ia = this.item(a);
    const ib = this.item(b);
    if (!ia || !ib || a === b) return { ok: false, reason: '부품을 찾을 수 없어요' };
    if (ia.id !== ib.id || ia.level !== ib.level) return { ok: false, reason: '같은 부품, 같은 레벨만 합칠 수 있어요' };
    if (ia.level >= MAX_LEVEL) return { ok: false, reason: '최대 레벨이에요' };
    const cost = fuseCost(ia.level);
    if (this.profile.coins < cost) return { ok: false, reason: `코인이 부족해요 (${cost})` };
    if (this.profile.garage.chassis === b) this.profile.garage.chassis = a;
    this.unequipUid(b);
    this.profile.coins -= cost;
    ia.level += 1;
    this.profile.inventory = this.profile.inventory.filter((i) => i.uid !== b);
    this.commit();
    return { ok: true, item: ia };
  }

  /** Sell a part for coins (not the equipped chassis). */
  sell(uid: string): number {
    const it = this.item(uid);
    if (!it || this.profile.garage.chassis === uid) return 0;
    const rarityValue: Record<Rarity, number> = { common: 15, rare: 40, epic: 100 };
    const value = rarityValue[getPart(it.id).rarity] * it.level;
    this.unequipUid(uid);
    this.profile.inventory = this.profile.inventory.filter((i) => i.uid !== uid);
    this.profile.coins += value;
    this.commit();
    return value;
  }

  openCrate(index: number): CrateReward | null {
    const crate = this.profile.crates[index];
    if (!crate) return null;
    const rng = createRng((Date.now() ^ (this.profile.nextUid * 7919)) >>> 0);
    const counts: Record<CrateKind, number> = { wood: 2, silver: 3, gold: 4 };
    const weights: Record<CrateKind, Record<Rarity, number>> = {
      wood: { common: 0.78, rare: 0.2, epic: 0.02 },
      silver: { common: 0.45, rare: 0.45, epic: 0.1 },
      gold: { common: 0.15, rare: 0.5, epic: 0.35 },
    };
    const items: InventoryItem[] = [];
    for (let n = 0; n < counts[crate]; n++) {
      const roll = rng();
      const w = weights[crate];
      const rarity: Rarity = roll < w.epic ? 'epic' : roll < w.epic + w.rare ? 'rare' : 'common';
      const pool = ALL_PARTS.filter((p) => p.rarity === rarity);
      const def: PartDef = pool[Math.floor(rng() * pool.length)];
      const item: InventoryItem = { uid: `u${this.profile.nextUid++}`, id: def.id, level: 1 };
      items.push(item);
      this.profile.inventory.push(item);
    }
    const coinRange: Record<CrateKind, [number, number]> = { wood: [20, 40], silver: [60, 110], gold: [150, 260] };
    const [lo, hi] = coinRange[crate];
    const coins = Math.round(lo + rng() * (hi - lo));
    this.profile.coins += coins;
    this.profile.crates.splice(index, 1);
    this.commit();
    return { crate, coins, items };
  }

  /** Apply a battle outcome. `ranked` = counts for trophies (quick battle / online). */
  applyBattle(outcome: 'win' | 'loss' | 'draw', ranked: boolean, rngSeed: number): BattleReward {
    const p = this.profile;
    const win = outcome === 'win';
    const draw = outcome === 'draw';
    let trophies = 0;
    let coins = draw ? 10 : win ? 30 : 8;
    let crate: CrateKind | null = null;
    if (ranked) {
      trophies = win ? 28 : draw ? 0 : -14;
      if (p.trophies + trophies < 0) trophies = -p.trophies;
      p.trophies += trophies;
    }
    if (win) {
      p.wins += 1;
      const r = createRng(rngSeed >>> 0)();
      const kind: CrateKind = r < 0.07 ? 'gold' : r < 0.32 ? 'silver' : 'wood';
      if (p.crates.length < MAX_CRATES) {
        p.crates.push(kind);
        crate = kind;
      } else {
        coins += 25;
      }
    } else if (!draw) {
      p.losses += 1;
    }
    p.coins += coins;
    this.commit();
    return { win, draw, trophies, coins, crate };
  }

  /** Online best-of-3 finished: server-provided trophy delta; winner also gets a crate. */
  applyOnlineMatch(trophyDelta: number, outcome: 'win' | 'loss' | 'draw', rngSeed: number): BattleReward {
    const p = this.profile;
    let trophies = Math.round(trophyDelta);
    if (p.trophies + trophies < 0) trophies = -p.trophies;
    p.trophies += trophies;
    let crate: CrateKind | null = null;
    let coins = outcome === 'win' ? 60 : outcome === 'draw' ? 20 : 15;
    if (outcome === 'win') {
      p.wins += 1;
      const r = createRng(rngSeed >>> 0)();
      const kind: CrateKind = r < 0.2 ? 'gold' : 'silver';
      if (p.crates.length < MAX_CRATES) {
        p.crates.push(kind);
        crate = kind;
      } else coins += 40;
    } else if (outcome === 'loss') p.losses += 1;
    p.coins += coins;
    this.commit();
    return { win: outcome === 'win', draw: outcome === 'draw', trophies, coins, crate };
  }

  setName(name: string): void {
    const clean = name.replace(/[<>]/g, '').trim().slice(0, 12);
    if (clean) this.profile.name = clean;
    this.commit();
  }

  setAvatar(avatar: AvatarId): void {
    if (AVATARS.includes(avatar)) this.profile.avatar = avatar;
    this.commit();
  }

  setMuted(muted: boolean): void {
    this.profile.muted = muted;
    this.commit();
  }

  /** Test/debug helper: reset to a fresh starter profile. */
  reset(): void {
    this.profile = starterProfile();
    this.commit();
  }

  // ---------------------------------------------------------------- persistence

  private repairGarage(): void {
    const g = this.profile.garage;
    let chassisItem = this.item(g.chassis);
    if (!chassisItem || getPart(chassisItem.id).kind !== 'chassis') {
      chassisItem = this.profile.inventory.find((i) => getPart(i.id).kind === 'chassis');
      if (!chassisItem) {
        this.profile = starterProfile();
        return;
      }
      g.chassis = chassisItem.uid;
    }
    const def = getChassis(chassisItem.id);
    const used = new Set<string>([g.chassis]);
    const fit = (list: (string | null)[], n: number, kind: PartKind) =>
      Array.from({ length: n }, (_, i) => {
        const uid = list[i];
        const it = uid ? this.item(uid) : undefined;
        if (!uid || !it || used.has(uid) || getPart(it.id).kind !== kind) return null;
        used.add(uid);
        return uid;
      });
    g.wheels = fit(g.wheels ?? [], def.wheelSlots.length, 'wheel');
    g.weapons = fit(g.weapons ?? [], def.weaponSlots.length, 'weapon').map((uid, i) =>
      uid && weaponFits(this.item(uid)!.id, def.weaponSlots[i].mount) ? uid : null,
    );
    g.gadgets = fit(g.gadgets ?? [], def.gadgetSlots.length, 'gadget');
  }

  private load(): Profile {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Profile;
        if (parsed && parsed.version === 1 && Array.isArray(parsed.inventory) && parsed.garage && typeof parsed.garage.chassis === 'string') {
          if (!Array.isArray(parsed.crates)) parsed.crates = [];
          parsed.inventory = parsed.inventory.filter((i) => ALL_PARTS.some((p) => p.id === i.id));
          return parsed;
        }
      }
    } catch {
      // storage unavailable or corrupt → fresh profile
    }
    return starterProfile();
  }

  private commit(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.profile));
    } catch {
      // ignore (private mode)
    }
    for (const fn of this.listeners) fn(this.profile);
  }
}
