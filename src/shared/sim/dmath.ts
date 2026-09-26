/**
 * Deterministic math: only +,-,*,/, floor and sqrt (all IEEE-exact in every JS
 * engine). Math.sin/cos/atan2 are NOT guaranteed identical across engines, so the
 * lockstep simulation must use these instead.
 */
export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

function wrapPi(x: number): number {
  // Reduce to [-PI, PI].
  const k = Math.floor((x + PI) / TAU);
  return x - k * TAU;
}

/** sin on [-PI/2, PI/2] via odd polynomial (error < 1e-9). */
function sinCore(x: number): number {
  const x2 = x * x;
  let p = 1 / 6227020800;
  p = -1 / 39916800 + x2 * p;
  p = 1 / 362880 + x2 * p;
  p = -1 / 5040 + x2 * p;
  p = 1 / 120 + x2 * p;
  p = -1 / 6 + x2 * p;
  p = 1 + x2 * p;
  return x * p;
}

export function dsin(x: number): number {
  let r = wrapPi(x);
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  return sinCore(r);
}

export function dcos(x: number): number {
  return dsin(x + HALF_PI);
}

/** atan on [-1,1] via polynomial (error < 2e-7 rad, plenty for aiming). */
function atanCore(z: number): number {
  const z2 = z * z;
  let p = -0.004054058;
  p = 0.0218612288 + z2 * p;
  p = -0.0559098861 + z2 * p;
  p = 0.0964200441 + z2 * p;
  p = -0.1390853351 + z2 * p;
  p = 0.1994653599 + z2 * p;
  p = -0.3332985605 + z2 * p;
  p = 0.9999993329 + z2 * p;
  return z * p;
}

export function datan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  let a: number;
  if (ax >= ay) {
    a = atanCore(ay / ax);
  } else {
    a = HALF_PI - atanCore(ax / ay);
  }
  if (x < 0) a = PI - a;
  if (y < 0) a = -a;
  return a;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** mulberry32 */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
