import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ArenaId } from '../shared/sim/types';
import { SIM } from '../shared/sim/types';
import { ASSET_URLS, type Assets } from './Assets';

interface ArenaLook {
  floor: 'concrete' | 'planks' | 'tarmac' | 'warehouse';
  hemiSky: string;
  hemiGround: string;
  hemi: number;
  key: string;
  keyIntensity: number;
  keyDir: [number, number, number];
  rim: string;
  rimIntensity: number;
  fog: string;
  exposure: number;
  /** Background plate vertical offset (world y of the plate center). */
  plateY: number;
}

export const ARENA_LOOKS: Record<ArenaId, ArenaLook> = {
  skate: { floor: 'concrete', hemiSky: '#ffe7c4', hemiGround: '#6d5a48', hemi: 1.35, key: '#ffd49a', keyIntensity: 2.7, keyDir: [-4, 7, 5], rim: '#ffb46b', rimIntensity: 1.4, fog: '#e8c9a0', exposure: 1.05, plateY: 4.9 },
  harbor: { floor: 'planks', hemiSky: '#ffe2d0', hemiGround: '#5e6b78', hemi: 1.35, key: '#ffe0bd', keyIntensity: 2.6, keyDir: [5, 6, 5], rim: '#9fd3ff', rimIntensity: 1.2, fog: '#f3cdb8', exposure: 1.05, plateY: 5.4 },
  airport: { floor: 'tarmac', hemiSky: '#ffc9d8', hemiGround: '#3f3f58', hemi: 1.3, key: '#ffcfa8', keyIntensity: 2.4, keyDir: [-5, 6, 4], rim: '#b59bff', rimIntensity: 1.6, fog: '#cf9fb6', exposure: 1.1, plateY: 5.0 },
  warehouse: { floor: 'warehouse', hemiSky: '#ffe0b0', hemiGround: '#4a4038', hemi: 1.2, key: '#ffc27a', keyIntensity: 2.8, keyDir: [3, 8, 4], rim: '#ffd99a', rimIntensity: 1.2, fog: '#8f7660', exposure: 1.08, plateY: 5.1 },
};

/** Scene env map (0.5) + ACES already lift the image; keep lights moderate so paints don't clip. */
const LIGHT_SCALE = 0.62;
const FLOOR_NEAR = 3.2;
const FLOOR_FAR = -7.5;

export interface ArenaHandle {
  id: ArenaId;
  group: THREE.Group;
  look: ArenaLook;
  keyLight: THREE.DirectionalLight;
  update(time: number): void;
  dispose(): void;
}

