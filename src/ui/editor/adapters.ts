import type { SlotKind, Store } from '../../app/Store';
import {
  ALL_PARTS,
  MAX_LEVEL,
  defaultBuild,
  findPart,
  getChassis,
  getPart,
  sanitizeBuild,
  weaponFits,
  type CarBuild,
  type PartKind,
  type PartRef,
} from '../../shared/parts';

export interface EditorItem {
  key: string;
  id: string;
  level: number;
}

/** What the build editor needs from a garage source (player inventory or free P2 catalog). */
export interface EditorAdapter {
  readonly mode: 'player' | 'p2';
  items(kind: PartKind): EditorItem[];
  item(key: string): EditorItem | undefined;
  build(): CarBuild;
  isEquipped(key: string): boolean;
  chassisKey(): string;
  slotKey(kind: SlotKind, index: number): string | null;
  canEquip(kind: SlotKind, index: number, key: string): boolean;
  equip(kind: SlotKind, index: number, key: string | null): boolean;
  autoEquip(key: string): { kind: SlotKind; index: number } | null;
  unequip(key: string): void;
  setChassis(key: string): void;
  setPaint(hex: string | undefined): void;
  fusable(key: string): boolean;
  subscribe(fn: () => void): () => void;
}

const listOf = <T>(b: { wheels: T[]; weapons: T[]; gadgets: T[] }, kind: SlotKind): T[] =>
  kind === 'wheel' ? b.wheels : kind === 'weapon' ? b.weapons : b.gadgets;

export class PlayerAdapter implements EditorAdapter {
  readonly mode = 'player' as const;
  constructor(private readonly store: Store) {}

  items(kind: PartKind): EditorItem[] {
    return this.store.itemsOfKind(kind).map((i) => ({ key: i.uid, id: i.id, level: i.level }));
  }
  item(key: string): EditorItem | undefined {
    const i = this.store.item(key);
    return i ? { key: i.uid, id: i.id, level: i.level } : undefined;
  }
  build(): CarBuild {
    return this.store.build();
  }
  isEquipped(key: string): boolean {
    return this.store.isEquipped(key);
  }
  chassisKey(): string {
    return this.store.get().garage.chassis;
  }
  slotKey(kind: SlotKind, index: number): string | null {
    return listOf(this.store.get().garage, kind)[index] ?? null;
  }
  canEquip(kind: SlotKind, index: number, key: string): boolean {
    return this.store.canEquip(kind, index, key);
  }
  equip(kind: SlotKind, index: number, key: string | null): boolean {
    return this.store.equip(kind, index, key);
  }
  autoEquip(key: string) {
    return this.store.autoEquip(key);
  }
  unequip(key: string): void {
    this.store.unequipUid(key);
  }
  setChassis(key: string): void {
    this.store.setChassis(key);
  }
  setPaint(hex: string | undefined): void {
    this.store.setPaint(hex);
  }
  fusable(key: string): boolean {
    return this.store.fusePartners(key).length > 0;
  }
  subscribe(fn: () => void): () => void {
    return this.store.subscribe(() => fn());
  }
}

/** Player 2 builds from the full catalog at a single chosen level. Keys are part ids. */
export class P2Adapter implements EditorAdapter {
  readonly mode = 'p2' as const;
  private b: CarBuild;
  private lvl = 5;
  private readonly listeners = new Set<() => void>();

  constructor(initial?: CarBuild) {
    this.b = sanitizeBuild(initial ?? defaultBuild());
    this.lvl = this.b.chassis.level;
  }

  get level(): number {
    return this.lvl;
  }
  setLevel(level: number): void {
    this.lvl = Math.max(1, Math.min(MAX_LEVEL, Math.round(level)));
    const re = (r: PartRef | null) => (r ? { id: r.id, level: this.lvl } : null);
    this.b = {
      chassis: { id: this.b.chassis.id, level: this.lvl },
      wheels: this.b.wheels.map(re),
      weapons: this.b.weapons.map(re),
      gadgets: this.b.gadgets.map(re),
      paint: this.b.paint,
    };
    this.emit();
  }

