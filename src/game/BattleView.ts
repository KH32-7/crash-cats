import * as THREE from 'three';
import { computeStats, type CarBuild } from '../shared/parts';
import { Battle, initPhysics } from '../shared/sim/Battle';
import { SIM, type CarIndex, type CarSnapshot, type MatchSetup, type SimEvent, type SimSnapshot } from '../shared/sim/types';
import { createArena, type ArenaHandle } from '../render/Arena';
import type { Assets } from '../render/Assets';
import { Vfx } from '../render/Vfx';
import { CarModel } from '../render/models/CarModel';
import type { AudioSystem } from '../audio/Audio';
import type { BattleHudState, BattleMode, BattleUiEvent, Side } from '../app/AppApi';

export interface BattleMeta {
  mode: BattleMode;
  names: [string, string];
  avatars: [string, string];
  catVariants: [number, number];
  you: Side | null;
  round?: { n: number; score: [number, number]; roundsToWin: number };
}

export interface BattleFinish {
  winner: CarIndex | -1;
  dealt: [number, number];
  hash: string;
}

export interface BattleCallbacks {
  hud(state: BattleHudState): void;
  ui(event: BattleUiEvent): void;
  finished(result: BattleFinish): void;
}

type Phase = 'intro' | 'fight' | 'outro' | 'done';

/** Yaw that makes the bulldozer GLB face +x (tuned from screenshots). */
const DOZER_YAW = -Math.PI / 2;
const DOZER_LENGTH = 3.75;

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function lerpPose(a: { x: number; y: number; a: number }, b: { x: number; y: number; a: number }, t: number) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, a: lerpAngle(a.a, b.a, t) };
}

function lerpCar(a: CarSnapshot, b: CarSnapshot, t: number): CarSnapshot {
  return {
    ...b,
    chassis: lerpPose(a.chassis, b.chassis, t),
    wheels: b.wheels.map((w, i) => (w && a.wheels[i] ? lerpPose(a.wheels[i]!, w, t) : w)),
    weapons: b.weapons.map((w, i) => {
      const p = a.weapons[i];
      if (!w || !p) return w;
      return { ...w, angle: p.angle + (w.angle - p.angle) * t, extend: p.extend + (w.extend - p.extend) * t, spin: p.spin + (w.spin - p.spin) * t, flip: p.flip + (w.flip - p.flip) * t };
    }),
  };
}

