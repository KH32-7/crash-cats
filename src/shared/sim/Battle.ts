import RAPIER from '@dimforge/rapier2d-deterministic-compat';
import {
  bladeArm,
  getChassis,
  getGadget,
  getWeapon,
  getWheel,
  levelScale,
  mountDir,
  sanitizeBuild,
  type CarBuild,
  type ChassisDef,
  type GadgetDef,
  type Mount,
  type WeaponDef,
  type WeaponType,
  type WheelDef,
} from '../parts';
import { clamp, createRng, datan2, dcos, dsin, PI, TAU } from './dmath';
import {
  SIM,
  type BodyPose,
  type CarIndex,
  type CarSnapshot,
  type GadgetAnim,
  type MatchSetup,
  type ProjectileSnapshot,
  type SimEvent,
  type SimSnapshot,
  type WeaponAnim,
} from './types';

type Body = RAPIER.RigidBody;
type Col = RAPIER.Collider;

let initPromise: Promise<void> | null = null;
/** Must be awaited once before creating a Battle (idempotent). */
export function initPhysics(): Promise<void> {
  if (!initPromise) initPromise = RAPIER.init();
  return initPromise;
}

// ---- Tuning (named constants; see artifacts/design.md) ----
export const TUNE = {
  chassisDensityScale: 10,
  wheelDensityScale: 6,
  partDensity: 3,
  torqueScale: 1.9,
  torqueGain: 0.7,
  impulseScale: 3.2,
  boosterScale: 2.2,
  boosterDuration: 0.55,
  springScale: 3.4,
  rocketSpeed: 10.5,
  rocketGravity: 0.12,
  rocketLife: 3,
  bladeSwingHz: 1.05,
  maxAim: 0.45,
  stalemateAfter: 2.2,
  backoffTime: 0.75,
  selfRightAfter: 1.4,
};

// ---- Collision groups: (membership << 16) | filter ----
// Weapons pass through enemy weapons (only bodies/wheels/gadgets block), like CATS.
const G_WORLD = 1;
const G_BODY: [number, number] = [2, 4];
const G_WPN: [number, number] = [8, 16];
const G_DOZER = 32;
const grp = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);
const solidGroups = (i: CarIndex) => grp(G_BODY[i], G_WORLD | G_BODY[1 - i] | G_WPN[1 - i] | G_DOZER);
const weaponGroups = (i: CarIndex) => grp(G_WPN[i], G_WORLD | G_BODY[1 - i] | G_DOZER);
const sensorGroups = (i: CarIndex) => grp(G_WPN[i], G_BODY[1 - i]);
const projectileQueryGroups = (i: CarIndex) => grp(G_WPN[i], G_WORLD | G_BODY[1 - i] | G_DOZER);
const dozerGroups = grp(G_DOZER, G_BODY[0] | G_BODY[1] | G_WPN[0] | G_WPN[1]);

type PartTag = 'world' | 'chassis' | 'wheel' | 'weapon' | 'gadget' | 'sensor' | 'dozer';
interface ColInfo {
  car: CarIndex | -1;
  part: PartTag;
}

interface WheelRt {
  def: WheelDef;
  body: Body;
  col: Col;
  torque: number;
  speed: number;
  pose: BodyPose;
}

interface WeaponRt {
  def: WeaponDef;
  slotX: number;
  slotY: number;
  mount: Mount;
  /** +1/-1: mountDir */
  d: 1 | -1;
  /** d * facing — total x mirror of weapon-local into body-local. */
  s: 1 | -1;
  damage: number;
  cooldown: number;
  timer: number;
  phase: number;
  /** Activation timeline for fork/punch (seconds since trigger, <0 = idle). */
  act: number;
  solid: Col | null;
  sensor: Col | null;
  anim: WeaponAnim;
}

interface GadgetRt {
  def: GadgetDef;
  slotX: number;
  slotY: number;
  timer: number;
  activeT: number;
  anim: GadgetAnim;
}

interface CarRt {
  index: CarIndex;
  facing: 1 | -1;
  build: CarBuild;
  chassisDef: ChassisDef;
  chassis: Body;
  chassisCol: Col;
  wheels: (WheelRt | null)[];
  weapons: (WeaponRt | null)[];
  gadgets: (GadgetRt | null)[];
  hp: number;
  maxHp: number;
  alive: boolean;
  dealt: number;
  pose: BodyPose;
  spawnY: number;
  driveDir: 1 | -1;
  upsideT: number;
  backoffT: number;
}

interface Rocket {
  id: number;
  owner: CarIndex;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  damage: number;
  impulse: number;
}

export interface BattleResult {
  winner: CarIndex | -1;
  ticks: number;
  hash: string;
  hp: [number, number];
  maxHp: [number, number];
  dealt: [number, number];
}

