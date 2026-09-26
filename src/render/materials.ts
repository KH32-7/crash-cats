/**
 * Shared material + procedural texture library for the car models.
 *
 * Everything returned by the plain getters (steel(), rubber(), solidPaint(color)...)
 * is CACHED and SHARED — never mutate or dispose it. Functions prefixed with
 * `create` return a fresh material the caller owns (per-car paint so that damage
 * flashes stay local, per-weapon "heat" glow) and must dispose.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { ChassisDef, Vec2 } from '../shared/parts';

type Std = THREE.MeshStandardMaterial;

const matCache = new Map<string, THREE.Material>();
const texCache = new Map<string, THREE.Texture>();

/** Deterministic PRNG (mulberry32) so textures are identical every run. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function finishTexture(canvas: HTMLCanvasElement, repeat = false, color = true): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.needsUpdate = true;
  return tex;
}

function cachedTex(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = texCache.get(key);
  if (!t) {
    t = make();
    t.name = key;
    texCache.set(key, t);
  }
  return t;
}

function cachedMat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key) as T | undefined;
  if (!m) {
    m = make();
    m.name = key;
    matCache.set(key, m);
  }
  return m;
}

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * k)));
  return '#' + c.getHexString();
}

// ---------------------------------------------------------------------------
// Procedural textures
// ---------------------------------------------------------------------------

/** Near-white tileable grime: speckles, smudges, light scratches (multiplies paint). */
export function grungeTexture(): THREE.Texture {
  return cachedTex('tex:grunge', () => {
    const S = 256;
    const [c, ctx] = makeCanvas(S, S);
    const r = makeRng(7);
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(0, 0, S, S);
    // soft smudges (wrapped so the tile repeats cleanly)
    for (let i = 0; i < 26; i++) {
      const x = r() * S, y = r() * S, rad = 12 + r() * 40;
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
        const a = 0.05 + r() * 0.06;
        g.addColorStop(0, `rgba(90,80,70,${a})`);
        g.addColorStop(1, 'rgba(90,80,70,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
      }
    }
    // speckles
    for (let i = 0; i < 900; i++) {
      const v = 150 + Math.floor(r() * 90);
      ctx.fillStyle = `rgba(${v},${v - 8},${v - 16},${0.25 + r() * 0.35})`;
      ctx.fillRect(r() * S, r() * S, 1 + r() * 1.5, 1 + r() * 1.5);
    }
    // bright scratches
    ctx.lineCap = 'round';
    for (let i = 0; i < 40; i++) {
      const x = r() * S, y = r() * S, a = r() * Math.PI, l = 4 + r() * 16;
      ctx.strokeStyle = `rgba(255,255,255,${0.4 + r() * 0.4})`;
      ctx.lineWidth = 0.6 + r();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
    const t = finishTexture(c, true);
    t.repeat.set(2, 2);
    return t;
  });
}

/** Brushed/worn metal detail (near-white). */
export function metalTexture(): THREE.Texture {
  return cachedTex('tex:metal', () => {
    const S = 128;
    const [c, ctx] = makeCanvas(S, S);
    const r = makeRng(11);
    ctx.fillStyle = '#ececec';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 160; i++) {
      const v = 190 + Math.floor(r() * 65);
      ctx.fillStyle = `rgba(${v},${v},${v},0.5)`;
      ctx.fillRect(0, r() * S, S, 0.6 + r());
    }
    for (let i = 0; i < 260; i++) {
      const v = 120 + Math.floor(r() * 80);
      ctx.fillStyle = `rgba(${v},${v - 6},${v - 12},${0.2 + r() * 0.3})`;
      ctx.fillRect(r() * S, r() * S, 1.2, 1.2);
    }
    return finishTexture(c, true);
  });
}

/**
 * Tire texture for LatheGeometry UVs: u = around the wheel, v = along the profile.
 * The middle band (v 0.3..0.7) is the tread with chunky chevrons; the rest is sidewall.
 * Colors are the actual rubber shades (material color stays white).
 */
