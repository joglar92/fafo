// Construcción de geometría: un acumulador de mallas con color por vértice
// (para fundir todo el estadio en pocas llamadas) y las primitivas unitarias
// que se instancian para dibujar jugadores, público y marcadores.

import { hexToRgb } from '../core/MathUtils.js';

export class MeshBuilder {
  constructor() {
    this.v = [];
    this.i = [];
    this.n = 0;
    this.c = [1, 1, 1, 1];
    this.m = null; // transformación opcional (mat4)
  }

  color(r, g, b, a = 1) {
    if (typeof r === 'string') { const k = hexToRgb(r); this.c = [k[0], k[1], k[2], g === undefined ? 1 : g]; }
    else this.c = [r, g, b, a];
    return this;
  }

  vert(x, y, z, nx, ny, nz, u = 0, v = 0) {
    const m = this.m;
    if (m) {
      const px = m[0] * x + m[4] * y + m[8] * z + m[12];
      const py = m[1] * x + m[5] * y + m[9] * z + m[13];
      const pz = m[2] * x + m[6] * y + m[10] * z + m[14];
      const qx = m[0] * nx + m[4] * ny + m[8] * nz;
      const qy = m[1] * nx + m[5] * ny + m[9] * nz;
      const qz = m[2] * nx + m[6] * ny + m[10] * nz;
      const l = Math.hypot(qx, qy, qz) || 1;
      x = px; y = py; z = pz; nx = qx / l; ny = qy / l; nz = qz / l;
    }
    const c = this.c;
    this.v.push(x, y, z, nx, ny, nz, u, v, c[0], c[1], c[2], c[3]);
    return this.n++;
  }

  tri(a, b, c) {
    this.i.push(a, b, c);
  }

  /** Cuadrilátero a,b,c,d en sentido antihorario visto desde su cara visible. */
  quad(a, b, c, d, uv) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const t = uv || [0, 0, 1, 1];
    const i0 = this.vert(a[0], a[1], a[2], nx, ny, nz, t[0], t[1]);
    const i1 = this.vert(b[0], b[1], b[2], nx, ny, nz, t[2], t[1]);
    const i2 = this.vert(c[0], c[1], c[2], nx, ny, nz, t[2], t[3]);
    const i3 = this.vert(d[0], d[1], d[2], nx, ny, nz, t[0], t[3]);
    this.i.push(i0, i1, i2, i0, i2, i3);
    return this;
  }

  /** Caja centrada en (cx,cy,cz). skip: cadena con las caras a omitir, p. ej. 'b' (base). */
  box(cx, cy, cz, sx, sy, sz, skip = '') {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    if (!skip.includes('f')) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    if (!skip.includes('k')) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
    if (!skip.includes('r')) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
    if (!skip.includes('l')) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    if (!skip.includes('t')) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
    if (!skip.includes('b')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
    return this;
  }

  /** Cilindro vertical con base en (x,y,z). r2 = radio superior. */
  cylinder(x, y, z, r, h, seg = 10, r2 = r, caps = true) {
    const base = this.n;
    const slope = (r - r2) / h;
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const nl = Math.hypot(1, slope);
      this.vert(x + c * r, y, z + s * r, c / nl, slope / nl, s / nl, k / seg, 0);
      this.vert(x + c * r2, y + h, z + s * r2, c / nl, slope / nl, s / nl, k / seg, 1);
    }
    for (let k = 0; k < seg; k++) {
      const a = base + k * 2;
      this.i.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    if (caps) {
      const t = this.vert(x, y + h, z, 0, 1, 0, 0.5, 0.5);
      const tb = this.n;
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        this.vert(x + Math.cos(a) * r2, y + h, z + Math.sin(a) * r2, 0, 1, 0);
      }
      for (let k = 0; k < seg; k++) this.i.push(t, tb + k + 1, tb + k);
      const bt = this.vert(x, y, z, 0, -1, 0, 0.5, 0.5);
      const bb = this.n;
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        this.vert(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 0, -1, 0);
      }
      for (let k = 0; k < seg; k++) this.i.push(bt, bb + k, bb + k + 1);
    }
    return this;
  }

  /** Tubo entre dos puntos cualesquiera (postes, largueros, mástiles). */
  tube(p0, p1, r, seg = 8) {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    const ax = dx / len, ay = dy / len, az = dz / len;
    // Base ortonormal perpendicular al eje
    let ux = Math.abs(ay) < 0.9 ? 0 : 1, uy = Math.abs(ay) < 0.9 ? 1 : 0, uz = 0;
    let bx = ay * uz - az * uy, by = az * ux - ax * uz, bz = ax * uy - ay * ux;
    let l = Math.hypot(bx, by, bz) || 1;
    bx /= l; by /= l; bz /= l;
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const base = this.n;
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const nx = bx * c + cx * s, ny = by * c + cy * s, nz = bz * c + cz * s;
      this.vert(p0[0] + nx * r, p0[1] + ny * r, p0[2] + nz * r, nx, ny, nz, k / seg, 0);
      this.vert(p1[0] + nx * r, p1[1] + ny * r, p1[2] + nz * r, nx, ny, nz, k / seg, 1);
    }
    for (let k = 0; k < seg; k++) {
      const a = base + k * 2;
      this.i.push(a, a + 3, a + 1, a, a + 2, a + 3);
    }
    return this;
  }

  sphere(cx, cy, cz, rx, ry, rz, seg = 12, rings = 8) {
    const base = this.n;
    for (let j = 0; j <= rings; j++) {
      const t = (j / rings) * Math.PI;
      const st = Math.sin(t), ct = Math.cos(t);
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const nx = Math.cos(a) * st, ny = ct, nz = Math.sin(a) * st;
        this.vert(cx + nx * rx, cy + ny * ry, cz + nz * rz, nx, ny, nz, k / seg, 1 - j / rings);
      }
    }
    const w = seg + 1;
    for (let j = 0; j < rings; j++) {
      for (let k = 0; k < seg; k++) {
        const a = base + j * w + k;
        this.i.push(a, a + 1, a + w + 1, a, a + w + 1, a + w);
      }
    }
    return this;
  }

  data() {
    return { vertices: new Float32Array(this.v), indices: new Uint32Array(this.i) };
  }

  build(renderer) {
    return renderer.geometry(this.data());
  }
}