// ----------------------------------------------------------------- textures

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number, count: number, colors: string[], maxR: number): void {
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[Math.floor(rnd() * colors.length)];
    g.globalAlpha = 0.05 + rnd() * 0.18;
    const r = 0.5 + rnd() * maxR;
    g.beginPath();
    g.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

function floorTexture(kind: ArenaLook['floor']): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const rnd = seeded(kind.length * 977);
  return canvasTexture(W, H, (g) => {
    if (kind === 'planks') {
      const rows = 8;
      const rh = H / rows;
      for (let r = 0; r < rows; r++) {
        let x = -rnd() * 300;
        while (x < W) {
          const len = 260 + rnd() * 320;
          const hue = 30 + rnd() * 8;
          const light = 62 + rnd() * 12;
          g.fillStyle = `hsl(${hue}, ${38 + rnd() * 12}%, ${light}%)`;
          g.fillRect(x, r * rh, len, rh);
          // grain
          g.strokeStyle = `hsla(${hue}, 40%, ${light - 18}%, 0.35)`;
          g.lineWidth = 1;
          for (let k = 0; k < 7; k++) {
            g.beginPath();
            const y = r * rh + rnd() * rh;
            g.moveTo(x, y);
            g.bezierCurveTo(x + len * 0.3, y + (rnd() - 0.5) * 8, x + len * 0.7, y + (rnd() - 0.5) * 8, x + len, y);
            g.stroke();
          }
          // board end + nails
          g.fillStyle = 'rgba(60,35,20,0.55)';
          g.fillRect(x + len - 3, r * rh, 3, rh);
          g.fillStyle = 'rgba(40,30,25,0.8)';
          for (const ny of [0.25, 0.75]) {
            g.beginPath();
            g.arc(x + 10, r * rh + rh * ny, 2.2, 0, Math.PI * 2);
            g.arc(x + len - 12, r * rh + rh * ny, 2.2, 0, Math.PI * 2);
            g.fill();
          }
          x += len;
        }
        g.fillStyle = 'rgba(55,32,18,0.8)';
        g.fillRect(0, r * rh, W, 4);
      }
      speckle(g, W, H, rnd, 500, ['#3b2414', '#fff3dc'], 3);
      return;
    }
    const base = kind === 'tarmac' ? '#4b4c55' : kind === 'warehouse' ? '#a29788' : '#b7ada1';
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);
    speckle(g, W, H, rnd, 5000, kind === 'tarmac' ? ['#2b2b30', '#777884', '#5f5f6a'] : ['#6e655b', '#d8cfc3', '#8f857a'], 2.2);
    // big stains
    for (let i = 0; i < 14; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const r = 30 + rnd() * 90;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, kind === 'tarmac' ? 'rgba(20,20,26,0.35)' : 'rgba(70,58,45,0.22)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    if (kind === 'concrete' || kind === 'warehouse') {
      g.strokeStyle = 'rgba(60,52,45,0.55)';
      g.lineWidth = 3;
      for (let x = 0; x <= W; x += 256) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, H);
        g.stroke();
      }
      g.beginPath();
      g.moveTo(0, H * 0.5);
      g.lineTo(W, H * 0.5);
      g.stroke();
      // skid marks
      g.strokeStyle = 'rgba(25,20,18,0.25)';
      g.lineWidth = 9;
      for (let i = 0; i < 5; i++) {
        g.beginPath();
        const y = H * (0.3 + rnd() * 0.45);
        g.moveTo(rnd() * W * 0.5, y);
        g.quadraticCurveTo(W * 0.5, y + (rnd() - 0.5) * 60, W * (0.5 + rnd() * 0.5), y + (rnd() - 0.5) * 40);
        g.stroke();
      }
    }
    if (kind === 'warehouse') {
      // hazard stripe band near the back
      const y0 = H * 0.06;
      for (let x = -40; x < W + 40; x += 56) {
        g.fillStyle = '#f2b233';
        g.beginPath();
        g.moveTo(x, y0);
        g.lineTo(x + 28, y0);
        g.lineTo(x + 8, y0 + 34);
        g.lineTo(x - 20, y0 + 34);
        g.fill();
      }
    }
    if (kind === 'tarmac') {
      g.fillStyle = '#f2c22e';
      for (let x = 0; x < W; x += 128) g.fillRect(x + 10, H * 0.62, 80, 12);
      g.fillStyle = 'rgba(240,240,240,0.8)';
      g.fillRect(0, H * 0.18, W, 6);
    }
  });
}

function fadeTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(4, 256, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    // v=1 (top of canvas after flipY) is the far edge.
    grad.addColorStop(0, '#000');
    grad.addColorStop(0.35, '#fff');
    grad.addColorStop(1, '#fff');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
  }, false);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function newspaperTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 192, (g) => {
    g.fillStyle = '#efe9dc';
    g.fillRect(0, 0, 256, 192);
    g.fillStyle = '#3a3a3a';
    g.fillRect(14, 12, 228, 18);
    g.fillStyle = '#8b8b8b';
    for (let y = 40; y < 180; y += 9) {
      g.fillRect(14, y, 104, 4);
      g.fillRect(138, y, 104, 4);
    }
    g.fillStyle = '#b4aea0';
    g.fillRect(138, 40, 104, 60);
  });
}

// ----------------------------------------------------------------- props kit

interface Kit {
  mat(color: string, rough?: number, metal?: number): THREE.MeshStandardMaterial;
}

function makeKit(): Kit {
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  return {
    mat(color, rough = 0.7, metal = 0.05) {
      const key = `${color}-${rough}-${metal}`;
      let m = cache.get(key);
      if (!m) {
        m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
        cache.set(key, m);
      }
      return m;
    },
  };
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cone(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.42, 0.04, 0.42), kit.mat('#e2561f', 0.6), 0, 0.02, 0));
  const body = mesh(new THREE.CylinderGeometry(0.04, 0.17, 0.62, 16, 1, true), kit.mat('#f06a26', 0.55), 0, 0.33, 0);
  g.add(body);
  g.add(mesh(new THREE.CylinderGeometry(0.095, 0.125, 0.12, 16, 1, true), kit.mat('#f4f1ea', 0.5), 0, 0.33, 0));
  return g;
}

