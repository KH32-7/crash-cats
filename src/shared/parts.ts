/**
 * Part catalog — the single contract shared by the physics sim (client + server),
 * the procedural 3D models and the UI. All geometry is in meters, in the car's
 * LOCAL frame: origin = chassis body origin, +x = the car's forward direction,
 * +y = up. Car #1 (right side) is mirrored on x by the sim/renderer.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export type PartKind = 'chassis' | 'wheel' | 'weapon' | 'gadget';
export type Rarity = 'common' | 'rare' | 'epic';
/** Weapon mount: front/back point along ±x; top sits on the roof and points forward. */
export type Mount = 'front' | 'top' | 'back';

export interface WeaponSlot {
  pos: Vec2;
  mount: Mount;
}

export interface ChassisDef {
  id: string;
  kind: 'chassis';
  name: string;
  desc: string;
  rarity: Rarity;
  hp: number;
  /** Physics density (kg/m^2) of the body polygon. */
  density: number;
  /** Convex polygon, counter-clockwise, local frame. */
  shape: Vec2[];
  /** Visual extrusion depth along z (meters). */
  depth: number;
  /** Default paint (hex). */
  color: string;
  /** Secondary trim color (hex). */
  trim: string;
  wheelSlots: Vec2[];
  weaponSlots: WeaponSlot[];
  gadgetSlots: Vec2[];
  /** Where the cat driver sits (seat base, local). */
  cockpit: Vec2;
}

export type WheelStyle = 'basic' | 'bigfoot' | 'spiked' | 'turbo' | 'heavy';

export interface WheelDef {
  id: string;
  kind: 'wheel';
  name: string;
  desc: string;
  rarity: Rarity;
  style: WheelStyle;
  hp: number;
  radius: number;
  /** Visual tire width along z. */
  width: number;
  /** Target spin speed (rad/s). Linear speed ≈ speed * radius. */
  speed: number;
  /** Max drive torque (N·m). */
  torque: number;
  friction: number;
  density: number;
  /** Rim color (hex). */
  color: string;
}

export type WeaponType = 'blade' | 'drill' | 'chainsaw' | 'rocket' | 'fork' | 'punch';

export interface WeaponDef {
  id: string;
  kind: 'weapon';
  name: string;
  desc: string;
  rarity: Rarity;
  weapon: WeaponType;
  hp: number;
  /** Damage per hit at level 1. */
  damage: number;
  /** Seconds between hits / activations. */
  cooldown: number;
  mounts: Mount[];
  /**
   * Geometry in WEAPON-local frame (origin = slot pos, +x = pointing direction):
   * blade:    arm of `length` from origin, saw disc of `radius` at arm tip.
   * drill:    cone, base radius `radius` at x=0, tip at x=`length`.
   * chainsaw: bar from x=0.1 to x=`length`, half-height `radius`.
   * rocket:   launcher tube x∈[0,length], radius `radius`; rockets spawn at tip.
   * fork:     flat plate x∈[0,length], half-thickness `radius`; flips enemies upward.
   * punch:    piston housing x∈[0,length], glove radius `radius`, extends by `reach`.
   */
  length: number;
  radius: number;
  reach: number;
  /** Knockback / flip impulse strength (N·s) where relevant. */
  impulse: number;
  color: string;
}

export type GadgetType = 'booster' | 'armor' | 'spring';

export interface GadgetDef {
  id: string;
  kind: 'gadget';
  name: string;
  desc: string;
  rarity: Rarity;
  gadget: GadgetType;
  hp: number;
  cooldown: number;
  /** booster: thrust force (N); spring: jump impulse (N·s); armor: unused. */
  power: number;
  /** Visual/collider size (armor plate half-extents x,y or nozzle radius). */
  size: Vec2;
  color: string;
}

export type PartDef = ChassisDef | WheelDef | WeaponDef | GadgetDef;

export interface PartRef {
  id: string;
  level: number;
}

export interface CarBuild {
  chassis: PartRef;
  /** Length = chassis.wheelSlots.length; null = empty slot. */
  wheels: (PartRef | null)[];
  /** Length = chassis.weaponSlots.length. */
  weapons: (PartRef | null)[];
  /** Length = chassis.gadgetSlots.length. */
  gadgets: (PartRef | null)[];
  /** Optional paint override (hex). */
  paint?: string;
}

export const MAX_LEVEL = 10;

const v = (x: number, y: number): Vec2 => ({ x, y });