// ---------------------------------------------------------------------------
// Primitivas unitarias para instanciar
// ---------------------------------------------------------------------------

export function unitBox() {
  return new MeshBuilder().box(0, 0, 0, 1, 1, 1).data();
}

export function unitSphere(seg = 14, rings = 10) {
  return new MeshBuilder().sphere(0, 0, 0, 1, 1, 1, seg, rings).data();
}

/** Extremidad: cilindro que cuelga desde y=0 hasta y=-1, algo más fino abajo. */
export function unitLimb(seg = 10, taper = 0.8) {
  const b = new MeshBuilder();
  b.cylinder(0, -1, 0, taper, 1, seg, 1, true);
  return b.data();
}

/**
 * Torso: sección elíptica de la cintura (y=0) a los hombros (y=1).
 * La u de textura recorre el cuerpo: 0 costado izquierdo, 0.25 espalda,
 * 0.5 costado derecho, 0.75 pecho.
 */
export function unitTorso(seg = 16) {
  const b = new MeshBuilder();
  const rings = [
    [0.0, 0.8, 0.86], [0.3, 0.84, 0.9], [0.66, 1.0, 1.0], [0.9, 0.97, 0.82], [1.0, 0.7, 0.6],
  ];
  const base = b.n;
  for (let j = 0; j < rings.length; j++) {
    const [y, rx, rz] = rings[j];
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const x = Math.cos(a) * rx, z = -Math.sin(a) * rz;
      b.vert(x, y, z, Math.cos(a), 0.1, -Math.sin(a), k / seg, y);
    }
  }
  const w = seg + 1;
  for (let j = 0; j < rings.length - 1; j++) {
    for (let k = 0; k < seg; k++) {
      const a = base + j * w + k;
      b.i.push(a, a + w, a + w + 1, a, a + w + 1, a + 1);
    }
  }
  // Tapa de los hombros
  const top = b.vert(0, 1.03, 0, 0, 1, 0, 0.02, 0.99);
  const tb = base + (rings.length - 1) * w;
  for (let k = 0; k < seg; k++) b.i.push(top, tb + k + 1, tb + k);
  return b.data();
}

/** Espectador: cuerpo teñido por instancia y cabeza con color propio. */
export function crowdPerson() {
  const b = new MeshBuilder();
  b.color(1, 1, 1, 1);
  b.box(0, 0.31, 0, 0.44, 0.62, 0.26, 'bk');
  b.color(0.86, 0.68, 0.55, 0);
  b.box(0, 0.75, 0, 0.19, 0.22, 0.19, 'b');
  return b.data();
}

/** Plano horizontal 1x1 centrado (calcomanías sobre el césped). */
export function groundQuad() {
  const b = new MeshBuilder();
  b.quad([-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 0, -0.5], [-0.5, 0, -0.5], [0, 0, 1, 1]);
  return b.data();
}

/** Plano vertical 1x1 centrado (carteles orientados a cámara). */
export function billboardQuad() {
  const b = new MeshBuilder();
  b.quad([-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0], [0, 0, 1, 1]);
  return b.data();
}
