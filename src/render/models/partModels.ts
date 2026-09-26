/**
 * Procedural builders for every car part. All dimensions come straight from
 * src/shared/parts.ts (meters, car-local frame: +x forward, +y up, z = depth).
 *
 * Geometry is cached per part id and shared between cars (never dispose it).
 * Materials come from ../materials — shared ones are cached; per-instance
 * "owned" materials (chassis paint, weapon heat glow) are listed in
 * `group.userData.ownedMaterials` so the owner can dispose them.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { bladeArm } from '../../shared/parts';
import type { ChassisDef, GadgetDef, Mount, Vec2, WeaponDef, WheelDef } from '../../shared/parts';
import type { GadgetAnim, WeaponAnim } from '../../shared/sim/types';
import * as M from '../materials';

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const geoCache = new Map<string, THREE.BufferGeometry>();

function cachedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    g.name = key;
    g.computeBoundingSphere();
    g.computeBoundingBox();
    geoCache.set(key, g);
  }
  return g;
}

/** Non-indexed, position/normal/uv only — so any mix of primitives can be merged. */
function prep(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name);
  }
  if (!out.attributes.normal) out.computeVertexNormals();
  if (!out.attributes.uv) {
    out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  }
  out.clearGroups();
  return out;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepped = parts.map(prep);
  const merged = mergeGeometries(prepped, false);
  for (const p of prepped) p.dispose();
  if (!merged) throw new Error('mergeGeometries failed');
  return merged;
}

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function place<T extends THREE.BufferGeometry>(g: T, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): T {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _m4.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  g.applyMatrix4(_m4);
  return g;
}

/** Cylinder along +x from x0 to x0+len. */
function cylX(r: number, len: number, x0 = 0, seg = 16, r2 = r, open = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r2, r, len, seg, 1, open);
  g.rotateZ(-Math.PI / 2);
  g.translate(x0 + len / 2, 0, 0);
  return g;
}
/** Cylinder along z, centered. */
function cylZ(r: number, len: number, seg = 16): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2);
  return g;
}
function cylY(r: number, h: number, seg = 16): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, h, seg);
}
function rbox(w: number, h: number, d: number, r: number, seg = 1): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
}
/** Hex-head bolt sitting on a face whose outward normal is ±z (dir) at (x,y,z). */
function boltZ(x: number, y: number, z: number, dir: 1 | -1, r = 0.017): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r * 0.72, r, r * 0.9, 6);
  g.rotateX((dir * Math.PI) / 2);
  g.translate(x, y, z + dir * r * 0.4);
  return g;
}
/** Bolt on a face whose outward normal is ±x. */
function boltX(x: number, y: number, z: number, dir: 1 | -1, r = 0.017): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r * 0.72, r, r * 0.9, 6);
  g.rotateZ((-dir * Math.PI) / 2);
  g.translate(x + dir * r * 0.4, y, z);
  return g;
}
/** Bolt on a face whose outward normal is +y. */
function boltY(x: number, y: number, z: number, r = 0.017): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r * 0.72, r, r * 0.9, 6);
  g.translate(x, y + r * 0.4, z);
  return g;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], name = ''): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Stadium (rounded slot) outline along x from xa-h..xb+h, half-height h. */
function stadiumPath<T extends THREE.Path>(p: T, xa: number, xb: number, h: number): T {
  p.moveTo(xa, -h);
  p.lineTo(xb, -h);
  p.absarc(xb, 0, h, -Math.PI / 2, Math.PI / 2, false);
  p.lineTo(xa, h);
  p.absarc(xa, 0, h, Math.PI / 2, (3 * Math.PI) / 2, false);
  return p;
}

function extrudeCentered(shape: THREE.Shape, depth: number, bevel: number, curveSegments = 10, bevelSegments = 1): THREE.BufferGeometry {
  const inner = Math.max(0.001, depth - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: inner,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments,
    curveSegments,
  });
  g.translate(0, 0, -inner / 2);
  return g;
}

function ownedList(g: THREE.Object3D): THREE.Material[] {
  if (!g.userData.ownedMaterials) g.userData.ownedMaterials = [];
  return g.userData.ownedMaterials as THREE.Material[];
}

// ---------------------------------------------------------------------------
// Chassis
// ---------------------------------------------------------------------------

const CH_BEVEL = 0.035;

function chassisBodyGeo(def: ChassisDef): THREE.BufferGeometry {
  return cachedGeo('chassis:body:' + def.id, () => {
    const shape = new THREE.Shape(def.shape.map((p) => new THREE.Vector2(p.x, p.y)));
    const inner = def.depth - 2 * CH_BEVEL;
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: inner,
      bevelEnabled: true,
      bevelThickness: CH_BEVEL,
      bevelSize: CH_BEVEL,
      bevelOffset: -CH_BEVEL, // widest bevel ring == the physics polygon exactly
      bevelSegments: 3,
      curveSegments: 1,
    });
    geo.translate(0, 0, -inner / 2);
    // Remap cap UVs to the polygon bounding box so the livery texture fits.
    const b = M.shapeBounds(def.shape);
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const cap = geo.groups[0];
    for (let i = cap.start; i < cap.start + cap.count; i++) {
      uv.setXY(i, (pos.getX(i) - b.minX) / w, (pos.getY(i) - b.minY) / h);
    }
    // Side walls: meters -> scale for the grunge tile.
    const side = geo.groups[1];
    for (let i = side.start; i < side.start + side.count; i++) uv.setXY(i, uv.getX(i) * 0.8, uv.getY(i) * 0.8);
    uv.needsUpdate = true;
    return geo;
  });
}