export class Battle {
  readonly setup: MatchSetup;
  private readonly world: RAPIER.World;
  private readonly info = new Map<number, ColInfo>();
  private readonly cars: [CarRt, CarRt];
  private readonly rng: () => number;
  private rockets: Rocket[] = [];
  private nextRocketId = 1;
  private tickCount = 0;
  private suddenDeath = false;
  private dozerBodies: [Body, Body] | null = null;
  private dozerCols: [Col, Col] | null = null;
  private dozerX = { left: -(SIM.halfWidth + 1.4), right: SIM.halfWidth + 1.4 };
  private clashCooldown = 0;
  private lastDamageTime = 0;
  private over = false;
  private winner: CarIndex | -1 | null = null;
  private events: SimEvent[] = [];

  /** Call `await initPhysics()` first. */
  constructor(setup: MatchSetup) {
    this.setup = {
      seed: setup.seed >>> 0,
      builds: [sanitizeBuild(setup.builds[0]), sanitizeBuild(setup.builds[1])],
      arena: setup.arena,
    };
    this.rng = createRng(this.setup.seed ^ 0x9e3779b9);
    this.world = new RAPIER.World({ x: 0, y: -9.81 });
    this.world.timestep = SIM.dt;
    this.createStatic();
    this.cars = [this.createCar(0, this.setup.builds[0]), this.createCar(1, this.setup.builds[1])];
  }

  get tick(): number {
    return this.tickCount;
  }
  get time(): number {
    return this.tickCount * SIM.dt;
  }
  get isOver(): boolean {
    return this.over;
  }
  get result(): CarIndex | -1 | null {
    return this.winner;
  }

  free(): void {
    this.world.free();
  }

  // ------------------------------------------------------------------ setup

