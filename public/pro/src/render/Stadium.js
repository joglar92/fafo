// Estadio 3D: césped, porterías con red, vallas, gradas de dos anfiteatros,
// público instanciado, cubiertas, banquillos, túnel, torres de luz y
// videomarcadores. Devuelve también los ajustes de iluminación de día y noche.

import { PITCH } from '../core/Config.js';
import { RNG, hexToRgb } from '../core/MathUtils.js';
import * as M from './Mat4.js';
import { MeshBuilder, crowdPerson, billboardQuad } from './Geo.js';
import { pitchTexture, netTexture, seatsTexture, adsTexture, glowTexture, drawScoreboard } from './Textures.js';

const { HL, HW, GOAL_HW, GOAL_H, GOAL_D, MARGIN_X, MARGIN_Z } = PITCH;

const BX = HL + MARGIN_X, BZ = HW + MARGIN_Z;      // vallas
const L_FRONT_Z = BZ + 2.2, L_FRONT_X = BX + 2.2;  // inicio de la grada baja
const L_ROWS = 14, L_DEPTH = 0.9, L_RISE = 0.47, L_Y0 = 1.3;
const U_ROWS = 12, U_DEPTH = 0.9, U_RISE = 0.62;
const L_BACK = L_ROWS * L_DEPTH, L_TOP = L_Y0 + L_ROWS * L_RISE;
const U_Y0 = L_TOP + 2.6;
const U_FRONT_Z = L_FRONT_Z + L_BACK - 1.5, U_FRONT_X = L_FRONT_X + L_BACK - 1.5;
const U_BACK = U_ROWS * U_DEPTH, U_TOP = U_Y0 + U_ROWS * U_RISE;
const ROOF_Y = U_TOP + 4.2;
const SEAT = 0.8;

export function environment(night) {
  const lamps = [[-83, 44, -66], [83, 44, -66], [-83, 44, 66], [83, 44, 66]];
  const lampFlat = new Float32Array(12);
  lamps.forEach((l, i) => lampFlat.set(l, i * 3));
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  if (night) {
    return {
      night: true,
      sun: norm([0.18, 1, 0.3]), sunCol: [0.62, 0.66, 0.74],
      sky: [0.2, 0.23, 0.32], ground: [0.1, 0.12, 0.14],
      fog: [0.03, 0.04, 0.08], fogD: 0.0011,
      top: [0.01, 0.015, 0.05], horizon: [0.07, 0.09, 0.17], glow: [0.25, 0.28, 0.4],
      lampFlat, lampCol: [0.2, 0.21, 0.24], lamps,
      excite: [0, 0], shadowFocus: [0, 0], shadowRange: 46,
    };
  }
  return {
    night: false,
    sun: norm([0.42, 0.78, 0.5]), sunCol: [1.0, 0.95, 0.84],
    sky: [0.5, 0.58, 0.72], ground: [0.26, 0.3, 0.24],
    fog: [0.7, 0.8, 0.92], fogD: 0.0009,
    top: [0.16, 0.38, 0.78], horizon: [0.72, 0.84, 0.96], glow: [1.0, 0.9, 0.7],
    lampFlat, lampCol: [0, 0, 0], lamps,
    excite: [0, 0], shadowFocus: [0, 0], shadowRange: 46,
  };
}

/** Marco local de cada grada: dirección a lo largo y dirección hacia atrás. */
const SIDES = {
  N: { ax: 1, az: 0, bx: 0, bz: -1 },
  S: { ax: -1, az: 0, bx: 0, bz: 1 },
  W: { ax: 0, az: -1, bx: -1, bz: 0 },
  E: { ax: 0, az: 1, bx: 1, bz: 0 },
};