/** Distance of point p inside the (CCW, convex) polygon to its nearest edge (negative = outside). */
function insideDist(shape: Vec2[], x: number, y: number): number {
  let d = Infinity;
  for (let i = 0; i < shape.length; i++) {
    const a = shape[i], b = shape[(i + 1) % shape.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    // inward normal of a CCW polygon is the left normal
    const nx = -ey / len, ny = ex / len;
    d = Math.min(d, (x - a.x) * nx + (y - a.y) * ny);
  }
  return d;
}

function bottomRange(def: ChassisDef, minH: number): [number, number] {
  const b = M.shapeBounds(def.shape);
  let x0 = b.minX, x1 = b.maxX;
  for (let x = b.minX; x < b.maxX; x += 0.01) {
    const r = M.yRangeAt(def.shape, x);
    if (r && r[1] - r[0] >= minH) { x0 = x; break; }
  }
  for (let x = b.maxX; x > b.minX; x -= 0.01) {
    const r = M.yRangeAt(def.shape, x);
    if (r && r[1] - r[0] >= minH) { x1 = x; break; }
  }
  return [x0, x1];
}

function headlightSpot(def: ChassisDef): { x: number; y: number } {
  const b = M.shapeBounds(def.shape);
  for (let x = b.maxX - 0.09; x > b.minX; x -= 0.02) {
    const r = M.yRangeAt(def.shape, x);
    if (r && r[1] - r[0] >= 0.21) return { x, y: Math.max(r[0] + 0.17, r[1] - 0.075) };
  }
  return { x: b.maxX - 0.1, y: (b.minY + b.maxY) / 2 };
}

function trimGeo(def: ChassisDef): THREE.BufferGeometry {
  return cachedGeo('chassis:trim:' + def.id, () => {
    const b = M.shapeBounds(def.shape);
    const [x0, x1] = bottomRange(def, 0.1);
    const parts: THREE.BufferGeometry[] = [];
    // chunky bottom bumper / skid rail
    parts.push(place(rbox(x1 - x0, 0.085, def.depth + 0.05, 0.03, 2), (x0 + x1) / 2, b.minY + 0.04, 0));
    // end caps: rear and front bumper blocks
    const rr = M.yRangeAt(def.shape, x0 + 0.02);
    if (rr) parts.push(place(rbox(0.07, Math.min(0.16, rr[1] - rr[0] - 0.02), def.depth + 0.07, 0.025), x0 + 0.015, rr[0] + Math.min(0.16, rr[1] - rr[0] - 0.02) / 2, 0));
    const rf = M.yRangeAt(def.shape, x1 - 0.02);
    if (rf) parts.push(place(rbox(0.07, Math.min(0.14, rf[1] - rf[0] - 0.02), def.depth + 0.07, 0.025), x1 - 0.015, rf[0] + Math.min(0.14, rf[1] - rf[0] - 0.02) / 2, 0));
    return merge(parts);
  });
}

function steelDetailGeo(def: ChassisDef): THREE.BufferGeometry {
  return cachedGeo('chassis:steel:' + def.id, () => {
    const b = M.shapeBounds(def.shape);
    const parts: THREE.BufferGeometry[] = [];
    const zf = def.depth / 2;
    const badge = M.liveryBadge(def);
    const hl = headlightSpot(def);

    // perimeter rivets on both side caps (skip the bottom edge — bumper covers it)
    const spacing = 0.13;
    for (let i = 0; i < def.shape.length; i++) {
      const a = def.shape[i], c = def.shape[(i + 1) % def.shape.length];
      if (Math.abs(a.y - b.minY) < 1e-4 && Math.abs(c.y - b.minY) < 1e-4) continue;
      const ex = c.x - a.x, ey = c.y - a.y;
      const len = Math.hypot(ex, ey);
      if (len < 0.12) continue;
      const tx = ex / len, ty = ey / len, nx = -ty, ny = tx;
      const n = Math.max(1, Math.floor((len - 0.1) / spacing));
      const step = (len - 0.1) / n;
      for (let j = 0; j <= n; j++) {
        const s = 0.05 + j * step;
        const x = a.x + tx * s + nx * 0.065, y = a.y + ty * s + ny * 0.065;
        if (insideDist(def.shape, x, y) < 0.05) continue;
        if (y < b.minY + 0.15) continue;
        if (Math.hypot(x - badge.x, y - badge.y) < badge.r + 0.04) continue;
        if (Math.hypot(x - hl.x, y - hl.y) < 0.09) continue;
        parts.push(boltZ(x, y, zf, 1), boltZ(x, y, -zf, -1));
      }
    }
    // bolts on the bumper
    const [x0, x1] = bottomRange(def, 0.1);
    for (let x = x0 + 0.1; x < x1 - 0.06; x += 0.17) {
      parts.push(boltZ(x, b.minY + 0.04, zf + 0.025, 1, 0.015), boltZ(x, b.minY + 0.04, -zf - 0.025, -1, 0.015));
    }

    // roll bar behind the seat
    const ck = def.cockpit;
    const xr = ck.x - 0.25;
    const rr = M.yRangeAt(def.shape, xr);
    const roofR = rr ? rr[1] : ck.y;
    const R = Math.min(zf - 0.07, 0.24);
    const legH = 0.2;
    const tube = 0.022;
    for (const sz of [-1, 1]) parts.push(place(cylY(tube, legH + 0.02, 10), xr, roofR + legH / 2 - 0.01, sz * R));
    parts.push(place(new THREE.TorusGeometry(R, tube, 8, 18, Math.PI), xr, roofR + legH, 0, 0, Math.PI / 2, 0));
    parts.push(place(cylY(0.04, 0.02, 12), xr, roofR + 0.005, R), place(cylY(0.04, 0.02, 12), xr, roofR + 0.005, -R));

    // exhaust pipes at the back
    const xe = b.minX + 0.16;
    const re = M.yRangeAt(def.shape, xe);
    if (re) {
      for (const sz of [-1, 1]) {
        const z = sz * (zf - 0.085);
        const ang = 0.55; // leans back
        const L = 0.22;
        const dx = -Math.sin(ang), dy = Math.cos(ang);
        parts.push(place(cylY(0.028, L, 10), xe + (dx * L) / 2, re[1] + (dy * L) / 2 - 0.02, z, 0, 0, ang));
        parts.push(place(new THREE.CylinderGeometry(0.038, 0.032, 0.06, 10, 1), xe + dx * L, re[1] + dy * L - 0.02, z, 0, 0, ang));
        parts.push(place(cylY(0.045, 0.02, 10), xe, re[1], z));
      }
    }

    // steering wheel in front of the seat (only if a top weapon is not in the way)
    const xs = ck.x + 0.22;
    const topClear = def.weaponSlots.every((s) => s.mount !== 'top' || Math.abs(s.pos.x - xs) > 0.3);
    const rs = M.yRangeAt(def.shape, xs);
    if (topClear && rs) {
      const colTop = { x: xs - 0.02, y: rs[1] + 0.17 };
      const colBase = { x: xs + 0.05, y: rs[1] };
      const cl = Math.hypot(colTop.x - colBase.x, colTop.y - colBase.y);
      const ca = Math.atan2(colTop.x - colBase.x, colTop.y - colBase.y);
      parts.push(place(cylY(0.016, cl, 8), (colTop.x + colBase.x) / 2, (colTop.y + colBase.y) / 2, 0, 0, 0, -ca));
      parts.push(place(new THREE.TorusGeometry(0.075, 0.014, 6, 16), colTop.x, colTop.y, 0, 0, Math.PI / 2, 0.45));
      parts.push(place(cylX(0.012, 0.15, -0.075, 6), colTop.x, colTop.y, 0, 0, Math.PI / 2, 0.45));
    }

    // headlight bezels
    for (const sz of [-1, 1]) {
      parts.push(place(new THREE.TorusGeometry(0.052, 0.013, 6, 16), hl.x, hl.y, sz * (zf + 0.012)));
    }

    // steel skid strip along long forward-facing ramps (wedge / tower nose)
    for (let i = 0; i < def.shape.length; i++) {
      const a = def.shape[i], c = def.shape[(i + 1) % def.shape.length];
      const ex = c.x - a.x, ey = c.y - a.y;
      const len = Math.hypot(ex, ey);
      const onx = ey / len; // outward normal x
      if (onx > 0.35 && len > 0.6 && ey / len < 0.9) {
        const ang = Math.atan2(ey, ex);
        parts.push(place(new THREE.BoxGeometry(len - 0.12, 0.03, def.depth - 0.03), (a.x + c.x) / 2, (a.y + c.y) / 2, 0, 0, 0, ang));
        for (let s = 0.12; s < len - 0.1; s += 0.2) {
          parts.push(boltY(0, 0, 0, 0.014).translate(0, 0.012, 0).rotateZ(ang).translate(a.x + (ex / len) * s, a.y + (ey / len) * s, zf * 0.55));
          parts.push(boltY(0, 0, 0, 0.014).translate(0, 0.012, 0).rotateZ(ang).translate(a.x + (ex / len) * s, a.y + (ey / len) * s, -zf * 0.55));
        }
      }
    }
    return merge(parts);
  });
}

function seatGeo(def: ChassisDef): THREE.BufferGeometry {
  return cachedGeo('chassis:seat:' + def.id, () => {
    const ck = def.cockpit;
    return merge([
      place(rbox(0.26, 0.06, 0.32, 0.025), ck.x, ck.y + 0.03, 0),
      place(rbox(0.065, 0.3, 0.32, 0.028), ck.x - 0.15, ck.y + 0.16, 0, 0, 0, 0.18),
      place(rbox(0.07, 0.1, 0.2, 0.03), ck.x - 0.19, ck.y + 0.34, 0, 0, 0, 0.18),
    ]);
  });
}

function lightGeo(def: ChassisDef): THREE.BufferGeometry {
  return cachedGeo('chassis:light:' + def.id, () => {
    const hl = headlightSpot(def);
    const zf = def.depth / 2;
    return merge([
      place(new THREE.SphereGeometry(0.046, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), hl.x, hl.y, zf, Math.PI / 2, 0, 0, 1, 0.45, 1),
      place(new THREE.SphereGeometry(0.046, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), hl.x, hl.y, -zf, -Math.PI / 2, 0, 0, 1, 0.45, 1),
    ]);
  });
}

/**
 * Chassis body in car-local coords (unmirrored). Paint materials are created per
 * call (for per-car damage flashes): `group.userData.paintMaterials` lists them and
 * `group.userData.ownedMaterials` holds everything the caller must dispose.
 */
export function buildChassisMesh(def: ChassisDef, paint?: string): THREE.Group {
  const g = new THREE.Group();
  g.name = 'chassis:' + def.id;
  const color = paint ?? def.color;
  const capMat = M.createLiveryMaterial(def, color);
  const sideMat = M.createPaintMaterial(color);
  g.add(mesh(chassisBodyGeo(def), [capMat, sideMat], 'body'));
  g.add(mesh(trimGeo(def), M.trimMat(def.trim), 'trim'));
  g.add(mesh(steelDetailGeo(def), M.steel(), 'steel'));
  g.add(mesh(seatGeo(def), M.leather(), 'seat'));
  const lights = mesh(lightGeo(def), M.headlight(), 'lights');
  lights.castShadow = false;
  g.add(lights);
  g.userData.paintMaterials = [capMat, sideMat];
  ownedList(g).push(capMat, sideMat);
  return g;
}

// ---------------------------------------------------------------------------
// Wheels
// ---------------------------------------------------------------------------

interface WheelGeos {
  tire: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
  steel: THREE.BufferGeometry;
}

function tireGeo(ri: number, ro: number, w: number, seg = 26): THREE.BufferGeometry {
  const c = Math.min(0.4 * (ro - ri), w * 0.32);
  const pts: THREE.Vector2[] = [];
  pts.push(new THREE.Vector2(ri, -w * 0.46));
  pts.push(new THREE.Vector2(ri + (ro - c - ri) * 0.5, -w * 0.5));
  for (let k = 0; k <= 4; k++) {
    const a = -Math.PI / 2 + (k / 4) * (Math.PI / 2);
    pts.push(new THREE.Vector2(ro - c + c * Math.cos(a), -w / 2 + c + c * Math.sin(a)));
  }
  for (let k = 0; k <= 4; k++) {
    const a = (k / 4) * (Math.PI / 2);
    pts.push(new THREE.Vector2(ro - c + c * Math.cos(a), w / 2 - c + c * Math.sin(a)));
  }
  pts.push(new THREE.Vector2(ri + (ro - c - ri) * 0.5, w * 0.5));
  pts.push(new THREE.Vector2(ri, w * 0.46));
  const g = new THREE.LatheGeometry(pts, seg);
  g.rotateX(Math.PI / 2); // lathe axis y -> z
  return g;
}

function wheelGeos(def: WheelDef): WheelGeos {
  const key = 'wheel:' + def.id;
  const hit = geoCache.get(key + ':tire');
  if (hit) return { tire: hit, rim: geoCache.get(key + ':rim')!, steel: geoCache.get(key + ':steel')! };

  const r = def.radius, w = def.width;
  const style = def.style;
  const tireParts: THREE.BufferGeometry[] = [];
  const rimParts: THREE.BufferGeometry[] = [];
  const steelParts: THREE.BufferGeometry[] = [];
  const zo = w * 0.4; // rim outer face

  let ro = r, ri = r * 0.6, spokes = 5;
  if (style === 'spiked') { ro = r * 0.84; ri = r * 0.54; spokes = 6; }
  if (style === 'turbo') { ri = r * 0.7; spokes = 0; }
  if (style === 'bigfoot') { ro = r * 0.87; ri = r * 0.5; spokes = 6; }
  if (style === 'heavy') { ro = r * 0.82; ri = r * 0.55; spokes = 3; }

  tireParts.push(tireGeo(ri, ro, w));

  // rim backing disc: dark (merged into the tire mesh) so colored spokes read as they spin;
  // turbo keeps a colored disc because its speed-stripe texture is the rotation cue.
  const disc = cylZ(ri * 1.03, w * 0.78, 24);
  if (style === 'turbo') rimParts.push(disc);
  else {
    const uv = disc.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 0.02); // plain sidewall shade of the tread texture
    tireParts.push(disc);
    // colored inner ring so the rim still reads in the wheel color
    rimParts.push(place(new THREE.TorusGeometry(ri * 0.62, Math.max(0.01, ri * 0.05), 6, 24), 0, 0, zo - 0.004));
  }
  rimParts.push(place(new THREE.TorusGeometry(ri * 0.97, Math.max(0.012, ri * 0.07), 6, 24), 0, 0, zo));
  if (spokes > 0) {
    const sw = style === 'bigfoot' ? 0.09 : style === 'heavy' ? 0.11 : 0.06;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2 + 0.3;
      const len = ri * 0.9;
      rimParts.push(place(new THREE.BoxGeometry(len, sw, 0.03), Math.cos(a) * len * 0.5, Math.sin(a) * len * 0.5, zo + 0.012, 0, 0, a));
    }
    // dark "holes" between spokes are implied by the darker rim disc behind the spokes:
    // make the dish slightly recessed by adding a smaller protruding hub
  }
  rimParts.push(place(cylZ(ri * 0.34, 0.06, 18), 0, 0, zo + 0.01));

  // steel: lug nuts + center cap
  const lugs = style === 'heavy' ? 6 : 5;
  for (let i = 0; i < lugs; i++) {
    const a = (i / lugs) * Math.PI * 2;
    steelParts.push(boltZ(Math.cos(a) * ri * 0.22, Math.sin(a) * ri * 0.22, zo + 0.04, 1, Math.max(0.011, ri * 0.06)));
  }
  steelParts.push(place(new THREE.SphereGeometry(ri * 0.12, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0, zo + 0.04, Math.PI / 2, 0, 0, 1, 0.6, 1));

  if (style === 'spiked') {
    const n = 12;
    const len = r - ro + 0.02;
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < n; i++) {
        const a = ((i + row * 0.5) / n) * Math.PI * 2;
        const rad = ro - 0.02 + len / 2;
        steelParts.push(place(new THREE.ConeGeometry(0.03, len, 6), Math.cos(a) * rad, Math.sin(a) * rad, (row ? 1 : -1) * w * 0.22, 0, 0, a - Math.PI / 2));
      }
    }
    // steel band on the tread
    steelParts.push(place(new THREE.TorusGeometry(ro - 0.005, 0.012, 6, 36), 0, 0, 0));
  }
  if (style === 'bigfoot') {
    const n = 14;
    const h = r - ro + 0.015;
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < n; i++) {
        const a = ((i + row * 0.5) / n) * Math.PI * 2;
        const rad = ro - 0.015 + h / 2;
        tireParts.push(place(new THREE.BoxGeometry(0.1 * r * 1.6, h, w * 0.42), Math.cos(a) * rad, Math.sin(a) * rad, (row ? 1 : -1) * w * 0.24, 0, 0, a - Math.PI / 2));
      }
    }
  }
  if (style === 'heavy') {
    const n = 16;
    const h = r - ro + 0.01;
    const cw = ((2 * Math.PI * ro) / n) * 0.8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rad = ro - 0.01 + h / 2;
      steelParts.push(place(new THREE.BoxGeometry(cw, h * 0.7, w * 1.04), Math.cos(a) * (rad - h * 0.15), Math.sin(a) * (rad - h * 0.15), 0, 0, 0, a - Math.PI / 2));
      steelParts.push(place(new THREE.BoxGeometry(cw * 0.3, h * 0.4, w * 1.04), Math.cos(a) * (rad + h * 0.3), Math.sin(a) * (rad + h * 0.3), 0, 0, 0, a - Math.PI / 2));
    }
    // road-wheel bolts around the rim
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      steelParts.push(boltZ(Math.cos(a) * ri * 0.78, Math.sin(a) * ri * 0.78, zo + 0.02, 1, 0.014));
    }
  }
  if (style === 'turbo') {
    // chrome spinner blades over the speed-stripe face
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      steelParts.push(place(new THREE.BoxGeometry(ri * 0.55, 0.014, 0.012), Math.cos(a) * ri * 0.4, Math.sin(a) * ri * 0.4, zo + 0.035, 0, 0, a + 0.5));
    }
  }

  const tire = merge(tireParts);
  const rim = merge(rimParts);
  const steel = merge(steelParts);
  for (const [k, g] of [['tire', tire], ['rim', rim], ['steel', steel]] as const) {
    g.name = key + ':' + k;
    g.computeBoundingSphere();
    geoCache.set(key + ':' + k, g);
  }
  return { tire, rim, steel };
}