  private createStatic(): void {
    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, SIM.groundY - 1));
    const groundCol = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(SIM.halfWidth + 6, 1).setFriction(0.9).setCollisionGroups(grp(G_WORLD, 0xffff)),
      ground,
    );
    this.info.set(groundCol.handle, { car: -1, part: 'world' });
    for (const side of [-1, 1]) {
      const wall = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(side * (SIM.halfWidth + 0.5), SIM.groundY + 3),
      );
      const wallCol = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.5, 4).setFriction(0.3).setCollisionGroups(grp(G_WORLD, 0xffff)),
        wall,
      );
      this.info.set(wallCol.handle, { car: -1, part: 'world' });
    }
  }

  private createCar(index: CarIndex, build: CarBuild): CarRt {
    const facing: 1 | -1 = index === 0 ? 1 : -1;
    const chassisDef = getChassis(build.chassis.id);
    const f = facing;

    // Lowest point below the chassis origin decides spawn height.
    let minY = 0;
    for (const p of chassisDef.shape) minY = Math.min(minY, p.y);
    build.wheels.forEach((ref, i) => {
      if (!ref) return;
      const w = getWheel(ref.id);
      minY = Math.min(minY, chassisDef.wheelSlots[i].y - w.radius);
    });
    const x0 = -f * SIM.spawnX;
    const y0 = SIM.groundY - minY + 0.04;

    const chassis = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x0, y0).setLinearDamping(0.05).setAngularDamping(0.35),
    );
    const pts = new Float32Array(chassisDef.shape.length * 2);
    chassisDef.shape.forEach((p, i) => {
      pts[i * 2] = p.x * f;
      pts[i * 2 + 1] = p.y;
    });
    const chassisDesc = RAPIER.ColliderDesc.convexHull(pts);
    if (!chassisDesc) throw new Error(`Bad chassis polygon ${chassisDef.id}`);
    const chassisCol = this.world.createCollider(
      chassisDesc
        .setDensity(chassisDef.density * TUNE.chassisDensityScale)
        .setFriction(0.6)
        .setRestitution(0.05)
        .setCollisionGroups(solidGroups(index)),
      chassis,
    );
    this.info.set(chassisCol.handle, { car: index, part: 'chassis' });

    const scale = levelScale(build.chassis.level);
    let maxHp = chassisDef.hp * scale;

    const wheels: (WheelRt | null)[] = chassisDef.wheelSlots.map((slot, i) => {
      const ref = build.wheels[i];
      if (!ref) return null;
      const def = getWheel(ref.id);
      maxHp += def.hp * levelScale(ref.level);
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(x0 + slot.x * f, y0 + slot.y)
          .setAngularDamping(0.05),
      );
      const col = this.world.createCollider(
        RAPIER.ColliderDesc.ball(def.radius)
          .setDensity(def.density * TUNE.wheelDensityScale)
          .setFriction(def.friction)
          .setRestitution(0.1)
          .setCollisionGroups(solidGroups(index)),
        body,
      );
      this.info.set(col.handle, { car: index, part: 'wheel' });
      const joint = this.world.createImpulseJoint(
        RAPIER.JointData.revolute({ x: slot.x * f, y: slot.y }, { x: 0, y: 0 }),
        chassis,
        body,
        true,
      );
      joint.setContactsEnabled(false);
      return {
        def,
        body,
        col,
        torque: def.torque * TUNE.torqueScale,
        speed: def.speed,
        pose: { x: x0 + slot.x * f, y: y0 + slot.y, a: 0 },
      };
    });

    const weapons: (WeaponRt | null)[] = chassisDef.weaponSlots.map((slot, i) => {
      const ref = build.weapons[i];
      if (!ref) return null;
      const def = getWeapon(ref.id);
      const lvl = levelScale(ref.level);
      maxHp += def.hp * lvl;
      const d = mountDir(slot.mount);
      const s = (d * f) as 1 | -1;
      const rt: WeaponRt = {
        def,
        slotX: slot.pos.x,
        slotY: slot.pos.y,
        mount: slot.mount,
        d,
        s,
        damage: Math.round(def.damage * lvl),
        cooldown: def.cooldown,
        timer: def.weapon === 'rocket' ? def.cooldown * 0.55 : 0,
        phase: this.rng() * TAU,
        act: -1,
        solid: null,
        sensor: null,
        anim: { type: def.weapon, angle: 0, extend: 0, spin: 0, flip: 0, heat: 0 },
      };
      this.createWeaponColliders(index, chassis, rt);
      return rt;
    });

    const gadgets: (GadgetRt | null)[] = chassisDef.gadgetSlots.map((slot, i) => {
      const ref = build.gadgets[i];
      if (!ref) return null;
      const def = getGadget(ref.id);
      maxHp += def.hp * levelScale(ref.level);
      const cx = def.gadget === 'armor' ? slot.x + def.size.x : slot.x;
      const col = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(def.size.x, def.size.y)
          .setTranslation(cx * f, slot.y)
          .setDensity(TUNE.partDensity)
          .setFriction(0.5)
          .setCollisionGroups(solidGroups(index)),
        chassis,
      );
      this.info.set(col.handle, { car: index, part: 'gadget' });
      return {
        def,
        slotX: slot.x,
        slotY: slot.y,
        timer: def.gadget === 'booster' ? def.cooldown - 1.2 - this.rng() * 0.3 : def.cooldown - 1.6 - this.rng() * 0.4,
        activeT: 0,
        anim: { type: def.gadget, active: 0 },
      };
    });

    maxHp = Math.round(maxHp);
    return {
      index,
      facing,
      build,
      chassisDef,
      chassis,
      chassisCol,
      wheels,
      weapons,
      gadgets,
      hp: maxHp,
      maxHp,
      alive: true,
      dealt: 0,
      pose: { x: x0, y: y0, a: 0 },
      spawnY: y0,
      driveDir: f,
      upsideT: 0,
      backoffT: 0,
    };
  }

  /** Weapon-local (px,py) → chassis body-local. */
  private wl(car: { facing: 1 | -1 }, w: WeaponRt, px: number, py: number): { x: number; y: number } {
    return { x: car.facing * (w.slotX + w.d * px), y: w.slotY + py };
  }

  private createWeaponColliders(index: CarIndex, chassis: Body, w: WeaponRt): void {
    const car = { facing: (index === 0 ? 1 : -1) as 1 | -1 };
    const def = w.def;
    const addSolid = (desc: RAPIER.ColliderDesc) => {
      const col = this.world.createCollider(
        desc.setDensity(TUNE.partDensity).setFriction(0.4).setCollisionGroups(weaponGroups(index)),
        chassis,
      );
      this.info.set(col.handle, { car: index, part: 'weapon' });
      return col;
    };
    const addSensor = (desc: RAPIER.ColliderDesc) => {
      const col = this.world.createCollider(
        desc.setSensor(true).setDensity(0).setCollisionGroups(sensorGroups(index)),
        chassis,
      );
      this.info.set(col.handle, { car: index, part: 'sensor' });
      return col;
    };
    const poly = (points: [number, number][]) => {
      const arr = new Float32Array(points.length * 2);
      points.forEach(([px, py], i) => {
        const p = this.wl(car, w, px, py);
        arr[i * 2] = p.x;
        arr[i * 2 + 1] = p.y;
      });
      const desc = RAPIER.ColliderDesc.convexHull(arr);
      if (!desc) throw new Error(`Bad weapon polygon ${def.id}`);
      return desc;
    };

    switch (def.weapon) {
      case 'blade': {
        const p = this.wl(car, w, def.length, 0);
        w.solid = addSolid(RAPIER.ColliderDesc.ball(def.radius * 0.92).setTranslation(p.x, p.y));
        w.sensor = addSensor(RAPIER.ColliderDesc.ball(def.radius + 0.06).setTranslation(p.x, p.y));
        break;
      }
      case 'drill': {
        w.solid = addSolid(poly([[0, -def.radius], [def.length, 0], [0, def.radius]]));
        const p = this.wl(car, w, def.length - 0.06, 0);
        w.sensor = addSensor(RAPIER.ColliderDesc.ball(0.13).setTranslation(p.x, p.y));
        break;
      }
      case 'chainsaw': {
        w.solid = addSolid(poly([[0.1, -def.radius], [def.length, -def.radius], [def.length, def.radius], [0.1, def.radius]]));
        w.sensor = addSensor(
          poly([[0.25, -def.radius - 0.07], [def.length + 0.05, -def.radius - 0.07], [def.length + 0.05, def.radius + 0.07], [0.25, def.radius + 0.07]]),
        );
        break;
      }
      case 'rocket': {
        w.solid = addSolid(poly([[0, -def.radius], [def.length, -def.radius], [def.length, def.radius], [0, def.radius]]));
        break;
      }
      case 'fork': {
        // Plate pivots at the slot; rotation set every tick. Rest angle points down to the floor.
        const t = def.radius;
        const pts = new Float32Array([0, -t, def.length * w.s, -t, def.length * w.s, t, 0, t]);
        const desc = RAPIER.ColliderDesc.convexHull(pts);
        if (!desc) throw new Error('fork');
        const p = this.wl(car, w, 0, 0);
        w.solid = addSolid(desc.setTranslation(p.x, p.y).setRotation(w.s * FORK_REST));
        w.sensor = addSensor(poly([[0.05, -0.45], [def.length + 0.2, -0.45], [def.length + 0.2, 0.55], [0.05, 0.55]]));
        break;
      }
      case 'punch': {
        addSolid(poly([[0, -0.1], [def.length, -0.1], [def.length, 0.1], [0, 0.1]]));
        const p = this.wl(car, w, def.length + def.radius, 0);
        w.solid = addSolid(RAPIER.ColliderDesc.ball(def.radius).setTranslation(p.x, p.y));
        w.sensor = addSensor(
          poly([[def.length, -0.32], [def.length + 2 * def.radius + def.reach + 0.12, -0.32], [def.length + 2 * def.radius + def.reach + 0.12, 0.32], [def.length, 0.32]]),
        );
        break;
      }
    }
  }

  // ------------------------------------------------------------------ step

  /** Advance one fixed tick. Returns events produced during this tick. */
  step(): SimEvent[] {
    this.events = [];
    const dt = SIM.dt;
    this.tickCount += 1;
    const t = this.time;
    if (this.clashCooldown > 0) this.clashCooldown -= dt;

    this.checkStalemate(t);
    for (const car of this.cars) {
      if (!car.alive) continue;
      const enemy = this.cars[1 - car.index];
      this.readPose(car);
      if (enemy.alive) this.readPose(enemy);
      this.selfRight(car, dt);
      this.drive(car, enemy);
      this.updateGadgets(car, dt);
      this.updateWeaponsKinematic(car, enemy, dt);
    }

    if (!this.suddenDeath && t >= SIM.suddenDeathAt && !this.over) this.startSuddenDeath();
    if (this.dozerBodies) {
      if (this.dozerX.right - this.dozerX.left > 2.6) {
        this.dozerX.left += SIM.dozerSpeed * dt;
        this.dozerX.right -= SIM.dozerSpeed * dt;
      }
      this.dozerBodies[0].setNextKinematicTranslation({ x: this.dozerX.left, y: SIM.groundY + 1.25 });
      this.dozerBodies[1].setNextKinematicTranslation({ x: this.dozerX.right, y: SIM.groundY + 1.25 });
    }

    this.world.step();

    for (const car of this.cars) {
      if (!car.alive) continue;
      this.readPose(car);
      for (const wh of car.wheels) {
        if (!wh) continue;
        const p = wh.body.translation();
        wh.pose.x = p.x;
        wh.pose.y = p.y;
        wh.pose.a = wh.body.rotation();
      }
    }

    if (!this.over) {
      for (const car of this.cars) {
        const enemy = this.cars[1 - car.index];
        if (car.alive && enemy.alive) this.resolveWeapons(car, enemy, dt);
      }
    }
    this.updateRockets(dt);
    this.checkClash();
    if (!this.over) this.checkDeaths();
    return this.events;
  }

  private readPose(car: CarRt): void {
    const p = car.chassis.translation();
    car.pose.x = p.x;
    car.pose.y = p.y;
    car.pose.a = car.chassis.rotation();
  }

  private toWorld(car: CarRt, bx: number, by: number): { x: number; y: number } {
    const c = dcos(car.pose.a);
    const s = dsin(car.pose.a);
    return { x: car.pose.x + c * bx - s * by, y: car.pose.y + s * bx + c * by };
  }

  /** No damage for a while while close → both cars reverse briefly, then charge again. */
  private checkStalemate(t: number): void {
    const [a, b] = this.cars;
    if (!a.alive || !b.alive || this.over) return;
    const dx = Math.abs(a.pose.x - b.pose.x);
    if (t - this.lastDamageTime > TUNE.stalemateAfter && dx < 3.2) {
      this.lastDamageTime = t + TUNE.backoffTime;
      a.backoffT = TUNE.backoffTime;
      b.backoffT = TUNE.backoffTime;
    }
  }

  /** A car stuck on its roof gets a cat-kick back over after a moment. */
  private selfRight(car: CarRt, dt: number): void {
    const up = dcos(car.pose.a);
    const lv = car.chassis.linvel();
    const still = lv.x * lv.x + lv.y * lv.y < 1.5;
    if (up < -0.2 && still) car.upsideT += dt;
    else car.upsideT = Math.max(0, car.upsideT - dt * 2);
    if (car.upsideT < TUNE.selfRightAfter) return;
    car.upsideT = 0;
    const m = car.chassis.mass();
    const sign = car.pose.a > 0 ? -1 : 1;
    car.chassis.applyImpulse({ x: 0, y: m * 4.2 }, true);
    car.chassis.applyTorqueImpulse(sign * m * 1.6, true);
    this.events.push({ type: 'jump', owner: car.index });
  }

  private drive(car: CarRt, enemy: CarRt): void {
    if (enemy.alive) {
      const dx = enemy.pose.x - car.pose.x;
      if (dx > 0.05) car.driveDir = 1;
      else if (dx < -0.05) car.driveDir = -1;
    }
    let dir = car.driveDir;
    if (car.backoffT > 0) {
      car.backoffT -= SIM.dt;
      dir = -dir as 1 | -1;
    }
    const chassisAng = car.chassis.angvel();
    for (const wh of car.wheels) {
      if (!wh) continue;
      const target = -dir * wh.speed;
      const rel = wh.body.angvel() - chassisAng;
      const tau = clamp((target - rel) * wh.torque * TUNE.torqueGain, -wh.torque, wh.torque);
      wh.body.applyTorqueImpulse(tau * SIM.dt, true);
      car.chassis.applyTorqueImpulse(-tau * SIM.dt, true);
    }
  }

  private updateGadgets(car: CarRt, dt: number): void {
    for (const g of car.gadgets) {
      if (!g) continue;
      const def = g.def;
      if (def.gadget === 'armor') continue;
      g.timer += dt;
      if (def.gadget === 'booster') {
        if (g.timer >= def.cooldown) {
          g.timer = 0;
          g.activeT = TUNE.boosterDuration;
          this.events.push({ type: 'boost', owner: car.index });
        }
        if (g.activeT > 0) {
          g.activeT -= dt;
          const force = def.power * TUNE.boosterScale;
          const c = dcos(car.pose.a);
          const s = dsin(car.pose.a);
          car.chassis.applyImpulse({ x: c * car.facing * force * dt, y: s * car.facing * force * dt }, true);
          g.anim.active = 1;
        } else {
          g.anim.active = Math.max(0, g.anim.active - dt * 4);
        }
      } else if (def.gadget === 'spring') {
        const lowEnough = car.pose.y < car.spawnY + 0.35;
        if (g.timer >= def.cooldown && lowEnough) {
          g.timer = 0;
          const up = def.power * TUNE.springScale;
          const c = dcos(car.pose.a);
          const s = dsin(car.pose.a);
          // Along the body's up vector: an upside-down car springs itself back over.
          car.chassis.applyImpulse({ x: -s * up + car.driveDir * up * 0.2, y: c * up }, true);
          if (c < 0.2) car.chassis.applyTorqueImpulse(car.facing * up * 0.22, true);
          g.anim.active = 1;
          this.events.push({ type: 'jump', owner: car.index });
        } else {
          g.anim.active = Math.max(0, g.anim.active - dt * 3.5);
        }
      }
    }
  }

  private updateWeaponsKinematic(car: CarRt, enemy: CarRt, dt: number): void {
    for (const w of car.weapons) {
      if (!w) continue;
      const def = w.def;
      if (w.timer > 0) w.timer -= dt;
      w.anim.heat = Math.max(0, w.anim.heat - dt * 3);
      switch (def.weapon) {
        case 'blade': {
          w.phase += TAU * TUNE.bladeSwingHz * dt;
          const arm = bladeArm(w.mount);
          const ang = arm.base + arm.swing * dsin(w.phase);
          w.anim.angle = ang;
          w.anim.spin += 22 * dt;
          const p = this.wl(car, w, def.length * dcos(ang), def.length * dsin(ang));
          w.solid?.setTranslationWrtParent(p);
          w.sensor?.setTranslationWrtParent(p);
          break;
        }
        case 'drill':
          w.anim.spin += 30 * dt;
          break;
        case 'chainsaw':
          w.anim.spin += 26 * dt;
          break;
        case 'fork': {
          const a = forkAngle(w.act);
          if (w.act >= 0) {
            w.act += dt;
            if (w.act > FORK_TOTAL) w.act = -1;
          }
          w.anim.flip = a;
          w.solid?.setRotationWrtParent(w.s * a);
          break;
        }
        case 'punch': {
          const e = punchExtend(w.act);
          if (w.act >= 0) {
            w.act += dt;
            if (w.act > PUNCH_TOTAL) w.act = -1;
          }
          w.anim.extend = e;
          const p = this.wl(car, w, def.length + def.radius + e * def.reach, 0);
          w.solid?.setTranslationWrtParent(p);
          break;
        }
        case 'rocket': {
          w.anim.extend = Math.max(0, w.anim.extend - dt * 3);
          if (!enemy.alive) break;
          // Aim toward the enemy body, clamped; expressed in weapon-local terms.
          const muzzle = this.toWorld(car, car.facing * (w.slotX + w.d * def.length), w.slotY);
          const fwdX = dcos(car.pose.a) * w.s;
          const fwdY = dsin(car.pose.a) * w.s;
          const vx = enemy.pose.x - muzzle.x;
          const vy = enemy.pose.y - muzzle.y;
          const rel = datan2(fwdX * vy - fwdY * vx, fwdX * vx + fwdY * vy);
          const aim = clamp(rel, -TUNE.maxAim, TUNE.maxAim);
          w.anim.angle += (w.s * aim - w.anim.angle) * Math.min(1, dt * 8);
          if (w.timer <= 0 && rel > -1.1 && rel < 1.1 && !this.over) {
            w.timer = def.cooldown;
            const worldAng = car.pose.a + (w.s === 1 ? 0 : PI) + w.s * w.anim.angle;
            const c = dcos(worldAng);
            const s = dsin(worldAng);
            this.rockets.push({
              id: this.nextRocketId++,
              owner: car.index,
              x: muzzle.x + c * 0.1,
              y: muzzle.y + s * 0.1,
              vx: c * TUNE.rocketSpeed,
              vy: s * TUNE.rocketSpeed,
              life: TUNE.rocketLife,
              damage: w.damage,
              impulse: def.impulse * TUNE.impulseScale,
            });
            w.anim.extend = 1;
            this.events.push({ type: 'rocketFire', owner: car.index, x: muzzle.x, y: muzzle.y, a: worldAng });
          }
          break;
        }
      }
    }
  }

  private overlapsEnemy(sensor: Col, enemy: CarRt): { chassis: boolean; any: boolean } {
    const chassis = this.world.intersectionPair(sensor, enemy.chassisCol);
    if (chassis) return { chassis: true, any: true };
    for (const wh of enemy.wheels) if (wh && this.world.intersectionPair(sensor, wh.col)) return { chassis: false, any: true };
    // Weapon/gadget solids of the enemy share its chassis body.
    let any = false;
    this.world.intersectionPairsWith(sensor, (other) => {
      const inf = this.info.get(other.handle);
      if (inf && inf.car === enemy.index && inf.part !== 'sensor') any = true;
    });
    return { chassis: false, any };
  }

  private resolveWeapons(car: CarRt, enemy: CarRt, _dt: number): void {
    for (const w of car.weapons) {
      if (!w || !w.sensor) continue;
      const def = w.def;
      switch (def.weapon) {
        case 'blade':
        case 'drill':
        case 'chainsaw': {
          if (w.timer > 0) break;
          if (!this.world.intersectionPair(w.sensor, enemy.chassisCol)) break;
          w.timer = w.cooldown;
          const sp = w.sensor.translation();
          this.damage(car, enemy, w.damage, def.weapon, sp.x, sp.y);
          w.anim.heat = 1;
          if (def.impulse > 0) {
            const dx = enemy.pose.x - sp.x;
            const dy = enemy.pose.y - sp.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const k = def.impulse * TUNE.impulseScale;
            enemy.chassis.applyImpulseAtPoint({ x: (dx / len) * k, y: (dy / len) * k }, sp, true);
          }
          break;
        }
        case 'fork': {
          if (w.timer > 0 || w.act >= 0) break;
          const hit = this.overlapsEnemy(w.sensor, enemy);
          if (!hit.any) break;
          w.timer = w.cooldown;
          w.act = 0;
          const tip = this.toWorld(car, car.facing * (w.slotX + w.d * def.length * 0.8), w.slotY);
          const k = def.impulse * TUNE.impulseScale;
          const dirX = enemy.pose.x > car.pose.x ? 1 : -1;
          enemy.chassis.applyImpulseAtPoint({ x: dirX * k * 0.3, y: k }, { x: tip.x, y: tip.y }, true);
          this.events.push({ type: 'flip', owner: car.index, x: tip.x, y: tip.y });
          if (hit.chassis) this.damage(car, enemy, w.damage, 'fork', tip.x, tip.y);
          w.anim.heat = 1;
          break;
        }
        case 'punch': {
          if (w.timer > 0 || w.act >= 0) break;
          const hit = this.overlapsEnemy(w.sensor, enemy);
          if (!hit.any) break;
          w.timer = w.cooldown;
          w.act = 0;
          const glove = this.toWorld(car, car.facing * (w.slotX + w.d * (def.length + def.radius + def.reach)), w.slotY);
          const k = def.impulse * TUNE.impulseScale * (hit.chassis ? 1 : 0.6);
          const dirX = enemy.pose.x > car.pose.x ? 1 : -1;
          enemy.chassis.applyImpulseAtPoint({ x: dirX * k, y: k * 0.35 }, glove, true);
          this.events.push({ type: 'punch', owner: car.index, x: glove.x, y: glove.y });
          if (hit.chassis) this.damage(car, enemy, w.damage, 'punch', glove.x, glove.y);
          w.anim.heat = 1;
          break;
        }
        case 'rocket':
          break;
      }
    }
  }

  private damage(from: CarRt, to: CarRt, amount: number, weapon: WeaponType | 'ram', x: number, y: number): void {
    if (!to.alive || this.over) return;
    this.lastDamageTime = Math.max(this.lastDamageTime, this.time);
    const dealt = Math.min(amount, Math.max(0, to.hp));
    to.hp -= amount;
    from.dealt += dealt;
    this.events.push({ type: 'hit', attacker: from.index, target: to.index, weapon, x, y, damage: amount });
  }

  private updateRockets(dt: number): void {
    if (this.rockets.length === 0) return;
    const shape = new RAPIER.Ball(0.1);
    const survivors: Rocket[] = [];
    for (const r of this.rockets) {
      r.vy -= 9.81 * TUNE.rocketGravity * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.life -= dt;
      let hitCol: Col | null = null;
      this.world.intersectionsWithShape(
        { x: r.x, y: r.y },
        0,
        shape,
        (col) => {
          hitCol = col;
          return false;
        },
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        projectileQueryGroups(r.owner),
      );
      const outOfBounds = r.life <= 0 || r.x < -SIM.halfWidth - 2 || r.x > SIM.halfWidth + 2 || r.y > 12;
      if (!hitCol && !outOfBounds) {
        survivors.push(r);
        continue;
      }
      if (hitCol) {
        const inf = this.info.get((hitCol as Col).handle);
        const target = inf && inf.car !== -1 ? this.cars[inf.car] : null;
        if (target && target.alive && inf && inf.car !== r.owner) {
          const len = Math.sqrt(r.vx * r.vx + r.vy * r.vy) || 1;
          const k = r.impulse * (inf.part === 'chassis' ? 1 : 0.5);
          target.chassis.applyImpulseAtPoint({ x: (r.vx / len) * k, y: (r.vy / len) * k + k * 0.3 }, { x: r.x, y: r.y }, true);
          if (inf.part === 'chassis') this.damage(this.cars[r.owner], target, r.damage, 'rocket', r.x, r.y);
        }
        this.events.push({ type: 'explode', x: r.x, y: r.y, size: 1 });
      }
    }
    this.rockets = survivors;
  }

  private checkClash(): void {
    const [a, b] = this.cars;
    if (!a.alive || !b.alive || this.clashCooldown > 0) return;
    let touching = false;
    this.world.contactPair(a.chassisCol, b.chassisCol, (m) => {
      if (m.numContacts() > 0) touching = true;
    });
    if (!touching) return;
    const va = a.chassis.linvel();
    const vb = b.chassis.linvel();
    const rel = Math.sqrt((va.x - vb.x) ** 2 + (va.y - vb.y) ** 2);
    if (rel > 1.8) {
      this.clashCooldown = 0.35;
      this.events.push({ type: 'clash', x: (a.pose.x + b.pose.x) / 2, y: (a.pose.y + b.pose.y) / 2, strength: Math.min(1, rel / 6) });
    }
  }

  private startSuddenDeath(): void {
    this.suddenDeath = true;
    this.events.push({ type: 'suddenDeath' });
    const make = (x: number) => {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, SIM.groundY + 1.25));
      const col = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.6, 1.25).setFriction(0.4).setCollisionGroups(dozerGroups),
        body,
      );
      this.info.set(col.handle, { car: -1, part: 'dozer' });
      return { body, col };
    };
    const l = make(this.dozerX.left);
    const r = make(this.dozerX.right);
    this.dozerBodies = [l.body, r.body];
    this.dozerCols = [l.col, r.col];
  }

  private checkDeaths(): void {
    const dead: { car: CarRt; cause: 'damage' | 'dozer' }[] = [];
    for (const car of this.cars) {
      if (!car.alive) continue;
      if (car.hp <= 0) {
        dead.push({ car, cause: 'damage' });
        continue;
      }
      if (car.pose.y < -3 || car.pose.x < -SIM.halfWidth - 3 || car.pose.x > SIM.halfWidth + 3) {
        car.hp = 0;
        dead.push({ car, cause: 'damage' });
        continue;
      }
      if (this.dozerCols) {
        let crushed = false;
        for (const dc of this.dozerCols) {
          this.world.contactPair(dc, car.chassisCol, (m) => {
            if (m.numContacts() > 0) crushed = true;
          });
        }
        if (crushed) dead.push({ car, cause: 'dozer' });
      }
    }

    if (dead.length === 0) {
      if (this.time >= SIM.hardCapAt) this.finish(this.leaderByHp());
      return;
    }
    let losers = dead;
    if (dead.length === 2) {
      const r0 = Math.max(0, this.cars[0].hp) / this.cars[0].maxHp;
      const r1 = Math.max(0, this.cars[1].hp) / this.cars[1].maxHp;
      if (r0 === r1) {
        for (const d of dead) this.kill(d.car, d.cause);
        this.finish(-1);
        return;
      }
      losers = [r0 < r1 ? dead.find((d) => d.car.index === 0)! : dead.find((d) => d.car.index === 1)!];
    }
    const loser = losers[0];
    this.kill(loser.car, loser.cause);
    this.finish((1 - loser.car.index) as CarIndex);
  }

  private leaderByHp(): CarIndex | -1 {
    const r0 = Math.max(0, this.cars[0].hp) / this.cars[0].maxHp;
    const r1 = Math.max(0, this.cars[1].hp) / this.cars[1].maxHp;
    if (r0 === r1) return -1;
    return r0 > r1 ? 0 : 1;
  }

  private kill(car: CarRt, cause: 'damage' | 'dozer'): void {
    car.alive = false;
    car.hp = Math.min(car.hp, 0);
    this.events.push({ type: 'destroyed', car: car.index, x: car.pose.x, y: car.pose.y, cause });
    this.events.push({ type: 'explode', x: car.pose.x, y: car.pose.y, size: 2.2 });
    for (const wh of car.wheels) if (wh) this.world.removeRigidBody(wh.body);
    this.world.removeRigidBody(car.chassis);
  }

  private finish(winner: CarIndex | -1): void {
    this.over = true;
    this.winner = winner;
    this.rockets = [];
    this.events.push({ type: 'end', winner });
  }

  // ------------------------------------------------------------------ output

  snapshot(): SimSnapshot {
    const carSnap = (car: CarRt): CarSnapshot => ({
      chassis: { ...car.pose },
      wheels: car.wheels.map((w) => (w ? { ...w.pose } : null)),
      weapons: car.weapons.map((w) => (w ? { ...w.anim } : null)),
      gadgets: car.gadgets.map((g) => (g ? { ...g.anim } : null)),
      hp: Math.max(0, Math.round(car.hp)),
      maxHp: car.maxHp,
      alive: car.alive,
      facing: car.facing,
      dealt: Math.round(car.dealt),
    });
    const projectiles: ProjectileSnapshot[] = this.rockets.map((r) => ({
      id: r.id,
      owner: r.owner,
      x: r.x,
      y: r.y,
      a: datan2(r.vy, r.vx),
    }));
    return {
      tick: this.tickCount,
      time: this.time,
      cars: [carSnap(this.cars[0]), carSnap(this.cars[1])],
      projectiles,
      dozers: { left: this.dozerX.left, right: this.dozerX.right },
      suddenDeath: this.suddenDeath,
      over: this.over,
      winner: this.winner,
    };
  }

  maxHp(i: CarIndex): number {
    return this.cars[i].maxHp;
  }

  /** Divergence fingerprint of the current state. */
  hash(): string {
    let h = 2166136261 >>> 0;
    const mix = (n: number) => {
      h ^= Math.round(n * 1000) | 0;
      h = Math.imul(h, 16777619) >>> 0;
    };
    mix(this.tickCount);
    for (const c of this.cars) {
      mix(c.pose.x);
      mix(c.pose.y);
      mix(c.pose.a);
      mix(c.hp);
      mix(c.dealt);
    }
    return h.toString(16);
  }

  /** Run headless until the match ends (plus nothing else). */
  runToEnd(maxSeconds = SIM.hardCapAt + 5): BattleResult {
    const maxTicks = Math.ceil(maxSeconds / SIM.dt);
    while (!this.over && this.tickCount < maxTicks) this.step();
    if (!this.over) this.finish(this.leaderByHp());
    return {
      winner: this.winner ?? -1,
      ticks: this.tickCount,
      hash: this.hash(),
      hp: [Math.max(0, Math.round(this.cars[0].hp)), Math.max(0, Math.round(this.cars[1].hp))],
      maxHp: [this.cars[0].maxHp, this.cars[1].maxHp],
      dealt: [Math.round(this.cars[0].dealt), Math.round(this.cars[1].dealt)],
    };
  }
}

// ---- weapon timelines ----
const FORK_REST = -0.5;
const FORK_UP = 0.75;
const FORK_TOTAL = 0.7;
function forkAngle(act: number): number {
  if (act < 0) return FORK_REST;
  if (act < 0.1) return FORK_REST + (FORK_UP - FORK_REST) * (act / 0.1);
  if (act < 0.3) return FORK_UP;
  return FORK_UP + (FORK_REST - FORK_UP) * Math.min(1, (act - 0.3) / 0.4);
}
const PUNCH_TOTAL = 0.5;
function punchExtend(act: number): number {
  if (act < 0) return 0;
  if (act < 0.07) return act / 0.07;
  if (act < 0.15) return 1;
  return Math.max(0, 1 - (act - 0.15) / 0.35);
}

export async function createBattle(setup: MatchSetup): Promise<Battle> {
  await initPhysics();
  return new Battle(setup);
}
