// Acciones con balón y defensivas. Las usan por igual la IA y el usuario,
// de modo que todas las mecánicas pasan por la misma física y las mismas reglas.

import { clamp, angDiff, dist, pointSeg, lerp } from '../core/MathUtils.js';
import { PITCH, BALL } from '../core/Config.js';
import { rollSpeedFor, rollSpeedForTime, aimVelocity, solveShot } from './Physics.js';

const { HL, HW, GOAL_HW } = PITCH;

// ---------------------------------------------------------------------------
// Utilidades de lectura del juego
// ---------------------------------------------------------------------------

/** Presión rival sobre un jugador (0 = libre, >1 = encimado por varios). */
export function pressure(match, p) {
  let s = 0;
  const opp = p.team.opponent.players;
  for (let i = 0; i < opp.length; i++) {
    const o = opp[i];
    const d = Math.hypot(o.x - p.x, o.z - p.z);
    if (d < 3.2) s += 1 - d / 3.2;
  }
  return Math.min(1.6, s);
}

export function nearestOpponentDist(team, x, z) {
  let m = 99;
  const opp = team.opponent.players;
  for (let i = 0; i < opp.length; i++) {
    const d = Math.hypot(opp[i].x - x, opp[i].z - z);
    if (d < m) m = d;
  }
  return m;
}

/**
 * Riesgo (0..1) de que un rival intercepte un balón raso de (ax,az) a (bx,bz).
 */
export function laneRisk(team, ax, az, bx, bz, ballSpeed = 15) {
  let risk = 0;
  const opp = team.opponent.players;
  const len = Math.hypot(bx - ax, bz - az);
  for (let i = 0; i < opp.length; i++) {
    const o = opp[i];
    if (o.state === 'down' || o.state === 'slide') continue;
    const r = pointSeg(o.x, o.z, ax, az, bx, bz);
    const along = r.t * len;
    if (along < 1.2 && r.d > 1.2) continue;
    const tb = along / ballSpeed;
    const to = Math.max(0, r.d - 0.9) / (o.topSpeed() * 0.85) + 0.18;
    const margin = to - tb;
    const k = margin < 0 ? 1 : margin < 0.35 ? 1 - margin / 0.35 : 0;
    if (k > risk) risk = k;
  }
  return risk;
}

/** Calidad de una ocasión de tiro desde la posición del jugador. */
export function shotQuality(match, p) {
  const dir = p.team.dir, gx = HL * dir;
  const dx = Math.abs(gx - p.x);
  const d = Math.hypot(gx - p.x, p.z);
  const open = Math.abs(Math.atan2(GOAL_HW - p.z, dx) - Math.atan2(-GOAL_HW - p.z, dx));
  let blockers = 0;
  const opp = p.team.opponent.players;
  for (let i = 0; i < opp.length; i++) {
    const o = opp[i];
    if (o.isGK) continue;
    const r = pointSeg(o.x, o.z, p.x, p.z, gx, 0);
    if (r.d < 1.0 && r.t > 0.03 && r.t < 0.95) blockers++;
  }
  let xg = clamp(open / 1.1, 0, 1) * Math.exp(-d / 17) * 1.6;
  xg *= Math.pow(0.55, blockers) * (0.7 + p.a.tiro / 330);
  return { xg: clamp(xg, 0, 0.95), d, open, blockers };
}

/** Penalización por orientación del cuerpo y equilibrio al golpear. */
function kickPenalty(p, ang) {
  const off = Math.abs(angDiff(p.facing, ang));
  const body = off < 0.6 ? 0 : (off - 0.6) / 2.5;
  const bal = Math.max(0, p.speed - 5.5) / 6;
  return { err: 1 + body * 1.2 + bal * 0.5, pow: 1 - body * 0.3 };
}

function canPlayBall(match, p) {
  const b = match.ball;
  if (b.owner === p) return true;
  if (b.owner) return false;
  return Math.hypot(b.x - p.x, b.z - p.z) < 1.35 && b.y < 1.1;
}

// ---------------------------------------------------------------------------
// Golpeo genérico
// ---------------------------------------------------------------------------

