// Física del balón: vuelo, bote, rodadura, efecto y colisiones con la portería.
// También incluye los "solvers" que calculan con qué velocidad hay que golpear
// para que el balón llegue a un punto (pases, centros, vaselinas, tiros).

import { BALL, PITCH } from '../core/Config.js';

const R = BALL.R;

/**
 * Avanza el estado del balón un paso dt. Devuelve la velocidad de impacto
 * vertical si ha botado (0 si no).
 * s: { x, y, z, vx, vy, vz, spinY, lift }
 */
export function stepBall(s, dt) {
  let bounce = 0;
  if (s.y <= R + 1e-4 && s.vy === 0) {
    // Rodando sobre el césped.
    const hs = Math.hypot(s.vx, s.vz);
    if (hs > 1e-3) {
      const nh = Math.max(0, hs - (BALL.ROLL_A + BALL.ROLL_K * hs) * dt);
      const k = nh / hs;
      s.vx *= k;
      s.vz *= k;
    } else {
      s.vx = 0;
      s.vz = 0;
    }
    s.x += s.vx * dt;
    s.z += s.vz * dt;
    s.y = R;
    s.spinY *= Math.exp(-3 * dt);
    s.lift = 0;
  } else {
    const sp = Math.hypot(s.vx, s.vy, s.vz);
    const drag = BALL.DRAG * sp;
    const hs = Math.hypot(s.vx, s.vz);
    const ax = -drag * s.vx - s.vz * s.spinY * BALL.MAGNUS;
    const az = -drag * s.vz + s.vx * s.spinY * BALL.MAGNUS;
    const ay = -drag * s.vy - BALL.G + s.lift * BALL.LIFT * hs;
    s.vx += ax * dt;
    s.vy += ay * dt;
    s.vz += az * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.z += s.vz * dt;
    const d = Math.exp(-BALL.SPIN_DECAY * dt);
    s.spinY *= d;
    s.lift *= d;
    if (s.y <= R) {
      s.y = R;
      if (s.vy < 0) {
        if (s.vy > -1.3) {
          s.vy = 0;
        } else {
          bounce = -s.vy;
          s.vy = -s.vy * BALL.REST;
          s.vx *= BALL.BOUNCE_FRICTION;
          s.vz *= BALL.BOUNCE_FRICTION;
          s.spinY *= 0.5;
          s.lift *= 0.3;
        }
      }
    }
  }
  return bounce;
}

/**
 * Colisión con postes, larguero y red. b necesita además b.inNet (0, -1 o +1).
 * Devuelve 0 (nada), 1 (poste), 2 (larguero) o 3 (red).
 */
