// IA individual: qué hace el jugador con balón (pasar, tirar, regatear, centrar,
// despejar) y cómo defiende al poseedor (acosar, temporizar, entrar).

import { clamp, pointSeg } from '../core/MathUtils.js';
import { PITCH } from '../core/Config.js';
import { LINE_OF } from '../data/TeamsData.js';
import * as Act from './Actions.js';

const { HL, HW, BOX_D, BOX_HW } = PITCH;

/** Valor posicional de un punto del campo para el equipo atacante (0..1+). */
export function fieldValue(u, v) {
  const prog = clamp((u + HL) / (2 * HL), 0, 1);
  let val = 0.72 * Math.pow(prog, 1.4) + 0.28 * prog * (1 - (Math.abs(v) / HW) * 0.6);
  if (u > HL - 18 && Math.abs(v) < 13) val += 0.14;
  return val;
}

function inOwnBox(p) {
  return p.u < -HL + BOX_D && Math.abs(p.v) < BOX_HW;
}

/** Mejor dirección para conducir: hacia portería pero evitando rivales. */
function bestDribble(m, p, press) {
  const dir = p.team.dir;
  const gx = HL * dir;
  const base = Math.atan2(-p.z * 0.5, gx - p.x);
  const opp = p.team.opponent.players;
  let best = { score: -9, dx: Math.cos(base), dz: Math.sin(base), space: 0, cos: 1 };
  const angles = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.5, -2.5];
  for (let i = 0; i < angles.length; i++) {
    const a = base + angles[i];
    const dx = Math.cos(a), dz = Math.sin(a);
    let space = 12;
    for (let k = 0; k < opp.length; k++) {
      const o = opp[k];
      const rx = o.x - p.x, rz = o.z - p.z;
      const along = rx * dx + rz * dz;
      if (along < -0.5 || along > 12) continue;
      const perp = Math.abs(rx * dz - rz * dx);
      const eff = along + perp * 1.6 - 1.2;
      if (perp < 3.2 + along * 0.25 && eff < space) space = Math.max(0, eff);
    }
    const ax = p.x + dx * 7, az = p.z + dz * 7;
    if (Math.abs(ax) > HL - 1.5 || Math.abs(az) > HW - 1.5) space = Math.min(space, 1);
    const c = Math.cos(angles[i]);
    const score = space * 0.03 + c * 0.12;
    if (score > best.score) best = { score, dx, dz, space, cos: c };
  }
  return best;
}