function rimMaterial(def: WheelDef): THREE.Material {
  return def.style === 'turbo' ? M.turboRim(def.color) : M.solidPaint(def.color);
}

/** Single wheel, axle along z, centered at origin, decorated face toward +z. */
export function buildWheelMesh(def: WheelDef): THREE.Group {
  const g = new THREE.Group();
  g.name = 'wheel:' + def.id;
  const geos = wheelGeos(def);
  g.add(mesh(geos.tire, def.style === 'heavy' ? M.blackRubber() : M.rubber(), 'tire'));
  g.add(mesh(geos.rim, rimMaterial(def), 'rim'));
  g.add(mesh(geos.steel, M.steel(), 'hub'));
  return g;
}

/**
 * A full axle for the assembled car: two wheels at z = ±zOff (both decorated faces
 * outward) plus the axle rod. Same pose as a single wheel (rotation.z = spin).
 */
export function buildWheelAxleMesh(def: WheelDef, zOff: number): THREE.Group {
  const key = `axle:${def.id}:${zOff.toFixed(3)}`;
  const single = wheelGeos(def);
  const pair = (g: THREE.BufferGeometry, extra: THREE.BufferGeometry[] = []) =>
    merge([g.clone().translate(0, 0, zOff), g.clone().rotateY(Math.PI).translate(0, 0, -zOff), ...extra]);
  const tire = cachedGeo(key + ':tire', () => pair(single.tire));
  const rim = cachedGeo(key + ':rim', () => pair(single.rim));
  const steel = cachedGeo(key + ':steel', () => pair(single.steel, [cylZ(0.032, zOff * 2, 10)]));
  const g = new THREE.Group();
  g.name = 'axle:' + def.id;
  g.add(mesh(tire, def.style === 'heavy' ? M.blackRubber() : M.rubber(), 'tire'));
  g.add(mesh(rim, rimMaterial(def), 'rim'));
  g.add(mesh(steel, M.steel(), 'hub'));
  return g;
}

