import * as THREE from 'three';
import { getChassis, getWheel, type CarBuild } from '../shared/parts';
import type { SlotKind } from '../app/Store';
import type { SlotScreenAnchor } from '../app/AppApi';
import { ASSET_URLS, type Assets } from '../render/Assets';
import { CarModel } from '../render/models/CarModel';

/** Showroom scene: painted garage backdrop, wooden floor, spotlight, the player's car. */
export class GarageView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 80);
  private car: CarModel | null = null;
  private cat: THREE.Object3D | null = null;
  private buildKey = '';
  private build: CarBuild | null = null;
  private catVariant = 0;
  private editing = false;
  private highlight: { kind: SlotKind; index: number } | null = null;
  private frame: { left: number; top: number; width: number; height: number } | null = null;
  private viewW = 1;
  private viewH = 1;
  private time = 0;
  private readonly carPivot = new THREE.Group();
  private readonly tmp = new THREE.Vector3();
  private bounce = 0;

  constructor(private readonly assets: Assets) {
    this.scene.background = new THREE.Color('#3a2a1e');
    this.scene.add(this.carPivot);
    void this.buildRoom();
  }

  private async buildRoom(): Promise<void> {
    const tex = await this.assets.texture(ASSET_URLS.bg.garage);
    const w = 30;
    const h = w / (2048 / 1158);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, depthWrite: false }));
    plate.position.set(0, 2.6, -8);
    plate.renderOrder = -10;
    this.scene.add(plate);

    const floorCanvas = document.createElement('canvas');
    floorCanvas.width = 512;
    floorCanvas.height = 256;
    const g = floorCanvas.getContext('2d')!;
    for (let r = 0; r < 6; r++) {
      for (let x = (r % 2) * -80; x < 512; x += 160) {
        g.fillStyle = `hsl(28, ${40 + ((x * 7 + r * 13) % 12)}%, ${40 + ((x * 3 + r * 17) % 10)}%)`;
        g.fillRect(x, r * 43, 158, 41);
      }
    }
    const floorTex = new THREE.CanvasTexture(floorCanvas);
    floorTex.colorSpace = THREE.SRGBColorSpace;
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(4, 2);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4.2, 48), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.8, transparent: true, opacity: 0.96 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    // Turntable disc under the car.
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.2, 0.08, 48), new THREE.MeshStandardMaterial({ color: '#4a4f57', roughness: 0.45, metalness: 0.6 }));
    disc.position.y = 0.04;
    disc.receiveShadow = true;
    this.scene.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.035, 8, 64), new THREE.MeshStandardMaterial({ color: '#f2b233', emissive: '#f2b233', emissiveIntensity: 0.6 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.085;
    this.scene.add(ring);

    this.scene.add(new THREE.HemisphereLight('#ffe8c8', '#4a3525', 1.25));
    const spot = new THREE.SpotLight('#ffe2b0', 60, 18, 0.55, 0.5, 1.2);
    spot.position.set(0.6, 7, 3.5);
    spot.target.position.set(0, 0.4, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0005;
    this.scene.add(spot, spot.target);
    const fill = new THREE.DirectionalLight('#9fc7ff', 0.8);
    fill.position.set(-5, 3, 4);
    this.scene.add(fill);
  }

  setCatVariant(variant: number): void {
    if (variant === this.catVariant) return;
    this.catVariant = variant;
    this.buildKey = '';
  }

  /** Rebuilds the car model when the build changes. */
  setBuild(build: CarBuild): void {
    const key = JSON.stringify(build) + this.catVariant;
    if (key === this.buildKey) return;
    const changed = this.buildKey !== '';
    this.buildKey = key;
    this.build = build;
    if (this.car) {
      this.carPivot.remove(this.car.root, this.car.wheelLayer);
      this.car.dispose();
    }
    this.car = new CarModel(build, 1);
    this.cat = this.assets.cat(this.catVariant);
    this.car.driverAnchor.add(this.cat);
    this.carPivot.add(this.car.root, this.car.wheelLayer);
    // Stand the car on the turntable: lowest wheel/chassis point at y=0.09.
    const chassis = getChassis(build.chassis.id);
    let minY = Math.min(...chassis.shape.map((p) => p.y));
    build.wheels.forEach((w, i) => {
      if (w) minY = Math.min(minY, chassis.wheelSlots[i].y - getWheel(w.id).radius);
    });
    this.carPivot.position.y = 0.09 - minY;
    this.car.setGaragePose(this.time);
    this.car.setSlotMarkersVisible(this.editing, this.highlight);
    if (changed) this.bounce = 1;
  }

  setEditing(editing: boolean): void {
    this.editing = editing;
    this.car?.setSlotMarkersVisible(editing, this.highlight);
  }

  setHighlight(slot: { kind: SlotKind; index: number } | null): void {
    this.highlight = slot;
    this.car?.setSlotMarkersVisible(this.editing, slot);
  }

  setFrame(rect: { left: number; top: number; width: number; height: number }): void {
    this.frame = rect;
  }

  onResize(width: number, height: number): void {
    this.viewW = width;
    this.viewH = height;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.time += dt;
    if (this.car) this.car.setGaragePose(this.time);
    // Equip "bounce".
    if (this.bounce > 0) {
      this.bounce = Math.max(0, this.bounce - dt * 3);
      const b = Math.sin(this.bounce * Math.PI) * 0.06 * this.bounce;
      this.carPivot.scale.set(1 + b, 1 - b, 1 + b);
    }
    this.carPivot.rotation.y = Math.sin(this.time * 0.35) * 0.12 - 0.08;
    this.frameCamera();
  }

  /** Fit the car (≈3.2 m wide × 2 m tall) into the UI-provided frame using a view offset. */
  private frameCamera(): void {
    const f = this.frame ?? { left: 0, top: 0, width: this.viewW, height: this.viewH };
    const fw = Math.max(80, f.width);
    const fh = Math.max(80, f.height);
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov / 2);
    // Required distance so the car fills ~80% of the frame.
    const fAspect = fw / fh;
    const needH = Math.max(2.0, 3.0 / fAspect) / 0.9;
    const dist = (needH * (this.viewH / fh)) / 2 / Math.tan(vHalf);
    const d = THREE.MathUtils.clamp(dist, 4.5, 30);
    this.camera.position.set(0, 0.95 + d * 0.07, d);
    this.camera.lookAt(0, 0.8, 0);
    // Shift the projection so the world origin lands in the frame center.
    const cx = f.left + fw / 2;
    const cy = f.top + fh / 2;
    this.camera.setViewOffset(this.viewW, this.viewH, this.viewW / 2 - cx, this.viewH / 2 - cy, this.viewW, this.viewH);
  }

  getSlotAnchors(): SlotScreenAnchor[] {
    if (!this.car || !this.build) return [];
    const build = this.build;
    const chassis = getChassis(build.chassis.id);
    this.camera.updateMatrixWorld();
    return this.car.getSlotAnchors().map((a) => {
      this.car!.getSlotWorld(a.kind, a.index, this.tmp);
      this.tmp.project(this.camera);
      const filled =
        a.kind === 'wheel' ? !!build.wheels[a.index] : a.kind === 'weapon' ? !!build.weapons[a.index] : !!build.gadgets[a.index];
      return {
        kind: a.kind,
        index: a.index,
        x: (this.tmp.x * 0.5 + 0.5) * this.viewW,
        y: (-this.tmp.y * 0.5 + 0.5) * this.viewH,
        filled,
        mount: a.kind === 'weapon' ? chassis.weaponSlots[a.index]?.mount : undefined,
      };
    });
  }
}