function trashBin(kit: Kit, color = '#2f7a54'): THREE.Group {
  const g = new THREE.Group();
  const body = mesh(new THREE.BoxGeometry(0.62, 0.95, 0.66), kit.mat(color, 0.6), 0, 0.5, 0);
  g.add(body);
  g.add(mesh(new THREE.BoxGeometry(0.7, 0.07, 0.74), kit.mat('#245f41', 0.6), 0, 1.0, 0));
  for (const s of [-1, 1]) {
    const wheel = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 14), kit.mat('#1d1d1d', 0.9), s * 0.24, 0.1, -0.34);
    wheel.rotation.x = Math.PI / 2;
    g.add(wheel);
  }
  return g;
}

function trashBag(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(0.32, 2);
  const pos = geo.attributes.position;
  const rnd = seeded(42);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const k = 1 + (rnd() - 0.5) * 0.22;
    pos.setXYZ(i, pos.getX(i) * k * 1.1, y * (y > 0 ? 1.15 : 0.8), pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
  g.add(mesh(geo, kit.mat('#1b1c1f', 0.35, 0.1), 0, 0.26, 0));
  const tie = mesh(new THREE.ConeGeometry(0.08, 0.2, 8), kit.mat('#1b1c1f', 0.35, 0.1), 0, 0.62, 0);
  g.add(tie);
  return g;
}

function crate(kit: Kit, size = 0.8): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(size, size, size), kit.mat('#b07a44', 0.8), 0, size / 2, 0));
  const plank = kit.mat('#8a5a2e', 0.85);
  const bars: THREE.BufferGeometry[] = [];
  for (const y of [0.08, size - 0.08]) {
    const b = new THREE.BoxGeometry(size + 0.02, 0.1, size + 0.02);
    b.translate(0, y, 0);
    bars.push(b);
  }
  const diag = new THREE.BoxGeometry(size * 1.25, 0.08, 0.04);
  diag.rotateZ(Math.PI / 4);
  diag.translate(0, size / 2, size / 2 + 0.01);
  bars.push(diag);
  g.add(mesh(mergeGeometries(bars)!, plank));
  return g;
}

function drum(kit: Kit, color: string): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 20), kit.mat(color, 0.45, 0.35), 0, 0.45, 0));
  for (const y of [0.22, 0.68]) g.add(mesh(new THREE.TorusGeometry(0.3, 0.02, 6, 24), kit.mat('#2a2a2a', 0.5, 0.5), 0, y, 0).rotateX(Math.PI / 2));
  return g;
}

function pallet(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const wood = kit.mat('#c89a5c', 0.85);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const b = new THREE.BoxGeometry(1.1, 0.03, 0.16);
    b.translate(0, 0.14, -0.44 + i * 0.22);
    parts.push(b);
  }
  for (const x of [-0.48, 0, 0.48]) {
    const b = new THREE.BoxGeometry(0.1, 0.12, 1.0);
    b.translate(x, 0.06, 0);
    parts.push(b);
  }
  g.add(mesh(mergeGeometries(parts)!, wood));
  return g;
}

function suitcase(kit: Kit, color: string, h = 0.7): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.5, h, 0.26), kit.mat(color, 0.5, 0.1), 0, h / 2 + 0.05, 0));
  g.add(mesh(new THREE.BoxGeometry(0.03, 0.35, 0.03), kit.mat('#333', 0.4, 0.8), -0.1, h + 0.2, 0));
  g.add(mesh(new THREE.BoxGeometry(0.03, 0.35, 0.03), kit.mat('#333', 0.4, 0.8), 0.1, h + 0.2, 0));
  g.add(mesh(new THREE.BoxGeometry(0.24, 0.03, 0.04), kit.mat('#333', 0.4, 0.8), 0, h + 0.37, 0));
  for (const s of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.04, 8, 6), kit.mat('#111', 0.8), s * 0.2, 0.04, 0));
  return g;
}

function stanchion(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const brass = kit.mat('#d6a54a', 0.3, 0.9);
  g.add(mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.04, 20), brass, 0, 0.02, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 10), brass, 0, 0.47, 0));
  g.add(mesh(new THREE.SphereGeometry(0.06, 12, 10), brass, 0, 0.95, 0));
  return g;
}