// ---------------------------------------------------------------------------
// Weapons (weapon-local: origin = slot, +x = pointing direction)
// ---------------------------------------------------------------------------

export interface WeaponModel {
  group: THREE.Group;
  animate(anim: WeaponAnim): void;
}

function setHeat(mat: THREE.MeshStandardMaterial, heat: number): void {
  mat.emissiveIntensity = Math.max(0, Math.min(1, heat)) * 0.9;
}

function sawDiscGeo(R: number): THREE.BufferGeometry {
  return cachedGeo('blade:disc:' + R, () => {
    const n = Math.max(14, Math.round(R * 70));
    const ri = R * 0.84;
    const shape = new THREE.Shape();
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 0.78) / n) * Math.PI * 2;
      const a2 = ((i + 1) / n) * Math.PI * 2;
      if (i === 0) shape.moveTo(Math.cos(a0) * ri, Math.sin(a0) * ri);
      shape.lineTo(Math.cos(a1) * R, Math.sin(a1) * R); // tooth tip, raked
      shape.lineTo(Math.cos(a1 + 0.02) * ri * 1.02, Math.sin(a1 + 0.02) * ri * 1.02);
      shape.lineTo(Math.cos(a2) * ri, Math.sin(a2) * ri);
    }
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3;
      const hole = new THREE.Path();
      hole.absarc(Math.cos(a) * R * 0.56, Math.sin(a) * R * 0.56, R * 0.12, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
    return extrudeCentered(shape, 0.028, 0.006, 10, 1);
  });
}