export function collideGoal(b, px, py, pz) {
  let ev = 0;
  const { HL, GOAL_HW, GOAL_H, GOAL_D, POST_R } = PITCH;
  const s = b.x >= 0 ? 1 : -1;
  const gx = s * HL;
  if (Math.abs(b.x - gx) > 4 || Math.abs(b.z) > GOAL_HW + 3) return 0;
  const min = R + POST_R;

  // Postes
  if (b.y < GOAL_H + POST_R) {
    for (let k = -1; k <= 1; k += 2) {
      const dx = b.x - gx, dz = b.z - k * GOAL_HW;
      const d = Math.hypot(dx, dz);
      if (d < min && d > 1e-6) {
        const nx = dx / d, nz = dz / d;
        const vn = b.vx * nx + b.vz * nz;
        if (vn < 0) {
          b.vx -= 1.65 * vn * nx;
          b.vz -= 1.65 * vn * nz;
          b.hit = -vn;
          ev = 1;
        }
        b.x = gx + nx * min;
        b.z = k * GOAL_HW + nz * min;
      }
    }
  }
  // Larguero
  if (Math.abs(b.z) < GOAL_HW + POST_R) {
    const dx = b.x - gx, dy = b.y - GOAL_H;
    const d = Math.hypot(dx, dy);
    if (d < min && d > 1e-6) {
      const nx = dx / d, ny = dy / d;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        b.vx -= 1.65 * vn * nx;
        b.vy -= 1.65 * vn * ny;
        b.hit = -vn;
        ev = 2;
      }
      b.x = gx + nx * min;
      b.y = GOAL_H + ny * min;
    }
  }

  // Red
  const depth = s * (b.x - gx);
  const pdepth = s * (px - gx);
  if (b.inNet === s) {
    if (depth > GOAL_D - R) {
      b.x = gx + s * (GOAL_D - R);
      if (s * b.vx > 0) {
        b.hit = Math.abs(b.vx);
        b.vx *= -0.08; b.vy *= 0.4; b.vz *= 0.3;
        ev = 3;
      }
    }
    if (Math.abs(b.z) > GOAL_HW - R) {
      const k = b.z > 0 ? 1 : -1;
      b.z = k * (GOAL_HW - R);
      if (b.vz * k > 0) {
        b.hit = Math.abs(b.vz);
        b.vz *= -0.08; b.vx *= 0.3;
        ev = 3;
      }
    }
    if (b.y > GOAL_H - R) {
      b.y = GOAL_H - R;
      if (b.vy > 0) {
        b.hit = Math.abs(b.vy);
        b.vy *= -0.08;
        ev = 3;
      }
    }
    if (depth < -0.4) b.inNet = 0;
  } else if (depth > 0 && depth < GOAL_D && Math.abs(b.z) < GOAL_HW && b.y < GOAL_H) {
    if (pdepth <= 0) {
      b.inNet = s; // ha entrado por la boca de la portería
    } else if (Math.abs(pz) >= GOAL_HW) {
      // Lateral de la red por fuera
      const k = pz > 0 ? 1 : -1;
      b.z = k * (GOAL_HW + R);
      b.vz = -b.vz * 0.2;
      b.vx *= 0.5;
      ev = 3;
    } else if (py >= GOAL_H) {
      b.y = GOAL_H + R;
      b.vy = Math.abs(b.vy) * 0.2;
      b.vx *= 0.6; b.vz *= 0.6;
      ev = 3;
    } else {
      b.x = gx + s * (GOAL_D + R);
      b.vx = -b.vx * 0.2;
      ev = 3;
    }
  }
  return ev;
}

// ---------------------------------------------------------------------------
// Rodadura: fórmulas cerradas (dv/dt = -(A + K v)).
// ---------------------------------------------------------------------------
const A = BALL.ROLL_A, K = BALL.ROLL_K, C = A / K;

function rollDistAt(v0, t) {
  const tStop = Math.log((v0 + C) / C) / K;
  const tt = Math.min(t, tStop);
  return ((v0 + C) * (1 - Math.exp(-K * tt))) / K - C * tt;
}

/** Velocidad inicial para recorrer d metros y llegar con velocidad vEnd. */
export function rollSpeedFor(d, vEnd = 3) {
  let lo = vEnd, hi = 45;
  for (let i = 0; i < 22; i++) {
    const v0 = (lo + hi) / 2;
    const te = Math.log((v0 + C) / (vEnd + C)) / K;
    if (rollDistAt(v0, te) < d) lo = v0;
    else hi = v0;
  }
  return hi;
}

/** Velocidad inicial para recorrer d metros en un tiempo t. */
export function rollSpeedForTime(d, t) {
  let lo = 0, hi = 45;
  for (let i = 0; i < 22; i++) {
    const v0 = (lo + hi) / 2;
    if (rollDistAt(v0, t) < d) lo = v0;
    else hi = v0;
  }
  return hi;
}

/** Tiempo que tarda un balón raso lanzado a v0 en recorrer d (Infinity si no llega). */
export function rollTime(v0, d) {
  const tStop = Math.log((v0 + C) / C) / K;
  if (rollDistAt(v0, tStop) < d) return Infinity;
  let lo = 0, hi = tStop;
  for (let i = 0; i < 22; i++) {
    const t = (lo + hi) / 2;
    if (rollDistAt(v0, t) < d) lo = t;
    else hi = t;
  }
  return hi;
}

// ---------------------------------------------------------------------------
// Vuelo: simulación numérica en un sistema local (avance, altura, desvío).
// ---------------------------------------------------------------------------
const tmp = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spinY: 0, lift: 0 };