function rope(kit: Kit, x0: number, x1: number, z: number): THREE.Mesh {
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x0, 0.88, z), new THREE.Vector3((x0 + x1) / 2, 0.55, z), new THREE.Vector3(x1, 0.88, z));
  return mesh(new THREE.TubeGeometry(curve, 16, 0.03, 6), kit.mat('#8e1f2a', 0.6));
}

function boundaryPost(kit: Kit, side: number): THREE.Group {
  // Stacked plank pillar with a bin + bag, like the arena edges in CATS.
  const g = new THREE.Group();
  const wood = kit.mat('#c58a3f', 0.75);
  const dark = kit.mat('#8a5a24', 0.8);
  g.add(mesh(new THREE.BoxGeometry(0.62, 2.6, 0.9), wood, 0, 1.3, 0));
  for (let i = 0; i < 4; i++) g.add(mesh(new THREE.BoxGeometry(0.66, 0.06, 0.94), dark, 0, 0.3 + i * 0.62, 0));
  g.add(mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), kit.mat('#d7b98a', 0.9), 0.05, 2.85, 0.1));
  const bag = trashBag(kit);
  bag.position.set(-0.05, 2.6, -0.1);
  bag.scale.setScalar(0.8);
  g.add(bag);
  const bin = trashBin(kit);
  bin.position.set(-side * 0.1, 0, 0.95);
  bin.scale.setScalar(0.9);
  g.add(bin);
  return g;
}

function place<T extends THREE.Object3D>(parent: THREE.Object3D, obj: T, x: number, z: number, rotY = 0, scale = 1): T {
  obj.position.set(x, 0, z);
  obj.rotation.y = rotY;
  obj.scale.multiplyScalar(scale);
  parent.add(obj);
  return obj;
}

function populate(id: ArenaId, kit: Kit, g: THREE.Group): void {
  const rnd = seeded(id.length * 131 + 7);
  const back = () => -2.6 - rnd() * 2.2;
  // Paper litter on the floor (flat decals).
  const paper = new THREE.MeshStandardMaterial({ map: newspaperTexture(), roughness: 0.95 });
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.5), paper);
    p.rotation.x = -Math.PI / 2;
    p.rotation.z = rnd() * Math.PI;
    p.position.set(-7 + rnd() * 14, 0.004, -1.8 + rnd() * 3.4);
    p.receiveShadow = true;
    g.add(p);
  }
  switch (id) {
    case 'skate':
      place(g, cone(kit), -6.2, -2.4, 0.3);
      place(g, cone(kit), -5.5, -3.1, 0.9);
      place(g, cone(kit), 5.8, -2.8, 0.2);
      place(g, crate(kit, 0.7), 7.3, -3.6, 0.4);
      place(g, drum(kit, '#3d7fb8'), -7.6, -3.8);
      place(g, cone(kit), 2.4, -4.6, 0.5);
      for (let i = 0; i < 3; i++) place(g, cone(kit), -2 + i * 1.3, back() - 1.5, rnd() * 3);
      break;
    case 'harbor': {
      place(g, crate(kit, 0.9), -7.2, -3.4, 0.2);
      place(g, crate(kit, 0.7), -6.3, -3.9, 0.7);
      place(g, drum(kit, '#b8452d'), 6.6, -3.2);
      place(g, drum(kit, '#2f6f8f'), 7.3, -3.8);
      // bollards + rope along the pier edge
      const iron = kit.mat('#2d3136', 0.45, 0.7);
      for (let x = -8; x <= 8; x += 4) {
        const b = mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.5, 16), iron, x, 0.25, -5.6);
        g.add(b);
        g.add(mesh(new THREE.SphereGeometry(0.2, 14, 10), iron, x, 0.52, -5.6));
      }
      place(g, pallet(kit), 3.2, -4.4, 0.1);
      break;
    }
    case 'airport': {
      const colors = ['#c9c4d8', '#4c5aa6', '#a33b4a', '#e2e2e2', '#3f7a74'];
      for (let i = 0; i < 6; i++) {
        const c = suitcase(kit, colors[i % colors.length], 0.55 + rnd() * 0.35);
        place(g, c, -7.5 + i * 0.55 + (i > 2 ? 11 : 0), -3.4 - rnd() * 0.8, (rnd() - 0.5) * 0.8);
      }
      for (let x = -6; x <= 6; x += 3) place(g, stanchion(kit), x, -2.9);
      for (let x = -6; x < 6; x += 3) g.add(rope(kit, x, x + 3, -2.9));
      place(g, cone(kit), 4.8, -4.4, 0.2);
      break;
    }
    case 'warehouse':
      place(g, pallet(kit), -6.8, -3.3, 0.1);
      place(g, crate(kit, 0.8), -6.8, -3.3).position.y = 0.15;
      place(g, drum(kit, '#2f6a3f'), 6.2, -3.1);
      place(g, drum(kit, '#b33a2a'), 6.9, -3.5);
      place(g, drum(kit, '#2f5d8a'), 7.5, -2.9);
      place(g, cone(kit), -3.8, -3.9, 0.4);
      place(g, cone(kit), 3.4, -4.2, 0.1);
      place(g, pallet(kit), 1.2, -4.8, 0.3);
      break;
  }
  place(g, boundaryPost(kit, -1), -(SIM.halfWidth + 0.45), 0);
  place(g, boundaryPost(kit, 1), SIM.halfWidth + 0.45, 0);
}