function buildBlade(def: WeaponDef, owned: THREE.Material[]): WeaponModel {
  const g = new THREE.Group();
  const L = def.length, R = def.radius;
  // motor at the pivot
  const baseGeo = cachedGeo('blade:base', () => {
    const parts = [cylZ(0.085, 0.2, 18), place(cylZ(0.1, 0.05, 18), 0, 0, 0)];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      parts.push(boltZ(Math.cos(a) * 0.06, Math.sin(a) * 0.06, 0.1, 1, 0.012), boltZ(Math.cos(a) * 0.06, Math.sin(a) * 0.06, -0.1, -1, 0.012));
    }
    return merge(parts);
  });
  g.add(mesh(baseGeo, M.darkSteel(), 'base'));

  const arm = new THREE.Group();
  arm.name = 'arm';
  g.add(arm);
  const armGeo = cachedGeo('blade:arm:' + L, () => {
    const s = stadiumPath(new THREE.Shape(), 0, L, 0.048);
    for (let x = 0.12; x < L - 0.1; x += 0.13) {
      const hole = new THREE.Path();
      hole.absarc(x, 0, 0.022, 0, Math.PI * 2, true);
      s.holes.push(hole);
    }
    return extrudeCentered(s, 0.05, 0.01, 10, 1);
  });
  arm.add(mesh(armGeo, M.solidPaint('#3a3f47'), 'armBar'));
  const armSteel = cachedGeo('blade:armsteel:' + L, () =>
    merge([cylZ(0.035, 0.1, 12), place(cylZ(0.035, 0.12, 12), L, 0, 0.0), boltZ(L * 0.5, 0.0, 0.025, 1, 0.014), boltZ(L * 0.5, 0.0, -0.025, -1, 0.014)]),
  );
  arm.add(mesh(armSteel, M.steel(), 'armSteel'));

  const disc = new THREE.Group();
  disc.name = 'disc';
  disc.position.set(L, 0, 0.055);
  arm.add(disc);
  const discMat = M.createHeatMaterial(M.coloredMetal(def.color));
  owned.push(discMat);
  disc.add(mesh(sawDiscGeo(R), discMat, 'saw'));
  const discHub = cachedGeo('blade:hub:' + R, () => {
    const parts = [cylZ(R * 0.3, 0.036, 20), place(cylZ(0.05, 0.05, 14), 0, 0, 0)];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      parts.push(boltZ(Math.cos(a) * R * 0.2, Math.sin(a) * R * 0.2, 0.018, 1, 0.012), boltZ(Math.cos(a) * R * 0.2, Math.sin(a) * R * 0.2, -0.018, -1, 0.012));
    }
    return merge(parts);
  });
  disc.add(mesh(discHub, M.darkSteel(), 'discHub'));

  return {
    group: g,
    animate(a) {
      arm.rotation.z = a.angle;
      disc.rotation.z = -a.spin;
      setHeat(discMat, a.heat);
    },
  };
}

function drillBitGeo(R: number, L: number): THREE.BufferGeometry {
  return cachedGeo(`drill:bit:${R}:${L}`, () => {
    const nu = 22, nt = 36;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const turns = 2.4;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const x = u * L;
      const taper = Math.pow(1 - u, 0.92);
      for (let j = 0; j <= nt; j++) {
        const t = (j / nt) * Math.PI * 2;
        const flute = 1 + 0.17 * Math.cos(2 * (t - turns * Math.PI * 2 * u)) * Math.min(1, u * 8 + 0.2);
        const rr = R * taper * flute;
        pos.push(x, Math.cos(t) * rr, Math.sin(t) * rr);
        uv.push(j / nt, u);
      }
    }
    const row = nt + 1;
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nt; j++) {
        const a = i * row + j, b = (i + 1) * row + j, c = i * row + j + 1, d = (i + 1) * row + j + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // base cap facing -x
    const cap = new THREE.CircleGeometry(R * 1.02, 24);
    cap.rotateY(-Math.PI / 2);
    return merge([g, cap]);
  });
}

function buildDrill(def: WeaponDef, owned: THREE.Material[]): WeaponModel {
  const g = new THREE.Group();
  const L = def.length, R = def.radius;
  const housing = cachedGeo(`drill:housing:${R}`, () => {
    const parts = [cylX(R * 1.12, 0.07, -0.06, 20), cylX(R * 0.9, 0.05, -0.1, 16)];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      parts.push(boltX(-0.06, Math.cos(a) * R * 0.95, Math.sin(a) * R * 0.95, -1, 0.013));
    }
    return merge(parts);
  });
  g.add(mesh(housing, M.darkSteel(), 'collar'));
  const motor = cachedGeo(`drill:motor:${R}`, () => {
    const parts = [place(rbox(0.2, R * 2.2, R * 2.2, 0.04), -0.19, 0, 0)];
    // cooling fins
    for (let i = 0; i < 4; i++) parts.push(place(new THREE.BoxGeometry(0.018, R * 2.35, R * 2.35), -0.25 + i * 0.035, 0, 0));
    return merge(parts);
  });
  g.add(mesh(motor, M.solidPaint('#e8b230'), 'motor'));
  const bit = new THREE.Group();
  bit.name = 'bit';
  g.add(bit);
  const bitMat = M.createHeatMaterial(M.coloredMetal(def.color));
  owned.push(bitMat);
  bit.add(mesh(drillBitGeo(R, L), bitMat, 'bit'));
  return {
    group: g,
    animate(a) {
      bit.rotation.x = a.spin;
      setHeat(bitMat, a.heat);
    },
  };
}

function buildChainsaw(def: WeaponDef, owned: THREE.Material[]): WeaponModel {
  const g = new THREE.Group();
  const L = def.length, h = def.radius;
  const x0 = 0.1;
  const xa = x0 + h, xb = L - h;
  // engine body
  const body = cachedGeo('chainsaw:body', () =>
    merge([
      place(rbox(0.28, 0.2, 0.2, 0.05), -0.02, 0.02, 0),
      place(rbox(0.12, 0.08, 0.16, 0.03), 0.1, -0.04, 0),
      place(cylZ(0.05, 0.215, 16), -0.06, 0.02, 0),
    ]),
  );
  g.add(mesh(body, M.solidPaint(def.color), 'body'));
  const dark = cachedGeo('chainsaw:dark', () => {
    const parts = [
      place(new THREE.TorusGeometry(0.075, 0.018, 8, 16, Math.PI), -0.03, 0.12, 0),
      place(cylZ(0.035, 0.225, 12), -0.06, 0.02, 0),
      place(rbox(0.05, 0.12, 0.22, 0.015), -0.14, 0.0, 0),
    ];
    for (let i = 0; i < 3; i++) parts.push(place(new THREE.BoxGeometry(0.012, 0.09, 0.205), 0.02 + i * 0.03, 0.02, 0));
    return merge(parts);
  });
  g.add(mesh(dark, M.darkSteel(), 'engineDark'));
  // guide bar + chain band
  const bar = cachedGeo(`chainsaw:bar:${L}:${h}`, () => {
    const s = stadiumPath(new THREE.Shape(), xa, xb, h - 0.004);
    const parts = [extrudeCentered(s, 0.022, 0.004, 14, 1)];
    // nose sprocket + bar bolts
    parts.push(place(cylZ(h * 0.4, 0.03, 12), xb, 0, 0));
    parts.push(boltZ(xa + 0.02, 0, 0.011, 1, 0.014), boltZ(xa + 0.02, 0, -0.011, -1, 0.014));
    return merge(parts);
  });
  g.add(mesh(bar, M.steel(), 'bar'));
  const band = cachedGeo(`chainsaw:band:${L}:${h}`, () => {
    const s = stadiumPath(new THREE.Shape(), xa, xb, h + 0.012);
    s.holes.push(stadiumPath(new THREE.Path(), xa, xb, h - 0.012));
    return extrudeCentered(s, 0.03, 0, 14);
  });
  g.add(mesh(band, M.darkSteel(), 'chain'));
  // teeth (instanced, scroll along the stadium path)
  const toothGeo = cachedGeo('chainsaw:tooth', () => {
    const s = new THREE.Shape();
    s.moveTo(-0.016, 0);
    s.lineTo(0.014, 0);
    s.lineTo(0.02, 0.022);
    s.lineTo(0.004, 0.016);
    s.lineTo(-0.016, 0.01);
    s.closePath();
    return extrudeCentered(s, 0.036, 0, 1);
  });
  const teethMat = M.createHeatMaterial(M.steel());
  owned.push(teethMat);
  const P = 2 * (xb - xa) + 2 * Math.PI * h;
  const N = Math.max(12, Math.round(P / 0.055));
  const teeth = new THREE.InstancedMesh(toothGeo, teethMat, N);
  teeth.name = 'teeth';
  teeth.castShadow = true;
  teeth.receiveShadow = true;
  teeth.frustumCulled = false;
  g.add(teeth);
  g.userData.ownedInstanced = [teeth];
  const obj = new THREE.Object3D();
  const rEdge = h + 0.008;
  const pointAt = (s: number): void => {
    s = ((s % P) + P) % P;
    const Ls = xb - xa;
    let x: number, y: number, ang: number;
    if (s < Ls) { x = xa + s; y = rEdge; ang = 0; }
    else if (s < Ls + Math.PI * h) {
      const phi = Math.PI / 2 - (s - Ls) / h;
      x = xb + Math.cos(phi) * rEdge; y = Math.sin(phi) * rEdge; ang = phi - Math.PI / 2;
    } else if (s < 2 * Ls + Math.PI * h) { x = xb - (s - Ls - Math.PI * h); y = -rEdge; ang = Math.PI; }
    else {
      const phi = -Math.PI / 2 - (s - 2 * Ls - Math.PI * h) / h;
      x = xa + Math.cos(phi) * rEdge; y = Math.sin(phi) * rEdge; ang = phi - Math.PI / 2;
    }
    obj.position.set(x, y, 0);
    obj.rotation.set(0, 0, ang);
    obj.updateMatrix();
  };
  let lastSpin = NaN;
  const place2 = (spin: number): void => {
    if (spin === lastSpin) return;
    lastSpin = spin;
    const off = spin * 0.035;
    for (let i = 0; i < N; i++) {
      pointAt((i / N) * P + off);
      teeth.setMatrixAt(i, obj.matrix);
    }
    teeth.instanceMatrix.needsUpdate = true;
  };
  place2(0);
  teeth.computeBoundingSphere();
  return {
    group: g,
    animate(a) {
      place2(a.spin);
      setHeat(teethMat, a.heat);
    },
  };
}

