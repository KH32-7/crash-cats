import type { SlotKind } from '../app/Store';
import {
  RARITY_COLOR,
  RARITY_NAME,
  levelScale,
  type Mount,
  type PartDef,
  type PartKind,
  type Rarity,
} from '../shared/parts';
import type { IconName } from './icons';

export const KIND_NAME: Record<PartKind, string> = { chassis: '차체', wheel: '바퀴', weapon: '무기', gadget: '가젯' };
export const KIND_ICON: Record<PartKind, IconName> = { chassis: 'chassis', wheel: 'wheel', weapon: 'sword', gadget: 'gadget' };
export const MOUNT_NAME: Record<Mount, string> = { front: '앞', top: '위', back: '뒤' };

export function slotName(kind: SlotKind, mount?: Mount): string {
  if (kind === 'weapon') return mount ? `${MOUNT_NAME[mount]} 무기 슬롯` : '무기 슬롯';
  return kind === 'wheel' ? '바퀴 슬롯' : '가젯 슬롯';
}

export const rarityColor = (r: Rarity) => RARITY_COLOR[r];
export const rarityName = (r: Rarity) => RARITY_NAME[r];

export interface StatLine {
  icon: IconName;
  label: string;
  value: string;
  /** Value at level+1 (for fuse previews). */
  next?: string;
}

const r0 = (n: number) => String(Math.round(n));
const r1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** Human stats of a part at a level (mirrors computeStats scaling). */
export function partStats(def: PartDef, level: number, withNext = false): StatLine[] {
  const s = levelScale(level);
  const n = levelScale(level + 1);
  const nx = (v: string) => (withNext ? v : undefined);
  const out: StatLine[] = [{ icon: 'heart', label: '체력', value: r0(def.hp * s), next: nx(r0(def.hp * n)) }];
  switch (def.kind) {
    case 'chassis':
      out.push({
        icon: 'gear',
        label: '슬롯',
        value: `바퀴 ${def.wheelSlots.length} · 무기 ${def.weaponSlots.length} · 가젯 ${def.gadgetSlots.length}`,
      });
      break;
    case 'wheel':
      out.push({ icon: 'bolt', label: '속도', value: r1(def.speed * def.radius) });
      out.push({ icon: 'wheel', label: '접지력', value: r1(def.friction) });
      break;
    case 'weapon':
      out.push({ icon: 'sword', label: '공격력', value: r0(def.damage * s), next: nx(r0(def.damage * n)) });
      out.push({ icon: 'clock', label: '쿨다운', value: `${def.cooldown}초` });
      break;
    case 'gadget':
      if (def.cooldown > 0) out.push({ icon: 'clock', label: '쿨다운', value: `${def.cooldown}초` });
      break;
  }
  return out;
}

/** Mirrors Store.sell's formula (display only). */
export function sellValue(def: PartDef, level: number): number {
  const v: Record<Rarity, number> = { common: 15, rare: 40, epic: 100 };
  return v[def.rarity] * level;
}

export const EMOTES: { id: number; text: string }[] = [
  { id: 0, text: '냐옹!' },
  { id: 1, text: '좋았어!' },
  { id: 2, text: '헉!' },
  { id: 3, text: 'GG' },
];
export const emoteText = (id: number) => EMOTES.find((e) => e.id === id)?.text ?? '냥?';