  items(kind: PartKind): EditorItem[] {
    const order = { epic: 0, rare: 1, common: 2 } as const;
    return ALL_PARTS.filter((p) => p.kind === kind)
      .sort((a, b) => order[a.rarity] - order[b.rarity])
      .map((p) => ({ key: p.id, id: p.id, level: this.lvl }));
  }
  item(key: string): EditorItem | undefined {
    return findPart(key) ? { key, id: key, level: this.lvl } : undefined;
  }
  build(): CarBuild {
    return sanitizeBuild(this.b);
  }
  isEquipped(key: string): boolean {
    const b = this.b;
    return b.chassis.id === key || [...b.wheels, ...b.weapons, ...b.gadgets].some((r) => r?.id === key);
  }
  chassisKey(): string {
    return this.b.chassis.id;
  }
  slotKey(kind: SlotKind, index: number): string | null {
    return listOf(this.b, kind)[index]?.id ?? null;
  }
  canEquip(kind: SlotKind, index: number, key: string): boolean {
    const def = findPart(key);
    if (!def || def.kind !== kind) return false;
    const ch = getChassis(this.b.chassis.id);
    if (kind === 'weapon') {
      const s = ch.weaponSlots[index];
      return !!s && weaponFits(key, s.mount);
    }
    if (kind === 'wheel') return index < ch.wheelSlots.length;
    return index < ch.gadgetSlots.length;
  }
  equip(kind: SlotKind, index: number, key: string | null): boolean {
    const list = listOf(this.b, kind);
    if (index < 0 || index >= list.length) return false;
    if (key !== null && !this.canEquip(kind, index, key)) return false;
    list[index] = key ? { id: key, level: this.lvl } : null;
    this.emit();
    return true;
  }
  autoEquip(key: string) {
    const def = findPart(key);
    if (!def) return null;
    if (def.kind === 'chassis') {
      this.setChassis(key);
      return null;
    }
    const kind = def.kind as SlotKind;
    const list = listOf(this.b, kind);
    let target = list.findIndex((v, i) => v === null && this.canEquip(kind, i, key));
    if (target < 0) target = list.findIndex((_, i) => this.canEquip(kind, i, key));
    if (target < 0) return null;
    this.equip(kind, target, key);
    return { kind, index: target };
  }
  unequip(key: string): void {
    const clearIn = (l: (PartRef | null)[]) => l.map((r) => (r?.id === key ? null : r));
    this.b = { ...this.b, wheels: clearIn(this.b.wheels), weapons: clearIn(this.b.weapons), gadgets: clearIn(this.b.gadgets) };
    this.emit();
  }
  setChassis(key: string): void {
    const def = getPart(key);
    if (def.kind !== 'chassis') return;
    const old = this.b;
    const keep = (l: (PartRef | null)[], n: number) => {
      const f = l.filter(Boolean);
      return Array.from({ length: n }, (_, i) => f[i] ?? null);
    };
    const weapons: (PartRef | null)[] = def.weaponSlots.map(() => null);
    for (const w of old.weapons) {
      if (!w) continue;
      const idx = def.weaponSlots.findIndex((s, i) => weapons[i] === null && weaponFits(w.id, s.mount));
      if (idx >= 0) weapons[idx] = w;
    }
    this.b = {
      chassis: { id: key, level: this.lvl },
      wheels: keep(old.wheels, def.wheelSlots.length),
      weapons,
      gadgets: keep(old.gadgets, def.gadgetSlots.length),
      paint: old.paint,
    };
    this.emit();
  }
  setPaint(hex: string | undefined): void {
    this.b = { ...this.b, paint: hex };
    this.emit();
  }
  fusable(): boolean {
    return false;
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