export class BattleView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 120);
  private arena: ArenaHandle | null = null;
  private readonly vfx = new Vfx();
  private cars: [CarModel, CarModel] | null = null;
  private cats: [THREE.Object3D, THREE.Object3D] | null = null;
  private dozers: [THREE.Object3D, THREE.Object3D] | null = null;
  private battle: Battle | null = null;
  private prev: SimSnapshot | null = null;
  private curr: SimSnapshot | null = null;
  private acc = 0;
  private phase: Phase = 'done';
  private phaseT = 0;
  private speed: 1 | 2 = 1;
  private timeScale = 1;
  private slowMoT = 0;
  private trauma = 0;
  private shakeT = 0;
  private meta: BattleMeta | null = null;
  private power: [number, number] = [0, 0];
  private finishedSent = false;
  private readonly camPos = new THREE.Vector3(0, 3, 14);
  private readonly camLook = new THREE.Vector3(0, 1, 0);
  private camInit = false;
  private hudTimer = 0;
  private readonly tmp = new THREE.Vector3();
  private dustT = 0;
  private suddenAnnounced = false;
  private lastShown: SimSnapshot | null = null;
  private skipping = false;
  private generation = 0;
  /** Fingerprint + damage at the exact tick the match ended (what the server compares). */
  private endHash = '';
  private endDealt: [number, number] = [0, 0];

  constructor(
    private readonly assets: Assets,
    private readonly audio: AudioSystem,
    private readonly cb: BattleCallbacks,
  ) {
    this.scene.add(this.vfx.group);
  }

  get active(): boolean {
    return this.phase !== 'done';
  }

  setSpeed(speed: 1 | 2): void {
    this.speed = speed;
  }

  async start(setup: MatchSetup, meta: BattleMeta): Promise<void> {
    const gen = ++this.generation;
    await initPhysics();
    if (gen !== this.generation) return;
    this.teardown();
    this.meta = meta;
    this.finishedSent = false;
    this.suddenAnnounced = false;
    this.skipping = false;
    this.endHash = '';
    this.speed = 1;
    this.timeScale = 1;
    this.slowMoT = 0;
    this.trauma = 0;
    this.acc = 0;
    this.camInit = false;

    const arena = await createArena(setup.arena, this.assets);
    // A newer start() or a stop() happened while loading: drop this one.
    if (gen !== this.generation) {
      arena.dispose();
      return;
    }
    this.arena = arena;
    this.scene.add(this.arena.group);
    this.scene.background = new THREE.Color(this.arena.look.fog);

    this.battle = new Battle(setup);
    const builds = this.battle.setup.builds;
    this.power = [computeStats(builds[0]).damage, computeStats(builds[1]).damage];
    this.cars = [this.makeCar(builds[0], 1, meta.catVariants[0], 0), this.makeCar(builds[1], -1, meta.catVariants[1], 1)];
    this.prev = this.battle.snapshot();
    this.curr = this.prev;
    this.applySnapshot(this.curr, this.curr, 1, 0);

    const dl = this.assets.dozer();
    const dr = this.assets.dozer();
    dl.rotation.y = DOZER_YAW;
    dr.rotation.y = DOZER_YAW + Math.PI;
    dl.visible = dr.visible = false;
    this.scene.add(dl, dr);
    this.dozers = [dl, dr];

    this.phase = 'intro';
    this.phaseT = 0;
    this.audio.startEngines(2);
    this.cb.ui({ type: 'banner', text: '준비!', tone: 'neutral', ms: 900 });
    this.audio.voice('ready');
  }

  private makeCar(build: CarBuild, facing: 1 | -1, catVariant: number, index: CarIndex): CarModel {
    const car = new CarModel(build, facing);
    const cat = this.assets.cat(catVariant);
    car.driverAnchor.add(cat);
    this.scene.add(car.root, car.wheelLayer);
    if (!this.cats) this.cats = [cat, cat];
    this.cats[index] = cat;
    return car;
  }

  /** Fast-forward the fight to its end. */
  skip(): void {
    if (!this.battle || this.phase === 'done') return;
    if (this.phase === 'intro') this.phase = 'fight';
    this.skipping = true;
  }

  private teardown(): void {
    if (this.arena) {
      this.scene.remove(this.arena.group);
      this.arena.dispose();
      this.arena = null;
    }
    if (this.cars) {
      for (const c of this.cars) {
        this.scene.remove(c.root, c.wheelLayer);
        c.dispose();
      }
      this.cars = null;
    }
    this.cats = null;
    if (this.dozers) {
      this.scene.remove(...this.dozers);
      this.dozers = null;
    }
    this.vfx.clear();
    this.battle?.free();
    this.battle = null;
    this.prev = this.curr = null;
  }

  stop(): void {
    this.generation++;
    this.phase = 'done';
    this.audio.stopEngines();
    this.teardown();
  }

  // --------------------------------------------------------------- update

  update(realDt: number): void {
    if (!this.battle || !this.cars || this.phase === 'done') return;
    this.phaseT += realDt;
    this.audio.tick(realDt);

    if (this.slowMoT > 0) {
      this.slowMoT -= realDt;
      this.timeScale = this.slowMoT > 0 ? 0.3 : 1;
    }

    if (this.phase === 'intro') {
      if (this.phaseT > 1.1 && this.phaseT - realDt <= 1.1) {
        this.cb.ui({ type: 'countdown', value: 'FIGHT' });
        this.audio.voice('fight');
        this.audio.countdownBeep(true);
      }
      if (this.phaseT >= 1.5) {
        this.phase = 'fight';
        this.phaseT = 0;
      }
    }

    let simDt = 0;
    if (this.phase === 'fight' || this.phase === 'outro') {
      simDt = realDt * this.speed * this.timeScale;
      this.acc += simDt;
      let steps = 0;
      const maxSteps = this.skipping ? 100000 : 8;
      while (this.acc >= SIM.dt && steps < maxSteps) {
        this.acc -= SIM.dt;
        steps++;
        this.prev = this.curr;
        const events = this.battle.step();
        this.curr = this.battle.snapshot();
        this.handleEvents(events, this.skipping);
        if (this.skipping && this.battle.isOver) {
          this.skipping = false;
          this.acc = 0;
          this.prev = this.curr;
          break;
        }
        // Keep simulating a little after the end for debris/physics settling.
        if (this.phase === 'outro' && this.phaseT > 3.2) break;
      }
      if (this.skipping) this.acc = 1; // keep draining next frame
      if (steps >= maxSteps && !this.skipping) this.acc = Math.min(this.acc, SIM.dt);
    }

    const alpha = this.prev && this.curr ? Math.min(1, this.acc / SIM.dt) : 1;
    if (this.prev && this.curr) this.applySnapshot(this.prev, this.curr, alpha, realDt);

    if (this.phase === 'outro' && this.phaseT > 2.8 && !this.finishedSent) {
      this.finishedSent = true;
      const r = this.battle;
      const s = r.snapshot();
      this.cb.finished({ winner: r.result ?? -1, dealt: this.endHash ? this.endDealt : [s.cars[0].dealt, s.cars[1].dealt], hash: this.endHash || r.hash() });
    }

    this.vfx.update(realDt);
    this.updateCamera(realDt);

    this.hudTimer -= realDt;
    if (this.hudTimer <= 0 && this.curr && this.meta) {
      this.hudTimer = 1 / 30;
      const s = this.curr;
      this.cb.hud({
        mode: this.meta.mode,
        names: this.meta.names,
        avatars: this.meta.avatars,
        hp: [s.cars[0].hp, s.cars[1].hp],
        maxHp: [s.cars[0].maxHp, s.cars[1].maxHp],
        power: this.power,
        time: s.time,
        suddenDeathIn: Math.max(0, SIM.suddenDeathAt - s.time),
        suddenDeath: s.suddenDeath,
        speed: this.speed,
        you: this.meta.you,
        round: this.meta.round,
        phase: this.phase === 'intro' ? 'countdown' : this.phase === 'fight' ? 'fight' : 'outro',
      });
    }
  }

  private handleEvents(events: SimEvent[], quiet: boolean): void {
    for (const e of events) {
      switch (e.type) {
        case 'hit': {
          if (quiet) break;
          this.vfx.hitSparks(e.x, e.y, e.damage, e.weapon);
          this.audio.hit(e.weapon, e.damage);
          this.cars?.[e.target].flashDamage(Math.min(0.55, 0.12 + e.damage / 60));
          this.addTrauma(e.weapon === 'punch' || e.weapon === 'rocket' ? 0.35 : 0.12);
          const p = this.project(e.x, e.y + 0.4);
          this.cb.ui({ type: 'hit', side: e.target, amount: e.damage, x: p.x, y: p.y });
          break;
        }
        case 'rocketFire':
          if (quiet) break;
          this.vfx.muzzle(e.x, e.y, e.a);
          this.audio.rocketLaunch();
          break;
        case 'explode':
          if (quiet && e.size < 2) break;
          this.vfx.explosion(e.x, e.y, e.size);
          this.audio.explosion(e.size);
          this.addTrauma(e.size > 1.5 ? 0.9 : 0.4);
          break;
        case 'flip':
          if (quiet) break;
          this.vfx.hitSparks(e.x, e.y, 10, 'fork');
          this.audio.flip();
          this.addTrauma(0.3);
          break;
        case 'punch':
          if (quiet) break;
          this.audio.punchFire();
          break;
        case 'boost':
          if (!quiet) this.audio.boost();
          break;
        case 'jump':
          if (!quiet) this.audio.jump();
          break;
        case 'clash':
          if (quiet) break;
          this.audio.clash(e.strength);
          this.vfx.hitSparks(e.x, e.y, 4 + e.strength * 8, 'clash');
          this.addTrauma(0.15 + e.strength * 0.25);
          break;
        case 'suddenDeath':
          if (!this.suddenAnnounced) {
            this.suddenAnnounced = true;
            this.cb.ui({ type: 'banner', text: '서든 데스!', tone: 'danger', ms: 1600 });
            this.audio.voice('suddendeath');
            this.audio.suddenDeathSiren();
          }
          break;
        case 'destroyed':
          this.destroyCar(e.car, e.x, e.y);
          break;
        case 'end': {
          const snap = this.battle!.snapshot();
          this.endHash = this.battle!.hash();
          this.endDealt = [snap.cars[0].dealt, snap.cars[1].dealt];
          this.phase = 'outro';
          this.phaseT = 0;
          if (e.winner === -1) {
            this.cb.ui({ type: 'banner', text: '무승부!', tone: 'neutral', ms: 1800 });
            this.audio.voice('draw');
          } else {
            this.cb.ui({ type: 'banner', text: 'K.O.!', tone: 'good', ms: 1500 });
            this.audio.voice('knockout');
          }
          break;
        }
      }
    }
  }

  private destroyCar(index: CarIndex, x: number, y: number): void {
    if (!this.cars) return;
    const car = this.cars[index];
    const cat = this.cats?.[index];
    if (cat) this.vfx.ejectCat(cat, index === 0 ? -1 : 1);
    const debris = car.shatter(this.vfx.group);
    this.vfx.addDebris(debris, x, y);
    car.root.visible = false;
    car.wheelLayer.visible = false;
    this.slowMoT = 1.2;
    this.timeScale = 0.3;
    this.addTrauma(1);
  }

  private addTrauma(t: number): void {
    this.trauma = Math.min(1, this.trauma + t);
  }

  private applySnapshot(a: SimSnapshot, b: SimSnapshot, t: number, dt: number): void {
    if (!this.cars) return;
    this.lastShown = b;
    for (let i = 0; i < 2; i++) {
      const cs = lerpCar(a.cars[i], b.cars[i], t);
      const car = this.cars[i];
      if (!b.cars[i].alive) continue;
      car.applySnapshot(cs, dt);
      // Booster flames + dust
      cs.gadgets.forEach((g, gi) => {
        if (g && g.type === 'booster' && g.active > 0.3) {
          car.getSlotWorld('gadget', gi, this.tmp);
          const ang = cs.chassis.a;
          const dirX = -Math.cos(ang) * cs.facing;
          const dirY = -Math.sin(ang) * cs.facing;
          this.vfx.flame(this.tmp.x + dirX * 0.15, this.tmp.y + dirY * 0.15, this.tmp.z, dirX, dirY, g.active);
        }
      });
      const vx = (b.cars[i].chassis.x - a.cars[i].chassis.x) / SIM.dt;
      const speed01 = Math.min(1, Math.abs(vx) / 5);
      this.audio.setEngine(i, speed01, true);
      this.dustT -= dt;
      if (this.dustT <= 0 && speed01 > 0.35) {
        for (const w of cs.wheels) if (w && w.y < 0.6) this.vfx.dust(w.x, 0, speed01);
      }
    }
    if (this.dustT <= 0) this.dustT = 0.06;
    for (let i = 0; i < 2; i++) if (!b.cars[i].alive) this.audio.setEngine(i, 0, false);
    this.vfx.syncRockets(b.projectiles, dt);
    if (this.dozers) {
      const show = b.suddenDeath;
      const [dl, dr] = this.dozers;
      dl.visible = dr.visible = show;
      if (show) {
        dl.position.set(b.dozers.left + 0.6 - DOZER_LENGTH / 2, 0, 0);
        dr.position.set(b.dozers.right - 0.6 + DOZER_LENGTH / 2, 0, 0);
        const rumble = Math.sin(performance.now() * 0.05) * 0.015;
        dl.position.y = dr.position.y = Math.abs(rumble);
      }
    }
  }

  private project(x: number, y: number): { x: number; y: number } {
    this.tmp.set(x, y, 0).project(this.camera);
    const canvasRect = { w: window.innerWidth, h: window.innerHeight };
    return { x: (this.tmp.x * 0.5 + 0.5) * canvasRect.w, y: (-this.tmp.y * 0.5 + 0.5) * canvasRect.h };
  }

  private updateCamera(dt: number): void {
    const s = this.lastShown;
    if (!s) return;
    const alive = s.cars.filter((c) => c.alive);
    const focus = alive.length > 0 ? alive : s.cars;
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = 0;
    for (const c of focus) {
      minX = Math.min(minX, c.chassis.x - 1.35);
      maxX = Math.max(maxX, c.chassis.x + 1.35);
      maxY = Math.max(maxY, c.chassis.y);
    }
    if (this.phase === 'outro') {
      minX -= 0.5;
      maxX += 0.5;
    }
    if (s.suddenDeath && !s.over) {
      // Keep the incoming bulldozer blades in frame — that's the tension.
      minX = Math.min(minX, Math.max(s.dozers.left - 0.4, minX - 4.5));
      maxX = Math.max(maxX, Math.min(s.dozers.right + 0.4, maxX + 4.5));
    }
    const cx = THREE.MathUtils.clamp((minX + maxX) / 2, -7, 7);
    const halfW = (maxX - minX) / 2 + 0.35;
    const aspect = this.camera.aspect;
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    let dist = halfW / Math.tan(hHalf);
    const minVertical = (Math.max(2.2, maxY + 1.6)) / Math.tan(vHalf);
    dist = THREE.MathUtils.clamp(Math.max(dist, minVertical * 0.62), 6.2, 22);
    if (this.phase === 'intro') dist += (1 - Math.min(1, this.phaseT / 1.2)) * 4;
    const lookY = 0.9 + Math.max(0, maxY - 1) * 0.5;
    const target = new THREE.Vector3(cx, lookY + dist * 0.11, dist);
    const look = new THREE.Vector3(cx, lookY, 0);
    if (!this.camInit) {
      this.camPos.copy(target);
      this.camLook.copy(look);
      this.camInit = true;
    }
    const k = 1 - Math.exp(-dt * 3.2);
    this.camPos.lerp(target, k);
    this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    // Trauma shake (trauma^2), decays in real time.
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    this.shakeT += dt;
    const sh = this.trauma * this.trauma;
    if (sh > 0.001) {
      const n = (seed: number) => Math.sin(this.shakeT * 37 + seed * 12.9898) * Math.cos(this.shakeT * 23 + seed * 4.1);
      this.camera.position.x += n(1) * 0.35 * sh;
      this.camera.position.y += n(2) * 0.28 * sh;
      this.camera.rotation.z += n(3) * 0.04 * sh;
    }
  }

  onResize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.vfx.setViewport(height, this.camera.fov);
  }

  /** Test hook: jump straight into the fight and simulate `seconds` of it (last ~0.75 s with VFX). */
  warp(seconds: number): void {
    if (!this.battle || !this.curr) return;
    this.phase = 'fight';
    this.phaseT = 0;
    const steps = Math.round(seconds / SIM.dt);
    for (let i = 0; i < steps && !this.battle.isOver; i++) {
      this.prev = this.curr;
      const events = this.battle.step();
      this.curr = this.battle.snapshot();
      this.handleEvents(events, i < steps - 45);
    }
    this.acc = 0;
    this.prev = this.curr;
    this.camInit = false;
    this.applySnapshot(this.curr, this.curr, 1, SIM.dt);
    this.vfx.update(SIM.dt);
    this.updateCamera(SIM.dt);
  }

  /** Debug/test: the latest snapshot. */
  snapshot(): SimSnapshot | null {
    return this.curr;
  }
}
