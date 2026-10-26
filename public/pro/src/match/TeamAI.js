// IA colectiva: forma del equipo según formación y táctica, reparto de roles
// (quién va al balón, quién presiona, quién marca, quién apoya, quién se
// desmarca) y movimiento sin balón de cada jugador.

import { clamp, lerp, smoothstep } from '../core/MathUtils.js';
import { PITCH } from '../core/Config.js';
import { LINE_OF } from '../data/TeamsData.js';
import { carrierAI, pressAI, laneOpen } from './PlayerAI.js';
import { nearestOpponentDist } from './Actions.js';

const { HL, HW } = PITCH;
const FULLBACKS = new Set(['LB', 'RB', 'LWB', 'RWB']);
const HI = { x: 0, z: 0, t: 0 };

/** Primer punto de la trayectoria prevista al que el jugador llega antes que el balón. */
export function interceptTime(p, pred, out, maxY = 2.0) {
  const sp = p.topSpeed() * 0.92;
  const n = pred.n;
  for (let i = 0; i < n; i++) {
    if (pred.y[i] > maxY) continue;
    const d = Math.hypot(p.x - pred.x[i], p.z - pred.z[i]);
    const t = i * pred.dt;
    if ((d - 0.6) / sp + 0.12 <= t || (i === 0 && d < 0.7)) {
      out.x = pred.x[i]; out.z = pred.z[i]; out.t = t;
      return t;
    }
  }
  const j = n - 1;
  out.x = pred.x[j]; out.z = pred.z[j];
  out.t = Math.max(j * pred.dt, Math.hypot(p.x - out.x, p.z - out.z) / sp);
  return out.t;
}

export class TeamAI {
  constructor(team, match) {
    this.team = team;
    this.m = match;
    this.attackness = 0.5;   // 0 = replegado, 1 = desplegado en ataque
    this.lostT = 99;
    this.wonT = 99;
    this.lastPoss = null;
    this.chaser = null;
    this.second = null;
    this.pressers = [];
    this.engage = true;
    this.sorted = [];
    this.offsideU = 0;
    this.ballU = 0; this.ballV = 0;
    this.defLine = -20; this.len = 30; this.wide = 0.7; this.vShift = 0;
    this.boxMode = false;
    this.teammatePress = false; // el usuario pide presión de un compañero
  }