/** Suelta el balón con la velocidad indicada. Devuelve false si ya no puede. */
export function release(match, p, vx, vy, vz, spinY, lift, meta) {
  const b = match.ball;
  if (b.owner && b.owner !== p) return false;
  if (!b.owner && (Math.hypot(b.x - p.x, b.z - p.z) > 1.7 || b.y > 1.4)) return false;
  b.owner = null;
  b.held = false;
  b.frozen = false;
  p.holdHigh = false;
  p.shielding = false;
  if (b.y < BALL.R) b.y = BALL.R;
  b.vx = vx; b.vy = vy; b.vz = vz;
  b.spinY = spinY || 0;
  b.lift = lift || 0;
  b.inNet = 0;
  b.lastKicker = p;
  b.lastTouch = p;
  b.kickTime = match.clock;
  b.kickType = meta.type;
  b.passTarget = meta.target || null;
  b.shot = meta.shot || null;
  b.kickId++;
  b.predTick = -1;
  p.cooldownControl = 0.35;
  match.rules.onKick(p, meta);
  match.emit('kick', { player: p, type: meta.type, speed: Math.hypot(vx, vy, vz) });
  return true;
}

function startKick(p, anim, windup, total, angle, fn) {
  p.setState('kick', total, anim);
  p.kickAngle = angle;
  p.pending = { at: windup, fn };
}

function rotate(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  const x = v.vx * c - v.vz * s, z = v.vx * s + v.vz * c;
  v.vx = x; v.vz = z;
}

// ---------------------------------------------------------------------------
// Selección de destinatario
// ---------------------------------------------------------------------------

export function findPassTarget(match, p, dirx, dirz, power, opts = {}) {
  const hasDir = dirx !== 0 || dirz !== 0;
  if (!hasDir) { dirx = p.dirX; dirz = p.dirZ; }
  const maxAng = opts.maxAng ?? (hasDir ? 1.05 : 1.7);
  const pref = opts.pref ?? 7 + power * 30;
  const min = opts.min ?? 2.5, max = opts.max ?? 48;
  const a0 = Math.atan2(dirz, dirx);
  let best = null, bs = 1e9;
  const mates = p.team.players;
  for (let i = 0; i < mates.length; i++) {
    const t = mates[i];
    if (t === p) continue;
    const dx = t.x - p.x, dz = t.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < min || d > max) continue;
    const ang = Math.abs(angDiff(a0, Math.atan2(dz, dx)));
    if (ang > maxAng) continue;
    let s = ang * 1.4 + Math.abs(d - pref) / 38;
    if (t.isGK) s += 0.3;
    // Asistencia: entre dos opciones parecidas, mejor la que tiene la línea limpia
    if (opts.lanes !== false) s += laneRisk(p.team, p.x, p.z, t.x, t.z, 16) * 0.4;
    if (s < bs) { bs = s; best = t; }
  }
  return best;
}

/** Evalúa un pase al hueco hacia el compañero t. */
export function throughPlan(match, p, t, power = 0.5) {
  const dir = p.team.dir;
  const sp = t.speed;
  let rx = dir, rz = 0;
  if (sp > 1.5) {
    rx = (t.vx / sp) * 0.6 + dir * 0.4;
    rz = (t.vz / sp) * 0.6;
    const l = Math.hypot(rx, rz) || 1;
    rx /= l; rz /= l;
  }
  const lead = 5 + power * 12 + sp * 0.9;
  let x = t.x + rx * lead, z = t.z + rz * lead;
  x = dir > 0 ? Math.min(x, HL - 4) : Math.max(x, -HL + 4);
  z = clamp(z, -HW + 2.5, HW - 2.5);
  const D = Math.hypot(x - p.x, z - p.z);
  if (D < 6 || D > 52) return null;
  if ((x - p.x) * dir < -4) return null;
  const tm = Math.hypot(x - t.x, z - t.z) / (t.topSpeed() * 0.9) + 0.2;
  let td = 9;
  const opp = p.team.opponent.players;
  for (let i = 0; i < opp.length; i++) {
    const o = opp[i];
    const k = Math.hypot(x - o.x, z - o.z) / (o.topSpeed() * 0.9) + (o.isGK ? 0.25 : 0);
    if (k < td) td = k;
  }
  return { t, x, z, time: tm, adv: td - tm, D };
}

