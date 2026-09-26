/**
 * Assembled battle car.
 *
 * Scene graph:
 *   root (chassis world pose: position.xy + rotation.z)
 *     └ container (scale.x = facing)  — everything below in UNMIRRORED car-local coords
 *         ├ chassis group
 *         ├ weapon groups at slot.pos, scale.x = mountDir(mount)
 *         ├ gadget groups at slot pos
 *         ├ driverAnchor at chassis.cockpit (faces +x)
 *         └ slot markers (garage)
 *   wheelLayer (add to the SAME parent as root, identity transform in battle)
 *     └ one axle group per wheel slot (two tires at ±z + axle), world pose from the sim
 *
 * Geometry and shared materials are cached across cars; each car owns its paint
 * materials (damage flash) and weapon heat materials, released in dispose().
 */
import * as THREE from 'three';
import { getChassis, getGadget, getWeapon, getWheel, mountDir } from '../../shared/parts';
import type { CarBuild, ChassisDef, GadgetType, Mount, WeaponDef } from '../../shared/parts';
import type { CarSnapshot } from '../../shared/sim/types';
import * as M from '../materials';
import {
  buildChassisMesh,
  buildGadgetMesh,
  buildWeaponMesh,
  buildWheelAxleMesh,
  disposeOwned,
  idleWeaponAnim,
  type GadgetModel,
  type WeaponModel,
} from './partModels';

export interface SlotAnchor {
  kind: 'wheel' | 'weapon' | 'gadget';
  index: number;
  /** car-local (unmirrored) position of the slot */
  local: THREE.Vector3;
}

interface WeaponEntry {
  def: WeaponDef;
  mount: Mount;
  model: WeaponModel;
}

interface MarkerEntry {
  anchor: SlotAnchor;
  group: THREE.Group;
  fill: THREE.Mesh;
  ring: THREE.Mesh;
  filled: boolean;
}

const MARKER_COLOR: Record<SlotAnchor['kind'], string> = {
  wheel: '#ffd23f',
  weapon: '#ff6a3d',
  gadget: '#4fd8ff',
};

let markerRingGeo: THREE.BufferGeometry | null = null;
let markerFillGeo: THREE.BufferGeometry | null = null;
function markerGeos(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  if (!markerRingGeo || !markerFillGeo) {
    const ring = new THREE.RingGeometry(0.105, 0.135, 36);
    const h = new THREE.PlaneGeometry(0.13, 0.03);
    const v = new THREE.PlaneGeometry(0.03, 0.13);
    const parts = [ring, h, v].map((g) => g.toNonIndexed());
    markerRingGeo = mergeSimple(parts);
    markerFillGeo = new THREE.CircleGeometry(0.105, 36);
  }
  return [markerRingGeo, markerFillGeo];
}

function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0;
  for (const p of parts) count += p.attributes.position.count;
  const pos = new Float32Array(count * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array as Float32Array, o);
    o += p.attributes.position.count * 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return g;
}

export class CarModel {
  readonly root = new THREE.Group();
  readonly driverAnchor = new THREE.Group();
  readonly wheelLayer = new THREE.Group();
  readonly chassisDef: ChassisDef;
  readonly facing: 1 | -1;

  private readonly container = new THREE.Group();
  private readonly chassis: THREE.Group;
  private readonly paintMats: THREE.MeshStandardMaterial[];
  private readonly wheels: (THREE.Group | null)[] = [];
  private readonly weapons: (WeaponEntry | null)[] = [];
  private readonly gadgets: (GadgetModel | null)[] = [];
  private readonly gadgetTypes: (GadgetType | null)[] = [];
  private readonly anchors: SlotAnchor[] = [];
  private readonly markers: MarkerEntry[] = [];
  private markersVisible = false;
  private highlight: { kind: SlotAnchor['kind']; index: number } | null = null;
  private flash = 0;
  private lastGarageTime: number | null = null;
  private clock = 0;
  private shattered = false;

