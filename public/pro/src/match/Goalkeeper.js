// IA del portero: colocación, lectura de la trayectoria, estiradas, salidas,
// blocajes, despejes y saque con la mano o con el pie.

import { clamp, pointSeg } from '../core/MathUtils.js';
import { PITCH } from '../core/Config.js';
import { LINE_OF } from '../data/TeamsData.js';
import { predictGoalCross } from './Physics.js';
import * as Act from './Actions.js';

const { HL, HW, GOAL_HW, GOAL_H, BOX_D, BOX_HW } = PITCH;

export class GoalkeeperAI {
  constructor(team, match) {
    this.team = team;
    this.m = match;
    this.handled = -1;      // último golpeo ya leído
    this.reactT = 0;
    this.threat = null;
    this.scanT = 0;
    this.holdT = 0;
    this.smotherCd = 0;
    this.noise = 0;
    this.noiseT = 0;
    this.saveCd = 0;
  }

  get gk() { return this.team.gk; }

  inBox(x, z) {
    const u = x * this.team.dir;
    return u < -HL + BOX_D && u > -HL - 0.5 && Math.abs(z) < BOX_HW;
  }

  update(dt) {
    const p = this.gk;
    if (!p) return;
    const m = this.m, ball = m.ball, team = this.team, dir = team.dir, prof = team.profile;
    const it = p.intent;
    if (this.smotherCd > 0) this.smotherCd -= dt;
    if (this.saveCd > 0) this.saveCd -= dt;

    if (ball.owner === p) { this.withBall(dt); return; }
    this.holdT = 0;
    if (p.state === 'hold') p.setState('free');

    // Parada por contacto (de pie, saltando o en plena estirada)
    if (!ball.owner && this.saveCd <= 0) {
      if (this.checkSave()) return;
    }
    if (p.state !== 'free') return;

    const gx = -HL * dir;
    const sp = m.setPiece;
    if (sp && sp.type === 'PENALTY' && sp.team !== team) {
      it.mx = 0; it.mz = 0; it.speed = 0;
      it.face = Math.atan2(ball.z - p.z, ball.x - p.x);
      return;
    }
    if (sp && sp.team === team && sp.taker === p) return;

    // --- Lectura de tiros ---
    if (!ball.owner && !ball.frozen) {
      this.scanT -= dt;
      const toward = -ball.vx * dir; // velocidad hacia nuestra portería
      if (toward > 5 && this.scanT <= 0) {
        this.scanT = 0.05;
        const g = predictGoalCross(ball, gx, 2.2);
        if (g && Math.abs(g.z) < GOAL_HW + 0.8 && g.y < GOAL_H + 0.6) {
          const at = predictGoalCross(ball, p.x, 2.2) || g;
          this.threat = { z: at.z, y: at.y, t: at.t, kick: ball.kickId, onTarget: Math.abs(g.z) < GOAL_HW && g.y < GOAL_H };
          if (this.handled !== ball.kickId) {
            this.handled = ball.kickId;
            this.reactT = prof.gkReaction + (1 - (p.a.porteria || 70) / 100) * 0.3 + m.rng.next() * 0.05;
          }
        } else this.threat = null;
      } else if (toward <= 5) this.threat = null;
      if (this.threat) {
        const th = this.threat;
        th.t -= dt;
        if (this.reactT > 0) this.reactT -= dt;
        else {
          const lat = th.z - p.z;
          if (th.t > 0.6) {
            // Hay tiempo: pasos laterales para llegar de pie
            it.mx = 0; it.mz = Math.sign(lat);
            it.speed = clamp(Math.abs(lat) / 1.5, 0, 1);
            it.sprint = Math.abs(lat) > 2;
            it.face = Math.atan2(ball.z - p.z, ball.x - p.x);
            return;
          }
          if (th.t > 0.03) {
            this.launchSave(p, th.z, th.y, th.t);
            this.threat = null;
            return;
          }
        }
        if (this.reactT > 0) { it.speed = 0; it.mx = 0; it.mz = 0; return; }
      }
    } else this.threat = null;

    // --- Colocación ---
    const bx = ball.x, bz = ball.z;
    const dBG = Math.hypot(bx - gx, bz) || 1;
    // Con el balón escorado se queda más cerca de la línea, tapando el primer palo
    const central = Math.abs(bx - gx) / dBG;
    let r = Math.max(0.9, clamp(dBG * 0.13, 1.0, 7) * (0.3 + 0.7 * central));
    const ballU = bx * dir;
    if (ballU > 0 && m.possession === team) r = clamp(8 + team.tactics.line * 8, 7, 16);

    this.noiseT -= dt;
    if (this.noiseT <= 0) {
      this.noiseT = 1.5 + m.rng.next() * 2;
      this.noise = m.rng.gauss() * prof.gkPosError;
    }
    let tx = gx + ((bx - gx) / dBG) * r;
    let tz = (bz / dBG) * r + this.noise;
    let sprint = false;

    const c = ball.owner;
    if (c && c.team !== team) {
      // Mano a mano: achicar espacios
      const cu = c.x * dir;
      if (cu < -HL + 24 && Math.abs(c.z) < 16) {
        let nearDef = 99;
        for (const d of team.players) {
          if (d.isGK) continue;
          const dd = Math.hypot(d.x - c.x, d.z - c.z);
          if (dd < nearDef) nearDef = dd;
        }
        const inBox = this.inBox(c.x, c.z);
        if ((inBox && nearDef > 2.2) || nearDef > 6.5) {
          r = clamp(dBG - 3.5, 1, inBox ? 7.5 : 5.5);
          tx = gx + ((bx - gx) / dBG) * r;
          tz = (bz / dBG) * r;
          sprint = true;
        }
        // Salida a los pies
        const db = Math.hypot(ball.x - p.x, ball.z - p.z);
        if (db < 1.35 && this.inBox(p.x, p.z) && this.smotherCd <= 0 && ball.y < 1) {
          this.smotherCd = 0.9;
          const prob = clamp(0.5 * prof.gkReach + ((p.a.porteria || 70) - c.a.regate) * 0.004 + (c.feintT > 0 ? -0.2 : 0), 0.1, 0.8);
          if (m.rng.chance(prob)) {
            c.setState('stun', 0.5);
            c.cooldownControl = 0.6;
            m.giveBall(p, true);
            ball.held = true;
            m.emit('save', { gk: p, shooter: c, claim: true });
            return;
          }
        }
      }
    } else if (!c && !ball.frozen) {
      // Balón suelto o centro: sale si llega antes que nadie
      const ic = p.ai.icept;
      if (this.inBox(ic.x, ic.z) && ball.kickType !== 'throw') {
        let oppEta = 9;
        for (const o of team.opponent.players) if (o.ai.eta < oppEta) oppEta = o.ai.eta;
        let mateEta = 9;
        for (const o of team.players) if (!o.isGK && o.ai.eta < mateEta) mateEta = o.ai.eta;
        const mine = ball.passTarget === p;
        if (mine || (p.ai.eta < oppEta - 0.15 && (p.ai.eta < mateEta + 0.3 || oppEta < mateEta + 0.5))) {
          tx = ic.x; tz = ic.z; sprint = true;
          const db = Math.hypot(ball.x - p.x, ball.z - p.z);
          if (db < 1.15 && ball.y < 2.45 && this.inBox(ball.x, ball.z)) {
            const backpass = ball.lastKicker && ball.lastKicker.team === team && ball.kickType === 'pass';
            m.giveBall(p, false);
            ball.held = !backpass;
            m.emit('gkClaim', { gk: p });
            return;
          }
        }
      }
    }
    // No abandonar el área salvo con el equipo volcado
    if (!(ballU > 0 && m.possession === team)) {
      const u = clamp(tx * dir, -HL + 0.6, -HL + BOX_D - 1);
      tx = u * dir;
      tz = clamp(tz, -BOX_HW + 2, BOX_HW - 2);
    }
    const dx = tx - p.x, dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.25) {
      it.mx = dx / d; it.mz = dz / d;
      it.speed = clamp(d / 2, 0.25, 1);
      it.sprint = sprint || d > 6;
    } else { it.mx = 0; it.mz = 0; it.speed = 0; it.sprint = false; }
    it.face = Math.atan2(ball.z - p.z, ball.x - p.x);
  }

  /** Lanza la estirada (o el salto) hacia el punto previsto de paso del balón. */
  launchSave(p, cz, cy, ct) {
    const prof = this.team.profile;
    const lat = cz - p.z;
    const side = lat >= 0 ? 1 : -1;
    p.facing = this.team.dir > 0 ? 0 : Math.PI;
    if (Math.abs(lat) < 0.55) {
      if (cy > 2.0) {
        p.jumpH = 0.55;
        p.setState('jump', 0.55, 1);
      }
      return;
    }
    const tc = clamp(ct, 0.1, 0.7);
    const dur = tc + 0.22;
    const maxV = (4.4 + (p.a.porteria || 70) * 0.027) * prof.gkReach;
    const need = Math.max(0, Math.abs(lat) - 0.85) / tc;
    const v = Math.min(need, maxV);
    p.dive = { vx: 0, vz: side * v, h: clamp(cy - 0.38, 0, 2.05), side, y: cy, pc: tc / dur };
    p.setState('dive', dur, side);
    this.m.emit('dive', { gk: p });
  }

  /** Comprueba si el balón impacta en el portero y resuelve la parada. */
  checkSave() {
    const p = this.gk, m = this.m, ball = m.ball;
    if (ball.lastTouch === p && m.clock - ball.kickTime < 0.4) return false;
    if (ball.lastKicker && ball.lastKicker.team === this.team && ball.kickType !== 'tackle' && ball.speed < 14) {
      return false; // cesiones y pases de compañeros: se juega con el pie / blocaje normal
    }
    if (!this.inBox(p.x, p.z)) return false;
    if (p.state === 'down' || p.state === 'kick' || p.state === 'stun') return false;
    const sp = ball.speed;
    if (sp < 4) return false;
    // Punto por el que el balón cruza el plano del portero durante este tick
    const px = m.ballPrev.x, py = m.ballPrev.y, pz = m.ballPrev.z;
    let cz, cy;
    const d0 = px - p.x, d1 = ball.x - p.x;
    if (d0 * d1 <= 0 && d0 !== d1) {
      const k = d0 / (d0 - d1);
      cz = pz + (ball.z - pz) * k;
      cy = py + (ball.y - py) * k;
    } else if (Math.abs(d1) < 0.45) {
      cz = ball.z; cy = ball.y;
    } else return false;

    let dist, stretch;
    if (p.state === 'dive') {
      const s = p.dive.side;
      const r = pointSeg(cz, cy, p.z - s * 0.7, p.y + 0.25, p.z + s * 1.1, p.y + 0.5);
      dist = r.d;
      stretch = r.t;
      if (dist > 0.34) return false;
    } else {
      const top = (p.state === 'jump' ? 2.45 + p.y : 2.05);
      const r = pointSeg(cz, cy, p.z, 0, p.z, top);
      dist = r.d;
      stretch = Math.abs(cz - p.z) / 0.6;
      if (dist > 0.52) return false;
    }
    this.resolveSave(p, sp, clamp(stretch, 0, 1));
    return true;
  }

  resolveSave(p, sp, stretch) {
    const m = this.m, ball = m.ball, rng = m.rng, dir = this.team.dir;
    const shot = ball.shot;
    const pc = clamp(0.82 - (sp - 12) * 0.04 - stretch * 0.35 + ((p.a.porteria || 70) - 75) * 0.01, 0.05, 0.95);
    this.saveCd = 0.4;
    this.threat = null;
    const shooter = shot ? shot.shooter : ball.lastKicker;
    // Mano blanda: llega muy forzado a un balón fuerte y no logra desviarlo del todo
    const weak = clamp((stretch - 0.6) * 1.2, 0, 0.5) * clamp((sp - 17) / 12, 0, 1) * (1.6 - (p.a.porteria || 70) / 100);
    if (rng.chance(weak)) {
      ball.vx *= 0.72; ball.vz = ball.vz * 0.7 + rng.gauss() * 1.2; ball.vy = ball.vy * 0.6 + 0.8;
      ball.lastTouch = p;
      ball.predTick = -1;
      this.saveCd = 1;
      m.emit('touch', { player: p, block: true, speed: sp, gk: true });
      return;
    }
    if (shot && shot.team !== this.team) this.team.stats.saves++;
    if (rng.chance(pc)) {
      m.giveBall(p, false);
      ball.held = true;
      m.emit('save', { gk: p, shooter, catch: true, xg: shot ? shot.xg : 0, speed: sp });
    } else {
      const side = p.state === 'dive' ? p.dive.side : (ball.z >= p.z ? 1 : -1);
      const wide = rng.chance(0.45);
      const back = -dir; // hacia nuestra portería
      if (wide) {
        ball.vx = back * Math.abs(ball.vx) * 0.25;
        ball.vz = side * (6 + rng.next() * 3);
      } else {
        ball.vx = -back * (4 + rng.next() * 6);
        ball.vz = side * (2 + rng.next() * 5);
      }
      ball.vy = 2 + rng.next() * 3.5;
      ball.x = p.x - back * 0.35;
      ball.spinY = 0; ball.lift = 0;
      ball.lastTouch = p;
      ball.kickType = 'save';
      ball.passTarget = null;
      ball.offside = null;
      ball.shot = null;
      ball.predTick = -1;
      p.cooldownControl = 0.3;
      m.emit('save', { gk: p, shooter, catch: false, xg: shot ? shot.xg : 0, speed: sp });
    }
  }

  /** Reacción al lanzamiento de un penalti. */
  penaltyDive(userSide) {
    const p = this.gk, m = this.m, ball = m.ball, rng = m.rng, prof = this.team.profile;
    const gx = -HL * this.team.dir;
    this.handled = ball.kickId;
    this.threat = null;
    const g = predictGoalCross(ball, gx, 2);
    const read = clamp(0.3 + ((p.a.porteria || 70) - 70) * 0.008 + (prof.gkReach - 0.84) * 0.9, 0.2, 0.62);
    let cz, cy;
    if (userSide !== undefined && userSide !== null) {
      cz = userSide * 2.6; cy = g ? g.y : 0.8;
    } else if (g && rng.chance(read)) {
      cz = g.z; cy = g.y;
    } else if (rng.chance(0.15)) {
      return; // se queda en el centro
    } else {
      cz = (rng.chance(0.5) ? 1 : -1) * 2.6;
      cy = rng.chance(0.5) ? 0.3 : 1.4;
    }
    this.launchSave(p, cz, cy, g ? g.t * 0.85 : 0.45);
  }

  /** Con el balón en su poder: lo bloca y lo pone en juego. */
  withBall(dt) {
    const p = this.gk, m = this.m, ball = m.ball, team = this.team, dir = team.dir, rng = m.rng;
    const it = p.intent;
    if (m.setPiece && m.setPiece.taker === p) return;
    if (p.state === 'kick') return;
    if (!ball.held) {
      // Con los pies (cesión o balón fuera del área): pase seguro o balón largo
      if (p.state === 'free' && m.controlled !== p) this.distribute(true);
      return;
    }
    if (p.state === 'free') p.setState('hold');
    if (p.state !== 'hold') return;
    this.holdT += dt;
    // Avanza unos pasos hacia el borde del área pequeña
    const tx = (-HL + 7) * dir, tz = clamp(p.z, -6, 6);
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d > 0.5) { it.mx = dx / d; it.mz = dz / d; it.speed = 0.6; } else { it.mx = 0; it.mz = 0; it.speed = 0; }
    it.sprint = false;
    it.face = dir > 0 ? 0 : Math.PI;
    if (m.controlled === p) {
      // El usuario decide el saque; si no hace nada, el portero saca solo
      const u = clamp(p.x * dir, -HL + 1.5, -HL + BOX_D - 2.5);
      p.x = u * dir;
      p.z = clamp(p.z, -BOX_HW + 2, BOX_HW - 2);
      if (this.holdT > 4.5) this.distribute(false);
      return;
    }
    if (this.holdT > 1.3 + (p.ai.wait ?? (p.ai.wait = rng.next() * 1.2))) {
      p.ai.wait = undefined;
      this.distribute(false);
    }
  }

  distribute(feet) {
    const p = this.gk, m = this.m, ball = m.ball, team = this.team, rng = m.rng;
    let best = null, bs = -1e9;
    for (const t of team.players) {
      if (t === p) continue;
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d < 8 || d > 40) continue;
      const line = LINE_OF[t.role];
      if (line === 'ATT') continue;
      const open = Act.nearestOpponentDist(team, t.x, t.z);
      if (open < 7) continue;
      const lr = Act.laneRisk(team, p.x, p.z, t.x, t.z, 15);
      if (lr > 0.3) continue;
      const s = open * 0.1 - lr * 2 + (line === 'DEF' ? 0.3 : 0.1) + rng.next() * 0.4 - team.tactics.tempo * 0.4;
      if (s > bs) { bs = s; best = t; }
    }
    if (p.state === 'hold') p.setState('free');
    ball.held = false;
    if (best) {
      ball.y = 0.11;
      ball.x = p.x + p.dirX * 0.5; ball.z = p.z + p.dirZ * 0.5;
      Act.pass(m, p, { target: best, power: 0.45 });
    } else {
      // Saque largo hacia el compañero más adelantado
      let far = null, fu = -99;
      for (const t of team.players) {
        if (t === p) continue;
        const s = t.u + rng.next() * 12;
        if (s > fu) { fu = s; far = t; }
      }
      ball.y = feet ? 0.11 : 0.5;
      ball.x = p.x + p.dirX * 0.5; ball.z = p.z + p.dirZ * 0.5;
      Act.lob(m, p, { target: far, power: 1 });
    }
    this.holdT = 0;
  }
}