export const CHASSIS: ChassisDef[] = [
  {
    id: 'scooter',
    kind: 'chassis',
    name: '스쿠터',
    desc: '가볍고 빠른 입문용 차체',
    rarity: 'common',
    hp: 110,
    density: 1.3,
    shape: [v(-0.8, -0.15), v(0.8, -0.15), v(0.92, 0.04), v(0.35, 0.2), v(-0.7, 0.26), v(-0.9, 0.06)],
    depth: 0.62,
    color: '#e8742c',
    trim: '#7a2f19',
    wheelSlots: [v(-0.6, -0.2), v(0.6, -0.2)],
    weaponSlots: [
      { pos: v(0.9, 0.02), mount: 'front' },
      { pos: v(0.05, 0.24), mount: 'top' },
    ],
    gadgetSlots: [v(-0.88, 0.08)],
    cockpit: v(-0.35, 0.24),
  },
  {
    id: 'wedge',
    kind: 'chassis',
    name: '웨지',
    desc: '낮은 경사로 상대 밑으로 파고든다',
    rarity: 'common',
    hp: 150,
    density: 1.8,
    shape: [v(-0.9, -0.2), v(1.05, -0.2), v(-0.15, 0.36), v(-0.9, 0.36)],
    depth: 0.7,
    color: '#2fa39a',
    trim: '#12433f',
    wheelSlots: [v(-0.65, -0.24), v(0.5, -0.24)],
    weaponSlots: [
      { pos: v(-0.45, 0.36), mount: 'top' },
      { pos: v(-0.9, 0.08), mount: 'back' },
    ],
    gadgetSlots: [v(-0.8, 0.36)],
    cockpit: v(-0.55, 0.36),
  },
  {
    id: 'box',
    kind: 'chassis',
    name: '박스 탱크',
    desc: '튼튼하고 무거운 상자형 차체',
    rarity: 'rare',
    hp: 210,
    density: 2.1,
    shape: [v(-0.95, -0.25), v(0.95, -0.25), v(1.0, 0.25), v(0.85, 0.42), v(-0.85, 0.42), v(-1.0, 0.25)],
    depth: 0.8,
    color: '#7d9a3a',
    trim: '#34431a',
    wheelSlots: [v(-0.72, -0.3), v(0, -0.3), v(0.72, -0.3)],
    weaponSlots: [
      { pos: v(1.0, 0.05), mount: 'front' },
      { pos: v(0.3, 0.42), mount: 'top' },
      { pos: v(-1.0, 0.08), mount: 'back' },
    ],
    gadgetSlots: [v(-0.55, 0.42)],
    cockpit: v(-0.25, 0.42),
  },
  {
    id: 'dragster',
    kind: 'chassis',
    name: '드래그스터',
    desc: '길고 낮아 뒤집히지 않는다',
    rarity: 'rare',
    hp: 140,
    density: 1.4,
    shape: [v(-1.2, -0.15), v(1.2, -0.15), v(1.28, 0.0), v(0.4, 0.16), v(-0.45, 0.3), v(-1.2, 0.3)],
    depth: 0.6,
    color: '#d8413a',
    trim: '#5c1512',
    wheelSlots: [v(-0.9, -0.2), v(0.95, -0.2)],
    weaponSlots: [
      { pos: v(1.25, 0.0), mount: 'front' },
      { pos: v(0.1, 0.22), mount: 'top' },
    ],
    gadgetSlots: [v(-1.18, 0.12), v(-0.85, 0.3)],
    cockpit: v(-0.5, 0.3),
  },
  {
    id: 'tower',
    kind: 'chassis',
    name: '타워',
    desc: '높은 곳에서 내려친다. 무게중심 주의',
    rarity: 'epic',
    hp: 180,
    density: 1.5,
    shape: [v(-0.8, -0.2), v(0.8, -0.2), v(0.8, 0.3), v(0.3, 0.78), v(-0.5, 0.78), v(-0.8, 0.3)],
    depth: 0.72,
    color: '#7b58c7',
    trim: '#2e1f55',
    wheelSlots: [v(-0.58, -0.25), v(0.58, -0.25)],
    weaponSlots: [
      { pos: v(0.8, 0.05), mount: 'front' },
      { pos: v(0.0, 0.78), mount: 'top' },
      { pos: v(-0.8, 0.08), mount: 'back' },
    ],
    gadgetSlots: [v(-0.65, 0.5)],
    cockpit: v(-0.2, 0.78),
  },
];