  constructor(build: CarBuild, facing: 1 | -1) {
    this.facing = facing;
    const def = getChassis(build.chassis.id);
    this.chassisDef = def;
    this.root.name = 'car:' + def.id;
    this.wheelLayer.name = 'car-wheels:' + def.id;
    this.container.name = 'car-container';
    this.container.scale.x = facing;
    this.root.add(this.container);

    this.chassis = buildChassisMesh(def, build.paint);
    this.paintMats = this.chassis.userData.paintMaterials as THREE.MeshStandardMaterial[];
    this.container.add(this.chassis);

    this.driverAnchor.name = 'driverAnchor';
    this.driverAnchor.position.set(def.cockpit.x, def.cockpit.y, 0);
    this.container.add(this.driverAnchor);

    // wheels
    def.wheelSlots.forEach((slot, i) => {
      this.anchors.push({ kind: 'wheel', index: i, local: new THREE.Vector3(slot.x, slot.y, 0) });
      const ref = build.wheels[i];
      if (!ref) {
        this.wheels.push(null);
        return;
      }
      const wdef = getWheel(ref.id);
      const zOff = def.depth / 2 + wdef.width / 2 - 0.03;
      const axle = buildWheelAxleMesh(wdef, zOff);
      axle.name = `wheel:${i}:${wdef.id}`;
      this.wheelLayer.add(axle);
      this.wheels.push(axle);
    });

    // weapons
    def.weaponSlots.forEach((slot, i) => {
      this.anchors.push({ kind: 'weapon', index: i, local: new THREE.Vector3(slot.pos.x, slot.pos.y, 0) });
      const ref = build.weapons[i];
      if (!ref) {
        this.weapons.push(null);
        return;
      }
      const wdef = getWeapon(ref.id);
      const model = buildWeaponMesh(wdef, slot.mount);
      model.group.position.set(slot.pos.x, slot.pos.y, 0);
      model.group.scale.x = mountDir(slot.mount);
      this.container.add(model.group);
      this.weapons.push({ def: wdef, mount: slot.mount, model });
    });

    // gadgets
    def.gadgetSlots.forEach((slot, i) => {
      this.anchors.push({ kind: 'gadget', index: i, local: new THREE.Vector3(slot.x, slot.y, 0) });
      const ref = build.gadgets[i];
      if (!ref) {
        this.gadgets.push(null);
        this.gadgetTypes.push(null);
        return;
      }
      const gdef = getGadget(ref.id);
      const model = buildGadgetMesh(gdef, def.depth + 0.08);
      this.gadgetTypes.push(gdef.gadget);
      model.group.position.set(slot.x, slot.y, 0);
      this.container.add(model.group);
      this.gadgets.push(model);
    });

    this.buildMarkers(build);
    this.setGaragePose(0);
  }

  // -------------------------------------------------------------------------

  private buildMarkers(build: CarBuild): void {
    const [ringGeo, fillGeo] = markerGeos();
    const z = this.chassisDef.depth / 2 + 0.12;
    for (const a of this.anchors) {
      const filled = a.kind === 'wheel' ? !!build.wheels[a.index] : a.kind === 'weapon' ? !!build.weapons[a.index] : !!build.gadgets[a.index];
      const group = new THREE.Group();
      group.name = `marker:${a.kind}:${a.index}`;
      group.position.set(a.local.x, a.local.y, z);
      const fill = new THREE.Mesh(fillGeo, M.marker(MARKER_COLOR[a.kind], 0.3));
      const ring = new THREE.Mesh(ringGeo, M.marker(MARKER_COLOR[a.kind], 0.95));
      fill.renderOrder = 20;
      ring.renderOrder = 21;
      group.add(fill, ring);
      group.visible = false;
      this.container.add(group);
      this.markers.push({ anchor: a, group, fill, ring, filled });
    }
  }

  private updateMarkers(time: number): void {
    for (const m of this.markers) {
      const hl = !!this.highlight && this.highlight.kind === m.anchor.kind && this.highlight.index === m.anchor.index;
      m.group.visible = this.markersVisible && (hl || !m.filled);
      if (!m.group.visible) continue;
      const base = m.anchor.kind === 'wheel' ? 1.45 : 1;
      const pulse = hl ? 1.15 + 0.12 * Math.sin(time * 6) : 1 + 0.06 * Math.sin(time * 3 + m.anchor.index);
      m.group.scale.setScalar(base * pulse);
      m.ring.material = hl ? M.marker('#ffffff', 1) : M.marker(MARKER_COLOR[m.anchor.kind], 0.95);
      m.fill.material = M.marker(MARKER_COLOR[m.anchor.kind], hl ? 0.55 : 0.3);
    }
  }

  private updateFlash(dt: number): void {
    if (this.flash <= 0 && this.paintMats[0].emissiveIntensity === 0) return;
    this.flash = Math.max(0, this.flash * Math.exp(-dt * 7) - dt * 0.05);
    const f = this.flash;
    for (const m of this.paintMats) {
      m.emissive.setRGB(1, 0.25 + 0.75 * f * f, 0.2 + 0.8 * f * f);
      m.emissiveIntensity = f * 1.4;
    }
  }

  // -------------------------------------------------------------------------