/** Elige la mejor acción para el poseedor del balón. */
export function decide(m, p, tai, press) {
  const team = p.team, prof = team.profile, tac = team.tactics, rng = m.rng;
  const dir = team.dir;
  const u = p.u, v = p.v;
  const dGoal = Math.hypot(HL * dir - p.x, p.z);
  const myVal = fieldValue(u, v);
  let best = null, bestScore = -1e9;
  const consider = (score, act) => {
    score += rng.gauss() * prof.decisionNoise;
    if (score > bestScore) { bestScore = score; best = act; }
  };

  // Tiro
  if (dGoal < 33) {
    const q = Act.shotQuality(m, p);
    let s = q.xg * 3.2 - 0.15 + (dGoal < 11 ? 0.35 : 0) - (dGoal > 24 ? 0.25 : 0);
    if (q.blockers > 1) s -= 0.2;
    consider(s, { type: 'shot', q });
    // Vaselina si el portero ha salido mucho
    const gk = team.opponent.gk;
    if (gk && dGoal > 14 && dGoal < 30) {
      const out = Math.hypot(gk.x - HL * dir, gk.z);
      if (out > 9 && Math.hypot(gk.x - p.x, gk.z - p.z) < dGoal - 5) consider(0.55 + out * 0.03, { type: 'chip' });
    }
  }

  // Pases
  const mates = team.players;
  const tempoK = 0.6 + tac.tempo * 0.8;
  for (let i = 0; i < mates.length; i++) {
    const t = mates[i];
    if (t === p) continue;
    const d = Math.hypot(t.x - p.x, t.z - p.z);
    if (d < 4 || d > 55) continue;
    if (d > 22 && rng.next() > prof.vision) continue; // no ve todas las opciones lejanas
    const tu = t.u, tv = t.v;
    const lr = Act.laneRisk(team, p.x, p.z, t.x, t.z, 16);
    const open = Math.min(Act.nearestOpponentDist(team, t.x, t.z), 7) / 7;
    const gain = fieldValue(tu, tv) - myVal;
    let s = 0.42 + gain * 1.6 * tempoK + open * 0.22 - lr * 0.95 - (d > 30 ? 0.12 : 0) + press * 0.25 * (1 - lr);
    if (t.isGK) s -= 0.25 + (press < 0.5 ? 0.4 : 0);
    if (tu - u < -5) s -= 0.08 * tac.tempo;
    if (p.ai.from === t && p.ai.holdT < 2) s -= 0.2;
    const offside = tu > tai.offsideU + 0.2 && tu > u;
    if (offside) s -= prof.offsideDiscipline;
    consider(s, { type: 'pass', t });
    if (d > 26 && lr > 0.6 && open > 0.7 && !offside && !t.isGK) {
      // Cambio de juego por arriba: solo si el receptor está muy solo
      consider(0.2 + gain * 1.1 + open * 0.12 - (1 - p.a.pase / 100) * 0.3 + (press > 0.8 ? 0.1 : 0), { type: 'lob', t });
    }
    // Pase al hueco
    if (!t.isGK && tu >= u - 6 && LINE_OF[t.role] !== 'DEF' && !offside) {
      const plan = Act.throughPlan(m, p, t, 0.45);
      if (plan && plan.adv > 0.15) {
        const pu = plan.x * dir, pv = plan.z * dir;
        const plr = Act.laneRisk(team, p.x, p.z, plan.x, plan.z, 17);
        const pg = fieldValue(pu, pv) - myVal;
        const run = t.ai.runMode === 'run' ? 0.12 : 0;
        consider(0.44 + Math.min(plan.adv, 1.2) * 0.3 + pg * 1.5 * tempoK - plr * 0.75 + run, { type: 'through', plan });
      }
    }
  }

  // Centro
  if (u > HL - 24 && Math.abs(v) > 13) {
    let n = 0;
    for (let i = 0; i < mates.length; i++) {
      const t = mates[i];
      if (t !== p && t.u > HL - 18 && Math.abs(t.v) < 13) n++;
    }
    if (n > 0) {
      const side = v > 0 ? 1 : -1;
      // Elige la zona con más ventaja para un rematador
      let zone = 'spot', zs = -9;
      const zones = { near: [HL - 6, side * 3.4], spot: [HL - 11, 0], far: [HL - 6.5, -side * 4.8] };
      for (const k in zones) {
        const zx = zones[k][0] * dir, zz = zones[k][1] * dir;
        let md = 12;
        for (const t of mates) if (t !== p && !t.isGK) md = Math.min(md, Math.hypot(t.x - zx, t.z - zz));
        const od = Act.nearestOpponentDist(team, zx, zz);
        const sc = -md * 0.5 + Math.min(od, 4) * 0.3 + rng.next() * 0.6;
        if (sc > zs) { zs = sc; zone = k; }
      }
      consider(0.5 + n * 0.14 + (u > HL - 12 ? 0.15 : 0) - press * 0.1, { type: 'cross', zone });
    }
  }

  // Despeje bajo presión cerca de la propia área
  if (u < -HL + 28 && press > 0.6) consider(0.3 + press * 0.28, { type: 'clear' });

  // Conducción / regate
  const dr = bestDribble(m, p, press);
  let ds = 0.38 + dr.space * 0.03 + (p.a.regate - 75) * 0.004 + dr.cos * 0.1 - press * 0.18 - tac.tempo * 0.06;
  if (u < -HL + 30) ds -= 0.1;
  consider(ds, { type: 'dribble', dx: dr.dx, dz: dr.dz, sprint: dr.space > 7 && dr.cos > 0.3, feint: press > 0.7 && dr.space > 3 });

  return best;
}

/** Control del jugador de la IA que lleva el balón. */
export function carrierAI(m, p, tai, dt) {
  const ai = p.ai, prof = p.team.profile, rng = m.rng;
  const it = p.intent;
  ai.holdT += dt;
  ai.decT -= dt;
  const press = Act.pressure(m, p);
  if (press > 0.75 && ai.decT > 0.08 && prof.vision > 0.7) ai.decT = 0.08;
  if (ai.dribX === undefined) {
    ai.dribX = p.team.dir; ai.dribZ = 0; ai.dribSprint = false;
  }
  if (ai.decT <= 0) {
    ai.decT = prof.decisionInterval * (0.7 + rng.next() * 0.6);
    const act = decide(m, p, tai, press);
    switch (act.type) {
      case 'shot': {
        const d = act.q.d;
        const power = clamp(0.32 + d / 45 + rng.gauss() * 0.1, 0.15, 0.9);
        Act.shoot(m, p, { power, finesse: d < 18 && rng.chance(0.3) });
        return;
      }
      case 'chip': Act.chip(m, p, {}); return;
      case 'pass': Act.pass(m, p, { target: act.t, power: 0.3 }); ai.lastPassTo = act.t; return;
      case 'lob': Act.lob(m, p, { target: act.t }); return;
      case 'through': Act.throughPass(m, p, { plan: act.plan }); return;
      case 'cross': Act.cross(m, p, { zone: act.zone }); return;
      case 'clear': Act.clearBall(m, p, {}); return;
      default:
        ai.dribX = act.dx; ai.dribZ = act.dz; ai.dribSprint = act.sprint;
        if (act.feint && p.cooldownFeint <= 0 && rng.chance(0.35 + p.a.regate / 300)) {
          const side = rng.chance(0.5) ? 1 : -1;
          Act.feint(m, p, act.dx - act.dz * 0.7 * side, act.dz + act.dx * 0.7 * side);
        }
    }
  }
  it.mx = ai.dribX; it.mz = ai.dribZ;
  it.speed = 1;
  it.sprint = ai.dribSprint && p.stamina > 0.25;
  it.face = null;
}

