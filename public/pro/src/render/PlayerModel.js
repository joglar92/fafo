// Futbolistas 3D articulados dibujados con primitivas instanciadas, y su
// animación por código: carrera (sincronizada con la distancia recorrida para
// que no patinen), golpeos, entradas, saltos, estiradas, caídas y celebraciones.

import { clamp, smoothstep, hexToRgb } from '../core/MathUtils.js';
import * as M from './Mat4.js';
import { unitLimb, unitSphere, unitTorso, unitBox } from './Geo.js';

const R = M.create(), SP = M.create(), J = M.create(), K = M.create(), T = M.create(), H = M.create();

const BOOTS = [[0.08, 0.08, 0.09], [0.95, 0.95, 0.95], [0.95, 0.35, 0.1], [0.1, 0.75, 0.9], [0.9, 0.9, 0.15]];

/** Aspecto fijo de una figura (colores, estatura, celda del atlas de camisetas). */
export function makeLook(data, kit, rect, isGK, seed = 0) {
  const sleeveCol = kit.pattern === 'sleeves' ? kit.accent : kit.shirt;
  return {
    h: data.height || 1,
    sleeve: hexToRgb(sleeveCol),
    shorts: hexToRgb(kit.shorts),
    socks: hexToRgb(kit.socks),
    skin: hexToRgb(data.skin || '#e6b38c'),
    hair: hexToRgb(data.hair || '#1b1512'),
    hairStyle: data.hairStyle ?? 0,
    boots: BOOTS[(seed * 7 + (data.number || 0)) % BOOTS.length],
    gloves: isGK ? [0.96, 0.96, 0.96] : null,
    longSleeve: !!isGK,
    rect,
    flag: null,
  };
}

export class Figures {
  constructor(r, scene, atlasTex, capacity = 40) {
    this.limbGeo = r.geometry(unitLimb(10));
    this.sphereGeo = r.geometry(unitSphere(12, 8));
    this.torsoGeo = r.geometry(unitTorso(16));
    this.boxGeo = r.geometry(unitBox());
    this.limbs = r.batch(this.limbGeo, capacity * 11);
    this.spheres = r.batch(this.sphereGeo, capacity * 9);
    this.torsos = r.batch(this.torsoGeo, capacity);
    this.boxes = r.batch(this.boxGeo, capacity * 2);
    this.mat = { map: atlasTex };
    scene.add({ geo: this.limbGeo, batch: this.limbs, mat: {}, castShadow: true });
    scene.add({ geo: this.sphereGeo, batch: this.spheres, mat: {}, castShadow: true });
    this.torsoItem = scene.add({ geo: this.torsoGeo, batch: this.torsos, mat: this.mat, castShadow: true });
    scene.add({ geo: this.boxGeo, batch: this.boxes, mat: {}, castShadow: true });
  }

  begin() {
    this.limbs.reset();
    this.spheres.reset();
    this.torsos.reset();
    this.boxes.reset();
  }