export function findThroughTarget(match, p, dirx, dirz, power) {
  const hasDir = dirx !== 0 || dirz !== 0;
  if (!hasDir) { dirx = p.dirX; dirz = p.dirZ; }
  const a0 = Math.atan2(dirz, dirx);
  const dir = p.team.dir;
  let best = null, bs = 1e9;
  for (const t of p.team.players) {
    if (t === p || t.isGK) continue;
    const plan = throughPlan(match, p, t, power);
    if (!plan) continue;
    const ang = Math.abs(angDiff(a0, Math.atan2(plan.z - p.z, plan.x - p.x)));
    if (ang > 0.95) continue;
    const s = ang * 1.3 - clamp(plan.adv, -1, 1.5) * 0.5 - ((plan.x - p.x) * dir) / 60;
    if (s < bs) { bs = s; best = plan; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Pases
// ---------------------------------------------------------------------------

function passSigma(match, p, ang, base, first) {
  const pen = kickPenalty(p, ang);
  const s = base * (1.7 - (p.a.pase / 100) * 1.3) * (1 + pressure(match, p) * 0.5) * pen.err *
    p.team.profile.passError * (first ? 1.4 : 1) * (1 + p.fatigue * 0.25);
  return { sigma: s, pow: pen.pow };
}

/** Pase raso. o: { dirx, dirz, power, target } */
export function pass(match, p, o = {}) {
  if (!canPlayBall(match, p)) return false;
  const b = match.ball, rng = match.rng;
  const power = o.power ?? 0.3;
  const first = b.owner !== p;
  let dirx = o.dirx || 0, dirz = o.dirz || 0;
  // Si no hay nadie en la dirección marcada se amplía el abanico antes de pasar al vacío
  const t = o.target || findPassTarget(match, p, dirx, dirz, power, o.opts)
    || ((dirx || dirz) ? findPassTarget(match, p, dirx, dirz, power, { maxAng: 2.2 }) : null);
  let tx, tz, speed;
  if (t) {
    const d0 = Math.hypot(t.x - b.x, t.z - b.z);
    const lead = Math.min(0.6, d0 / 22);
    tx = t.x + t.vx * lead;
    tz = t.z + t.vz * lead;
    const d = Math.hypot(tx - b.x, tz - b.z);
    speed = clamp(rollSpeedFor(d, 4.5) * (0.96 + power * 0.22), 7, 27);
  } else {
    if (!dirx && !dirz) { dirx = p.dirX; dirz = p.dirZ; }
    tx = b.x + dirx * 20;
    tz = b.z + dirz * 20;
    speed = 10 + power * 14;
  }
  let ang = Math.atan2(tz - b.z, tx - b.x);
  const e = passSigma(match, p, ang, 0.034, first);
  ang += rng.gauss() * e.sigma;
  speed *= Math.max(0.94, e.pow) * (1 + rng.gauss() * 0.035);
  startKick(p, 0, first ? 0.06 : 0.11, 0.3, ang, () => {
    if (release(match, p, Math.cos(ang) * speed, 0, Math.sin(ang) * speed, 0, 0, { type: 'pass', target: t })) {
      p.team.stats.passes++;
    }
  });
  return true;
}

/** Pase al hueco: el balón va al espacio que ataca el compañero. */
export function throughPass(match, p, o = {}) {
  if (!canPlayBall(match, p)) return false;
  const b = match.ball, rng = match.rng;
  const power = o.power ?? 0.5;
  const plan = o.plan || findThroughTarget(match, p, o.dirx || 0, o.dirz || 0, power);
  if (!plan) return pass(match, p, o);
  const first = b.owner !== p;
  const D = Math.hypot(plan.x - b.x, plan.z - b.z);
  let ang = Math.atan2(plan.z - b.z, plan.x - b.x);
  const e = passSigma(match, p, ang, 0.036, first);
  const blocked = D > 17 && laneRisk(p.team, b.x, b.z, lerp(b.x, plan.x, 0.6), lerp(b.z, plan.z, 0.6), 18) > 0.6;
  let v;
  if (blocked) {
    // Por arriba: balón picado a la espalda de la defensa.
    v = aimVelocity(b.x, b.z, plan.x, plan.z, 0.45, 0, 0.2, b.y);
    rotate(v, rng.gauss() * e.sigma);
  } else {
    const speed = clamp(Math.max(rollSpeedForTime(D, plan.time), rollSpeedFor(D, 2.5)), 8, 26) * Math.max(0.94, e.pow);
    ang += rng.gauss() * e.sigma;
    v = { vx: Math.cos(ang) * speed, vy: 0, vz: Math.sin(ang) * speed };
  }
  startKick(p, blocked ? 2 : 0, first ? 0.06 : 0.12, 0.32, ang, () => {
    if (release(match, p, v.vx, v.vy, v.vz, 0, blocked ? 0.2 : 0, { type: 'through', target: plan.t })) {
      p.team.stats.passes++;
      plan.t.ai.runTo = { x: plan.x, z: plan.z, until: match.clock + plan.time + 1.6 };
    }
  });
  return true;
}

/** Pase elevado (cambio de juego, balón largo). */
export function lob(match, p, o = {}) {
  if (!canPlayBall(match, p)) return false;
  const b = match.ball, rng = match.rng;
  const power = o.power ?? 0.5;
  const first = b.owner !== p;
  let dirx = o.dirx || 0, dirz = o.dirz || 0;
  const t = o.target || findPassTarget(match, p, dirx, dirz, power, { pref: 20 + power * 32, min: 9, max: 68 });
  let v, ang;
  if (t) {
    const d0 = Math.hypot(t.x - b.x, t.z - b.z);
    const ft = d0 / 17;
    const tx = clamp(t.x + t.vx * ft * 0.7, -HL + 2, HL - 2), tz = clamp(t.z + t.vz * ft * 0.7, -HW + 2, HW - 2);
    v = aimVelocity(b.x, b.z, tx, tz, d0 < 22 ? 0.62 : 0.5, 0, 0.12, b.y);
    ang = v.yaw;
  } else {
    if (!dirx && !dirz) { dirx = p.dirX; dirz = p.dirZ; }
    ang = Math.atan2(dirz, dirx);
    const sp = 15 + power * 14;
    v = { vx: Math.cos(ang) * sp * 0.85, vy: sp * 0.52, vz: Math.sin(ang) * sp * 0.85 };
  }
  const e = passSigma(match, p, ang, 0.042, first);
  rotate(v, rng.gauss() * e.sigma);
  const k = e.pow * (1 + rng.gauss() * 0.035);
  v.vx *= k; v.vy *= k; v.vz *= k;
  startKick(p, 2, first ? 0.08 : 0.15, 0.36, ang, () => {
    if (release(match, p, v.vx, v.vy, v.vz, 0, 0.12, { type: 'lob', target: t })) p.team.stats.passes++;
  });
  return true;
}

/** Centro al área: primer palo, punto de penalti o segundo palo. */
export function cross(match, p, o = {}) {
  if (!canPlayBall(match, p)) return false;
  const b = match.ball, rng = match.rng;
  const power = o.power ?? 0.5;
  const dir = p.team.dir;
  const first = b.owner !== p;
  const side = b.z * dir >= 0 ? 1 : -1;
  const zone = o.zone || (power < 0.34 ? 'near' : power < 0.67 ? 'spot' : 'far');
  let tu, tv, angle;
  if (zone === 'near') { tu = HL - 6; tv = side * 3.4; angle = 0.4; }
  else if (zone === 'far') { tu = HL - 6.5; tv = -side * 4.8; angle = 0.56; }
  else { tu = HL - 11; tv = -side * 0.3; angle = 0.5; }
  let tx = tu * dir, tz = tv * dir;
  // Si hay un compañero atacando esa zona, se le busca a él.
  let mate = null, md = 9;
  for (const t of p.team.players) {
    if (t === p || t.isGK) continue;
    const d = Math.hypot(t.x - tx, t.z - tz);
    if (d < md) { md = d; mate = t; }
  }
  if (mate) {
    tx = lerp(tx, mate.x + mate.vx * 0.7, 0.6);
    tz = lerp(tz, mate.z + mate.vz * 0.7, 0.6);
  }
  const curl = o.curl !== undefined ? o.curl : -side * 0.38;
  const v = aimVelocity(b.x, b.z, tx, tz, angle, curl, 0.05, b.y, 1.75);
  const e = passSigma(match, p, v.yaw, 0.046, first);
  rotate(v, rng.gauss() * e.sigma);
  const k = e.pow * (1 + rng.gauss() * 0.04);
  v.vx *= k; v.vy *= k; v.vz *= k;
  startKick(p, 2, first ? 0.08 : 0.16, 0.38, v.yaw, () => {
    if (release(match, p, v.vx, v.vy, v.vz, curl, 0.05, { type: 'cross', target: mate })) p.team.stats.passes++;
  });
  return true;
}

// ---------------------------------------------------------------------------
// Tiros
// ---------------------------------------------------------------------------

export const SHOT_NAMES = { low: 'RASO', mid: 'MEDIA ALTURA', high: 'ALTO', finesse: 'COLOCADO', power: 'POTENTE', chip: 'VASELINA' };

export function shotKind(power, finesse) {
  if (finesse) return 'finesse';
  if (power < 0.3) return 'low';
  if (power < 0.62) return 'mid';
  if (power < 0.85) return 'high';
  return 'power';
}

/** Disparo. o: { dirz, power, finesse, aimZ, aimY } */
export function shoot(match, p, o = {}) {
  if (!canPlayBall(match, p)) return false;
  const b = match.ball, rng = match.rng;
  const dir = p.team.dir, gx = HL * dir;
  const power = clamp(o.power ?? 0.5, 0, 1);
  const first = b.owner !== p;
  const gk = p.team.opponent.gk;
  const finesse = !!o.finesse;
  let zT;
  if (o.aimZ !== undefined) zT = o.aimZ;
  else if (Math.abs(o.dirz || 0) > 0.35) zT = Math.sign(o.dirz) * 2.95;
  else {
    // Sin dirección marcada: al lado más abierto, sin ajustar siempre al palo
    const spread = p.team.isUser ? 2.5 : 1.3 + rng.next() * 1.8;
    if (gk && Math.abs(gk.z) > 0.35) zT = (gk.z > 0 ? -1 : 1) * spread;
    else zT = (Math.abs(b.z) > 1 ? -Math.sign(b.z) : rng.chance(0.5) ? 1 : -1) * spread;
  }
  if (finesse) zT = clamp(zT * 1.15, -3.3, 3.3);
  const D = Math.hypot(gx - b.x, zT - b.z);
  let ang = Math.atan2(zT - b.z, gx - b.x);
  const pen = kickPenalty(p, ang);
  let speed = (15 + 14 * power) * (0.8 + (0.28 * p.a.tiro) / 100) * pen.pow;
  let yT;
  if (o.aimY !== undefined) yT = o.aimY;
  else if (finesse) yT = 0.4 + power * 1.6;
  else if (power < 0.3) yT = 0.15;
  else if (power < 0.65) yT = 0.3 + ((power - 0.3) / 0.35) * 1.2;
  else yT = 1.5 + ((power - 0.65) / 0.35) * 1.25;
  let spin = rng.gauss() * 0.06;
  if (finesse) {
    speed *= 0.8;
    spin = -Math.sign(zT || 1) * dir * 0.5;
  } else if (o.curl) spin = o.curl;
  const sol = solveShot(D, speed, yT, spin, b.y);
  let sigma = 0.064 * (1.75 - (1.25 * p.a.tiro) / 100) * (1 + pressure(match, p) * 0.6) * pen.err *
    (1 + Math.max(0, power - 0.82) * 3) * p.team.profile.shotError * (first ? 1.35 : 1) * (finesse ? 0.8 : 1);
  if (o.sigmaMul) sigma *= o.sigmaMul;
  ang += sol.yawFix + rng.gauss() * sigma;
  const elev = sol.elev + rng.gauss() * sigma * 0.55;
  const q = shotQuality(match, p);
  const ch = Math.cos(elev) * speed;
  const kind = shotKind(power, finesse);
  startKick(p, 1, first ? 0.07 : 0.18, 0.42, ang, () => {
    release(match, p, Math.cos(ang) * ch, Math.sin(elev) * speed, Math.sin(ang) * ch, spin, 0, {
      type: 'shot', shot: { team: p.team, shooter: p, xg: q.xg, dist: q.d, kind, time: match.clock },
    });
  });
  return true;
}

/** Vaselina: balón bombeado por encima del portero. */
export function chip(match, p, o = {}) {
  if (!canPlayBall(match, p)) return false;
  const b = match.ball, rng = match.rng;
  const dir = p.team.dir, gx = HL * dir;
  const first = b.owner !== p;
  const zT = Math.abs(o.dirz || 0) > 0.35 ? Math.sign(o.dirz) * 1.9 : clamp(-b.z * 0.08, -1.5, 1.5);
  const D = Math.hypot(gx - b.x, zT - b.z);
  const angle = clamp(0.98 - D * 0.013, 0.58, 0.9);
  const v = aimVelocity(b.x, b.z, gx - dir * 0.2, zT, angle, 0, 0.25, b.y, 1.2);
  const pen = kickPenalty(p, v.yaw);
  const sigma = 0.04 * (1.75 - (1.25 * p.a.tiro) / 100) * (1 + pressure(match, p) * 0.5) * pen.err * p.team.profile.shotError * (first ? 1.4 : 1);
  rotate(v, rng.gauss() * sigma);
  const k = 1 + rng.gauss() * 0.035 * (1.6 - p.a.tiro / 100);
  v.vx *= k; v.vy *= k; v.vz *= k;
  const q = shotQuality(match, p);
  startKick(p, 3, first ? 0.07 : 0.16, 0.4, v.yaw, () => {
    release(match, p, v.vx, v.vy, v.vz, 0, 0.25, {
      type: 'shot', shot: { team: p.team, shooter: p, xg: q.xg * 0.8, dist: q.d, kind: 'chip', time: match.clock },
    });
  });
  return true;
}

/** Despeje: lejos y arriba, hacia la banda o hacia delante. */
export function clearBall(match, p, o = {}) {
  if (!canPlayBall(match, p)) return false;
  const b = match.ball, rng = match.rng;
  const dir = p.team.dir;
  let dx = o.dirx || 0, dz = o.dirz || 0;
  if (!dx && !dz) {
    dx = dir * 0.85;
    dz = (Math.abs(b.z) > 3 ? Math.sign(b.z) : rng.chance(0.5) ? 1 : -1) * 0.5;
  }
  // Nunca hacia la propia portería si está cerca.
  if (dx * dir < 0.15 && b.x * dir < -HL + 30) dx = dir * 0.4;
  let ang = Math.atan2(dz, dx) + rng.gauss() * 0.13;
  const speed = 23 + rng.next() * 5;
  const elev = 0.62 + rng.gauss() * 0.06;
  const first = b.owner !== p;
  startKick(p, 2, first ? 0.05 : 0.1, 0.34, ang, () => {
    release(match, p, Math.cos(ang) * Math.cos(elev) * speed, Math.sin(elev) * speed, Math.sin(ang) * Math.cos(elev) * speed, 0, 0.1, { type: 'clear' });
  });
  return true;
}

/** Cabezazo. mode: 'shot' | 'pass' | 'clear'. Se ejecuta en el momento del contacto. */
export function header(match, p, mode) {
  const b = match.ball, rng = match.rng;
  const dir = p.team.dir, gx = HL * dir;
  let vx, vy, vz, target = null, meta;
  if (mode === 'shot') {
    const gk = p.team.opponent.gk;
    const zT = (gk && gk.z > 0 ? -1 : 1) * (0.9 + rng.next() * 1.8);
    const D = Math.hypot(gx - b.x, zT - b.z);
    const contested = nearestOpponentDist(p.team, p.x, p.z) < 1.3;
    const speed = (10.5 + p.a.fisico * 0.055) * (contested ? 0.88 : 1);
    const sol = solveShot(D, speed, 0.7, 0, b.y);
    const sigma = 0.14 * (1.7 - p.a.tiro / 160 - p.a.fisico / 250) * p.team.profile.shotError * (contested ? 1.5 : 1);
    const ang = Math.atan2(zT - b.z, gx - b.x) + rng.gauss() * sigma;
    const elev = sol.elev + rng.gauss() * sigma * 0.6;
    vx = Math.cos(ang) * Math.cos(elev) * speed; vy = Math.sin(elev) * speed; vz = Math.sin(ang) * Math.cos(elev) * speed;
    const q = shotQuality(match, p);
    meta = { type: 'shot', header: true, shot: { team: p.team, shooter: p, xg: q.xg * 0.6, dist: q.d, kind: 'header', time: match.clock } };
  } else if (mode === 'pass') {
    target = findPassTarget(match, p, dir, 0, 0.2, { min: 3, max: 20, pref: 9, maxAng: 2.2 });
    let ang, sp = 9.5;
    if (target) {
      ang = Math.atan2(target.z - b.z, target.x - b.x);
      sp = clamp(Math.hypot(target.x - b.x, target.z - b.z) * 0.9 + 3, 7, 14);
    } else ang = Math.atan2(rng.gauss() * 0.4, dir);
    ang += rng.gauss() * 0.12;
    vx = Math.cos(ang) * sp; vz = Math.sin(ang) * sp; vy = 1.2;
    meta = { type: 'header', target };
  } else {
    const ang = Math.atan2((Math.abs(b.z) > 4 ? Math.sign(b.z) : rng.gauss()) * 0.6, dir) + rng.gauss() * 0.2;
    const sp = 12 + p.a.fisico * 0.045;
    vx = Math.cos(ang) * sp * 0.82; vz = Math.sin(ang) * sp * 0.82; vy = sp * 0.55;
    meta = { type: 'clear', header: true };
  }
  b.owner = null;
  b.held = false;
  b.vx = vx; b.vy = vy; b.vz = vz;
  b.spinY = 0; b.lift = 0;
  b.lastKicker = p; b.lastTouch = p;
  b.kickTime = match.clock;
  b.kickType = meta.type;
  b.passTarget = target;
  b.shot = meta.shot || null;
  b.kickId++;
  b.predTick = -1;
  p.cooldownControl = 0.4;
  match.rules.onKick(p, meta);
  match.emit('kick', { player: p, type: 'header', speed: Math.hypot(vx, vy, vz) });
}

/** Saque de banda con las manos. */
export function throwIn(match, p, o = {}) {
  const b = match.ball;
  if (b.owner !== p) return false;
  const long = !!o.long;
  const t = o.target || findPassTarget(match, p, o.dirx || 0, o.dirz || 0, 0.3, { min: 3, max: long ? 30 : 19, pref: long ? 24 : 9, maxAng: 1.7 });
  let v;
  if (t) {
    v = aimVelocity(b.x, b.z, t.x + t.vx * 0.3, t.z + t.vz * 0.3, long ? 0.5 : 0.36, 0, 0, 2.0, 0.4);
  } else {
    const ang = o.dirx || o.dirz ? Math.atan2(o.dirz, o.dirx) : p.facing;
    v = { vx: Math.cos(ang) * 10, vy: 4.5, vz: Math.sin(ang) * 10, yaw: ang };
  }
  p.facing = v.yaw;
  p.setState('throw', 0.5, 0);
  p.kickAngle = v.yaw;
  p.pending = {
    at: 0.24,
    fn: () => {
      release(match, p, v.vx, v.vy, v.vz, 0, 0, { type: 'throw', target: t });
    },
  };
  return true;
}

// ---------------------------------------------------------------------------
// Regate y protección
// ---------------------------------------------------------------------------

/** Recorte: cambio brusco de dirección que descoloca al defensor. */
export function feint(match, p, dirx, dirz) {
  if (match.ball.owner !== p || p.state !== 'free' || p.cooldownFeint > 0) return false;
  if (!dirx && !dirz) { dirx = p.dirX; dirz = p.dirZ; }
  const l = Math.hypot(dirx, dirz) || 1;
  const sp = Math.min(p.topSpeed(), p.speed * 0.6 + 3.2 + p.a.regate * 0.02);
  p.vx = (dirx / l) * sp;
  p.vz = (dirz / l) * sp;
  p.facing = Math.atan2(dirz, dirx);
  p.feintT = 0.45;
  p.cooldownFeint = 1.1;
  match.emit('feint', { player: p });
  return true;
}

// ---------------------------------------------------------------------------
// Defensa
// ---------------------------------------------------------------------------

export function startTackle(match, p, slide, dirx = 0, dirz = 0) {
  if (p.state !== 'free' || p.cooldownTackle > 0) return false;
  const b = match.ball;
  let ang = p.facing;
  const d = Math.hypot(b.x - p.x, b.z - p.z);
  if (d < (slide ? 6 : 3.5)) {
    // Apunta al balón, anticipando un poco su movimiento.
    const k = slide ? 0.22 : 0.1;
    ang = Math.atan2(b.z + b.vz * k - p.z, b.x + b.vx * k - p.x);
  } else if (dirx || dirz) ang = Math.atan2(dirz, dirx);
  p.tackleDir = ang;
  p.facing = ang;
  p.tackleResolved = false;
  p.setState(slide ? 'slide' : 'tackle', slide ? 0.78 : 0.36, 0);
  p.cooldownTackle = slide ? 1.4 : 0.8;
  match.emit('tackleStart', { player: p, slide });
  return true;
}

/** Resuelve una entrada en curso. Se llama cada tick durante su ventana activa. */
export function resolveTackle(match, p) {
  const b = match.ball, rng = match.rng;
  const slide = p.state === 'slide';
  const c = b.owner;
  if (c && c.team === p.team) return;
  if (b.y > 0.9) return;
  if (c && b.held) return; // no se puede entrar al portero con el balón en las manos
  const reach = slide ? 1.25 : 0.95;
  const fx = p.x + Math.cos(p.tackleDir) * 0.55, fz = p.z + Math.sin(p.tackleDir) * 0.55;
  if (Math.hypot(fx - b.x, fz - b.z) > reach) {
    if (slide) {
      // Entrada que se lleva por delante a un rival sin tocar balón.
      for (const o of p.team.opponent.players) {
        if (o.isGK || o.state === 'down') continue;
        if (Math.hypot(o.x - p.x, o.z - p.z) < 0.75 && p.speed > 3) {
          p.tackleResolved = true;
          if (rng.chance(0.75)) match.rules.foul(p, o, { slide: true, behind: false, noBall: true });
          return;
        }
      }
    }
    return;
  }
  p.tackleResolved = true;
  if (!c) {
    // Balón suelto: lo puntea hacia delante.
    const sp = slide ? 7.5 : 4.5;
    b.vx = Math.cos(p.tackleDir) * sp + rng.gauss();
    b.vz = Math.sin(p.tackleDir) * sp + rng.gauss();
    b.vy = slide ? 1.5 : 0;
    b.lastTouch = p;
    b.kickType = 'tackle';
    b.passTarget = null;
    b.offside = null;
    b.predTick = -1;
    p.cooldownControl = 0.25;
    match.emit('tackle', { player: p, clean: true, slide });
    return;
  }
  const prof = p.team.profile;
  const tx = (p.x - c.x), tz = (p.z - c.z);
  const tl = Math.hypot(tx, tz) || 1;
  const behind = (c.dirX * tx + c.dirZ * tz) / tl < -0.45;
  let prob = 0.56 + (p.a.defensa - c.a.regate) * 0.006 + (p.a.fuerza - c.a.fuerza) * 0.002;
  if (behind) prob -= 0.22;
  if (c.shielding) prob -= 0.16 + (c.a.fuerza - p.a.fuerza) * 0.004;
  if (c.feintT > 0) prob -= 0.28;
  if (slide) prob += 0.08;
  if (c.state === 'kick') prob += 0.08;
  prob = clamp(prob * prof.tackleSkill, 0.08, 0.92);
  const foulP = clamp(0.11 + (behind ? 0.3 : 0) + (slide ? 0.16 : 0) - (p.a.defensa - 70) * 0.003, 0.03, 0.75);
  const r = rng.next();
  if (r < prob) {
    c.cooldownControl = 0.55;
    c.shielding = false;
    c.setState('stun', slide ? 0.6 : 0.35);
    p.team.stats.tackles++;
    if (!slide && r < prob * 0.55) {
      match.giveBall(p, true);
    } else {
      b.owner = null;
      const sp = 4 + rng.next() * 3;
      b.vx = Math.cos(p.tackleDir) * sp + rng.gauss() * 1.5;
      b.vz = Math.sin(p.tackleDir) * sp + rng.gauss() * 1.5;
      b.vy = slide ? 1.2 : 0;
      b.lastTouch = p;
      b.kickType = 'tackle';
      b.passTarget = null;
      b.offside = null;
      b.shot = null;
      b.predTick = -1;
      p.cooldownControl = slide ? 0.5 : 0.15;
    }
    match.emit('tackle', { player: p, victim: c, clean: true, slide });
  } else if (rng.chance(foulP)) {
    match.rules.foul(p, c, { slide, behind });
  } else {
    // Entrada fallida: el defensor queda superado un instante.
    if (!slide) p.setState('stun', 0.45);
    match.emit('tackle', { player: p, victim: c, clean: false, slide });
  }
}