export function treadTexture(): THREE.Texture {
  return cachedTex('tex:tread', () => {
    const W = 512, H = 128;
    const [c, ctx] = makeCanvas(W, H);
    ctx.fillStyle = '#34343a';
    ctx.fillRect(0, 0, W, H);
    // sidewall rings
    ctx.fillStyle = '#44444b';
    ctx.fillRect(0, H * 0.1, W, H * 0.05);
    ctx.fillRect(0, H * 0.85, W, H * 0.05);
    // tread band
    ctx.fillStyle = '#26262b';
    ctx.fillRect(0, H * 0.28, W, H * 0.44);
    const n = 18;
    ctx.fillStyle = '#3c3c43';
    for (let i = 0; i < n; i++) {
      const x = (i / n) * W;
      const bw = W / n;
      ctx.beginPath();
      ctx.moveTo(x + bw * 0.1, H * 0.3);
      ctx.lineTo(x + bw * 0.55, H * 0.3);
      ctx.lineTo(x + bw * 0.85, H * 0.5);
      ctx.lineTo(x + bw * 0.55, H * 0.7);
      ctx.lineTo(x + bw * 0.1, H * 0.7);
      ctx.lineTo(x + bw * 0.4, H * 0.5);
      ctx.closePath();
      ctx.fill();
    }
    return finishTexture(c, true);
  });
}

/** Turbo rim face: rim color base, white swirl speed-stripes, dark hub ring. */
export function turboRimTexture(color: string): THREE.Texture {
  return cachedTex('tex:turbo:' + color, () => {
    const S = 256;
    const [c, ctx] = makeCanvas(S, S);
    const cx = S / 2;
    ctx.fillStyle = shade(color, 0.55);
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cx, S * 0.47, 0, Math.PI * 2);
    ctx.fill();
    // swirl stripes
    for (let k = 0; k < 3; k++) {
      const a0 = (k / 3) * Math.PI * 2;
      ctx.fillStyle = k === 0 ? '#ffffff' : '#e8f6ff';
      ctx.beginPath();
      const steps = 24;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const rr = S * (0.12 + 0.34 * t);
        const a = a0 + t * 1.9;
        const x = cx + Math.cos(a) * rr, y = cx + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = steps; i >= 0; i--) {
        const t = i / steps;
        const rr = S * (0.12 + 0.34 * t);
        const a = a0 + t * 1.9 + 0.12 + 0.28 * t;
        ctx.lineTo(cx + Math.cos(a) * rr, cx + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = shade(color, 0.45);
    ctx.lineWidth = S * 0.035;
    ctx.beginPath();
    ctx.arc(cx, cx, S * 0.455, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#1d2a36';
    ctx.beginPath();
    ctx.arc(cx, cx, S * 0.13, 0, Math.PI * 2);
    ctx.fill();
    return finishTexture(c);
  });
}

// ---- chassis livery --------------------------------------------------------

export interface ShapeBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function shapeBounds(shape: Vec2[]): ShapeBounds {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of shape) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, maxX, minY, maxY };
}