function buildFork(def: WeaponDef, owned: THREE.Material[]): WeaponModel {
  const g = new THREE.Group();
  const L = def.length, t = def.radius;
  const W = 0.46;
  const bracket = cachedGeo('fork:bracket', () =>
    merge([
      place(rbox(0.14, 0.12, 0.06, 0.02), -0.05, -0.02, W * 0.33),
      place(rbox(0.14, 0.12, 0.06, 0.02), -0.05, -0.02, -W * 0.33),
      place(rbox(0.1, 0.1, W * 0.5, 0.02), -0.08, -0.03, 0),
    ]),
  );
  g.add(mesh(bracket, M.darkSteel(), 'bracket'));
  const plate = new THREE.Group();
  plate.name = 'plate';
  g.add(plate);
  const plateGeo = cachedGeo(`fork:plate:${L}:${t}`, () => {
    // top-view outline in (x, z)
    const s = new THREE.Shape();
    const pw = 0.085, zs = [-0.17, 0, 0.17];
    const baseEnd = 0.22;
    s.moveTo(0.0, -W / 2);
    s.lineTo(baseEnd, -W / 2);
    for (let k = 0; k < 3; k++) {
      const zc = zs[k];
      s.lineTo(baseEnd, zc - pw / 2);
      s.lineTo(L - 0.09, zc - pw / 2);
      s.lineTo(L, zc - 0.012);
      s.lineTo(L, zc + 0.012);
      s.lineTo(L - 0.09, zc + pw / 2);
      s.lineTo(baseEnd, zc + pw / 2);
    }
    s.lineTo(baseEnd, W / 2);
    s.lineTo(0.0, W / 2);
    s.closePath();
    const geo = extrudeCentered(s, t * 2, 0.01, 1, 1);
    geo.rotateX(-Math.PI / 2); // shape y -> -z, extrusion -> y
    return geo;
  });
  const plateMat = M.createHeatMaterial(M.coloredMetal(def.color));
  owned.push(plateMat);
  plate.add(mesh(plateGeo, plateMat, 'prongs'));
  const rivets = cachedGeo(`fork:rivets:${t}`, () => {
    const parts = [place(cylZ(0.05, W * 0.92, 16), 0, 0, 0)];
    for (const z of [-0.19, -0.1, 0, 0.1, 0.19]) {
      parts.push(boltY(0.1, t, z, 0.014), boltY(0.17, t, z, 0.014));
    }
    // side rivets toward camera
    parts.push(boltZ(0.1, 0, W / 2, 1, 0.012), boltZ(0.1, 0, -W / 2, -1, 0.012));
    return merge(parts);
  });
  plate.add(mesh(rivets, M.steel(), 'rivets'));
  // hydraulic ram under the plate (bracket -> plate underside), follows the flip
  const ramBase = new THREE.Vector2(-0.07, -0.09);
  const ramTip = new THREE.Vector2(0.2, -t - 0.01);
  const ram = mesh(cachedGeo('fork:ram', () => merge([cylX(0.022, 1, 0, 10), cylX(0.034, 0.45, 0, 12)])), M.chrome(), 'ram');
  g.add(ram);
  const tip = new THREE.Vector2();
  return {
    group: g,
    animate(a) {
      plate.rotation.z = a.flip;
      tip.copy(ramTip).rotateAround(new THREE.Vector2(0, 0), a.flip);
      const dx = tip.x - ramBase.x, dy = tip.y - ramBase.y;
      ram.position.set(ramBase.x, ramBase.y, 0);
      ram.rotation.z = Math.atan2(dy, dx);
      ram.scale.x = Math.hypot(dx, dy);
      setHeat(plateMat, a.heat);
    },
  };
}

function gloveMaterial(color: string): THREE.MeshStandardMaterial {
  return M.solidPaint(color);
}

