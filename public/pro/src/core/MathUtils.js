// Utilidades matemáticas compartidas por la simulación y el render.

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export const sign = (v) => (v < 0 ? -1 : 1);
export const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Diferencia angular más corta de a hacia b, en (-PI, PI]. */
export function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}

export function lerpAngle(a, b, t) {
  return a + angDiff(a, b) * t;
}

/** Distancia de un punto a un segmento y parámetro t de la proyección. */
export function pointSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = clamp01(t);
  const cx = ax + dx * t, cz = az + dz * t;
  return { d: Math.hypot(px - cx, pz - cz), t, x: cx, z: cz };
}

/** Generador pseudoaleatorio con semilla (mulberry32). */
export class RNG {
  constructor(seed = 1) {
    this.s = seed >>> 0 || 1;
  }
  next() {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) {
    return a + (b - a) * this.next();
  }
  int(a, b) {
    return Math.floor(this.range(a, b + 1));
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p) {
    return this.next() < p;
  }
  /** Normal estándar aproximada. */
  gauss() {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.2247;
  }
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function colorDistance(a, b) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}

export function shade(hex, f) {
  const [r, g, b] = hexToRgb(hex);
  const c = (v) => Math.round(clamp01(f >= 0 ? v + (1 - v) * f : v * (1 + f)) * 255);
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}