  update(dt) {
    const m = this.m, team = this.team, opp = team.opponent, ball = m.ball;
    const poss = m.possession;
    const mine = poss === team, theirs = poss === opp;
    if (poss !== this.lastPoss) {
      if (this.lastPoss === team && theirs) this.lostT = 0;
      if (mine && this.lastPoss !== team) this.wonT = 0;
      this.lastPoss = poss;
    }
    this.lostT += dt;
    this.wonT += dt;
    const target = mine ? 1 : theirs ? 0 : ball.x * team.dir > 0 ? 0.6 : 0.35;
    this.attackness += clamp(target - this.attackness, -dt * 1.6, dt * 1.6);
    this.computeShape();
    this.assignRoles(dt);
    const ps = team.players;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.isGK) continue;
      if (p === m.controlled && !m.assist(p)) continue;
      this.steer(p, dt);
    }
  }

  computeShape() {
    const t = this.team, dir = t.dir, b = this.m.ball, tac = t.tactics;
    this.ballU = b.x * dir;
    this.ballV = b.z * dir;
    // Línea de fuera de juego para nuestros atacantes: penúltimo rival
    let a = -99, c = -99;
    const opp = t.opponent.players;
    for (let i = 0; i < opp.length; i++) {
      const u = opp[i].x * dir;
      if (u > a) { c = a; a = u; } else if (u > c) c = u;
    }
    this.offsideU = Math.max(c, this.ballU, 0);
    const m = tac.mentality, A = this.attackness;
    const defA = clamp(this.ballU - 30 + m * 3 + tac.line * 8, -38, 10 + tac.line * 12);
    const defD = clamp(this.ballU - 13 - (1 - tac.line) * 9 + m * 1.5, -46.5, 4 + tac.line * 10);
    this.defLine = lerp(defD, defA, A);
    this.len = lerp(25 + tac.depth * 9, 33 + tac.depth * 13, A) * (1 + m * 0.03);
    this.wide = lerp(0.48 + tac.width * 0.2, 0.7 + tac.width * 0.3, A);
    this.vShift = this.ballV * lerp(0.42, 0.12, A);
    // Zona a partir de la cual el equipo sale a morder
    const counterpress = this.lostT < 4 && tac.pressing > 0.45;
    this.engage = counterpress || this.ballU < -15 + tac.pressing * 55;
    this.counterpress = counterpress;
  }

  /** Posición base del jugador según formación, táctica y posición del balón. */
  anchor(p) {
    const s = p.slot, tac = this.team.tactics, ai = p.ai;
    const A = this.attackness, m = tac.mentality;
    let u = this.defLine + s.d * this.len;
    let v = s.w * HW * this.wide + this.vShift * (1 - Math.abs(s.w) * 0.3);
    const line = LINE_OF[p.role];
    if (A > 0.5) {
      const k = (A - 0.5) * 2;
      if (FULLBACKS.has(p.role)) {
        const same = Math.sign(s.w) === Math.sign(this.ballV) || Math.abs(this.ballV) < 8;
        const push = clamp(0.5 + m * 0.25, 0, 1) * (same ? 1 : 0.5) * smoothstep(-25, 10, this.ballU);
        u += push * 16 * k;
        v = lerp(v, s.w * HW * 0.9, k * 0.6);
      }
      if (line === 'ATT') u = Math.max(u, Math.min(this.offsideU - 1.5, this.ballU + 10));
      if (line === 'MID') u = Math.max(u, this.ballU - 16 + s.d * 10);
    }
    // Colocación imperfecta en dificultades bajas (deriva lenta)
    const noise = this.team.profile.anchorNoise;
    if (noise > 0.05) {
      if (ai.nx === undefined) { ai.nx = 0; ai.nz = 0; ai.nT = 0; ai.ntx = 0; ai.ntz = 0; }
      ai.nT -= 1 / 60;
      if (ai.nT <= 0) {
        ai.nT = 2 + this.m.rng.next() * 3;
        ai.ntx = this.m.rng.gauss() * noise;
        ai.ntz = this.m.rng.gauss() * noise;
      }
      ai.nx += (ai.ntx - ai.nx) * 0.01;
      ai.nz += (ai.ntz - ai.nz) * 0.01;
      u += ai.nx; v += ai.nz;
    }
    ai.au = clamp(u, -HL + 4, HL - 3);
    ai.av = clamp(v, -HW + 1.5, HW - 1.5);
  }

  assignRoles(dt) {
    const m = this.m, ball = m.ball, team = this.team, prof = team.profile, tac = team.tactics;
    const ps = team.players;
    const owner = ball.owner;
    const pred = owner ? null : ball.predict(m.tick);
    const sorted = this.sorted;
    const oppSorted = m.ais[team.opponent.side].sorted;
    const oppBest = oppSorted.length ? oppSorted[0].ai.eta : 9;
    sorted.length = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i], ai = p.ai;
      this.anchor(p);
      ai.mark = null;
      ai.support = false;
      ai.boxSpot = null;
      if (owner) {
        ai.eta = Math.hypot(p.x - owner.x, p.z - owner.z) / p.topSpeed();
      } else {
        // Sin rivales cerca se espera a que el balón baje; si hay disputa, se va al salto
        ai.eta = interceptTime(p, pred, ai.icept, 1.25);
        if (oppBest < ai.eta + 0.4) {
          const hi = interceptTime(p, pred, HI, 2.0);
          if (hi < ai.eta) { ai.eta = hi; ai.icept.x = HI.x; ai.icept.z = HI.z; ai.icept.t = HI.t; }
        }
      }
      if (p.state !== 'free') ai.eta += 0.8;
      if (!p.isGK) sorted.push(p);
    }
    sorted.sort((a, b) => a.ai.eta - b.ai.eta);
    this.chaser = null;
    this.second = null;
    this.pressers.length = 0;
    const poss = m.possession;
    const userHere = m.controlled && m.controlled.team === team ? m.controlled : null;

    if (!m.live) {
      // Balón parado: nadie lo persigue, todos vuelven a su sitio
    } else if (!owner) {
      const pt = ball.passTarget;
      if (pt && pt.team === team && ps.includes(pt) && !pt.isGK) {
        this.chaser = pt;
        if (sorted[0] !== pt && sorted[0].ai.eta < pt.ai.eta - 0.6) this.chaser = sorted[0];
      } else if (pt && pt.team === team && pt.isGK) {
        this.chaser = null;
      } else {
        this.chaser = sorted[0] || null;
        if (poss !== team && sorted.length > 1 && sorted[1].ai.eta < sorted[0].ai.eta + 0.45) this.second = sorted[1];
      }
    } else if (owner.team !== team && !(owner.isGK && ball.held)) {
      let n = prof.pressers;
      if (this.counterpress) n = Math.max(n, 2);
      if (this.ballU < -25 && prof.cover) n = Math.max(n, 2);
      if (tac.pressing > 0.75 && prof.pressers > 1) n = Math.min(3, n + 1);
      if (userHere) {
        // El usuario es el primer hombre; los compañeros solo ayudan si lo pide
        // o si el jugador controlado está muy lejos de la jugada.
        const far = userHere.ai.eta > (sorted[0] ? sorted[0].ai.eta : 0) + 1.3;
        n = this.teammatePress || far ? 1 : 0;
        // En campo propio siempre ayuda un compañero, salvo que el usuario ya esté encima
        if (this.ballU < 0 && n === 0 && userHere.ai.eta > 0.45) n = 1;
        if (this.ballU < -28 && this.teammatePress) n = 2;
      }
      const gx = -HL * team.dir;
      // Preferencia por quien ya está entre el balón y la portería
      const cand = sorted.slice(0, 5).map((p) => {
        const goalSide = Math.hypot(p.x - gx, p.z) < Math.hypot(owner.x - gx, owner.z) + 1;
        return { p, s: p.ai.eta + (goalSide ? 0 : 0.55) };
      }).sort((a, b) => a.s - b.s);
      for (let i = 0; i < cand.length && this.pressers.length < n; i++) {
        if (cand[i].p === userHere) continue;
        this.pressers.push(cand[i].p);
      }
    }

    const A = this.attackness;
    // Marcajes en defensa
    if (A < 0.55) {
      const dir = team.dir;
      const opp = team.opponent.players;
      const threats = [];
      for (let i = 0; i < opp.length; i++) {
        const o = opp[i];
        if (o.isGK || o === owner) continue;
        const uo = o.x * dir;
        if (uo < 14) threats.push(o);
      }
      threats.sort((a, b) => a.x * dir - b.x * dir);
      for (let k = 0; k < threats.length; k++) {
        const o = threats[k];
        let best = null, bd = 16;
        for (let i = 0; i < ps.length; i++) {
          const p = ps[i];
          if (p.isGK || p.ai.mark || this.pressers.includes(p) || p === this.chaser || p === userHere) continue;
          const line = LINE_OF[p.role];
          if (line === 'ATT') continue;
          let d = Math.hypot(p.ai.au * dir - o.x, p.ai.av * dir - o.z);
          if (line === 'MID' && o.x * dir < -HL + 22) d += 3;
          if (d < bd) { bd = d; best = p; }
        }
        if (best) best.ai.mark = o;
      }
    }

    // Roles de ataque
    if (A > 0.45) {
      const carrier = owner && owner.team === team ? owner : (ball.passTarget && ball.passTarget.team === team ? ball.passTarget : null);
      this.carrier = carrier;
      const cu = carrier ? carrier.u : this.ballU, cv = carrier ? carrier.v : this.ballV;
      this.boxMode = Math.abs(cv) > 14 && cu > HL - 26;
      if (this.boxMode) {
        const side = cv > 0 ? 1 : -1;
        const spots = [
          [HL - 5.5, side * 3.2], [HL - 10.5, -side * 0.5], [HL - 6.5, -side * 5], [HL - 19, side * 2],
        ];
        const cands = [];
        for (let i = 0; i < ps.length; i++) {
          const p = ps[i];
          if (p.isGK || p === carrier) continue;
          const line = LINE_OF[p.role];
          if (line === 'DEF' || p.role === 'CDM') continue;
          if (Math.hypot(p.x - (carrier ? carrier.x : ball.x), p.z - (carrier ? carrier.z : ball.z)) < 9 && Math.abs(p.v) > 12) continue;
          cands.push(p);
        }
        cands.sort((a, b) => b.u - a.u);
        const use = cands.slice(0, 4);
        for (let k = 0; k < spots.length && use.length; k++) {
          let bi = 0, bd = 1e9;
          for (let i = 0; i < use.length; i++) {
            const d = Math.hypot(use[i].u - spots[k][0], use[i].v - spots[k][1]);
            if (d < bd) { bd = d; bi = i; }
          }
          use[bi].ai.boxSpot = spots[k];
          use.splice(bi, 1);
        }
      }
      if (carrier) {
        // Dos apoyos cercanos
        let n = 0;
        const byDist = ps.filter((p) => !p.isGK && p !== carrier && !p.ai.boxSpot && LINE_OF[p.role] !== 'ATT')
          .sort((a, b) => Math.hypot(a.x - carrier.x, a.z - carrier.z) - Math.hypot(b.x - carrier.x, b.z - carrier.z));
        for (let i = 0; i < byDist.length && n < 2; i++) {
          byDist[i].ai.support = true;
          n++;
        }
      }
    } else {
      this.carrier = null;
      this.boxMode = false;
    }
  }

  /** Busca un punto de apoyo con línea de pase limpia cerca del poseedor. */
  supportSpot(p, carrier) {
    const team = this.team, dir = team.dir, tac = team.tactics;
    const a0 = dir > 0 ? 0 : Math.PI;
    const cu = carrier.u;
    let best = null, bs = -1e9;
    const angs = [-2.4, -1.6, -0.9, 0.9, 1.6, 2.4, Math.PI];
    for (let i = 0; i < angs.length; i++) {
      for (let r = 9; r <= 14; r += 5) {
        const x = carrier.x + Math.cos(a0 + angs[i]) * r, z = carrier.z + Math.sin(a0 + angs[i]) * r;
        if (Math.abs(x) > HL - 2 || Math.abs(z) > HW - 2) continue;
        const u = x * dir;
        if (u > this.offsideU - 0.5 && u > cu) continue;
        const s = laneOpen(team, carrier.x, carrier.z, x, z) * 1.0 +
          (Math.min(nearestOpponentDist(team, x, z), 8) / 8) * 0.6 -
          Math.hypot(u - p.ai.au, z * dir - p.ai.av) / 25 -
          Math.hypot(x - p.x, z - p.z) / 40 +
          ((u - cu) / 14) * 0.25 * tac.tempo;
        if (s > bs) { bs = s; best = { x, z }; }
      }
    }
    return best;
  }

  goTo(p, x, z, sprint, arrive = 2.5) {
    const it = p.intent;
    const dx = x - p.x, dz = z - p.z;
    const d = Math.hypot(dx, dz);
    const ball = this.m.ball;
    if (d < 0.4) {
      it.mx = 0; it.mz = 0; it.speed = 0; it.sprint = false;
      it.face = Math.atan2(ball.z - p.z, ball.x - p.x);
      return;
    }
    it.mx = dx / d; it.mz = dz / d;
    it.speed = clamp(d / arrive, 0.22, 1);
    it.sprint = (sprint || d > 14) && p.stamina > 0.12;
    it.face = d < 1.6 ? Math.atan2(ball.z - p.z, ball.x - p.x) : null;
  }

  steer(p, dt) {
    const m = this.m, ball = m.ball, team = this.team, dir = team.dir, prof = team.profile;
    const ai = p.ai;
    if (p.state !== 'free') return;

    // 1. Lleva el balón
    if (ball.owner === p) {
      if (!m.live) { p.stop(); return; }
      carrierAI(m, p, this, dt);
      return;
    }
    // 2. Va a por el balón (receptor o más cercano)
    if (this.chaser === p || this.second === p) {
      const ic = ai.icept;
      this.goTo(p, ic.x, ic.z, true, 0.9);
      return;
    }
    // 3. Carrera a un pase al hueco
    if (ai.runTo) {
      if (m.clock < ai.runTo.until && !ball.owner) {
        this.goTo(p, ai.runTo.x, ai.runTo.z, true, 1);
        return;
      }
      ai.runTo = null;
    }
    // 4. Presión sobre el poseedor
    const pi = this.pressers.indexOf(p);
    if (pi >= 0 && pressAI(m, p, this, dt, pi)) return;

    // 5. Posicional
    let tu = ai.au, tv = ai.av, sprint = false;
    const A = this.attackness;
    const line = LINE_OF[p.role];

    if (A < 0.55) {
      // --- Defensa ---
      const o = ai.mark;
      if (o) {
        const gx = -HL * dir;
        let gdx = gx - o.x, gdz = -o.z;
        const gl = Math.hypot(gdx, gdz) || 1;
        gdx /= gl; gdz /= gl;
        const tight = 1.2 + (1 - prof.marking) * 2.5;
        const mx = (o.x + gdx * tight + (ball.x - o.x) * 0.12) * dir;
        const mv = (o.z + gdz * tight + (ball.z - o.z) * 0.12) * dir;
        const w = (line === 'DEF' ? 0.8 : 0.55) * prof.marking * smoothstep(16, -22, o.x * dir);
        tu = lerp(tu, mx, w);
        tv = lerp(tv, mv, w);
        // Seguir al que rompe a la espalda
        const ou = o.x * dir;
        if (ou < tu) tu = lerp(tu, ou - 1.2, prof.trackRunners);
        if (o.speed > 6 && Math.hypot(o.x - p.x, o.z - p.z) < 9) sprint = true;
      }
      // Cobertura: si un defensa ha salido a presionar, el vecino cierra el hueco
      if (prof.cover && line === 'DEF' && this.pressers.length) {
        const pr = this.pressers[0];
        if (pr !== p && LINE_OF[pr.role] === 'DEF') {
          const gap = pr.ai.av - tv;
          if (Math.abs(gap) < 22) tv += gap * 0.45;
        }
      }
      // Contraataque: el punta más adelantado aguanta arriba
      if (line === 'ATT' && this.lostT > 4 && team.tactics.mentality <= 0) tu = Math.max(tu, this.ballU + 14);
    } else {
      // --- Ataque ---
      const carrier = this.carrier;
      const cu = carrier ? carrier.u : this.ballU, cv = carrier ? carrier.v : this.ballV;
      const tac = team.tactics;
      let limitOff = true;
      if (ai.boxSpot) {
        tu = ai.boxSpot[0]; tv = ai.boxSpot[1];
        sprint = Math.hypot(tu - p.u, tv - p.v) > 5;
      } else if (FULLBACKS.has(p.role) && carrier && carrier !== p &&
        Math.sign(p.slot.w) === Math.sign(cv) && Math.abs(cv) > 12 && cu > -5 &&
        (tac.mentality >= 0 || (tac.mentality === -1 && cu > 20)) && cu - p.u < 22) {
        // Desdoblamiento por banda
        tu = Math.min(cu + 9, HL - 8);
        tv = Math.sign(p.slot.w) * (HW - 3);
        sprint = tu - p.u > 5;
      } else if (line === 'ATT' || p.role === 'CAM') {
        // Desmarques de ruptura
        ai.runT -= dt;
        if (ai.runMode === 'run') {
          tu = Math.min(HL - 8, this.offsideU + 10);
          tv = ai.runV;
          sprint = true;
          if (ai.runT <= 0) { ai.runMode = 'rest'; ai.runT = (2 + m.rng.next() * 2.5) / prof.runs; }
        } else if (ai.runT <= 0) {
          const gap = p.u - cu;
          if (carrier && carrier !== p && cu > -25 && gap > 3 && gap < 38) {
            ai.runMode = 'run';
            ai.runT = 1.6 + m.rng.next();
            ai.runV = clamp(p.v * 0.75 + m.rng.gauss() * 5, -HW + 6, HW - 6);
            ai.runOff = m.rng.chance(1 - prof.offsideDiscipline) ? 1.3 : -0.3;
          } else ai.runT = 0.5;
        }
        if (ai.runMode !== 'run' && this.wonT < 5 && tac.tempo > 0.6) sprint = tu - p.u > 6; // contraataque
      } else if (ai.support && carrier && carrier !== p) {
        ai.supT -= dt;
        if (ai.supT <= 0 || !ai.sp) {
          ai.supT = 0.35;
          ai.sp = prof.support > m.rng.next() * 0.9 ? this.supportSpot(p, carrier) : null;
        }
        if (ai.sp) { tu = ai.sp.x * dir; tv = ai.sp.z * dir; }
      }
      // No caer en fuera de juego
      if (limitOff && tu > this.offsideU + (ai.runOff ?? -0.3) && this.ballU < tu) {
        tu = Math.min(tu, this.offsideU + (ai.runMode === 'run' ? (ai.runOff ?? -0.3) : -0.6));
      }
    }
    tu = clamp(tu, -HL + 2, HL - 2);
    tv = clamp(tv, -HW + 1, HW - 1);
    // Durante un saque los rivales respetan la distancia
    let x = tu * dir, z = tv * dir;
    const sp = m.setPiece;
    if (sp && sp.team !== team) {
      const dx = x - ball.x, dz = z - ball.z;
      const d = Math.hypot(dx, dz), min = sp.minDist;
      if (d < min) {
        const k = min / (d || 1);
        x = ball.x + (d ? dx : -dir) * k; z = ball.z + dz * k;
      }
    }
    this.goTo(p, x, z, sprint);
  }
}