/** Vertical extent [lo, hi] of a convex polygon at x, or null if outside. */
export function yRangeAt(shape: Vec2[], x: number): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < shape.length; i++) {
    const a = shape[i], b = shape[(i + 1) % shape.length];
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    if (x < x0 - 1e-6 || x > x1 + 1e-6) continue;
    if (Math.abs(b.x - a.x) < 1e-6) {
      lo = Math.min(lo, a.y, b.y);
      hi = Math.max(hi, a.y, b.y);
    } else {
      const y = a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

/** Where the paw roundel goes on a chassis side (also used by nothing else but kept public for tests). */
export function liveryBadge(def: ChassisDef): { x: number; y: number; r: number } {
  const b = shapeBounds(def.shape);
  const w = b.maxX - b.minX;
  let best = { x: 0, y: 0, r: 0.1, score: -Infinity };
  for (let i = 0; i <= 40; i++) {
    const x = b.minX + w * (0.22 + 0.56 * (i / 40));
    const rg = yRangeAt(def.shape, x);
    if (!rg) continue;
    const h = rg[1] - rg[0];
    let score = h - Math.abs(x - (b.minX + b.maxX) / 2) * 0.15;
    for (const s of def.wheelSlots) if (Math.abs(s.x - x) < 0.36) score -= 0.4;
    // keep clear of the sloped edges: need room left/right of the roundel
    const rl = yRangeAt(def.shape, x - 0.1), rr = yRangeAt(def.shape, x + 0.1);
    if (!rl || !rr) continue;
    score += Math.min(rl[1], rr[1]) - rg[1];
    if (score > best.score) {
      const r = Math.min(0.13, h * 0.24);
      best = { x, y: rg[0] + h * 0.6, r, score };
    }
  }
  return { x: best.x, y: best.y, r: best.r };
}

function drawPaw(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy + s * 0.28, s * 0.46, s * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();
  const toes: [number, number, number, number, number][] = [
    [-0.55, -0.2, 0.17, 0.21, -0.45],
    [-0.2, -0.55, 0.17, 0.22, -0.12],
    [0.2, -0.55, 0.17, 0.22, 0.12],
    [0.55, -0.2, 0.17, 0.21, 0.45],
  ];
  for (const [tx, ty, rx, ry, rot] of toes) {
    ctx.beginPath();
    ctx.ellipse(cx + tx * s, cy + ty * s, rx * s, ry * s, rot, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Side livery for the chassis caps (UVs are remapped to the polygon bounding box):
 * paint, light-to-dark gradient, dark trim band along the bottom, racing stripe,
 * paw-print roundel, panel seams with painted rivets, edge wear and grime.
 */
export function liveryTexture(def: ChassisDef, paint: string): THREE.Texture {
  return cachedTex(`tex:livery:${def.id}:${paint}`, () => {
    const b = shapeBounds(def.shape);
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    const k = 320; // px per meter
    const W = Math.ceil(w * k), H = Math.ceil(h * k);
    const [c, ctx] = makeCanvas(W, H);
    const r = makeRng(hashString(def.id + paint));
    const PX = (x: number) => (x - b.minX) * k;
    const PY = (y: number) => (b.maxY - y) * k;

    // base paint + vertical light gradient
    ctx.fillStyle = paint;
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(255,255,255,0.22)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.0)');
    g.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // soft paint mottling
    for (let i = 0; i < 30; i++) {
      const x = r() * W, y = r() * H, rad = (0.05 + r() * 0.15) * k;
      const gg = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const light = r() > 0.5;
      gg.addColorStop(0, light ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)');
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }

    const badge = liveryBadge(def);
    const trimTop = b.minY + 0.13;

    // racing stripe through the badge height
    const stripeH = Math.max(0.05, badge.r * 0.62);
    const sy0 = badge.y - stripeH / 2;
    ctx.fillStyle = '#f6eedb';
    ctx.fillRect(0, PY(sy0 + stripeH), W, stripeH * k);
    ctx.fillStyle = def.trim;
    ctx.fillRect(0, PY(sy0 + stripeH + 0.028), W, 0.014 * k);
    ctx.fillRect(0, PY(sy0 - 0.014), W, 0.014 * k);
    // stripe fades into speed slashes toward the rear
    ctx.fillStyle = paint;
    for (let i = 0; i < 3; i++) {
      const x0 = b.minX + 0.12 + i * 0.07;
      ctx.beginPath();
      ctx.moveTo(PX(x0), PY(sy0 + stripeH + 0.001));
      ctx.lineTo(PX(x0 + 0.035), PY(sy0 + stripeH + 0.001));
      ctx.lineTo(PX(x0 + 0.035 - stripeH * 0.5), PY(sy0 - 0.001));
      ctx.lineTo(PX(x0 - stripeH * 0.5), PY(sy0 - 0.001));
      ctx.closePath();
      ctx.fill();
    }

    // panel seams (vertical) with painted rivets
    const seamXs: number[] = [];
    for (const f of [0.3, 0.7]) {
      let x = b.minX + w * f;
      if (Math.abs(x - badge.x) < badge.r + 0.08) x = badge.x + Math.sign(x - badge.x || 1) * (badge.r + 0.1);
      seamXs.push(x);
    }
    for (const x of seamXs) {
      const rg = yRangeAt(def.shape, x);
      if (!rg) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      ctx.fillRect(PX(x) - 1.5, PY(rg[1]), 3, (rg[1] - rg[0]) * k);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(PX(x) + 1.5, PY(rg[1]), 1.5, (rg[1] - rg[0]) * k);
      for (let y = rg[0] + 0.16; y < rg[1] - 0.06; y += 0.09) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.arc(PX(x) - 7, PY(y) + 1, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath();
        ctx.arc(PX(x) - 7.5, PY(y), 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // trim band along the bottom
    ctx.fillStyle = def.trim;
    ctx.fillRect(0, PY(trimTop), W, (trimTop - b.minY) * k + 2);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(0, PY(trimTop), W, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, PY(trimTop) + 2, W, 2);
    // hazard chevrons on the trim, front end
    ctx.save();
    ctx.beginPath();
    ctx.rect(PX(b.maxX - 0.42), PY(trimTop - 0.015), 0.28 * k, 0.05 * k);
    ctx.clip();
    ctx.fillStyle = '#f2c230';
    ctx.fillRect(PX(b.maxX - 0.42), PY(trimTop - 0.015), 0.28 * k, 0.05 * k);
    ctx.fillStyle = '#1b1b1b';
    for (let x = b.maxX - 0.46; x < b.maxX - 0.1; x += 0.06) {
      ctx.beginPath();
      ctx.moveTo(PX(x), PY(trimTop - 0.015));
      ctx.lineTo(PX(x + 0.03), PY(trimTop - 0.015));
      ctx.lineTo(PX(x + 0.08), PY(trimTop - 0.065));
      ctx.lineTo(PX(x + 0.05), PY(trimTop - 0.065));
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // paw roundel
    const bx = PX(badge.x), by = PY(badge.y), br = badge.r * k;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.arc(bx + 3, by + 4, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.trim;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f6eedb';
    ctx.beginPath();
    ctx.arc(bx, by, br * 0.84, 0, Math.PI * 2);
    ctx.fill();
    drawPaw(ctx, bx, by + br * 0.02, br * 0.62, def.trim);

    // grime at the bottom
    const gg = ctx.createLinearGradient(0, PY(b.minY + 0.3), 0, H);
    gg.addColorStop(0, 'rgba(70,50,30,0)');
    gg.addColorStop(1, 'rgba(70,50,30,0.35)');
    ctx.fillStyle = gg;
    ctx.fillRect(0, PY(b.minY + 0.3), W, 0.3 * k);

    // edge wear: dark outline + chipped highlights
    ctx.beginPath();
    def.shape.forEach((p, i) => (i === 0 ? ctx.moveTo(PX(p.x), PY(p.y)) : ctx.lineTo(PX(p.x), PY(p.y))));
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 0.13 * k;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 0.085 * k;
    ctx.stroke();

    // scratches / paint chips
    ctx.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const x = r() * W, y = r() * H, a = (r() - 0.5) * 1.2, l = (0.01 + r() * 0.05) * k;
      ctx.strokeStyle = r() > 0.35 ? 'rgba(235,230,220,0.55)' : 'rgba(40,30,25,0.4)';
      ctx.lineWidth = 1 + r() * 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(30,20,10,${0.08 + r() * 0.15})`;
      ctx.fillRect(r() * W, r() * H, 1.5, 1.5);
    }
    return finishTexture(c);
  });
}

// ---------------------------------------------------------------------------
// Shared materials (cached — do not dispose / mutate)
// ---------------------------------------------------------------------------

export function steel(): Std {
  return cachedMat('mat:steel', () => new THREE.MeshStandardMaterial({ color: '#b8c2ca', roughness: 0.35, metalness: 0.85, map: metalTexture() }));
}
export function darkSteel(): Std {
  return cachedMat('mat:darkSteel', () => new THREE.MeshStandardMaterial({ color: '#555d66', roughness: 0.45, metalness: 0.8, map: metalTexture() }));
}
export function chrome(): Std {
  return cachedMat('mat:chrome', () => new THREE.MeshStandardMaterial({ color: '#eef3f7', roughness: 0.16, metalness: 1.0 }));
}
export function rubber(): Std {
  return cachedMat('mat:rubber', () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0.0, map: treadTexture() }));
}
export function blackRubber(): Std {
  return cachedMat('mat:blackRubber', () => new THREE.MeshStandardMaterial({ color: '#2c2c31', roughness: 0.88, metalness: 0.0 }));
}
export function leather(): Std {
  return cachedMat('mat:leather', () => new THREE.MeshStandardMaterial({ color: '#6a3a24', roughness: 0.65, metalness: 0.05, map: grungeTexture() }));
}
export function headlight(): Std {
  return cachedMat('mat:headlight', () =>
    new THREE.MeshStandardMaterial({ color: '#fff4c2', emissive: '#ffd766', emissiveIntensity: 1.1, roughness: 0.15, metalness: 0.1 }),
  );
}
export function trimMat(color: string): Std {
  return cachedMat('mat:trim:' + color, () => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.35, map: grungeTexture() }));
}
/** Shared painted metal (rims, weapon bodies). */
export function solidPaint(color: string): Std {
  return cachedMat('mat:paint:' + color, () => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2, map: grungeTexture() }));
}
/** Polished colored metal (saw disc etc.). */
export function coloredMetal(color: string): Std {
  return cachedMat('mat:cmetal:' + color, () => new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.85, map: metalTexture() }));
}
export function turboRim(color: string): Std {
  return cachedMat('mat:turboRim:' + color, () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, metalness: 0.35, map: turboRimTexture(color) }));
}
export function cream(): Std {
  return cachedMat('mat:cream', () => new THREE.MeshStandardMaterial({ color: '#f3ead6', roughness: 0.6, metalness: 0.0 }));
}
/** Additive flame (booster). */
export function flame(color: string): THREE.MeshBasicMaterial {
  return cachedMat('mat:flame:' + color, () =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
  );
}
/** Garage slot marker (unlit, always on top). */
export function marker(color: string, opacity: number): THREE.MeshBasicMaterial {
  return cachedMat(`mat:marker:${color}:${opacity}`, () =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false }),
  );
}

// ---------------------------------------------------------------------------
// Owned materials (caller disposes)
// ---------------------------------------------------------------------------

/** Chassis body paint (side walls/bevels). Emissive is set up for flashDamage. */
export function createPaintMaterial(color: string): Std {
  return new THREE.MeshStandardMaterial({
    name: 'paint:' + color,
    color,
    roughness: 0.45,
    metalness: 0.2,
    map: grungeTexture(),
    emissive: '#ff3322',
    emissiveIntensity: 0,
  });
}

/** Chassis side caps with the painted livery. Emissive is set up for flashDamage. */
export function createLiveryMaterial(def: ChassisDef, paint: string): Std {
  return new THREE.MeshStandardMaterial({
    name: `livery:${def.id}:${paint}`,
    color: '#ffffff',
    roughness: 0.45,
    metalness: 0.2,
    map: liveryTexture(def, paint),
    emissive: '#ff3322',
    emissiveIntensity: 0,
  });
}

/** Clone of a shared material with an orange emissive used for weapon "heat" glow. */
export function createHeatMaterial(base: Std): Std {
  const m = base.clone();
  m.name = base.name + ':heat';
  m.emissive = new THREE.Color('#ff5a14');
  m.emissiveIntensity = 0;
  return m;
}

// ---------------------------------------------------------------------------
// Environment (metals need reflections to read as metal)
// ---------------------------------------------------------------------------

const envCache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();

/**
 * Neutral studio reflection map (RoomEnvironment through PMREM), cached per renderer.
 * Assign to `scene.environment` (optionally with scene.environmentIntensity ≈ 0.5–0.8).
 */
export function getStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  let env = envCache.get(renderer);
  if (!env) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    env = pmrem.fromScene(room, 0.04).texture;
    room.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    pmrem.dispose();
    envCache.set(renderer, env);
  }
  return env;
}