/** Defensor que acosa al poseedor. idx 0 = primer hombre, 1 = ayuda. */
export function pressAI(m, p, tai, dt, idx) {
  const ball = m.ball, c = ball.owner;
  const it = p.intent, prof = p.team.profile, rng = m.rng;
  const dir = p.team.dir;
  if (!c) return false;
  const gx = -HL * dir;
  const d = Math.hypot(c.x - p.x, c.z - p.z);
  let gdx = gx - c.x, gdz = -c.z;
  const gl = Math.hypot(gdx, gdz) || 1;
  gdx /= gl; gdz /= gl;
  let tx, tz, sprint = false;
  if (idx === 0) {
    if (!tai.engage && d < 9) {
      // Fuera de la zona de presión: temporiza a distancia
      tx = c.x + gdx * 5.5; tz = c.z + gdz * 5.5;
    } else {
      const lead = clamp(d / 9, 0, 0.5);
      const off = d > 4 ? 1.6 : 0.6;
      tx = c.x + c.vx * lead + gdx * off;
      tz = c.z + c.vz * lead + gdz * off;
      sprint = d > 3.2;
      if (p.cooldownTackle <= 0 && p.state === 'free') {
        const box = inOwnBox(p);
        if (d < 1.9) {
          const exposed = c.speed > 6 || c.state === 'kick' ? 0.8 : 0;
          let rate = prof.tackleRate * (1.5 + exposed) * (box ? 0.6 : 1);
          if (p.team.isUser) rate *= 0.65; // los compañeros del usuario entran con más prudencia
          if (rng.next() < rate * dt) Act.startTackle(m, p, false);
        } else if (d < 3.4 && !box) {
          // Entrada deslizante si el rival se escapa
          const away = (c.vx * (c.x - p.x) + c.vz * (c.z - p.z)) / (d || 1);
          if (away > 5.5 && rng.next() < 0.3 * prof.tackleRate * dt) Act.startTackle(m, p, true);
        }
      }
    }
  } else {
    // Segundo hombre: tapa la mejor línea de pase o cierra por dentro
    let recv = null, rs = 1e9;
    if (prof.laneBlock) {
      for (const t of c.team.players) {
        if (t === c || t.isGK) continue;
        const dd = Math.hypot(t.x - c.x, t.z - c.z);
        if (dd > 26) continue;
        const threat = Math.hypot(t.x - gx, t.z) + dd * 0.3;
        if (threat < rs) { rs = threat; recv = t; }
      }
    }
    if (recv) {
      tx = c.x + (recv.x - c.x) * 0.42; tz = c.z + (recv.z - c.z) * 0.42;
    } else {
      tx = c.x + gdx * 4.5; tz = c.z + gdz * 4.5 + (p.z > c.z ? 1.5 : -1.5);
    }
    sprint = Math.hypot(tx - p.x, tz - p.z) > 5;
  }
  const dx = tx - p.x, dz = tz - p.z;
  const dd = Math.hypot(dx, dz);
  if (dd > 0.25) {
    it.mx = dx / dd; it.mz = dz / dd;
    it.speed = clamp(dd / 1.6, 0.3, 1);
  } else {
    it.mx = 0; it.mz = 0; it.speed = 0;
  }
  it.sprint = sprint && p.stamina > 0.15;
  it.face = d < 6 ? Math.atan2(ball.z - p.z, ball.x - p.x) : null;
  return true;
}

/** ¿Hay línea de pase limpia entre a y b? (para apoyos) */
export function laneOpen(team, ax, az, bx, bz) {
  const opp = team.opponent.players;
  let min = 9;
  for (let i = 0; i < opp.length; i++) {
    const r = pointSeg(opp[i].x, opp[i].z, ax, az, bx, bz);
    if (r.t > 0.05 && r.t < 0.97 && r.d < min) min = r.d;
  }
  return clamp(min / 4, 0, 1);
}