export const WHEELS: WheelDef[] = [
  { id: 'wheel_basic', kind: 'wheel', name: '기본 바퀴', desc: '무난한 성능', rarity: 'common', style: 'basic', hp: 10, radius: 0.26, width: 0.22, speed: 12, torque: 7, friction: 1.2, density: 1.0, color: '#f2b233' },
  { id: 'wheel_spiked', kind: 'wheel', name: '스파이크 바퀴', desc: '접지력이 매우 높다', rarity: 'rare', style: 'spiked', hp: 15, radius: 0.3, width: 0.24, speed: 11, torque: 8, friction: 2.2, density: 1.1, color: '#b9c3c9' },
  { id: 'wheel_turbo', kind: 'wheel', name: '터보 바퀴', desc: '가장 빠르지만 약하다', rarity: 'rare', style: 'turbo', hp: 8, radius: 0.25, width: 0.2, speed: 18, torque: 6, friction: 1.0, density: 0.9, color: '#3fb5ff' },
  { id: 'wheel_bigfoot', kind: 'wheel', name: '빅풋', desc: '큰 바퀴로 상대를 타고 넘는다', rarity: 'epic', style: 'bigfoot', hp: 25, radius: 0.42, width: 0.32, speed: 9, torque: 10, friction: 1.4, density: 0.8, color: '#ff8a1f' },
  { id: 'wheel_heavy', kind: 'wheel', name: '탱크 바퀴', desc: '무겁고 튼튼해 잘 안 뒤집힌다', rarity: 'epic', style: 'heavy', hp: 30, radius: 0.32, width: 0.3, speed: 8, torque: 13, friction: 1.4, density: 2.4, color: '#6b7b52' },
];

export const WEAPONS: WeaponDef[] = [
  { id: 'blade', kind: 'weapon', name: '톱날', desc: '휘두르는 회전 톱날', rarity: 'common', weapon: 'blade', hp: 10, damage: 13, cooldown: 0.25, mounts: ['front', 'top', 'back'], length: 0.55, radius: 0.26, reach: 0, impulse: 0.15, color: '#f2b233' },
  { id: 'drill', kind: 'weapon', name: '드릴', desc: '붙어서 계속 뚫는다', rarity: 'common', weapon: 'drill', hp: 8, damage: 8, cooldown: 0.2, mounts: ['front', 'back'], length: 0.62, radius: 0.17, reach: 0, impulse: 0, color: '#c9d2d9' },
  { id: 'chainsaw', kind: 'weapon', name: '전기톱', desc: '긴 사거리의 톱', rarity: 'rare', weapon: 'chainsaw', hp: 8, damage: 6, cooldown: 0.12, mounts: ['front', 'back'], length: 0.9, radius: 0.08, reach: 0, impulse: 0, color: '#e84a2f' },
  { id: 'fork', kind: 'weapon', name: '포크', desc: '상대를 들어 뒤집는다', rarity: 'rare', weapon: 'fork', hp: 20, damage: 16, cooldown: 2.0, mounts: ['front'], length: 0.72, radius: 0.035, reach: 0, impulse: 7.5, color: '#9aa7b0' },
  { id: 'punch', kind: 'weapon', name: '펀치', desc: '피스톤 글러브로 강타', rarity: 'rare', weapon: 'punch', hp: 15, damage: 30, cooldown: 1.4, mounts: ['front', 'back'], length: 0.32, radius: 0.17, reach: 0.55, impulse: 6, color: '#e2343a' },
  { id: 'rocket', kind: 'weapon', name: '로켓', desc: '멀리서 로켓을 발사한다', rarity: 'epic', weapon: 'rocket', hp: 12, damage: 36, cooldown: 1.8, mounts: ['top', 'front'], length: 0.5, radius: 0.1, reach: 0, impulse: 3, color: '#5f6f7a' },
];

export const GADGETS: GadgetDef[] = [
  { id: 'armor', kind: 'gadget', name: '장갑판', desc: '체력 증가 + 방패', rarity: 'common', gadget: 'armor', hp: 60, cooldown: 0, power: 0, size: v(0.08, 0.3), color: '#8a96a0' },
  { id: 'booster', kind: 'gadget', name: '부스터', desc: '주기적으로 돌진', rarity: 'rare', gadget: 'booster', hp: 10, cooldown: 3.0, power: 60, size: v(0.12, 0.12), color: '#4c5a66' },
  { id: 'spring', kind: 'gadget', name: '점프 스프링', desc: '주기적으로 뛰어오른다', rarity: 'rare', gadget: 'spring', hp: 10, cooldown: 3.5, power: 7, size: v(0.14, 0.2), color: '#d9d9d9' },
];