export function buildStadium(r, scene, opts) {
  const { home, away, night, quality = 1 } = opts;
  const rng = new RNG(4242);
  const homeCol = home.home.shirt, homeAcc = home.home.accent;
  const out = { items: {}, near: [] };

  // ---------------------------------------------------------------- Césped
  const pb = new MeshBuilder();
  pb.color(1, 1, 1);
  pb.quad([-BX, 0, BZ], [BX, 0, BZ], [BX, 0, -BZ], [-BX, 0, -BZ], [0, 0, 1, 1]);
  const pitchTex = r.texture(pitchTexture(quality >= 1 ? 4096 : 2048), { aniso: 8 });
  scene.add({ geo: pb.build(r), mat: { map: pitchTex, spec: 0 } });

  // ------------------------------------------------- Estructura (color por vértice)
  const b = new MeshBuilder();
  const concrete = '#484c55', dark = '#24272e', steel = '#7b808a', roofTop = '#b9bec6', roofUnder = '#2c3038';
  // Suelo exterior y pista perimetral
  b.color('#1e2126');
  b.quad([-400, -0.06, 400], [400, -0.06, 400], [400, -0.06, -400], [-400, -0.06, -400]);
  b.color('#3b3f47');
  const ring = (x0, z0, x1, z1) => b.quad([x0, -0.02, z1], [x1, -0.02, z1], [x1, -0.02, z0], [x0, -0.02, z0]);
  ring(-L_FRONT_X, BZ, L_FRONT_X, L_FRONT_Z); ring(-L_FRONT_X, -L_FRONT_Z, L_FRONT_X, -BZ);
  ring(BX, -BZ, L_FRONT_X, BZ); ring(-L_FRONT_X, -BZ, -BX, BZ);

  // Porterías
  b.color('#f4f4f4');
  for (const s of [-1, 1]) {
    const gx = s * HL;
    for (const k of [-1, 1]) b.tube([gx, 0, k * GOAL_HW], [gx, GOAL_H + 0.06, k * GOAL_HW], 0.06, 10);
    b.tube([gx, GOAL_H, -GOAL_HW - 0.06], [gx, GOAL_H, GOAL_HW + 0.06], 0.06, 10);
    b.color('#c9ccd2');
    for (const k of [-1, 1]) {
      b.tube([gx, GOAL_H, k * GOAL_HW], [gx + s * GOAL_D, GOAL_H, k * GOAL_HW], 0.025, 6);
      b.tube([gx + s * GOAL_D, GOAL_H, k * GOAL_HW], [gx + s * GOAL_D, 0, k * GOAL_HW], 0.025, 6);
    }
    b.tube([gx + s * GOAL_D, GOAL_H, -GOAL_HW], [gx + s * GOAL_D, GOAL_H, GOAL_HW], 0.025, 6);
    b.color('#f4f4f4');
    // Banderines de córner
    for (const k of [-1, 1]) {
      b.color('#e8e8e8');
      b.tube([gx, 0, k * HW], [gx, 1.55, k * HW], 0.022, 6);
      b.color('#f2c230');
      b.quad([gx, 1.5, k * HW], [gx - s * 0.42, 1.36, k * HW], [gx, 1.2, k * HW], [gx, 1.2, k * HW]);
      b.quad([gx, 1.5, k * HW], [gx, 1.2, k * HW], [gx - s * 0.42, 1.36, k * HW], [gx - s * 0.42, 1.36, k * HW]);
      b.color('#f4f4f4');
    }
  }

  // Cuerpo de las vallas (la cara interior va texturizada aparte)
  b.color(dark);
  b.box(0, 0.5, -BZ - 0.12, BX * 2, 1.0, 0.24);
  b.box(0, 0.5, BZ + 0.12, BX * 2, 1.0, 0.24);
  b.box(BX + 0.12, 0.5, 0, 0.24, 1.0, BZ * 2);
  b.box(-BX - 0.12, 0.5, 0, 0.24, 1.0, BZ * 2);

  // Gradas
  const seats = new MeshBuilder();
  const nearB = new MeshBuilder();
  const nearSeats = new MeshBuilder();
  const crowd = [], crowdNear = [];
  const homeRgb = hexToRgb(homeCol), accRgb = hexToRgb(homeAcc), awayRgb = hexToRgb(opts.awayColor || away.home.shirt);
  const neutrals = [[0.9, 0.9, 0.9], [0.15, 0.16, 0.2], [0.55, 0.57, 0.62], [0.75, 0.2, 0.2], [0.2, 0.3, 0.6], [0.85, 0.78, 0.6]];
  const mat = M.create();

  const tier = (sideName, a0, a1, front, y0, rows, depth, rise, isNear, gap) => {
    const S = SIDES[sideName];
    const sb = isNear ? nearSeats : seats, cb = isNear ? nearB : b, list = isNear ? crowdNear : crowd;
    const P = (a, d, y) => [S.ax * a + S.bx * d, y, S.az * a + S.bz * d];
    const back = front + rows * depth, top = y0 + rows * rise;
    const segs = gap ? [[a0, gap[0]], [gap[1], a1]] : [[a0, a1]];
    for (const [s0, s1] of segs) {
      // Superficie inclinada con asientos
      const tint = sideName === 'N' || sideName === 'S' ? homeRgb : accRgb;
      sb.color(tint[0] * 0.75 + 0.2, tint[1] * 0.75 + 0.2, tint[2] * 0.75 + 0.2);
      sb.quad(P(s0, front, y0), P(s1, front, y0), P(s1, back, top), P(s0, back, top), [0, 0, Math.round((s1 - s0) / SEAT), rows]);
      // Muro frontal y laterales
      cb.color(concrete);
      cb.quad(P(s0, front, 0), P(s1, front, 0), P(s1, front, y0), P(s0, front, y0));
      cb.color(dark);
      cb.quad(P(s0, back, 0), P(s0, front, 0), P(s0, front, y0), P(s0, back, top));
      cb.quad(P(s1, front, 0), P(s1, back, 0), P(s1, back, top), P(s1, front, y0));
      // Público
      const yaw = Math.atan2(-S.bx, -S.bz);
      const n = Math.floor((s1 - s0) / SEAT);
      for (let row = 0; row < rows; row++) {
        for (let i = 0; i < n; i++) {
          if (!rng.chance(0.84)) continue;
          if (quality < 1 && ((i + row) & 1)) continue;
          const a = s0 + (i + 0.5) * SEAT, d = front + (row + 0.55) * depth, y = y0 + (row + 0.45) * rise;
          const p = P(a, d, y);
          // Sector visitante: una esquina del anfiteatro superior
          const awaySector = y0 > 5 && sideName === 'E' && a < -14;
          let col;
          const k = rng.next();
          if (awaySector) col = k < 0.85 ? awayRgb : neutrals[rng.int(0, 5)];
          else if (k < 0.6) col = homeRgb;
          else if (k < 0.7) col = accRgb;
          else col = neutrals[rng.int(0, 5)];
          const v = 0.78 + rng.next() * 0.35;
          const sc = 0.9 + rng.next() * 0.2;
          M.fromTranslation(mat, p[0], p[1], p[2]);
          M.rotateY(mat, mat, yaw + rng.gauss() * 0.12);
          M.scale(mat, mat, sc, sc, sc);
          list.push({ m: Float32Array.from(mat), c: [col[0] * v, col[1] * v, col[2] * v], ph: rng.next(), away: awaySector ? 1 : 0 });
        }
      }
    }
    return { back, top };
  };

  const lowerSpanX = L_FRONT_X + L_BACK, upperSpanX = U_FRONT_X + U_BACK;
  // Anfiteatro bajo (el fondo norte deja hueco para el túnel)
  tier('N', -lowerSpanX, lowerSpanX, L_FRONT_Z, L_Y0, L_ROWS, L_DEPTH, L_RISE, false, [-4.2, 4.2]);
  tier('S', -lowerSpanX, lowerSpanX, L_FRONT_Z, L_Y0, L_ROWS, L_DEPTH, L_RISE, false);
  tier('W', -L_FRONT_Z, L_FRONT_Z, L_FRONT_X, L_Y0, L_ROWS, L_DEPTH, L_RISE, false);
  tier('E', -L_FRONT_Z, L_FRONT_Z, L_FRONT_X, L_Y0, L_ROWS, L_DEPTH, L_RISE, false);
  // Anfiteatro alto
  tier('N', -upperSpanX, upperSpanX, U_FRONT_Z, U_Y0, U_ROWS, U_DEPTH, U_RISE, false);
  tier('S', -upperSpanX, upperSpanX, U_FRONT_Z, U_Y0, U_ROWS, U_DEPTH, U_RISE, true);
  tier('W', -U_FRONT_Z, U_FRONT_Z, U_FRONT_X, U_Y0, U_ROWS, U_DEPTH, U_RISE, false);
  tier('E', -U_FRONT_Z, U_FRONT_Z, U_FRONT_X, U_Y0, U_ROWS, U_DEPTH, U_RISE, false);

  // Frente del anfiteatro alto, muros traseros y cubiertas
  const shell = (sideName, half, front, isNear) => {
    const S = SIDES[sideName], cb = isNear ? nearB : b;
    const P = (a, d, y) => [S.ax * a + S.bx * d, y, S.az * a + S.bz * d];
    const back = front + U_BACK;
    cb.color(homeCol);
    cb.quad(P(-half, front, L_TOP + 1.1), P(half, front, L_TOP + 1.1), P(half, front, U_Y0), P(-half, front, U_Y0));
    cb.color('#f0f0f0');
    cb.quad(P(-half, front - 0.02, U_Y0 - 0.35), P(half, front - 0.02, U_Y0 - 0.35), P(half, front - 0.02, U_Y0 - 0.15), P(-half, front - 0.02, U_Y0 - 0.15));
    cb.color(roofUnder);
    cb.quad(P(-half, front, L_TOP + 1.1), P(-half, front + 3, L_TOP + 1.1), P(half, front + 3, L_TOP + 1.1), P(half, front, L_TOP + 1.1));
    // Muro trasero (dos caras)
    cb.color(dark);
    cb.quad(P(-half, back, 0), P(half, back, 0), P(half, back, ROOF_Y), P(-half, back, ROOF_Y));
    cb.color(concrete);
    cb.quad(P(half, back + 0.3, 0), P(-half, back + 0.3, 0), P(-half, back + 0.3, ROOF_Y), P(half, back + 0.3, ROOF_Y));
    // Cubierta en voladizo
    const rf = front - 7;
    cb.color(roofUnder);
    cb.quad(P(-half, rf, ROOF_Y - 1.8), P(-half, back + 0.3, ROOF_Y), P(half, back + 0.3, ROOF_Y), P(half, rf, ROOF_Y - 1.8));
    cb.color(roofTop);
    cb.quad(P(-half, rf, ROOF_Y - 1.5), P(half, rf, ROOF_Y - 1.5), P(half, back + 0.3, ROOF_Y + 0.3), P(-half, back + 0.3, ROOF_Y + 0.3));
    cb.color(steel);
    cb.quad(P(-half, rf, ROOF_Y - 1.8), P(half, rf, ROOF_Y - 1.8), P(half, rf, ROOF_Y - 1.5), P(-half, rf, ROOF_Y - 1.5));
    // Cerchas
    for (let a = -half + 6; a < half; a += 14) {
      cb.tube(P(a, back, ROOF_Y - 0.3), P(a, rf + 0.5, ROOF_Y - 2.0), 0.16, 5);
      cb.tube(P(a, back, U_TOP + 0.2), P(a, rf + 8, ROOF_Y - 1.9), 0.1, 5);
    }
  };
  shell('N', upperSpanX + 0.3, U_FRONT_Z, false);
  shell('S', upperSpanX + 0.3, U_FRONT_Z, true);
  shell('W', U_FRONT_Z, U_FRONT_X, false);
  shell('E', U_FRONT_Z, U_FRONT_X, false);

  // Túnel de vestuarios (fondo norte, centro)
  const tunD = ((3.25 - L_Y0) / L_RISE) * L_DEPTH; // fondo a partir del cual la grada pasa por encima
  b.color('#3a3d45');
  b.box(0, 1.625, -L_FRONT_Z - tunD / 2, 8.4, 3.25, tunD, 'f');
  b.color('#08090b');
  b.quad([-4.2, 0, -L_FRONT_Z - 0.5], [4.2, 0, -L_FRONT_Z - 0.5], [4.2, 3.25, -L_FRONT_Z - 0.5], [-4.2, 3.25, -L_FRONT_Z - 0.5]);
  b.color(concrete);
  b.quad([-4.2, 3.25, -L_FRONT_Z - tunD], [4.2, 3.25, -L_FRONT_Z - tunD], [4.2, L_TOP, -L_FRONT_Z - L_BACK], [-4.2, L_TOP, -L_FRONT_Z - L_BACK]);
  b.color(homeCol);
  b.box(0, 3.25, -L_FRONT_Z + 0.9, 9.4, 0.3, 3.2);
  b.color(steel);
  for (const k of [-1, 1]) {
    b.box(k * 4.5, 1.55, -L_FRONT_Z + 0.9, 0.2, 3.1, 3.0);
    b.tube([k * 4.4, 0, -BZ - 0.3], [k * 4.4, 1.1, -BZ - 0.3], 0.05, 6);
  }
  b.color('#d9dce2');
  b.quad([-4.1, 0.01, -BZ - 0.2], [4.1, 0.01, -BZ - 0.2], [4.1, 0.01, -L_FRONT_Z], [-4.1, 0.01, -L_FRONT_Z]);

  // Banquillos (banda norte)
  [[-15, home.home], [15, opts.awayKit || away.home]].forEach(([cx, kit]) => {
    const z0 = -HW - 4.9;
    b.color('#2c3038');
    b.box(cx, 0.15, z0, 10.4, 0.3, 2.0);
    b.color('#dfe6ee');
    b.box(cx, 1.0, z0 - 0.95, 10.4, 2.0, 0.1);
    b.box(cx - 5.2, 1.0, z0, 0.1, 2.0, 2.0);
    b.box(cx + 5.2, 1.0, z0, 0.1, 2.0, 2.0);
    b.color('#9fb7cc');
    b.quad([cx - 5.2, 2.0, z0 - 0.95], [cx - 5.2, 1.75, z0 + 1.05], [cx + 5.2, 1.75, z0 + 1.05], [cx + 5.2, 2.0, z0 - 0.95]);
    b.color('#16181d');
    b.box(cx, 0.55, z0 - 0.35, 9.6, 0.12, 0.6);
    // Suplentes sentados
    const kc = hexToRgb(kit.shirt), sk = [0.82, 0.64, 0.5];
    for (let i = 0; i < 7; i++) {
      const px = cx - 3.9 + i * 1.3;
      b.color(kc[0], kc[1], kc[2]);
      b.box(px, 0.95, z0 - 0.38, 0.46, 0.62, 0.26);
      b.color(hexToRgb(kit.shorts)[0], hexToRgb(kit.shorts)[1], hexToRgb(kit.shorts)[2]);
      b.box(px, 0.66, z0 - 0.12, 0.42, 0.16, 0.5);
      b.color(sk[0], sk[1], sk[2]);
      b.sphere(px, 1.4, z0 - 0.38, 0.11, 0.125, 0.11, 8, 6);
    }
    // Entrenador de pie en el área técnica
    b.color('#1b1d22');
    b.box(cx + 3, 0.45, z0 + 2.6, 0.34, 0.9, 0.24);
    b.color('#2f3440');
    b.box(cx + 3, 1.2, z0 + 2.6, 0.48, 0.62, 0.28);
    b.color(sk[0], sk[1], sk[2]);
    b.sphere(cx + 3, 1.66, z0 + 2.6, 0.11, 0.125, 0.11, 8, 6);
  });

  // Torres de iluminación
  const lampMesh = new MeshBuilder();
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * 83, z = sz * 66;
      const cb = sz > 0 ? nearB : b;
      cb.color(steel);
      cb.tube([x, 0, z], [x, 42, z], 0.55, 8);
      cb.color('#3a3e46');
      // Panel orientado al centro del campo
      const yaw = Math.atan2(-x, -z);
      const pm = M.create();
      M.fromTranslation(pm, x, 44, z);
      M.rotateY(pm, pm, yaw);
      M.rotateX(pm, pm, 0.35);
      cb.m = pm;
      cb.box(0, 0, 0, 11, 6, 0.6);
      cb.m = null;
      lampMesh.m = pm;
      lampMesh.color(1, 0.98, 0.9);
      for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) {
        lampMesh.quad([i * 2 - 0.75, j * 1.8 - 0.65, 0.32], [i * 2 + 0.75, j * 1.8 - 0.65, 0.32], [i * 2 + 0.75, j * 1.8 + 0.65, 0.32], [i * 2 - 0.75, j * 1.8 + 0.65, 0.32]);
      }
      lampMesh.m = null;
    }
  }

  // Soportes de los videomarcadores (sobre las cubiertas de los fondos)
  const sbGeo = new MeshBuilder();
  for (const s of [-1, 1]) {
    const x = s * (U_FRONT_X - 6.5);
    b.color('#15171c');
    b.box(x + s * 0.5, ROOF_Y + 4.6, 0, 0.8, 9.4, 27);
    b.color(steel);
    for (const k of [-1, 1]) b.tube([x + s * 0.6, ROOF_Y - 1.6, k * 9], [x + s * 0.6, ROOF_Y, k * 9], 0.3, 6);
    sbGeo.color(1, 1, 1);
    const z0 = -s * 13, z1 = s * 13;
    sbGeo.quad([x, ROOF_Y + 0.4, z0], [x, ROOF_Y + 0.4, z1], [x, ROOF_Y + 8.8, z1], [x, ROOF_Y + 8.8, z0], [0, 0, 1, 1]);
  }

  scene.add({ geo: b.build(r), mat: {}, castShadow: false });
  const seatTex = r.texture(seatsTexture(), { repeat: true, aniso: 4 });
  scene.add({ geo: seats.build(r), mat: { map: seatTex } });
  out.near.push(scene.add({ geo: nearB.build(r), mat: {} }));
  out.near.push(scene.add({ geo: nearSeats.build(r), mat: { map: seatTex } }));
  scene.add({ geo: lampMesh.build(r), mat: { unlit: true, emissive: night ? 0.6 : 0, noShadow: true } });

  // Sombra de las porterías sobre el césped: los postes sí proyectan
  const gb = new MeshBuilder();
  for (const s of [-1, 1]) {
    const gx = s * HL;
    for (const k of [-1, 1]) gb.tube([gx, 0, k * GOAL_HW], [gx, GOAL_H, k * GOAL_HW], 0.07, 6);
    gb.tube([gx, GOAL_H, -GOAL_HW], [gx, GOAL_H, GOAL_HW], 0.07, 6);
  }
  scene.add({ geo: gb.build(r), mat: { alpha: 0, blend: 'alpha' }, castShadow: true });

  // ------------------------------------------------------------ Vallas LED
  const ads = adsTexture();
  const adTex = r.texture(ads.canvas, { repeat: true, aniso: 4 });
  const ab = new MeshBuilder();
  ab.color(1, 1, 1);
  const panelW = 7;
  const rep = (len) => len / (panelW * ads.panels);
  ab.quad([-BX, 0.03, -BZ], [BX, 0.03, -BZ], [BX, 0.97, -BZ], [-BX, 0.97, -BZ], [0, 0, rep(BX * 2), 1]);
  ab.quad([BX, 0.03, BZ], [-BX, 0.03, BZ], [-BX, 0.97, BZ], [BX, 0.97, BZ], [0.3, 0, 0.3 + rep(BX * 2), 1]);
  ab.quad([BX, 0.03, -BZ], [BX, 0.03, BZ], [BX, 0.97, BZ], [BX, 0.97, -BZ], [0.5, 0, 0.5 + rep(BZ * 2), 1]);
  ab.quad([-BX, 0.03, BZ], [-BX, 0.03, -BZ], [-BX, 0.97, -BZ], [-BX, 0.97, BZ], [0.7, 0, 0.7 + rep(BZ * 2), 1]);
  scene.add({ geo: ab.build(r), mat: { map: adTex, unlit: true, emissive: night ? 0.25 : 0, noShadow: true } });

  // -------------------------------------------------------------- Marcador
  const sbCanvas = document.createElement('canvas');
  sbCanvas.width = 1024; sbCanvas.height = 384;
  drawScoreboard(sbCanvas, { home, away, score: [0, 0], clock: '00:00' });
  const sbTex = r.texture(sbCanvas, { aniso: 4 });
  scene.add({ geo: sbGeo.build(r), mat: { map: sbTex, unlit: true, emissive: night ? 0.3 : 0.05, noShadow: true } });
  out.scoreboard = { canvas: sbCanvas, tex: sbTex };

  // ---------------------------------------------------------------- Público
  const personGeo = r.geometry(crowdPerson());
  const mkCrowd = (list) => {
    const batch = r.batch(personGeo, Math.max(1, list.length), false);
    for (const p of list) batch.push(p.m, p.c[0], p.c[1], p.c[2], 1, p.ph, p.away, 0, 0);
    return scene.add({ geo: personGeo, batch, mat: { crowd: true, noShadow: true } });
  };
  out.items.crowd = mkCrowd(crowd);
  out.near.push(mkCrowd(crowdNear));
  out.crowdCount = crowd.length + crowdNear.length;

  // ------------------------------------------------------------------ Redes
  const nb = new MeshBuilder();
  nb.color(1, 1, 1);
  const cell = 0.13;
  for (const s of [-1, 1]) {
    const gx = s * HL, bx = gx + s * GOAL_D;
    const ru = (GOAL_HW * 2) / cell, rv = GOAL_H / cell, rd = GOAL_D / cell;
    nb.quad([bx, 0, -GOAL_HW], [bx, 0, GOAL_HW], [bx, GOAL_H, GOAL_HW], [bx, GOAL_H, -GOAL_HW], [0, 0, ru, rv]);
    nb.quad([gx, GOAL_H, -GOAL_HW], [gx, GOAL_H, GOAL_HW], [bx, GOAL_H, GOAL_HW], [bx, GOAL_H, -GOAL_HW], [0, 0, ru, rd]);
    for (const k of [-1, 1]) nb.quad([gx, 0, k * GOAL_HW], [bx, 0, k * GOAL_HW], [bx, GOAL_H, k * GOAL_HW], [gx, GOAL_H, k * GOAL_HW], [0, 0, rd, rv]);
  }
  const netTex = r.texture(netTexture(), { repeat: true, aniso: 4 });
  scene.add({ geo: nb.build(r), mat: { map: netTex, blend: 'alpha', doubleSided: true, noShadow: true, unlit: true, alpha: night ? 0.75 : 0.85 } });

  // ------------------------------------------------- Resplandor de los focos
  if (night) {
    const qg = r.geometry(billboardQuad());
    const glow = r.batch(qg, 8, true);
    out.glow = { batch: glow, pos: [[-83, 44, -66], [83, 44, -66], [-83, 44, 66], [83, 44, 66]] };
    scene.add({ geo: qg, batch: glow, mat: { map: r.texture(glowTexture()), blend: 'add', unlit: true, noShadow: true, doubleSided: true } });
  }
  return out;
}

/** Orienta los resplandores de los focos hacia la cámara. */
export function updateGlow(out, cam) {
  if (!out.glow) return;
  const b = out.glow.batch;
  b.reset();
  const m = M.create();
  for (const p of out.glow.pos) {
    // Matriz con los ejes de la cámara (inversa de la rotación de la vista)
    const v = cam.view;
    m[0] = v[0]; m[1] = v[4]; m[2] = v[8]; m[3] = 0;
    m[4] = v[1]; m[5] = v[5]; m[6] = v[9]; m[7] = 0;
    m[8] = v[2]; m[9] = v[6]; m[10] = v[10]; m[11] = 0;
    m[12] = p[0]; m[13] = p[1]; m[14] = p[2]; m[15] = 1;
    M.scale(m, m, 46, 46, 1);
    b.push(m, 1, 0.97, 0.88, 0.9);
  }
}
