import * as THREE from 'three';

/** Visual-only RNG (kept separate from the deterministic sim). */
function vfxRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function softSpriteTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.65)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

interface ParticleOpts {
  max: number;
  additive: boolean;
  texture: THREE.Texture;
}

/** Point-sprite particle pool with per-particle size/alpha/color. */
class ParticlePool {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly alpha: Float32Array;
  private readonly size: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly alpha0: Float32Array;
  private cursor = 0;
  private readonly max: number;

  constructor(opts: ParticleOpts) {
    const n = opts.max;
    this.max = n;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.alpha = new Float32Array(n);
    this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.size0 = new Float32Array(n);
    this.size1 = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.alpha0 = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: opts.texture }, scale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float alpha;
        attribute float size;
        varying float vAlpha;
        varying vec3 vColor;
        uniform float scale;
        void main() {
          vAlpha = alpha;
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          float a = t.a * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
        }`,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = opts.additive ? 20 : 10;
  }

  setScale(pxPerUnit: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = pxPerUnit;
  }

  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size0: number,
    size1: number,
    color: THREE.Color,
    alpha = 1,
    gravity = 0,
    drag = 0,
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r;
    this.col[i * 3 + 1] = color.g;
    this.col[i * 3 + 2] = color.b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = size0;
    this.size1[i] = size1;
    this.alpha0[i] = alpha;
    this.grav[i] = gravity;
    this.drag[i] = drag;
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02 && this.grav[i] > 0) {
        this.pos[i * 3 + 1] = 0.02;
        this.vel[i * 3 + 1] *= -0.35;
      }
      this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      this.alpha[i] = this.alpha0[i] * (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9);
    }
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.alpha.needsUpdate = true;
    geo.attributes.size.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
  }
}

/** Spark streaks: additive line segments stretched along velocity. */
class SparkPool {
  readonly lines: THREE.LineSegments;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly p: Float32Array;
  private readonly v: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly c: Float32Array;
  private cursor = 0;
  constructor(private readonly max: number) {
    this.pos = new Float32Array(max * 6);
    this.col = new Float32Array(max * 6);
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.c = new Float32Array(max * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.lines = new THREE.LineSegments(geo, mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 25;
  }
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: THREE.Color): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.p.set([x, y, z], i * 3);
    this.v.set([vx, vy, vz], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.c.set([color.r, color.g, color.b], i * 3);
  }
  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      const o = i * 6;
      if (this.life[i] <= 0) {
        for (let k = 0; k < 6; k++) this.col[o + k] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.v[i * 3 + 1] -= 9 * dt;
      for (let a = 0; a < 3; a++) this.p[i * 3 + a] += this.v[i * 3 + a] * dt;
      if (this.p[i * 3 + 1] < 0.01) {
        this.p[i * 3 + 1] = 0.01;
        this.v[i * 3 + 1] *= -0.4;
        this.v[i * 3] *= 0.6;
      }
      const tail = 0.022;
      this.pos[o] = this.p[i * 3];
      this.pos[o + 1] = this.p[i * 3 + 1];
      this.pos[o + 2] = this.p[i * 3 + 2];
      this.pos[o + 3] = this.p[i * 3] - this.v[i * 3] * tail;
      this.pos[o + 4] = this.p[i * 3 + 1] - this.v[i * 3 + 1] * tail;
      this.pos[o + 5] = this.p[i * 3 + 2] - this.v[i * 3 + 2] * tail;
      const b = k * 2.2;
      for (let a = 0; a < 3; a++) {
        this.col[o + a] = this.c[i * 3 + a] * b;
        this.col[o + 3 + a] = this.c[i * 3 + a] * b * 0.2;
      }
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.color.needsUpdate = true;
  }
  clear(): void {
    this.life.fill(0);
  }
}

interface Debris {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  resting: boolean;
}

interface Ejectee {
  cat: THREE.Object3D;
  chute: THREE.Group;
  vel: THREE.Vector3;
  t: number;
  landed: boolean;
}

const C = {
  spark: new THREE.Color('#ffd27a'),
  sparkHot: new THREE.Color('#fff2c0'),
  fire: new THREE.Color('#ff8a2a'),
  fireCore: new THREE.Color('#ffe08a'),
  smoke: new THREE.Color('#5d5652'),
  smokeLight: new THREE.Color('#a79c92'),
  dust: new THREE.Color('#b9a58c'),
  white: new THREE.Color('#ffffff'),
};

export class Vfx {
  readonly group = new THREE.Group();
  private readonly additive: ParticlePool;
  private readonly normal: ParticlePool;
  private readonly sparks = new SparkPool(420);
  private readonly debris: Debris[] = [];
  private readonly ejectees: Ejectee[] = [];
  private readonly flash: THREE.PointLight;
  private flashT = 0;
  private readonly rings: { mesh: THREE.Mesh; t: number; max: number }[] = [];
  private readonly ringGeo = new THREE.RingGeometry(0.8, 1, 48);
  private readonly rockets = new Map<number, THREE.Group>();
  private readonly rocketTemplate: THREE.Group;
  private readonly rng = vfxRng(1234);

  constructor() {
    const tex = softSpriteTexture();
    this.additive = new ParticlePool({ max: 900, additive: true, texture: tex });
    this.normal = new ParticlePool({ max: 900, additive: false, texture: tex });
    this.group.add(this.normal.points, this.additive.points, this.sparks.lines);
    this.flash = new THREE.PointLight('#ffb35c', 0, 9, 1.6);
    this.group.add(this.flash);
    this.rocketTemplate = buildRocketMesh();
  }

  /** Keep sprite size consistent with the viewport height (px per world unit at distance 1). */
  setViewport(heightPx: number, fovDeg: number): void {
    const s = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    this.additive.setScale(s);
    this.normal.setScale(s);
  }

  private r(a: number, b: number): number {
    return a + (b - a) * this.rng();
  }

  hitSparks(x: number, y: number, amount: number, kind: string): void {
    const n = Math.min(40, 6 + Math.round(amount * 0.8));
    const z = 0.35;
    for (let i = 0; i < n; i++) {
      const a = this.r(0, Math.PI * 2);
      const sp = this.r(2.5, 7.5);
      this.sparks.spawn(x, y, z + this.r(-0.2, 0.2), Math.cos(a) * sp, Math.sin(a) * sp + 2, this.r(-1.5, 2.5), this.r(0.25, 0.6), this.rng() < 0.3 ? C.sparkHot : C.spark);
    }
    this.additive.spawn(x, y, z + 0.1, 0, 0, 0, 0.12, 0.5 + amount * 0.02, 0.2, C.fireCore, 1);
    if (kind === 'punch' || kind === 'fork') {
      for (let i = 0; i < 8; i++) {
        this.normal.spawn(x, y, z, this.r(-1.5, 1.5), this.r(0, 1.8), this.r(-0.5, 0.5), this.r(0.4, 0.8), 0.25, 0.7, C.smokeLight, 0.7, 0, 2);
      }
      this.ring(x, y, 0.35, 0.9);
    }
  }

  dust(x: number, y: number, strength: number): void {
    for (let i = 0; i < 2; i++) {
      this.normal.spawn(x + this.r(-0.1, 0.1), y + 0.05, this.r(-0.3, 0.3), this.r(-0.6, 0.6), this.r(0.2, 0.7), this.r(-0.2, 0.2), this.r(0.5, 0.9), 0.15, 0.55 * strength + 0.2, C.dust, 0.45, 0, 1.5);
    }
  }

  flame(x: number, y: number, z: number, dirX: number, dirY: number, intensity: number): void {
    for (let i = 0; i < 2; i++) {
      const sp = this.r(2, 4) * intensity;
      this.additive.spawn(x, y, z + this.r(-0.05, 0.05), dirX * sp + this.r(-0.3, 0.3), dirY * sp + this.r(-0.3, 0.3), 0, this.r(0.12, 0.22), 0.28 * intensity, 0.05, this.rng() < 0.5 ? C.fire : C.fireCore, 0.9);
    }
    if (this.rng() < 0.3) this.normal.spawn(x, y, z, dirX * 1.2, dirY * 1.2 + 0.4, 0, 0.7, 0.15, 0.45, C.smokeLight, 0.35, 0, 1);
  }

  muzzle(x: number, y: number, a: number): void {
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    for (let i = 0; i < 10; i++) {
      this.normal.spawn(x, y, 0.3, -cx * this.r(0.5, 2) + this.r(-0.5, 0.5), -cy * this.r(0.5, 2) + this.r(0, 0.8), this.r(-0.3, 0.3), this.r(0.5, 1), 0.2, 0.7, C.smokeLight, 0.6, 0, 1.5);
    }
    this.additive.spawn(x, y, 0.3, 0, 0, 0, 0.1, 0.7, 0.3, C.fireCore, 1);
  }

  explosion(x: number, y: number, size: number): void {
    const s = size;
    for (let i = 0; i < 26 * s; i++) {
      const a = this.r(0, Math.PI * 2);
      const sp = this.r(0.5, 3.2) * s;
      this.additive.spawn(x, y, this.r(-0.3, 0.6), Math.cos(a) * sp, Math.sin(a) * sp + 1.2, this.r(-0.8, 0.8), this.r(0.25, 0.55), this.r(0.5, 0.9) * s, 0.1, this.rng() < 0.4 ? C.fireCore : C.fire, 1);
    }
    for (let i = 0; i < 12 * s; i++) {
      const a = this.r(0, Math.PI * 2);
      const sp = this.r(0.3, 1.4) * s;
      this.normal.spawn(x, y, this.r(-0.5, 0.2), Math.cos(a) * sp, Math.sin(a) * sp + 1.0, this.r(-0.3, 0.3), this.r(0.8, 1.6), this.r(0.3, 0.5) * s, this.r(0.7, 1.1) * s, this.rng() < 0.35 ? C.smoke : C.smokeLight, 0.5, -0.4, 1.4);
    }
    for (let i = 0; i < 30 * s; i++) {
      const a = this.r(0, Math.PI * 2);
      const sp = this.r(3, 10);
      this.sparks.spawn(x, y, this.r(-0.3, 0.6), Math.cos(a) * sp, Math.sin(a) * sp + 2.5, this.r(-2, 2), this.r(0.4, 1), C.spark);
    }
    this.ring(x, Math.max(0.05, y), 0.4 * s, 2.2 * s);
    this.flash.position.set(x, y + 0.4, 1.2);
    this.flash.intensity = 60 * s;
    this.flashT = 0.35;
  }

  private ring(x: number, y: number, t: number, maxScale: number): void {
    const mat = new THREE.MeshBasicMaterial({ color: '#fff0c8', transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.position.set(x, y, 0.5);
    mesh.scale.setScalar(0.1);
    this.group.add(mesh);
    this.rings.push({ mesh, t: 0, max: maxScale + t * 0 });
  }

  /** Animate part meshes flying off a destroyed car. */
  addDebris(objs: THREE.Object3D[], originX: number, originY: number): void {
    for (const obj of objs) {
      const dx = obj.position.x - originX;
      const dir = Math.sign(dx) || (this.rng() < 0.5 ? -1 : 1);
      this.debris.push({
        obj,
        vel: new THREE.Vector3(dir * this.r(1, 4.5), this.r(3.5, 7.5), this.r(-0.9, 0.5)),
        spin: new THREE.Vector3(this.r(-9, 9), this.r(-9, 9), this.r(-12, 12)),
        life: 6,
        resting: false,
      });
      if (obj.parent !== this.group) {
        const world = new THREE.Vector3();
        obj.getWorldPosition(world);
        this.group.attach(obj);
      }
    }
    void originY;
  }

  /** The cat bails out with a parachute (CATS signature). `cat` must be in world space. */
  ejectCat(cat: THREE.Object3D, dirX: number): void {
    this.group.attach(cat);
    const chute = buildParachute();
    chute.visible = false;
    this.group.add(chute);
    this.ejectees.push({ cat, chute, vel: new THREE.Vector3(dirX * 1.2, 8.5, 0.6), t: 0, landed: false });
  }

  syncRockets(list: { id: number; x: number; y: number; a: number }[], dt: number): void {
    const alive = new Set<number>();
    for (const r of list) {
      alive.add(r.id);
      let mesh = this.rockets.get(r.id);
      if (!mesh) {
        mesh = this.rocketTemplate.clone(true);
        this.rockets.set(r.id, mesh);
        this.group.add(mesh);
      }
      mesh.position.set(r.x, r.y, 0.25);
      mesh.rotation.z = r.a;
      const cx = Math.cos(r.a);
      const cy = Math.sin(r.a);
      this.flame(r.x - cx * 0.25, r.y - cy * 0.25, 0.25, -cx, -cy, 0.8);
      if (this.rng() < 0.8) this.normal.spawn(r.x - cx * 0.3, r.y - cy * 0.3, 0.25, this.r(-0.2, 0.2), this.r(0, 0.3), 0, this.r(0.6, 1.1), 0.12, 0.5, C.smokeLight, 0.5, -0.2, 1);
    }
    for (const [id, mesh] of this.rockets) {
      if (!alive.has(id)) {
        this.group.remove(mesh);
        this.rockets.delete(id);
      }
    }
    void dt;
  }

  update(dt: number): void {
    this.additive.update(dt);
    this.normal.update(dt);
    this.sparks.update(dt);
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.intensity *= Math.exp(-dt * 10);
      if (this.flashT <= 0) this.flash.intensity = 0;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / 0.35;
      r.mesh.scale.setScalar(0.1 + r.max * (1 - (1 - k) * (1 - k)));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - k);
      if (k >= 1) {
        this.group.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
      }
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      if (!d.resting) {
        d.vel.y -= 14 * dt;
        d.obj.position.addScaledVector(d.vel, dt);
        d.obj.rotation.x += d.spin.x * dt;
        d.obj.rotation.y += d.spin.y * dt;
        d.obj.rotation.z += d.spin.z * dt;
        if (d.obj.position.y < 0.12) {
          d.obj.position.y = 0.12;
          d.vel.y *= -0.35;
          d.vel.x *= 0.6;
          d.vel.z *= 0.6;
          d.spin.multiplyScalar(0.5);
          if (Math.abs(d.vel.y) < 0.6) d.resting = true;
        }
        if (this.rng() < 0.12) this.normal.spawn(d.obj.position.x, d.obj.position.y, d.obj.position.z, 0, 0.3, 0, 0.7, 0.08, 0.3, C.smokeLight, 0.35, -0.3, 1);
      }
      if (d.life < 1) d.obj.scale.multiplyScalar(Math.max(0, 1 - dt * 3));
      if (d.life <= 0) {
        this.group.remove(d.obj);
        this.debris.splice(i, 1);
      }
    }
    for (const e of this.ejectees) {
      e.t += dt;
      if (e.landed) continue;
      const open = e.t > 0.55;
      if (!open) {
        e.vel.y -= 14 * dt;
        e.cat.rotation.z += dt * 9;
      } else {
        e.chute.visible = true;
        const k = Math.min(1, (e.t - 0.55) / 0.3);
        e.chute.scale.setScalar(0.2 + 0.8 * k);
        e.vel.y += (-0.9 - e.vel.y) * Math.min(1, dt * 4);
        e.vel.x *= 1 - dt * 1.5;
        e.cat.rotation.z *= 1 - Math.min(1, dt * 6);
        const sway = Math.sin(e.t * 2.4) * 0.18;
        e.chute.rotation.z = sway;
        e.cat.rotation.x = 0;
      }
      e.cat.position.addScaledVector(e.vel, dt);
      e.chute.position.set(e.cat.position.x, e.cat.position.y + 0.55, e.cat.position.z);
      if (e.cat.position.y <= 0) {
        e.cat.position.y = 0;
        e.landed = true;
        e.chute.visible = false;
        e.cat.rotation.set(0, e.cat.rotation.y, 0);
      }
    }
  }

  clear(): void {
    this.additive.clear();
    this.normal.clear();
    this.sparks.clear();
    for (const d of this.debris) this.group.remove(d.obj);
    this.debris.length = 0;
    for (const e of this.ejectees) {
      this.group.remove(e.cat);
      this.group.remove(e.chute);
    }
    this.ejectees.length = 0;
    for (const [, mesh] of this.rockets) this.group.remove(mesh);
    this.rockets.clear();
    for (const r of this.rings) this.group.remove(r.mesh);
    this.rings.length = 0;
    this.flash.intensity = 0;
  }
}

function buildRocketMesh(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.34, 12), new THREE.MeshStandardMaterial({ color: '#e9e4da', roughness: 0.45 }));
  body.rotation.z = -Math.PI / 2;
  g.add(body);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 12), new THREE.MeshStandardMaterial({ color: '#d8342e', roughness: 0.4 }));
  tip.rotation.z = -Math.PI / 2;
  tip.position.x = 0.24;
  g.add(tip);
  const finMat = new THREE.MeshStandardMaterial({ color: '#d8342e', roughness: 0.5 });
  for (let i = 0; i < 3; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.01), finMat);
    fin.position.x = -0.13;
    fin.rotation.x = (i * Math.PI * 2) / 3;
    fin.translateY(0.07);
    g.add(fin);
  }
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}

function buildParachute(): THREE.Group {
  const g = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 16;
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? '#f4efe6' : '#e23b35';
    ctx.fillRect(i * 32, 0, 32, 16);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.62, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide }),
  );
  canopy.scale.y = 0.6;
  canopy.position.y = 0.55;
  canopy.castShadow = true;
  g.add(canopy);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    pts.push(new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(Math.cos(a) * 0.5, 0.62, Math.sin(a) * 0.5));
  }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#3b3330' })));
  return g;
}