/** Simula un golpeo y devuelve dónde cae (o dónde baja hasta hEnd). */
function flight(speed, angle, spinY, lift, h0, hEnd) {
  const s = tmp;
  s.x = 0; s.y = h0; s.z = 0;
  s.vx = speed * Math.cos(angle); s.vy = speed * Math.sin(angle); s.vz = 0;
  s.spinY = spinY; s.lift = lift;
  const dt = 1 / 90;
  let t = 0;
  for (let i = 0; i < 700; i++) {
    const py = s.y;
    stepBall(s, dt);
    t += dt;
    if ((s.vy <= 0 && s.y <= hEnd && py >= s.y) || s.y <= R + 1e-3) break;
  }
  return { range: s.x, lateral: s.z, time: t };
}

/**
 * Calcula el vector velocidad para enviar el balón por el aire desde (fx,fz)
 * hasta (tx,tz) con un ángulo de salida dado. Compensa el efecto lateral.
 */
export function aimVelocity(fx, fz, tx, tz, angle, spinY = 0, lift = 0, h0 = R, hEnd = R) {
  const d = Math.hypot(tx - fx, tz - fz);
  let lo = 3, hi = 46, res = null;
  for (let i = 0; i < 18; i++) {
    const v = (lo + hi) / 2;
    res = flight(v, angle, spinY, lift, h0, hEnd);
    if (Math.hypot(res.range, res.lateral) < d) lo = v;
    else hi = v;
  }
  const speed = (lo + hi) / 2;
  res = flight(speed, angle, spinY, lift, h0, hEnd);
  const yaw = Math.atan2(tz - fz, tx - fx) - Math.atan2(res.lateral, res.range);
  const ch = Math.cos(angle) * speed;
  return {
    vx: Math.cos(yaw) * ch, vy: Math.sin(angle) * speed, vz: Math.sin(yaw) * ch,
    speed, time: res.time, yaw,
  };
}

/** Altura y desvío lateral del balón al recorrer una distancia horizontal D. */
function heightAt(speed, elev, spinY, h0, D) {
  const s = tmp;
  s.x = 0; s.y = h0; s.z = 0;
  s.vx = speed * Math.cos(elev); s.vy = speed * Math.sin(elev); s.vz = 0;
  s.spinY = spinY; s.lift = 0;
  if (s.y <= R && s.vy <= 0) { s.y = R; s.vy = 0; }
  const dt = 1 / 90;
  let t = 0;
  for (let i = 0; i < 400; i++) {
    stepBall(s, dt);
    t += dt;
    if (s.x >= D) return { y: s.y, lateral: s.z, time: t, reached: true };
    if (Math.abs(s.vx) < 0.3) break;
  }
  return { y: s.y, lateral: s.z, time: t, reached: false };
}

/**
 * Tiro a puerta: dada la velocidad, busca la elevación que hace pasar el balón
 * a la altura targetY tras recorrer D metros.
 */
export function solveShot(D, speed, targetY, spinY = 0, h0 = R) {
  let lo = -0.12, hi = 0.75, r = null;
  for (let i = 0; i < 16; i++) {
    const e = (lo + hi) / 2;
    r = heightAt(speed, e, spinY, h0, D);
    if (!r.reached || r.y < targetY) lo = e;
    else hi = e;
  }
  const elev = (lo + hi) / 2;
  r = heightAt(speed, elev, spinY, h0, D);
  return { elev, yawFix: -Math.atan2(r.lateral, D), time: r.time };
}

/**
 * Predice por dónde cruzará el balón la línea de fondo x = gx.
 * Devuelve { z, y, t } o null si no llega en maxT segundos.
 */
export function predictGoalCross(b, gx, maxT = 3) {
  const s = { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, spinY: b.spinY, lift: b.lift };
  const sg = gx > 0 ? 1 : -1;
  if (sg * s.vx <= 0.5) return null;
  const dt = 1 / 120;
  for (let t = 0; t < maxT; t += dt) {
    const px = s.x, py = s.y, pz = s.z;
    stepBall(s, dt);
    if (sg * (s.x - gx) >= 0) {
      const k = (gx - px) / (s.x - px || 1e-9);
      return { z: pz + (s.z - pz) * k, y: py + (s.y - py) * k, t: t + dt * k };
    }
    if (Math.hypot(s.vx, s.vz) < 0.2) return null;
  }
  return null;
}
