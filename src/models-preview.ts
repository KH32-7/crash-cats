/**
 * Standalone test page for the procedural car models (models-preview.html).
 * Modes: battle (2 cars, fake animated snapshots, game camera), garage (5 cars),
 * close-up (one car, slot markers), parts (every part), thumbnails strip.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ALL_PARTS, CHASSIS, GADGETS, WEAPONS, WHEELS, bladeArm, getChassis, getWheel } from './shared/parts';
import type { CarBuild } from './shared/parts';
import type { CarSnapshot, GadgetAnim, WeaponAnim } from './shared/sim/types';
import { getStudioEnvironment } from './render/materials';
import { CarModel } from './render/models/CarModel';
import { buildChassisMesh, buildGadgetMesh, buildWeaponMesh, buildWheelMesh, disposeOwned, idleWeaponAnim } from './render/models/partModels';
import { renderPartThumbnail } from './render/models/thumbnails';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const info = document.getElementById('info') as HTMLDivElement;
const bar = document.getElementById('bar') as HTMLDivElement;
const thumbs = document.getElementById('thumbs') as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#8fb8d8');
scene.fog = new THREE.Fog('#8fb8d8', 18, 40);
scene.environment = getStudioEnvironment(renderer);
scene.environmentIntensity = 0.5;

const hemi = new THREE.HemisphereLight('#fff1d8', '#6b5140', 1.3);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff4e0', 2.6);
sun.position.set(4, 8, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -10;
sun.shadow.camera.right = 10;
sun.shadow.camera.top = 6;
sun.shadow.camera.bottom = -6;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 30;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), new THREE.MeshStandardMaterial({ color: '#b59b7c', roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
// back wall for depth
const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 12), new THREE.MeshStandardMaterial({ color: '#6f8fa6', roughness: 1 }));
wall.position.set(0, 6, -4);
wall.receiveShadow = true;
scene.add(wall);

const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

function resize(): void {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
// builds

const BUILDS: { build: CarBuild; facing: 1 | -1 }[] = [
  { facing: 1, build: { chassis: { id: 'scooter', level: 1 }, wheels: [{ id: 'wheel_basic', level: 1 }, { id: 'wheel_basic', level: 1 }], weapons: [{ id: 'blade', level: 1 }, { id: 'rocket', level: 1 }], gadgets: [{ id: 'booster', level: 1 }] } },
  { facing: -1, build: { chassis: { id: 'wedge', level: 1 }, wheels: [{ id: 'wheel_spiked', level: 1 }, { id: 'wheel_spiked', level: 1 }], weapons: [{ id: 'blade', level: 1 }, { id: 'drill', level: 1 }], gadgets: [{ id: 'spring', level: 1 }] } },
  { facing: 1, build: { chassis: { id: 'box', level: 1 }, wheels: [{ id: 'wheel_heavy', level: 1 }, { id: 'wheel_heavy', level: 1 }, { id: 'wheel_heavy', level: 1 }], weapons: [{ id: 'fork', level: 1 }, { id: 'rocket', level: 1 }, { id: 'chainsaw', level: 1 }], gadgets: [{ id: 'armor', level: 1 }] } },
  { facing: -1, build: { chassis: { id: 'dragster', level: 1 }, wheels: [{ id: 'wheel_turbo', level: 1 }, { id: 'wheel_turbo', level: 1 }], weapons: [{ id: 'chainsaw', level: 1 }, { id: 'blade', level: 1 }], gadgets: [{ id: 'booster', level: 1 }, null] } },
  { facing: 1, build: { chassis: { id: 'tower', level: 1 }, wheels: [{ id: 'wheel_bigfoot', level: 1 }, { id: 'wheel_bigfoot', level: 1 }], weapons: [{ id: 'punch', level: 1 }, null, { id: 'punch', level: 1 }], gadgets: [null] }, },
];
const BATTLE: { build: CarBuild; facing: 1 | -1 }[] = [
  { facing: 1, build: { chassis: { id: 'box', level: 1 }, wheels: [{ id: 'wheel_bigfoot', level: 1 }, { id: 'wheel_heavy', level: 1 }, { id: 'wheel_bigfoot', level: 1 }], weapons: [{ id: 'fork', level: 1 }, { id: 'rocket', level: 1 }, { id: 'chainsaw', level: 1 }], gadgets: [{ id: 'booster', level: 1 }] } },
  { facing: -1, build: { chassis: { id: 'tower', level: 1 }, wheels: [{ id: 'wheel_spiked', level: 1 }, { id: 'wheel_spiked', level: 1 }], weapons: [{ id: 'punch', level: 1 }, { id: 'blade', level: 1 }, { id: 'drill', level: 1 }], gadgets: [{ id: 'spring', level: 1 }] }, },
];

function restHeight(build: CarBuild): number {
  const def = getChassis(build.chassis.id);
  let y = 0.4;
  def.wheelSlots.forEach((s, i) => {
    const ref = build.wheels[i];
    if (ref) y = Math.max(y, getWheel(ref.id).radius - s.y);
  });
  return y;
}

// ---------------------------------------------------------------------------
// scene content per mode

type Mode = 'battle' | 'garage' | 'close' | 'parts';
let mode: Mode = 'battle';
let closeIndex = 0;
const cars: { car: CarModel; build: CarBuild; baseX: number; restY: number }[] = [];
const partObjs: THREE.Object3D[] = [];
const partAnims: ((t: number, dt: number) => void)[] = [];

function clearContent(): void {
  for (const c of cars) c.car.dispose();
  cars.length = 0;
  for (const o of partObjs) {
    o.removeFromParent();
    disposeOwned(o);
  }
  partObjs.length = 0;
  partAnims.length = 0;
}

function addCar(build: CarBuild, facing: 1 | -1, x: number): CarModel {
  const car = new CarModel(build, facing);
  const restY = restHeight(build);
  car.root.position.set(x, restY, 0);
  scene.add(car.root, car.wheelLayer);
  car.setGaragePose(0);
  cars.push({ car, build, baseX: x, restY });
  return car;
}

function gameCamera(cx = 0, dist = 6.2): void {
  camera.position.set(cx, 1.55, dist);
  controls.target.set(cx, 0.55, 0);
  camera.fov = 40;
  camera.updateProjectionMatrix();
  controls.update();
}

function setMode(m: Mode, idx = closeIndex): void {
  mode = m;
  closeIndex = idx;
  clearContent();
  if (m === 'battle') {
    addCar(BATTLE[0].build, 1, -1.7);
    addCar(BATTLE[1].build, -1, 1.7);
    gameCamera(0, 6.2);
  } else if (m === 'garage') {
    BUILDS.forEach((b, i) => addCar(b.build, b.facing, (i - 2) * 3.1));
    gameCamera(0, 13);
  } else if (m === 'close') {
    const b = BUILDS[idx];
    const car = addCar(b.build, b.facing, 0);
    car.setSlotMarkersVisible(true, { kind: 'weapon', index: 0 });
    gameCamera(0, 4.2);
  } else {
    buildPartsGrid();
    camera.position.set(0, 5.5, 9.5);
    controls.target.set(0, 0.6, 0);
    camera.fov = 40;
    camera.updateProjectionMatrix();
    controls.update();
  }
  updateButtons();
  window.setTimeout(measureAll, 50);
}

function buildPartsGrid(): void {
  const put = (o: THREE.Object3D, x: number, y: number, z: number) => {
    o.position.set(x, y, z);
    scene.add(o);
    partObjs.push(o);
  };
  CHASSIS.forEach((d, i) => put(buildChassisMesh(d), (i - 2) * 2.7, -Math.min(...d.shape.map((p) => p.y)), -1.2));
  WHEELS.forEach((d, i) => {
    const w = buildWheelMesh(d);
    put(w, (i - 2) * 1.3, d.radius, 0.4);
    partAnims.push((t) => (w.rotation.z = -t * 1.5));
  });
  WEAPONS.forEach((d, i) => {
    const mount = d.mounts[0];
    const m = buildWeaponMesh(d, mount);
    put(m.group, (i - 2.5) * 1.35 - 0.2, 0.45, 1.8);
    partAnims.push((t) => m.animate(fakeWeapon(d.weapon, mount, t + i)));
  });
  GADGETS.forEach((d, i) => {
    const m = buildGadgetMesh(d, 0.6);
    put(m.group, (i - 1) * 1.2 + 5.2, 0.35, 0.4);
    partAnims.push((t, dt) => m.animate({ type: d.gadget, active: Math.max(0, Math.sin(t * 1.6 + i)) }, dt));
  });
}

// ---------------------------------------------------------------------------
// fake sim

function fakeWeapon(type: WeaponAnim['type'], mount: 'front' | 'top' | 'back', t: number): WeaponAnim {
  const arm = bladeArm(mount);
  const cyc = (p: number) => (t % p) / p;
  switch (type) {
    case 'blade':
      return { type, angle: arm.base + arm.swing * Math.sin(t * 4), extend: 0, spin: t * 22, flip: 0, heat: Math.max(0, Math.sin(t * 2)) };
    case 'drill':
      return { type, angle: 0, extend: 0, spin: t * 30, flip: 0, heat: Math.max(0, Math.sin(t * 1.3)) };
    case 'chainsaw':
      return { type, angle: 0, extend: 0, spin: t * 40, flip: 0, heat: Math.max(0, Math.sin(t * 1.7)) };
    case 'fork': {
      const c = cyc(2.0);
      return { type, angle: 0, extend: 0, spin: 0, flip: c < 0.25 ? Math.sin((c / 0.25) * Math.PI) * 0.9 : 0, heat: 0 };
    }
    case 'punch': {
      const c = cyc(1.4);
      return { type, angle: 0, extend: c < 0.1 ? c / 0.1 : c < 0.4 ? 1 - (c - 0.1) / 0.3 : 0, spin: 0, flip: 0, heat: c < 0.3 ? 1 - c / 0.3 : 0 };
    }
    case 'rocket': {
      const c = cyc(1.8);
      return { type, angle: 0.18 + 0.12 * Math.sin(t * 0.8), extend: c < 0.35 ? 1 - c / 0.35 : 0, spin: 0, flip: 0, heat: 0 };
    }
  }
}

function fakeSnapshot(entry: (typeof cars)[number], t: number): CarSnapshot {
  const { car, build, baseX, restY } = entry;
  const f = car.facing;
  const def = car.chassisDef;
  const x = baseX + f * 0.35 * Math.sin(t * 0.9);
  const y = restY + 0.025 * Math.sin(t * 6.3 + baseX);
  const a = 0.05 * Math.sin(t * 1.7 + baseX) * f;
  const cos = Math.cos(a), sin = Math.sin(a);
  const wheels = def.wheelSlots.map((s, i) => {
    const ref = build.wheels[i];
    if (!ref) return null;
    const lx = s.x * f, ly = s.y + 0.02 * Math.sin(t * 5 + i);
    const r = getWheel(ref.id).radius;
    return { x: x + cos * lx - sin * ly, y: y + sin * lx + cos * ly, a: -(x - baseX) / r - f * t * 1.2 };
  });
  const weapons = def.weaponSlots.map((s, i) => {
    const ref = build.weapons[i];
    if (!ref) return null;
    const w = WEAPONS.find((d) => d.id === ref.id)!;
    return fakeWeapon(w.weapon, s.mount, t + i * 0.37);
  });
  const gadgets = def.gadgetSlots.map((_, i): GadgetAnim | null => {
    const ref = build.gadgets[i];
    if (!ref) return null;
    const g = GADGETS.find((d) => d.id === ref.id)!;
    const c = (t % 3) / 3;
    return { type: g.gadget, active: c < 0.3 ? Math.sin((c / 0.3) * Math.PI) : 0 };
  });
  return { chassis: { x, y, a }, wheels, weapons, gadgets, hp: 100, maxHp: 100, alive: true, facing: f, dealt: 0 };
}

// ---------------------------------------------------------------------------
// UI + stats

const statsText: string[] = [];
function measureCar(car: CarModel): { calls: number; triangles: number } {
  const vis = new Map<THREE.Object3D, boolean>();
  for (const c of scene.children) {
    vis.set(c, c.visible);
    c.visible = c === car.root || c === car.wheelLayer;
  }
  renderer.info.autoReset = false;
  renderer.info.reset();
  renderer.shadowMap.autoUpdate = false;
  renderer.render(scene, camera);
  const r = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  renderer.shadowMap.autoUpdate = true;
  renderer.info.autoReset = true;
  for (const [o, v] of vis) o.visible = v;
  return r;
}
function measureAll(): void {
  statsText.length = 0;
  for (const c of cars) {
    const r = measureCar(c.car);
    statsText.push(`${c.car.chassisDef.id.padEnd(9)} facing ${c.car.facing > 0 ? '+1' : '-1'}  calls ${r.calls}  tris ${r.triangles}`);
  }
  console.info('[models-preview] per-car stats\n' + statsText.join('\n'));
}

function updateButtons(): void {
  for (const b of Array.from(bar.querySelectorAll('button'))) {
    const key = b.dataset.mode!;
    b.classList.toggle('on', key === mode || key === `close:${closeIndex}` && mode === 'close');
  }
}
function addButton(label: string, key: string, fn: () => void): void {
  const b = document.createElement('button');
  b.textContent = label;
  b.dataset.mode = key;
  b.onclick = fn;
  bar.appendChild(b);
}
addButton('Battle', 'battle', () => setMode('battle'));
addButton('Garage (5)', 'garage', () => setMode('garage'));
BUILDS.forEach((b, i) => addButton(b.build.chassis.id, `close:${i}`, () => setMode('close', i)));
addButton('Parts', 'parts', () => setMode('parts'));
addButton('Thumbs', 'thumbs', () => toggleThumbs());
addButton('Flash', 'flash', () => cars.forEach((c) => c.car.flashDamage(1)));
addButton('Shatter', 'shatter', () => shatterAll());

let thumbsBuilt = false;
function toggleThumbs(force?: boolean): void {
  const on = force ?? !thumbs.classList.contains('on');
  thumbs.classList.toggle('on', on);
  if (on && !thumbsBuilt) {
    thumbsBuilt = true;
    const t0 = performance.now();
    for (const p of ALL_PARTS) {
      const fig = document.createElement('figure');
      const img = document.createElement('img');
      img.src = renderPartThumbnail(p.id, 128);
      img.alt = p.id;
      const cap = document.createElement('figcaption');
      cap.textContent = p.id;
      fig.append(img, cap);
      thumbs.appendChild(fig);
    }
    console.info(`[models-preview] ${ALL_PARTS.length} thumbnails in ${(performance.now() - t0).toFixed(0)} ms`);
  }
}

const debris: { o: THREE.Object3D; v: THREE.Vector3; w: THREE.Vector3 }[] = [];
function shatterAll(): void {
  for (const c of cars) {
    for (const o of c.car.shatter(scene)) {
      debris.push({ o, v: new THREE.Vector3((Math.random() - 0.5) * 5, 3 + Math.random() * 3, (Math.random() - 0.5) * 2), w: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6) });
    }
  }
}

// ---------------------------------------------------------------------------

const timer = new THREE.Timer();
let t = 0;
function frame(): void {
  timer.update();
  const dt = Math.min(0.05, timer.getDelta());
  t += dt;
  if (mode === 'battle') {
    for (const c of cars) c.car.applySnapshot(fakeSnapshot(c, t), dt);
  } else {
    for (const c of cars) c.car.setGaragePose(t);
    for (const a of partAnims) a(t, dt);
  }
  for (const d of debris) {
    d.v.y -= 9.8 * dt;
    d.o.position.addScaledVector(d.v, dt);
    d.o.rotation.x += d.w.x * dt;
    d.o.rotation.z += d.w.z * dt;
    if (d.o.position.y < 0.1) { d.o.position.y = 0.1; d.v.set(d.v.x * 0.6, Math.abs(d.v.y) * 0.3, d.v.z * 0.6); }
  }
  controls.update();
  renderer.render(scene, camera);
  info.textContent = `mode: ${mode}${mode === 'close' ? ' ' + BUILDS[closeIndex].build.chassis.id : ''}\n` + statsText.join('\n') + `\nframe: calls ${renderer.info.render.calls} tris ${renderer.info.render.triangles}`;
  requestAnimationFrame(frame);
}

const hash = location.hash.replace('#', '');
if (hash.startsWith('close')) setMode('close', Number(hash.split(':')[1] ?? 0));
else if (hash === 'garage' || hash === 'parts' || hash === 'battle') setMode(hash);
else setMode('battle');
if (location.search.includes('thumbs')) toggleThumbs(true);
requestAnimationFrame(frame);

// hooks for automated inspection
Object.assign(window, {
  __preview: {
    setMode,
    measureAll,
    stats: () => statsText.slice(),
    toggleThumbs,
    setTime: (v: number) => { t = v; },
    cars: () => cars.map((c) => c.car),
    idleWeaponAnim,
  },
});