export const ALL_PARTS: PartDef[] = [...CHASSIS, ...WHEELS, ...WEAPONS, ...GADGETS];
const PART_INDEX = new Map<string, PartDef>(ALL_PARTS.map((p) => [p.id, p]));

export function getPart(id: string): PartDef {
  const part = PART_INDEX.get(id);
  if (!part) throw new Error(`Unknown part: ${id}`);
  return part;
}
export function findPart(id: string): PartDef | undefined {
  return PART_INDEX.get(id);
}
export const getChassis = (id: string) => getPart(id) as ChassisDef;
export const getWheel = (id: string) => getPart(id) as WheelDef;
export const getWeapon = (id: string) => getPart(id) as WeaponDef;
export const getGadget = (id: string) => getPart(id) as GadgetDef;

/** Stat multiplier for a part level (hp and damage). */
export function levelScale(level: number): number {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  return 1 + 0.14 * (l - 1);
}

/** +1 facing forward (front/top), -1 facing backward. */
export function mountDir(mount: Mount): 1 | -1 {
  return mount === 'back' ? -1 : 1;
}

/** Blade arm base angle (radians, weapon-local, before mirroring) and swing amplitude. */
export function bladeArm(mount: Mount): { base: number; swing: number } {
  return mount === 'top' ? { base: 0.85, swing: 0.75 } : { base: 0.15, swing: 0.45 };
}

export interface CarStats {
  hp: number;
  damage: number;
  mass: number;
}

export function computeStats(build: CarBuild): CarStats {
  const chassis = getChassis(build.chassis.id);
  let hp = chassis.hp * levelScale(build.chassis.level);
  let damage = 0;
  for (const ref of build.wheels) if (ref) hp += getWheel(ref.id).hp * levelScale(ref.level);
  for (const ref of build.weapons) {
    if (!ref) continue;
    const w = getWeapon(ref.id);
    hp += w.hp * levelScale(ref.level);
    damage += w.damage * levelScale(ref.level);
  }
  for (const ref of build.gadgets) if (ref) hp += getGadget(ref.id).hp * levelScale(ref.level);
  return { hp: Math.round(hp), damage: Math.round(damage), mass: 0 };
}

/** Returns a sanitized copy of a build (unknown parts dropped, arrays sized to chassis slots). */
export function sanitizeBuild(build: CarBuild | null | undefined): CarBuild {
  const fallback = defaultBuild();
  if (!build || !build.chassis) return fallback;
  const chassisDef = findPart(build.chassis.id);
  if (!chassisDef || chassisDef.kind !== 'chassis') return fallback;
  const clampRef = (ref: PartRef | null | undefined, kind: PartKind): PartRef | null => {
    if (!ref) return null;
    const def = findPart(ref.id);
    if (!def || def.kind !== kind) return null;
    return { id: def.id, level: Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(ref.level) || 1))) };
  };
  const wheels = chassisDef.wheelSlots.map((_, i) => clampRef(build.wheels?.[i], 'wheel'));
  const weapons = chassisDef.weaponSlots.map((slot, i) => {
    const ref = clampRef(build.weapons?.[i], 'weapon');
    if (!ref) return null;
    return getWeapon(ref.id).mounts.includes(slot.mount) ? ref : null;
  });
  const gadgets = chassisDef.gadgetSlots.map((_, i) => clampRef(build.gadgets?.[i], 'gadget'));
  const paint = typeof build.paint === 'string' && /^#[0-9a-fA-F]{6}$/.test(build.paint) ? build.paint : undefined;
  return {
    chassis: { id: chassisDef.id, level: clampRef(build.chassis, 'chassis')?.level ?? 1 },
    wheels,
    weapons,
    gadgets,
    paint,
  };
}

export function defaultBuild(): CarBuild {
  return {
    chassis: { id: 'scooter', level: 1 },
    wheels: [
      { id: 'wheel_basic', level: 1 },
      { id: 'wheel_basic', level: 1 },
    ],
    weapons: [{ id: 'blade', level: 1 }, null],
    gadgets: [null],
  };
}

/** Can this weapon go into that slot? */
export function weaponFits(weaponId: string, mount: Mount): boolean {
  const def = findPart(weaponId);
  return !!def && def.kind === 'weapon' && def.mounts.includes(mount);
}

export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#8fb4c9',
  rare: '#5aa7ff',
  epic: '#c46bff',
};
export const RARITY_NAME: Record<Rarity, string> = {
  common: '일반',
  rare: '희귀',
  epic: '에픽',
};