// ----------------------------------------------------------------- arena

export async function createArena(id: ArenaId, assets: Assets): Promise<ArenaHandle> {
  const look = ARENA_LOOKS[id];
  const group = new THREE.Group();
  group.name = `arena-${id}`;

  // Background plate (Higgsfield painting).
  const plateTex = await assets.texture(ASSET_URLS.bg[id]);
  const plateW = 64;
  const plateH = plateW / (2048 / 878);
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(plateW, plateH),
    new THREE.MeshBasicMaterial({ map: plateTex, toneMapped: false, fog: false, depthWrite: false }),
  );
  plate.position.set(0, look.plateY, -20);
  plate.renderOrder = -10;
  group.add(plate);

  // Floor strip with far-edge fade into the painting. The pier deck ends near the
  // camera over water; solid floors run past the camera.
  const near = look.floor === 'planks' ? FLOOR_NEAR : 12;
  const floorTex = floorTexture(look.floor);
  const depth = near - FLOOR_FAR;
  floorTex.repeat.set(40 / 8, depth / 4);
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTex,
    roughness: look.floor === 'warehouse' ? 0.55 : 0.85,
    metalness: 0.02,
    alphaMap: fadeTexture(),
    transparent: true,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(44, depth), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, (near + FLOOR_FAR) / 2);
  floor.receiveShadow = true;
  group.add(floor);

  if (look.floor === 'planks') {
    // Deck edge, pier posts and the water below it.
    const lip = new THREE.Mesh(new THREE.BoxGeometry(44, 0.5, 0.3), new THREE.MeshStandardMaterial({ color: '#6d4526', roughness: 0.9 }));
    lip.position.set(0, -0.25, FLOOR_NEAR - 0.15);
    group.add(lip);
    const postMat = new THREE.MeshStandardMaterial({ color: '#5a3a22', roughness: 0.9 });
    for (let x = -18; x <= 18; x += 3) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 3.5, 10), postMat);
      post.position.set(x, -1.8, FLOOR_NEAR - 0.2);
      group.add(post);
    }
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 40),
      new THREE.MeshStandardMaterial({ color: '#4c8fb5', roughness: 0.18, metalness: 0.2 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -2.6, 0);
    group.add(water);
  }

  const kit = makeKit();
  populate(id, kit, group);

  // Lighting.
  const hemi = new THREE.HemisphereLight(look.hemiSky, look.hemiGround, look.hemi * LIGHT_SCALE);
  group.add(hemi);
  const key = new THREE.DirectionalLight(look.key, look.keyIntensity * LIGHT_SCALE);
  key.position.set(...look.keyDir);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 1024);
  key.shadow.camera.left = -12;
  key.shadow.camera.right = 12;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -4;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  group.add(key);
  group.add(key.target);
  const rim = new THREE.DirectionalLight(look.rim, look.rimIntensity * LIGHT_SCALE);
  rim.position.set(-look.keyDir[0], 4, -6);
  group.add(rim);

  return {
    id,
    group,
    look,
    keyLight: key,
    update() {
      // static for now; hook for ambient motion (flags, lights)
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
        }
      });
      floorTex.dispose();
    },
  };
}