  setGaragePose(time: number): void {
    const dt = this.lastGarageTime === null ? 0 : Math.max(0, Math.min(0.1, time - this.lastGarageTime));
    this.lastGarageTime = time;
    // wheelLayer follows root (so a moved/rotated showroom root keeps its wheels)
    this.root.updateMatrix();
    this.wheelLayer.position.copy(this.root.position);
    this.wheelLayer.quaternion.copy(this.root.quaternion);
    this.wheelLayer.scale.copy(this.root.scale);
    this.chassisDef.wheelSlots.forEach((slot, i) => {
      const w = this.wheels[i];
      if (!w) return;
      w.visible = true;
      w.position.set(slot.x * this.facing, slot.y, 0);
      w.rotation.set(0, 0, 0);
    });
    for (const w of this.weapons) {
      if (!w) continue;
      w.model.group.visible = true;
      w.model.animate(idleWeaponAnim(w.def, w.mount, time));
    }
    this.gadgets.forEach((g, i) => {
      if (!g) return;
      g.group.visible = true;
      g.animate({ type: this.gadgetTypes[i] ?? 'armor', active: 0 }, dt);
    });
    this.updateFlash(dt);
    this.updateMarkers(time);
  }

  applySnapshot(s: CarSnapshot, dt: number): void {
    this.clock += dt;
    this.root.position.set(s.chassis.x, s.chassis.y, 0);
    this.root.rotation.set(0, 0, s.chassis.a);
    this.wheelLayer.position.set(0, 0, 0);
    this.wheelLayer.rotation.set(0, 0, 0);
    this.wheelLayer.scale.set(1, 1, 1);
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      if (!w) continue;
      const p = s.wheels[i];
      w.visible = !!p;
      if (p) {
        w.position.set(p.x, p.y, 0);
        w.rotation.set(0, 0, p.a);
      }
    }
    for (let i = 0; i < this.weapons.length; i++) {
      const w = this.weapons[i];
      if (!w) continue;
      const a = s.weapons[i];
      w.model.group.visible = !!a;
      if (a) w.model.animate(a);
    }
    for (let i = 0; i < this.gadgets.length; i++) {
      const g = this.gadgets[i];
      if (!g) continue;
      const a = s.gadgets[i];
      g.group.visible = !!a;
      if (a) g.animate(a, dt);
    }
    this.updateFlash(dt);
    if (this.markersVisible) this.updateMarkers(this.clock);
  }

  getSlotAnchors(): SlotAnchor[] {
    return this.anchors.map((a) => ({ kind: a.kind, index: a.index, local: a.local.clone() }));
  }

  getSlotWorld(kind: SlotAnchor['kind'], index: number, target: THREE.Vector3): THREE.Vector3 {
    const a = this.anchors.find((x) => x.kind === kind && x.index === index);
    if (!a) return target.set(NaN, NaN, NaN);
    this.container.updateWorldMatrix(true, false);
    return this.container.localToWorld(target.copy(a.local));
  }

  setSlotMarkersVisible(visible: boolean, highlight: { kind: SlotAnchor['kind']; index: number } | null = null): void {
    this.markersVisible = visible;
    this.highlight = highlight ?? null;
    this.updateMarkers(this.lastGarageTime ?? this.clock);
  }

  flashDamage(amount01: number): void {
    this.flash = Math.min(1, Math.max(this.flash, amount01));
    this.updateFlash(0);
  }

  shatter(scene: THREE.Object3D): THREE.Object3D[] {
    if (this.shattered) return [];
    this.shattered = true;
    for (const m of this.markers) m.group.visible = false;
    scene.updateWorldMatrix(true, false);
    this.root.updateWorldMatrix(true, true);
    this.wheelLayer.updateWorldMatrix(true, true);
    const pieces: THREE.Object3D[] = [];
    const take = (o: THREE.Object3D | null | undefined) => {
      if (!o || !o.visible) return;
      scene.attach(o);
      pieces.push(o);
    };
    // chassis: split into body + detail chunks so the explosion has more pieces
    for (const child of [...this.chassis.children]) {
      if (child.name === 'lights') continue;
      take(child);
    }
    for (const w of this.weapons) take(w?.model.group);
    for (const g of this.gadgets) take(g?.group);
    for (const w of this.wheels) take(w);
    this.root.visible = false;
    this.wheelLayer.visible = false;
    this.debris = pieces;
    return pieces;
  }

  private debris: THREE.Object3D[] = [];

  /** Releases per-car materials and removes root/wheelLayer from their parents. Debris objects are left to the caller. */
  dispose(): void {
    disposeOwned(this.chassis);
    for (const w of this.weapons) if (w) disposeOwned(w.model.group);
    for (const g of this.gadgets) if (g) disposeOwned(g.group);
    for (const d of this.debris) disposeOwned(d);
    this.root.removeFromParent();
    this.wheelLayer.removeFromParent();
  }
}