function buildPunch(def: WeaponDef, owned: THREE.Material[]): WeaponModel {
  const g = new THREE.Group();
  const L = def.length, R = def.radius, reach = def.reach;
  const housing = cachedGeo(`punch:housing:${L}`, () => {
    const parts = [cylX(0.095, L, 0, 18), cylX(0.075, 0.04, L - 0.01, 16), place(rbox(0.05, 0.26, 0.26, 0.02), 0.02, 0, 0)];
    for (const [y, z] of [[0.09, 0.09], [-0.09, 0.09], [0.09, -0.09], [-0.09, -0.09]]) parts.push(boltX(0.045, y, z, 1, 0.014));
    return merge(parts);
  });
  g.add(mesh(housing, M.darkSteel(), 'housing'));
  const bands = cachedGeo(`punch:bands:${L}`, () => merge([cylX(0.105, 0.035, 0.08, 18), cylX(0.105, 0.035, L - 0.06, 18)]));
  g.add(mesh(bands, M.solidPaint('#f2b233'), 'bands'));
  const rod = mesh(cachedGeo('punch:rod', () => cylX(0.038, 1, 0, 12)), M.chrome(), 'rod');
  rod.position.x = L - 0.02;
  g.add(rod);
  const glove = new THREE.Group();
  glove.name = 'glove';
  g.add(glove);
  const gloveGeo = cachedGeo(`punch:glove:${R}`, () =>
    merge([
      place(new THREE.SphereGeometry(R, 18, 12), R * 0.95, 0, 0, 0, 0, 0, 1.0, 0.9, 0.95),
      // thumb along the top/front side
      place(new THREE.CapsuleGeometry(R * 0.3, R * 0.55, 4, 10), R * 0.9, R * 0.55, R * 0.45, 0, 0, -1.2),
      // knuckle roll
      place(new THREE.TorusGeometry(R * 0.55, R * 0.18, 8, 16, Math.PI), R * 1.45, 0, 0, 0, Math.PI / 2, Math.PI / 2),
    ]),
  );
  const gloveMat = M.createHeatMaterial(gloveMaterial(def.color));
  gloveMat.roughness = 0.32;
  owned.push(gloveMat);
  glove.add(mesh(gloveGeo, gloveMat, 'fist'));
  const cuff = cachedGeo(`punch:cuff:${R}`, () =>
    merge([cylX(R * 0.62, R * 0.42, R * -0.12, 18), cylX(R * 0.66, R * 0.06, R * 0.12, 18), place(rbox(R * 0.3, R * 0.08, R * 0.9, 0.01), R * 0.1, R * 0.58, 0)]),
  );
  glove.add(mesh(cuff, M.cream(), 'cuff'));
  return {
    group: g,
    animate(a) {
      const ext = Math.max(0, Math.min(1, a.extend)) * reach;
      glove.position.x = L + R * 0.12 + ext;
      rod.scale.x = Math.max(0.001, ext + R * 0.12 + 0.02);
      rod.visible = ext > 0.005;
      setHeat(gloveMat, a.heat);
    },
  };
}

function buildRocket(def: WeaponDef): WeaponModel {
  const g = new THREE.Group();
  const L = def.length, R = def.radius;
  const podZ = R * 0.75;
  const base = cachedGeo(`rocket:base:${R}`, () =>
    merge([
      place(cylY(0.1, 0.05, 16), 0.02, -R - 0.045, 0),
      place(rbox(0.1, R + 0.06, 0.03, 0.01), 0.0, -R / 2 - 0.02, podZ + 0.03),
      place(rbox(0.1, R + 0.06, 0.03, 0.01), 0.0, -R / 2 - 0.02, -podZ - 0.03),
      cylZ(0.03, podZ * 2 + 0.1, 12),
    ]),
  );
  g.add(mesh(base, M.darkSteel(), 'turret'));
  const tilt = new THREE.Group();
  tilt.name = 'tilt';
  g.add(tilt);
  const recoil = new THREE.Group();
  tilt.add(recoil);
  const tubeY = R * 0.48, tubeR = R * 0.5;
  const pod = cachedGeo(`rocket:pod:${L}:${R}`, () =>
    merge([place(rbox(L - 0.07, R * 2.05, podZ * 2, 0.03), (L - 0.07) / 2 + 0.03, 0, 0), place(rbox(0.12, 0.05, podZ * 2 + 0.02, 0.015), L * 0.45, R * 1.02, 0)]),
  );
  recoil.add(mesh(pod, M.solidPaint('#56643a'), 'pod'));
  const tubes = cachedGeo(`rocket:tubes:${L}:${R}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const y of [-tubeY, tubeY]) {
      parts.push(place(cylX(tubeR, L, 0, 16), 0, y, 0));
      parts.push(place(cylX(tubeR * 0.7, 0.05, -0.04, 14, tubeR * 1.1), 0, y, 0));
      parts.push(place(new THREE.CircleGeometry(tubeR * 0.82, 16), L + 0.001, y, 0, 0, Math.PI / 2, 0));
    }
    // straps
    for (const x of [0.12, L - 0.12]) parts.push(place(rbox(0.04, R * 2.15, podZ * 2 + 0.03, 0.01), x, 0, 0));
    parts.push(boltZ(L * 0.3, 0, podZ, 1, 0.014), boltZ(L * 0.7, 0, podZ, 1, 0.014), boltZ(L * 0.3, 0, -podZ, -1, 0.014), boltZ(L * 0.7, 0, -podZ, -1, 0.014));
    return merge(parts);
  });
  recoil.add(mesh(tubes, M.solidPaint(def.color), 'tubes'));
  const tipsGeo = cachedGeo(`rocket:tips:${L}:${R}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const y of [-tubeY, tubeY]) {
      const cone = new THREE.ConeGeometry(tubeR * 0.72, 0.09, 14);
      cone.rotateZ(-Math.PI / 2);
      parts.push(place(cone, L + 0.03, y, 0));
    }
    return merge(parts);
  });
  const tips = mesh(tipsGeo, M.solidPaint('#e2343a'), 'tips');
  recoil.add(tips);
  return {
    group: g,
    animate(a) {
      tilt.rotation.z = a.angle;
      recoil.position.x = -Math.max(0, Math.min(1, a.extend)) * 0.08;
      tips.visible = a.extend < 0.2;
    },
  };
}

/** Weapon at the slot origin, +x = pointing direction (mirroring by mount is done by the caller). */
export function buildWeaponMesh(def: WeaponDef, mount: Mount): WeaponModel {
  const owned: THREE.Material[] = [];
  let model: WeaponModel;
  switch (def.weapon) {
    case 'blade': model = buildBlade(def, owned); break;
    case 'drill': model = buildDrill(def, owned); break;
    case 'chainsaw': model = buildChainsaw(def, owned); break;
    case 'fork': model = buildFork(def, owned); break;
    case 'punch': model = buildPunch(def, owned); break;
    case 'rocket': model = buildRocket(def); break;
  }
  model.group.name = `weapon:${def.id}:${mount}`;
  ownedList(model.group).push(...owned);
  model.animate(idleWeaponAnim(def, mount, 0));
  return model;
}

/** Garage/showroom animation state for a weapon. */
export function idleWeaponAnim(def: WeaponDef, mount: Mount, time: number): WeaponAnim {
  const base = def.weapon === 'blade' ? bladeArm(mount).base : 0;
  return { type: def.weapon, angle: base, extend: 0, spin: time * 3, flip: 0, heat: 0 };
}

// ---------------------------------------------------------------------------
// Gadgets
// ---------------------------------------------------------------------------

export interface GadgetModel {
  group: THREE.Group;
  animate(anim: GadgetAnim, dt: number): void;
}