  /**
   * Dibuja una figura a partir de su estado resumido.
   * x,y,z posición; facing orientación; speed, phase (ciclo de carrera);
   * state código; prog progreso o tiempo en el estado; auxRaw dato extra.
   */
  emit(look, x, y, z, facing, speed, phase, state, prog, auxRaw, time) {
    if (state < 0) return;
    auxRaw = Math.round(auxRaw);
    const shield = auxRaw >= 100;
    if (shield) auxRaw -= 100;
    const holds = Math.floor(auxRaw / 10);
    const aux = (auxRaw % 10) - 2;
    const h = look.h;
    const A = clamp(speed / 7.5, 0, 1);

    // --- Pose base: carrera / reposo ---
    const blend = Math.min(1, speed / 1.2);
    const amp = (0.28 + 0.72 * A) * blend;
    const s = Math.sin(phase), c = Math.cos(phase);
    let thL = s * 0.95 * amp, thR = -s * 0.95 * amp;
    let knL = 0.12 + 1.3 * amp * Math.max(0, c), knR = 0.12 + 1.3 * amp * Math.max(0, -c);
    let shLx = -s * 0.8 * amp, shRx = s * 0.8 * amp;
    let shLz = 0.1, shRz = 0.1;
    let elL = 0.3 + 1.1 * amp, elR = 0.3 + 1.1 * amp;
    let lean = 0.04 + 0.17 * A, pitch = 0, roll = 0, head = 0;
    let ground = true;   // apoya el pie más bajo en el suelo
    let hipOff = 0, yOff = 0;
    if (speed < 0.4) {
      // Respiración en parado
      const br = Math.sin(time * 1.8 + x * 0.7 + z);
      shLx += br * 0.03; shRx -= br * 0.03;
      lean += br * 0.006;
    }
    let card = 0, flagUp = false;

    switch (state) {
      case 1: { // golpeo
        const k = [0.55, 1.0, 0.9, 0.62][clamp(aux, 0, 3)] || 0.6;
        const pc = 0.4;
        if (prog < pc) {
          const q = prog / pc;
          thR = q < 0.6 ? -1.1 * k * Math.sin((q / 0.6) * Math.PI * 0.5) : -1.1 * k + (q - 0.6) / 0.4 * 1.45 * k;
          knR = q < 0.6 ? 1.35 * k * (q / 0.6) : 1.35 * k * (1 - (q - 0.6) / 0.4) + 0.1;
          lean = 0.12;
        } else {
          const q = (prog - pc) / (1 - pc);
          thR = q < 0.35 ? 0.35 * k + (q / 0.35) * 0.85 * k : 1.2 * k * (1 - (q - 0.35) / 0.65);
          knR = 0.1 + 0.3 * q;
          lean = -0.12 * k * (1 - q);
        }
        thL = -0.12; knL = 0.22;
        shLx = 0.7 * k; shLz = 0.55 * k; shRx = -0.6 * k; shRz = 0.35 * k;
        elL = 0.4; elR = 0.5;
        break;
      }
      case 2: // entrada
        thR = 1.05; knR = 0.05; thL = -0.55; knL = 1.05;
        lean = 0.38; shLz = 0.75; shRz = 0.75; shLx = -0.3; shRx = -0.3;
        break;
      case 3: { // entrada deslizante
        const e = smoothstep(0, 0.22, prog);
        pitch = -1.22 * e;
        ground = false;
        hipOff = -0.66 * e;
        thR = 0.28 * e; knR = 0.05; thL = 0.05; knL = 0.75 * e;
        lean = 0.35 * e;
        shLx = -0.9 * e; shRx = -0.7 * e; shLz = 0.5; shRz = 0.5; elL = 0.5; elR = 0.5;
        break;
      }
      case 4: { // en el suelo / levantándose
        ground = false;
        if (aux === 1) {
          const e = 1 - smoothstep(0.25, 1, prog);
          pitch = -1.22 * e; hipOff = -0.66 * e; lean = 0.35 * e;
          thL = 0.1; knL = 0.75 * e + 0.1; thR = 0.28 * e; knR = 0.1 + (1 - e) * 0.3;
          shLx = -0.8 * e; shRx = -0.6 * e;
        } else if (aux >= 2) {
          const e = 1 - smoothstep(0.3, 1, prog);
          roll = (aux === 2 ? 1 : -1) * 1.35 * e * this.sideSign(facing);
          hipOff = -0.52 * e;
          shLx = 2.4 * e; shRx = 2.4 * e; knL = 0.3; knR = 0.5;
        } else {
          const e = smoothstep(0, 0.15, prog) * (1 - smoothstep(0.62, 1, prog));
          pitch = 1.42 * e; hipOff = -0.72 * e;
          thL = 0.1 * e; thR = -0.2 * e; knL = 0.3 * e + 0.1; knR = 0.6 * e + 0.1;
          shLx = 1.2 * e; shRx = 0.9 * e; shLz = 0.6 * e; shRz = 0.5 * e; elL = 0.9; elR = 0.9;
          head = -0.3 * e;
        }
        break;
      }
      case 5: { // salto
        ground = false;
        const up = Math.sin(clamp(prog, 0, 1) * Math.PI);
        if (aux === 1) {
          shLx = 3.0; shRx = 3.0; elL = 0.1; elR = 0.1;
        } else {
          shLx = 0.6 + up * 0.5; shRx = 0.6 + up * 0.5; shLz = 0.55; shRz = 0.55; elL = 0.9; elR = 0.9;
          head = prog > 0.4 && prog < 0.7 ? 0.35 : -0.15;
        }
        thL = 0.3 * up; knL = 0.75 * up + 0.1; thR = -0.1 * up; knR = 0.5 * up + 0.1;
        lean = 0.08;
        break;
      }
      case 6: { // estirada del portero
        ground = false;
        const e = smoothstep(0, 0.3, prog);
        roll = aux * 1.32 * e * this.sideSign(facing);
        hipOff = -0.5 * e;
        shLx = 2.95 * e; shRx = 2.95 * e; shLz = 0.15; shRz = 0.15; elL = 0.1; elR = 0.1;
        thL = -0.15; thR = 0.2; knL = 0.3; knR = 0.45;
        lean = 0;
        break;
      }
      case 7: // portero con el balón
        shLx = 0.95; shRx = 0.95; elL = 1.25; elR = 1.25; shLz = -0.05; shRz = -0.05;
        break;
      case 8: { // saque de banda
        if (prog < 0.48) {
          shLx = 3.25; shRx = 3.25; elL = 0.7; elR = 0.7; lean = -0.22 * (prog / 0.48);
        } else {
          const q = (prog - 0.48) / 0.52;
          shLx = 3.25 - q * 1.9; shRx = shLx; elL = 0.2; elR = 0.2; lean = -0.22 + q * 0.5;
        }
        shLz = 0.12; shRz = 0.12;
        thL = 0.15; thR = -0.2; knL = 0.2; knR = 0.2;
        break;
      }
      case 9: { // celebración
        if (aux === 2) {
          const j = Math.abs(Math.sin(prog * 6.5 + x));
          yOff = j * 0.24;
          shLx = 2.8; shRx = 2.8; shLz = 0.4; shRz = 0.4; elL = 0.2; elR = 0.2;
          knL = 0.15 + (1 - j) * 0.5; knR = knL;
          ground = false;
          hipOff = -(1 - j) * 0.06;
        } else {
          shLz = 1.35; shRz = 1.35; shLx = 0.1; shRx = 0.1; elL = 0.15; elR = 0.15;
          if (aux === 1) { shLz = 1.5; shRz = 1.5; }
        }
        break;
      }
      case 10: // trastabillado
        lean = 0.38; shLz = 0.8; shRz = 0.9; shLx += 0.3;
        break;
      case 11: // gestos arbitrales
        if (aux === 1) { shRx = 1.5; elR = 0.05; }
        else if (aux === 2 || aux === 3) { shRx = 2.95; elR = 0.1; card = aux; }
        else if (aux === 4) { shLx = 1.1; elL = 2.2; shRx = 1.5; elR = 0.05; }
        else if (aux === 5) { shRx = 3.0; elR = 0.05; flagUp = true; }
        break;
      default:
        break;
    }
    if (holds === 2 && state !== 8) { shLx = 3.1; shRx = 3.1; elL = 0.6; elR = 0.6; shLz = 0.12; shRz = 0.12; }
    else if (holds === 1 && state !== 6 && state !== 4) { shLx = 0.95; shRx = 0.95; elL = 1.25; elR = 1.25; }
    if (shield) { lean = -0.04; shLz = 0.95; shRz = 0.95; knL += 0.35; knR += 0.35; }

    // --- Altura de la cadera: el pie más bajo toca el suelo ---
    const thighL = 0.44 * h, shinL = 0.465 * h;
    let hipY;
    if (ground) {
      const fl = thighL * Math.cos(thL) + shinL * Math.cos(thL - knL);
      const fr = thighL * Math.cos(thR) + shinL * Math.cos(thR - knR);
      hipY = Math.max(fl, fr) + 0.025 * h;
    } else {
      hipY = 0.93 * h + hipOff * h;
    }

    // --- Matrices ---
    M.fromTranslation(R, x, y + yOff + hipY, z);
    M.rotateY(R, R, Math.PI / 2 - facing);
    if (pitch) M.rotateX(R, R, pitch);
    if (roll) M.rotateZ(R, R, roll);
    const L = this.limbs, S = this.spheres;
    const sk = look.skin, sl = look.sleeve, sh = look.shorts, so = look.socks, bt = look.boots;

    // Pelvis
    M.translate(T, R, 0, 0.03 * h, 0);
    M.scale(T, T, 0.168 * h, 0.125 * h, 0.125 * h);
    S.push(T, sh[0], sh[1], sh[2]);

    // Tronco
    M.rotateX(SP, R, lean);
    M.translate(T, SP, 0, 0.03 * h, 0);
    M.scale(T, T, 0.2 * h, 0.52 * h, 0.122 * h);
    const rc = look.rect;
    this.torsos.push(T, 1, 1, 1, 1, rc[0], rc[1], rc[2], rc[3]);

    // Cuello y cabeza
    M.translate(T, SP, 0, 0.63 * h, 0);
    M.scale(T, T, 0.046 * h, 0.09 * h, 0.046 * h);
    L.push(T, sk[0], sk[1], sk[2]);
    M.translate(H, SP, 0, 0.715 * h, 0.012 * h);
    if (head) M.rotateX(H, H, head);
    M.scale(T, H, 0.098 * h, 0.12 * h, 0.106 * h);
    S.push(T, sk[0], sk[1], sk[2]);
    if (look.hairStyle !== 1) {
      const big = look.hairStyle === 2 ? 1.1 : 1;
      M.translate(T, H, 0, 0.032 * h, -0.016 * h);
      M.scale(T, T, 0.103 * h * big, 0.1 * h * big, 0.108 * h * big);
      S.push(T, look.hair[0], look.hair[1], look.hair[2]);
    }

    // Brazos (s = +1 izquierdo, -1 derecho)
    for (let side = 1; side >= -1; side -= 2) {
      const sx = side > 0 ? shLx : shRx, sz = side > 0 ? shLz : shRz, el = side > 0 ? elL : elR;
      M.translate(J, SP, side * 0.212 * h, 0.52 * h, 0);
      M.rotateZ(J, J, side * sz);
      M.rotateX(J, J, -sx);
      M.scale(T, J, 0.058 * h, 0.058 * h, 0.058 * h);
      S.push(T, sl[0], sl[1], sl[2]);
      M.scale(T, J, 0.047 * h, 0.27 * h, 0.047 * h);
      L.push(T, sl[0], sl[1], sl[2]);
      M.translate(K, J, 0, -0.27 * h, 0);
      M.rotateX(K, K, -el);
      M.scale(T, K, 0.04 * h, 0.25 * h, 0.04 * h);
      if (look.longSleeve) L.push(T, sl[0], sl[1], sl[2]);
      else L.push(T, sk[0], sk[1], sk[2]);
      M.translate(T, K, 0, -0.27 * h, 0);
      const g = look.gloves;
      if (g) { M.scale(T, T, 0.058 * h, 0.065 * h, 0.05 * h); S.push(T, g[0], g[1], g[2]); }
      else { M.scale(T, T, 0.04 * h, 0.046 * h, 0.036 * h); S.push(T, sk[0], sk[1], sk[2]); }
      // Tarjeta o banderín en la mano derecha
      if (side < 0 && (card || look.flag)) {
        M.translate(T, K, 0, -0.36 * h, 0);
        if (card) {
          M.scale(T, T, 0.085, 0.12, 0.01);
          if (card === 2) this.boxes.push(T, 1, 0.86, 0.1); else this.boxes.push(T, 0.9, 0.1, 0.1);
        } else {
          M.translate(T, T, 0, flagUp ? -0.22 : -0.1, 0);
          M.scale(T, T, 0.3, 0.26, 0.012);
          this.boxes.push(T, look.flag[0], look.flag[1], look.flag[2]);
        }
      }
    }

    // Piernas
    for (let side = 1; side >= -1; side -= 2) {
      const th = side > 0 ? thL : thR, kn = side > 0 ? knL : knR;
      M.translate(J, R, side * 0.093 * h, 0, 0);
      M.rotateX(J, J, -th);
      M.scale(T, J, 0.09 * h, 0.21 * h, 0.092 * h);
      L.push(T, sh[0], sh[1], sh[2]);
      M.scale(T, J, 0.073 * h, thighL, 0.075 * h);
      L.push(T, sk[0], sk[1], sk[2]);
      M.translate(K, J, 0, -thighL, 0);
      M.rotateX(K, K, kn);
      M.scale(T, K, 0.057 * h, 0.42 * h, 0.058 * h);
      L.push(T, so[0], so[1], so[2]);
      M.translate(T, K, 0, -0.425 * h, 0.05 * h);
      M.scale(T, T, 0.05 * h, 0.042 * h, 0.115 * h);
      S.push(T, bt[0], bt[1], bt[2]);
    }
  }

  /** Signo para convertir un lado del mundo (eje Z) al lado local del modelo. */
  sideSign(facing) {
    const c = Math.cos(facing);
    return c >= 0 ? 1 : -1;
  }
}
