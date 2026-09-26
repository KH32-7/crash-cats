import type { CarBuild, GadgetType, WeaponType } from '../parts';

export type CarIndex = 0 | 1;
export type ArenaId = 'skate' | 'harbor' | 'airport' | 'warehouse';
export const ARENAS: ArenaId[] = ['skate', 'harbor', 'airport', 'warehouse'];

export interface MatchSetup {
  seed: number;
  builds: [CarBuild, CarBuild];
  arena: ArenaId;
}

/** World pose. x/y meters, a = rotation (radians, CCW). */
export interface BodyPose {
  x: number;
  y: number;
  a: number;
}

/**
 * Animation state for one mounted weapon, expressed in the WEAPON-local frame
 * (before mount/facing mirroring). Renderer: weapon group at slot.pos with
 * scale.x = mountDir(mount); apply these inside it.
 */
export interface WeaponAnim {
  type: WeaponType;
  /** blade: arm angle (rad, +up). rocket: launcher tilt. others 0. */
  angle: number;
  /** punch: glove extension 0..1 of reach. rocket: recoil 0..1. */
  extend: number;
  /** blade/drill/chainsaw spin phase (rad, keeps increasing). */
  spin: number;
  /** fork: plate lift angle (rad, 0 = flat). */
  flip: number;
  /** 0..1, decays after this weapon dealt damage (for glow/sparks). */
  heat: number;
}

export interface GadgetAnim {
  type: GadgetType;
  /** 0..1 active intensity (booster flame, spring compression→release). */
  active: number;
}

export interface CarSnapshot {
  chassis: BodyPose;
  /** Per wheel slot; null if slot empty. */
  wheels: (BodyPose | null)[];
  weapons: (WeaponAnim | null)[];
  gadgets: (GadgetAnim | null)[];
  hp: number;
  maxHp: number;
  alive: boolean;
  facing: 1 | -1;
  /** Total damage dealt so far. */
  dealt: number;
}

export interface ProjectileSnapshot {
  id: number;
  owner: CarIndex;
  x: number;
  y: number;
  a: number;
}

export interface SimSnapshot {
  tick: number;
  time: number;
  cars: [CarSnapshot, CarSnapshot];
  projectiles: ProjectileSnapshot[];
  /** Bulldozer blade x positions (world). Only meaningful when suddenDeath. */
  dozers: { left: number; right: number };
  suddenDeath: boolean;
  over: boolean;
  winner: CarIndex | -1 | null;
}

export type SimEvent =
  | { type: 'hit'; attacker: CarIndex; target: CarIndex; weapon: WeaponType | 'ram'; x: number; y: number; damage: number }
  | { type: 'rocketFire'; owner: CarIndex; x: number; y: number; a: number }
  | { type: 'explode'; x: number; y: number; size: number }
  | { type: 'flip'; owner: CarIndex; x: number; y: number }
  | { type: 'punch'; owner: CarIndex; x: number; y: number }
  | { type: 'boost'; owner: CarIndex }
  | { type: 'jump'; owner: CarIndex }
  | { type: 'clash'; x: number; y: number; strength: number }
  | { type: 'suddenDeath' }
  | { type: 'destroyed'; car: CarIndex; x: number; y: number; cause: 'damage' | 'dozer' }
  | { type: 'end'; winner: CarIndex | -1 };

export const SIM = {
  dt: 1 / 60,
  groundY: 0,
  halfWidth: 9,
  spawnX: 4.6,
  suddenDeathAt: 30,
  hardCapAt: 60,
  dozerSpeed: 0.9,
} as const;