function buildBooster(def: GadgetDef, owned: THREE.Material[]): GadgetModel {
  const g = new THREE.Group();
  const Rn = def.size.x;
  const body = cachedGeo(`booster:body:${Rn}`, () =>
    merge([
      cylX(Rn * 0.9, 0.16, -0.02, 20),
      place(new THREE.SphereGeometry(Rn * 0.9, 20, 10, 0, Math.PI), 0.14, 0, 0, 0, Math.PI / 2, 0, 1, 1, 0.6),
    ]),
  );
  g.add(mesh(body, M.solidPaint(def.color), 'tank'));
  const dark = cachedGeo(`booster:nozzle:${Rn}`, () => {
    const parts = [
      cylX(Rn, 0.12, -0.15, 20, Rn * 0.72, true),
      cylX(Rn * 0.95, 0.03, 0.02, 20),
      cylX(Rn * 0.95, 0.03, 0.09, 20),
      place(rbox(0.12, 0.05, Rn * 1.4, 0.015), 0.05, -Rn * 0.9, 0),
    ];
    // inner nozzle wall (visible from behind): flip winding + normals so it faces inward
    const inner = new THREE.CylinderGeometry(Rn * 0.68, Rn * 0.95, 0.12, 20, 1, true);
    inner.rotateZ(-Math.PI / 2);
    const idx = inner.index!;
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
    const nrm = inner.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
    inner.translate(-0.09, 0, 0);
    parts.push(inner);
    return merge(parts);
  });
  g.add(mesh(dark, M.darkSteel(), 'nozzle'));
  const glowMat = new THREE.MeshStandardMaterial({ color: '#2a1a12', emissive: '#ff7a1a', emissiveIntensity: 0.2, roughness: 0.6 });
  owned.push(glowMat);
  const glow = mesh(cachedGeo(`booster:glow:${Rn}`, () => place(new THREE.CircleGeometry(Rn * 0.7, 20), -0.03, 0, 0, 0, -Math.PI / 2, 0)), glowMat, 'glow');
  g.add(glow);
  const flameGeo = cachedGeo('booster:flame', () => {
    const c = new THREE.ConeGeometry(1, 1, 16, 1, true);
    c.rotateZ(Math.PI / 2); // tip -> -x
    c.translate(-0.5, 0, 0);
    return c;
  });
  const flames = new THREE.Group();
  flames.position.x = -0.15;
  g.add(flames);
  const outer = new THREE.Mesh(flameGeo, M.flame('#ff7a22'));
  const inner = new THREE.Mesh(flameGeo, M.flame('#ffe9a0'));
  outer.renderOrder = 5;
  inner.renderOrder = 6;
  flames.add(outer, inner);
  let t = 0;
  return {
    group: g,
    animate(a, dt) {
      t += dt;
      const act = Math.max(0, Math.min(1, a.active));
      flames.visible = act > 0.02;
      const flick = 0.85 + 0.15 * Math.sin(t * 47) * Math.sin(t * 23 + 1);
      const len = (0.12 + 0.6 * act) * flick;
      outer.scale.set(len, Rn * 0.85, Rn * 0.85);
      inner.scale.set(len * 0.6, Rn * 0.5, Rn * 0.5);
      glowMat.emissiveIntensity = 0.25 + act * 2.5;
    },
  };
}

class Helix extends THREE.Curve<THREE.Vector3> {
  constructor(private r: number, private h: number, private turns: number) {
    super();
  }
  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const a = t * this.turns * Math.PI * 2;
    return target.set(Math.cos(a) * this.r, t * this.h, Math.sin(a) * this.r);
  }
}

function buildSpring(def: GadgetDef): GadgetModel {
  const g = new THREE.Group();
  const rw = def.size.x, rest = def.size.y * 0.8;
  const base = cachedGeo(`spring:base:${rw}`, () => {
    const parts = [place(cylY(rw * 0.95, 0.035, 20), 0, 0.0175, 0)];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      parts.push(boltY(Math.cos(a) * rw * 0.72, 0.035, Math.sin(a) * rw * 0.72, 0.013));
    }
    return merge(parts);
  });
  g.add(mesh(base, M.darkSteel(), 'base'));
  const coil = mesh(cachedGeo(`spring:coil:${rw}:${rest}`, () => new THREE.TubeGeometry(new Helix(rw * 0.68, rest, 5), 90, 0.016, 6, false)), M.coloredMetal(def.color), 'coil');
  coil.position.y = 0.035;
  g.add(coil);
  const pad = new THREE.Group();
  g.add(pad);
  const padGeo = cachedGeo(`spring:pad:${rw}`, () => {
    const parts = [place(cylY(rw, 0.045, 22), 0, 0.0225, 0)];
    for (let i = -2; i <= 2; i++) parts.push(place(new THREE.BoxGeometry(0.018, 0.012, rw * 1.6), i * 0.045, 0.05, 0));
    return merge(parts);
  });
  pad.add(mesh(padGeo, M.solidPaint('#d8402f'), 'pad'));
  return {
    group: g,
    animate(a) {
      const s = 1 + Math.max(0, Math.min(1, a.active)) * 1.3;
      coil.scale.y = s;
      pad.position.y = 0.035 + rest * s;
    },
  };
}

function buildArmor(def: GadgetDef, depth: number): GadgetModel {
  const g = new THREE.Group();
  const sx = def.size.x, sy = def.size.y;
  const plateGeo = cachedGeo(`armor:plate:${sx}:${sy}:${depth}`, () =>
    merge([
      place(rbox(sx * 2, sy * 2, depth, 0.03), sx, 0, 0),
      // raised outer rib
      place(rbox(0.03, sy * 1.7, depth * 0.8, 0.012), sx * 2 + 0.005, 0, 0),
    ]),
  );
  g.add(mesh(plateGeo, M.trimMat(def.color), 'plate'));
  const rivets = cachedGeo(`armor:rivets:${sx}:${sy}:${depth}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const zf = depth / 2;
    for (let y = -sy + 0.06; y <= sy - 0.05; y += (2 * sy - 0.12) / 4) {
      for (const x of [sx * 0.45, sx * 1.55]) parts.push(boltZ(x, y, zf, 1, 0.016), boltZ(x, y, -zf, -1, 0.016));
      for (const z of [-zf * 0.75, zf * 0.75]) parts.push(boltX(sx * 2, y, z, 1, 0.016));
    }
    return merge(parts);
  });
  g.add(mesh(rivets, M.steel(), 'rivets'));
  // hazard stripe band on the side faces
  const stripeGeo = cachedGeo(`armor:stripe:${sx}:${sy}:${depth}`, () =>
    merge([place(new THREE.PlaneGeometry(sx * 1.6, 0.06), sx, sy * 0.62, depth / 2 + 0.001), place(new THREE.PlaneGeometry(sx * 1.6, 0.06), sx, sy * 0.62, -depth / 2 - 0.001, 0, Math.PI, 0)]),
  );
  g.add(mesh(stripeGeo, M.solidPaint('#f2c230'), 'stripe'));
  return { group: g, animate() {} };
}

/**
 * Gadget at the slot origin (car-local, unmirrored). `depth` = z-extent for the armor
 * plate (defaults to a typical chassis depth + margin).
 */
export function buildGadgetMesh(def: GadgetDef, depth = 0.78): GadgetModel {
  const owned: THREE.Material[] = [];
  let model: GadgetModel;
  switch (def.gadget) {
    case 'booster': model = buildBooster(def, owned); break;
    case 'spring': model = buildSpring(def); break;
    case 'armor': model = buildArmor(def, depth); break;
  }
  model.group.name = 'gadget:' + def.id;
  ownedList(model.group).push(...owned);
  model.animate({ type: def.gadget, active: 0 }, 0);
  return model;
}

/** Dispose per-instance resources created by the builders (never the shared caches). */
export function disposeOwned(root: THREE.Object3D): void {
  root.traverse((o) => {
    const owned = o.userData.ownedMaterials as THREE.Material[] | undefined;
    if (owned) for (const m of owned) m.dispose();
    o.userData.ownedMaterials = [];
    const inst = o.userData.ownedInstanced as THREE.InstancedMesh[] | undefined;
    if (inst) for (const im of inst) im.dispose();
    o.userData.ownedInstanced = [];
  });
}
