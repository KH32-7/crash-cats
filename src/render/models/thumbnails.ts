/**
 * Part icon renderer: one lazily created, shared offscreen WebGLRenderer renders a
 * 3/4 view of any part to a transparent PNG data URL (cached per id + size).
 */
import * as THREE from 'three';
import { findPart } from '../../shared/parts';
import { getStudioEnvironment } from '../materials';
import { buildChassisMesh, buildGadgetMesh, buildWeaponMesh, buildWheelMesh, disposeOwned, idleWeaponAnim } from './partModels';

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
const cache = new Map<string, string>();

function setup(): { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  if (!renderer || !scene || !camera) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    scene = new THREE.Scene();
    scene.environment = getStudioEnvironment(renderer);
    scene.environmentIntensity = 0.55;
    scene.add(new THREE.HemisphereLight('#fff3dc', '#4a3a30', 1.4));
    const key = new THREE.DirectionalLight('#ffffff', 2.4);
    key.position.set(2, 4, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight('#9fd0ff', 1.0);
    rim.position.set(-3, 2, -2);
    scene.add(rim);
    camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
  }
  return { renderer, scene, camera };
}

function buildPart(id: string): THREE.Object3D | null {
  const def = findPart(id);
  if (!def) return null;
  switch (def.kind) {
    case 'chassis':
      return buildChassisMesh(def);
    case 'wheel':
      return buildWheelMesh(def);
    case 'weapon': {
      const mount = def.mounts[0];
      const m = buildWeaponMesh(def, mount);
      const a = idleWeaponAnim(def, mount, 0.35);
      if (def.weapon === 'punch') a.extend = 0.35;
      if (def.weapon === 'fork') a.flip = 0.25;
      if (def.weapon === 'rocket') a.angle = 0.2;
      m.animate(a);
      return m.group;
    }
    case 'gadget': {
      const m = buildGadgetMesh(def, 0.6);
      m.animate({ type: def.gadget, active: def.gadget === 'booster' ? 0.7 : def.gadget === 'spring' ? 0.35 : 0 }, 0.3);
      return m.group;
    }
  }
}

const _corners = Array.from({ length: 8 }, () => new THREE.Vector3());

/** PNG data URL of a part icon (transparent background, 3/4 view). '' for unknown ids. */
export function renderPartThumbnail(partId: string, size = 128): string {
  const key = `${partId}@${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const obj = buildPart(partId);
  if (!obj) return '';
  const { renderer: r, scene: s, camera: cam } = setup();

  const pivot = new THREE.Group();
  pivot.add(obj);
  s.add(pivot);
  pivot.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(obj, true);
  const center = box.getCenter(new THREE.Vector3());
  obj.position.sub(center);
  pivot.updateWorldMatrix(true, true);
  box.setFromObject(obj, true);

  // 3/4 view from the front-right, slightly above
  const dir = new THREE.Vector3(0.62, 0.42, 1).normalize();
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
  let dist = radius * 3;
  const target = new THREE.Vector3();
  for (let pass = 0; pass < 3; pass++) {
    cam.position.copy(dir).multiplyScalar(dist).add(target);
    cam.lookAt(target);
    cam.updateMatrixWorld(true);
    const { min, max } = box;
    let k = 0;
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) _corners[k++].set(x, y, z);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of _corners) {
      const p = c.clone().project(cam);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    const extent = Math.max(x1 - x0, y1 - y0) / 2;
    // recentre on the projected box, then rescale distance so it fills ~86%
    const halfH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * dist;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    target.addScaledVector(right, ((x0 + x1) / 2) * halfH).addScaledVector(up, ((y0 + y1) / 2) * halfH);
    dist *= extent / 0.86;
  }
  cam.position.copy(dir).multiplyScalar(dist).add(target);
  cam.lookAt(target);
  cam.near = Math.max(0.01, dist - radius * 2);
  cam.far = dist + radius * 2;
  cam.updateProjectionMatrix();

  r.setSize(size, size, false);
  r.render(s, cam);
  const url = r.domElement.toDataURL('image/png');

  s.remove(pivot);
  disposeOwned(obj);
  cache.set(key, url);
  return url;
}
