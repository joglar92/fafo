// Reglamento: balón fuera, goles, fuera de juego, faltas, tarjetas y la
// colocación de los jugadores en cada saque.

import { clamp } from '../core/MathUtils.js';
import { PITCH, BALL, STATE } from '../core/Config.js';
import { LINE_OF } from '../data/TeamsData.js';
import { predictGoalCross } from './Physics.js';
import * as Act from './Actions.js';
import { decide } from './PlayerAI.js';
import { GESTURE } from './Referee.js';

const { HL, HW, GOAL_HW, GOAL_H, BOX_D, BOX_HW, SIX_D, PEN_SPOT, CIRCLE_R } = PITCH;

export class MatchRules {
  constructor(match) {
    this.m = match;
  }

  // -------------------------------------------------------------------------
  // Golpeos: foto del fuera de juego y registro de tiros
  // -------------------------------------------------------------------------
  onKick(p, meta) {
    const m = this.m, ball = m.ball;
    const sp = m.setPiece;
    let noOffside = meta.type === 'tackle';
    if (sp) {
      if (sp.type === 'THROW_IN' || sp.type === 'CORNER' || sp.type === 'GOAL_KICK') noOffside = true;
      if (sp.type === 'THROW_IN') ball.entering = true;
      m.setPieceTaken(p, meta);
    }
    ball.offside = null;
    if (!noOffside) {
      const team = p.team, dir = team.dir;
      let a = -99, c = -99;
      const opp = team.opponent.players;
      for (let i = 0; i < opp.length; i++) {
        const u = opp[i].x * dir;
        if (u > a) { c = a; a = u; } else if (u > c) c = u;
      }
      const line = Math.max(c, ball.x * dir, 0);
      let set = null;
      for (const t of team.players) {
        if (t !== p && t.x * dir > line + 0.3) (set || (set = [])).push({ p: t, x: t.x, z: t.z });
      }
      if (set) ball.offside = { team, set };
    }
    if (meta.type === 'shot' && meta.shot) {
      const team = p.team;
      team.stats.shots++;
      const g = predictGoalCross(ball, HL * team.dir, 3);
      const on = !!g && Math.abs(g.z) < GOAL_HW - 0.05 && g.y < GOAL_H - 0.05;
      meta.shot.onTarget = on;
      if (on) team.stats.onTarget++;
      m.lastShooter = { player: p, team, time: m.clock, xg: meta.shot.xg, onTarget: on };
      m.emit('shot', { player: p, team, xg: meta.shot.xg, onTarget: on, kind: meta.shot.kind, dist: meta.shot.dist });
    }
    // El control pasa al destinatario para que el usuario pueda recibir
    if (m.userTeam === p.team && meta.target && !sp) m.setControlled(meta.target);
  }

  /**
   * Un jugador toca el balón. Devuelve true si se ha pitado fuera de juego.
   */
  onTouch(p) {
    const m = this.m, ball = m.ball, off = ball.offside;
    if (!off) return false;
    if (off.team !== p.team) {
      ball.offside = null;
      return false;
    }
    if (m.state !== STATE.PLAYING) return false;
    for (const e of off.set) {
      if (e.p === p) {
        this.offside(p, e.x, e.z);
        return true;
      }
    }
    return false;
  }

  offside(p, x, z) {
    const m = this.m;
    p.team.stats.offsides++;
    m.ball.offside = null;
    m.ball.owner = null;
    m.ball.passTarget = null;
    m.referee.flag(x);
    m.referee.signal(GESTURE.whistle, 1.4);
    m.deadBall(STATE.OFFSIDE, 1.8, { type: 'FREE_KICK', team: p.team.opponent, x: clamp(x, -HL + 1, HL - 1), z: clamp(z, -HW + 1, HW - 1), indirect: true });
    m.emit('offside', { player: p, team: p.team });
    m.emit('whistle', { kind: 'short' });
  }

  // -------------------------------------------------------------------------
  // Balón fuera y goles
  // -------------------------------------------------------------------------
  checkBall() {
    const m = this.m, b = m.ball;
    if (b.held) return;
    const R = BALL.R;
    if (b.entering) {
      // Tras un saque de banda el balón sale de fuera del campo: aún no cuenta
      if (Math.abs(b.z) < HW && Math.abs(b.x) < HL) b.entering = false;
      else if (m.clock - b.kickTime > 1.2) b.entering = false;
      else return;
    }
    const last = b.lastTouch ? b.lastTouch.team : m.teams[0];
    if (b.inNet && Math.abs(b.x) > HL + R) {
      const scoring = m.teams[0].dir === b.inNet ? m.teams[0] : m.teams[1];
      m.goal(scoring);
      return;
    }
    // Tanda de penales: el balón que sale es fallo (no hay saques de banda/puerta)
    if (m.so && m.so.phase === 'ball') {
      if (Math.abs(b.z) > HW + R || Math.abs(b.x) > HL + R) { m.soMiss(); return; }
    }
    if (Math.abs(b.z) > HW + R && Math.abs(b.x) <= HL + R) {
      const x = clamp(b.x, -HL + 0.5, HL - 0.5), z = Math.sign(b.z) * HW;
      m.referee.signal(GESTURE.point, 1.2);
      m.deadBall(STATE.BALL_OUT, 1.1, { type: 'THROW_IN', team: last.opponent, x, z });
      m.emit('out', { kind: 'THROW_IN', team: last.opponent });
      return;
    }
    if (Math.abs(b.x) > HL + R && !b.inNet) {
      const s = Math.sign(b.x);
      const defending = m.teams[0].dir === -s ? m.teams[0] : m.teams[1];
      const kz = b.z >= 0 ? 1 : -1;
      m.referee.signal(GESTURE.point, 1.2);
      if (last === defending) {
        defending.opponent.stats.corners++;
        m.deadBall(STATE.BALL_OUT, 1.3, { type: 'CORNER', team: defending.opponent, x: s * HL, z: kz * HW });
        m.emit('out', { kind: 'CORNER', team: defending.opponent });
      } else {
        m.deadBall(STATE.BALL_OUT, 1.3, { type: 'GOAL_KICK', team: defending, x: s * (HL - SIX_D), z: kz * 5.5 });
        m.emit('out', { kind: 'GOAL_KICK', team: defending });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Faltas y tarjetas
  // -------------------------------------------------------------------------
  foul(offender, victim, info) {
    const m = this.m, rng = m.rng;
    if (m.state !== STATE.PLAYING) return;
    const team = offender.team;
    team.stats.fouls++;
    const x = clamp(victim.x, -HL + 0.5, HL - 0.5), z = clamp(victim.z, -HW + 0.5, HW - 0.5);
    victim.setState('down', 1.6, 0);
    // ¿Ocasión manifiesta de gol? El atacante solo tenía por delante al portero.
    const dir = team.dir;
    let coverers = 0;
    for (const d of team.players) {
      if (d.isGK || d === offender) continue;
      if (d.x * dir < victim.x * dir - 1) coverers++;
    }
    const lastMan = coverers === 0 && victim.x * dir < -HL + 30 && Math.abs(victim.z) < 18 && !info.noBall;
    const pY = 0.14 + (info.slide ? 0.3 : 0) + (info.behind ? 0.2 : 0) + (info.noBall ? 0.15 : 0);
    const pR = (info.slide && info.behind ? 0.07 : 0.004) + (lastMan ? 0.3 : 0);
    const r = rng.next();
    let card = null;
    if (r < pR) card = 'red';
    else if (r < pR + pY) card = 'yellow';
    if (card === 'yellow') {
      offender.yellow++;
      team.stats.yellow++;
      if (offender.yellow >= 2) card = 'second';
    }
    if (card === 'red' || card === 'second') team.stats.red++;
    const u = x * dir;
    const penalty = u < -HL + BOX_D && Math.abs(z) < BOX_HW;
    // LEY DE LA VENTAJA: falta leve sin tarjeta ni penal, con el atacado en ataque → dejar seguir
    if (!card && !penalty && !info.noBall && rng.chance(0.5) && victim.x * victim.team.dir > -HL + 20) {
      victim.setState('free');
      m.emit('advantage', { team: victim.team });
      return;
    }
    const b = m.ball;
    b.owner = null;
    b.held = false;
    b.passTarget = null;
    b.offside = null;
    b.vx *= 0.3; b.vz *= 0.3;
    m.refSpot = { x: x + (dir > 0 ? 2 : -2), z: z + 2 };
    m.foulInfo = { offender, victim, card, penalty, x, z };
    const next = penalty
      ? { type: 'PENALTY', team: victim.team }
      : { type: 'FREE_KICK', team: victim.team, x, z };
    m.deadBall(STATE.FOUL, card ? 3.2 : 2.1, next);
    m.emit('whistle', { kind: 'long' });
    m.emit('foul', { offender, victim, card, penalty, team });
  }

  /** A mitad de la pausa por falta: el árbitro enseña la tarjeta. */
  showCard() {
    const m = this.m, f = m.foulInfo;
    if (!f || !f.card || f.shown) return;
    f.shown = true;
    m.referee.signal(f.card === 'yellow' ? GESTURE.yellow : GESTURE.red, 1.8);
    m.emit('card', { player: f.offender, card: f.card, team: f.offender.team });
  }

  /** Al terminar la pausa: el expulsado abandona el campo. */
  applyCard() {
    const m = this.m, f = m.foulInfo;
    if (!f) return;
    if (f.card === 'red' || f.card === 'second') {
      const p = f.offender, team = p.team;
      p.sentOff = true;
      team.remove(p);
      if (p.isGK && team.players.length) {
        // Un jugador de campo se pone bajo palos
        const sub = team.players.reduce((a, b) => ((a.a.defensa + a.a.fisico) > (b.a.defensa + b.a.fisico) ? a : b));
        sub.isGK = true;
        sub.role = 'GK';
        sub.slot = { role: 'GK', d: -0.5, w: 0 };
        sub.a.porteria = 52;
        team.gk = sub;
      }
      if (m.controlled === p) m.setControlled(null);
    }
    m.foulInfo = null;
    m.refSpot = null;
  }

  // -------------------------------------------------------------------------
  // Colocación para los saques
  // -------------------------------------------------------------------------

  /** Coloca a los dos equipos según su táctica con el balón en (bx,bz). */
  placeGeneric(team, bx, bz, minDist, opts = {}) {
    const m = this.m, ball = m.ball;
    ball.x = bx; ball.z = bz;
    const order = [team.opponent, team];
    for (const T of order) {
      const ai = m.ais[T.side], dir = T.dir;
      ai.attackness = T === team ? (opts.attack ?? 0.8) : (opts.defend ?? 0.15);
      ai.computeShape();
      for (const p of T.players) {
        if (p.isGK) {
          p.place((-HL + 2.5) * dir, clamp(bz * 0.05, -2, 2), dir > 0 ? 0 : Math.PI);
          continue;
        }
        ai.anchor(p);
        let u = p.ai.au, v = p.ai.av;
        if (T === team) u = Math.min(u, ai.offsideU - 0.8);
        if (opts.ownHalf) u = Math.min(u, -1);
        let x = u * dir, z = v * dir;
        const dx = x - bx, dz = z - bz;
        const d = Math.hypot(dx, dz);
        const min = T === team ? 3 : minDist;
        if (d < min) {
          const k = min / (d || 1);
          x = bx + (d ? dx : -dir) * k;
          z = bz + (d ? dz : 0.5) * k;
        }
        if (opts.outOfBox && T !== team) {
          // Nadie del rival dentro del área en un saque de puerta
          const s = Math.sign(bx);
          if (s * x > HL - BOX_D - 1.5 && Math.abs(z) < BOX_HW + 1.5) x = s * (HL - BOX_D - 2 - m.rng.next() * 3);
        }
        x = clamp(x, -HL + 1, HL - 1);
        z = clamp(z, -HW + 1, HW - 1);
        p.place(x, z, Math.atan2(bz - z, bx - x));
        p.ai.runMode = 'rest';
        p.ai.runTo = null;
      }
    }
  }

  nearestOutfield(team, x, z, filter) {
    let best = null, bd = 1e9;
    for (const p of team.players) {
      if (p.isGK || (filter && !filter(p))) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** Prepara un saque. Devuelve el descriptor que guarda el partido. */
  setup(next) {
    const m = this.m, ball = m.ball, rng = m.rng;
    const team = next.team, dir = team.dir;
    const type = next.type;
    ball.reset(ball.x, ball.z);
    for (const T of m.teams) for (const p of T.players) { p.fixed = false; p.holdHigh = false; }
    let taker = null, minDist = CIRCLE_R, bx = next.x, bz = next.z, face = 0;
    const sp = { type, team, taker: null, minDist, t: 0, delay: 1.6 + rng.next() * 0.8, direct: false };

    if (type === 'KICKOFF') {
      bx = 0; bz = 0;
      this.placeGeneric(team, 0, 0, CIRCLE_R + 0.3, { attack: 0.35, defend: 0.3, ownHalf: true });
      // El rival también en su campo
      for (const p of team.opponent.players) {
        if (p.isGK) continue;
        if (p.x * team.opponent.dir > -1) p.x = -1.2 * team.opponent.dir;
        const d = Math.hypot(p.x, p.z);
        if (d < CIRCLE_R + 0.3) { const k = (CIRCLE_R + 0.5) / (d || 1); p.x *= k; p.z = (p.z || 1) * k; }
      }
      const fw = team.players.filter((p) => !p.isGK).sort((a, b) => b.slot.d - a.slot.d);
      taker = fw[0];
      taker.place(-0.5 * dir, 0.15, dir > 0 ? Math.PI : 0);
      if (fw[1]) fw[1].place(-3.5 * dir, 5, dir > 0 ? 0 : Math.PI);
      face = taker.facing;
      sp.delay = 1.2;
    } else if (type === 'THROW_IN') {
      minDist = 2.5;
      this.placeGeneric(team, bx, bz, minDist, { attack: 0.7, defend: 0.2 });
      taker = this.nearestOutfield(team, bx, bz, (p) => p.role !== 'CB' && p.role !== 'ST') || this.nearestOutfield(team, bx, bz);
      const k = Math.sign(bz);
      face = Math.atan2(-k, dir * 0.35);
      taker.place(bx, k * (HW + 0.35), face);
      // Dos apoyos cercanos para el saque
      const near = team.players.filter((p) => !p.isGK && p !== taker)
        .sort((a, b) => Math.hypot(a.x - bx, a.z - bz) - Math.hypot(b.x - bx, b.z - bz));
      if (near[0]) near[0].place(clamp(bx + dir * 7, -HL + 2, HL - 2), k * (HW - 7), Math.atan2(k, 0));
      if (near[1]) near[1].place(clamp(bx - dir * 5, -HL + 2, HL - 2), k * (HW - 9), Math.atan2(k, 0));
      sp.delay = 1.1 + rng.next() * 0.7;
    } else if (type === 'GOAL_KICK') {
      this.placeGeneric(team, bx, bz, CIRCLE_R, { attack: 0.55, defend: 0.35, outOfBox: true });
      taker = team.gk;
      face = dir > 0 ? 0 : Math.PI;
      taker.place(bx - dir * 0.5, bz, face);
      // Centrales abiertos para salir jugando
      const cbs = team.players.filter((p) => p.role === 'CB');
      cbs.forEach((p, i) => {
        const k = cbs.length === 1 ? 0 : (i / (cbs.length - 1)) * 2 - 1;
        p.place((-HL + BOX_D + 1.5) * dir, k * 15 * dir, face);
      });
    } else if (type === 'CORNER') {
      const s = Math.sign(bx), k = Math.sign(bz);
      bx = s * (HL - 0.45); bz = k * (HW - 0.45);
      this.placeCorner(team, bx, bz, sp);
      taker = sp.taker;
      face = Math.atan2(-k, -s * 0.2);
      taker.place(s * (HL + 0.25), k * (HW + 0.45), face);
      sp.delay = 2 + rng.next();
    } else if (type === 'PENALTY') {
      bx = (HL - PEN_SPOT) * dir; bz = 0;
      this.placePenalty(team, bx, sp);
      taker = sp.taker;
      face = dir > 0 ? 0 : Math.PI;
      taker.place(bx - dir * 0.6, 0, face);
      sp.delay = 2.2 + rng.next() * 0.6;
      sp.direct = true;
    } else {
      // FREE_KICK
      const dGoal = Math.hypot(HL * dir - bx, bz);
      const direct = !next.indirect && dGoal < 30 && Math.abs(bz) < 22 && dGoal > 13;
      this.placeGeneric(team, bx, bz, CIRCLE_R + 0.2, { attack: bx * dir > 0 ? 0.85 : 0.6, defend: 0.1 });
      sp.direct = direct;
      if (direct) {
        taker = team.best((p) => p.a.tiro * 0.6 + p.a.pase * 0.4);
        this.buildWall(team.opponent, bx, bz, dGoal < 22 ? 4 : 3);
      } else if (bx * dir < -HL + 30) {
        taker = this.nearestOutfield(team, bx, bz, (p) => LINE_OF[p.role] === 'DEF') || this.nearestOutfield(team, bx, bz);
      } else {
        taker = bx * dir > 10 ? team.best((p) => p.a.pase) : this.nearestOutfield(team, bx, bz);
      }
      face = Math.atan2(-bz * (direct ? 1 : 0.2), HL * dir - bx);
      taker.place(bx - Math.cos(face) * 0.6, bz - Math.sin(face) * 0.6, face);
      sp.delay = direct ? 2.4 + rng.next() : 1.5 + rng.next() * 0.8;
    }

    sp.taker = taker;
    sp.minDist = minDist;
    sp.bx = bx; sp.bz = bz;
    taker.fixed = true;
    ball.x = bx; ball.z = bz; ball.y = BALL.R;
    ball.owner = taker;
    ball.lastTouch = taker;
    if (type === 'THROW_IN') {
      ball.held = true;
      taker.holdHigh = true;
    } else {
      // El balón queda delante del pie del lanzador
      taker.x = bx - Math.cos(face) * 0.42;
      taker.z = bz - Math.sin(face) * 0.42;
    }
    return sp;
  }

  buildWall(defTeam, bx, bz, n) {
    const dir = defTeam.dir; // su portería está en -HL*dir
    const gx = -HL * dir;
    // La barrera tapa el palo corto
    const nearZ = Math.sign(bz || 1) * (GOAL_HW - 1.2);
    let wx = gx - bx, wz = nearZ - bz;
    const l = Math.hypot(wx, wz) || 1;
    wx /= l; wz /= l;
    const cx = bx + wx * CIRCLE_R, cz = bz + wz * CIRCLE_R;
    const px = -wz, pz = wx;
    const cands = defTeam.players.filter((p) => !p.isGK)
      .sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz)).slice(0, n);
    cands.forEach((p, i) => {
      const o = (i - (n - 1) / 2) * 0.62;
      p.place(cx + px * o, cz + pz * o, Math.atan2(-wz, -wx));
      p.ai.wall = true;
    });
  }

  wallJump(defTeam) {
    for (const q of defTeam.players) {
      if (q.ai.wall && q.state === 'free') { q.jumpH = 0.4; q.setState('jump', 0.6, 0); }
    }
  }

  placeCorner(team, bx, bz, sp) {
    const m = this.m, dir = team.dir, opp = team.opponent;
    const kv = Math.sign(bz * dir); // lado del córner en coordenadas del atacante
    const taker = team.best((p) => p.a.pase + (LINE_OF[p.role] === 'DEF' ? -15 : 0));
    sp.taker = taker;
    const rest = team.players.filter((p) => !p.isGK && p !== taker);
    const aerial = (p) => p.a.fisico + p.a.fuerza + (p.role === 'CB' || p.role === 'ST' ? 12 : 0);
    rest.sort((a, b) => aerial(b) - aerial(a));
    const box = [[HL - 5, kv * 3.5], [HL - 6, -kv * 4.6], [HL - 11, 0], [HL - 7.5, kv * 0.6], [HL - 17, -kv * 3]];
    const attackers = [];
    let i = 0;
    for (; i < box.length && i < rest.length; i++) {
      const p = rest[i];
      p.place(box[i][0] * dir, box[i][1] * dir, Math.atan2(bz - box[i][1] * dir, bx - box[i][0] * dir));
      attackers.push(p);
    }
    const others = rest.slice(i).sort((a, b) => b.a.ritmo - a.a.ritmo);
    const spots = [[-2, 9], [-4, -10], [HL - 6, kv * (HW - 10)], [HL - 22, kv * 4]];
    others.forEach((p, k) => {
      const s = spots[k] || [HL - 26, -kv * 8];
      p.place(s[0] * dir, s[1] * dir, Math.atan2(bz - s[1] * dir, bx - s[0] * dir));
    });
    team.gk.place((-HL + 14) * dir, 0, dir > 0 ? 0 : Math.PI);

    // Defensa
    const odir = opp.dir, gx = -HL * odir;
    opp.gk.place(gx + odir * 0.9, Math.sign(bz) * 0.8, Math.atan2(bz, bx - gx));
    const defs = opp.players.filter((p) => !p.isGK).sort((a, b) => (b.a.defensa + b.a.fuerza) - (a.a.defensa + a.a.fuerza));
    let k = 0;
    for (const a of attackers) {
      const d = defs[k++];
      if (!d) break;
      let gdx = gx - a.x, gdz = -a.z;
      const gl = Math.hypot(gdx, gdz) || 1;
      d.place(a.x + (gdx / gl) * 0.9, a.z + (gdz / gl) * 0.9, Math.atan2(bz - a.z, bx - a.x));
    }
    const extra = [
      [gx + odir * 0.6, Math.sign(bz) * (GOAL_HW - 0.4)],            // palo corto
      [gx + odir * 5.5, 0],                                           // área pequeña
      [bx + Math.sign(-bx) * 8.5, bz - Math.sign(bz) * 6],            // vigila el saque en corto
      [gx + odir * 42, Math.sign(bz) * 8], [gx + odir * 48, -Math.sign(bz) * 10], // descolgados
    ];
    for (let e = 0; k < defs.length; k++, e++) {
      const s = extra[e] || [gx + odir * 20, 0];
      defs[k].place(s[0], s[1], Math.atan2(bz - s[1], bx - s[0]));
    }
    m.ais[team.side].attackness = 0.9;
    m.ais[opp.side].attackness = 0.1;
  }

  placePenalty(team, bx, sp) {
    const m = this.m, dir = team.dir, opp = team.opponent;
    const taker = team.best((p) => p.a.tiro);
    sp.taker = taker;
    opp.gk.place(HL * dir - dir * 0.15, 0, dir > 0 ? Math.PI : 0);
    team.gk.place((-HL + 6) * dir, 0, dir > 0 ? 0 : Math.PI);
    const others = [];
    for (const T of m.teams) for (const p of T.players) if (!p.isGK && p !== taker) others.push(p);
    const n = others.length;
    others.forEach((p, i) => {
      const v = (i - (n - 1) / 2) * 2.1;
      const u = HL - BOX_D - (Math.abs(v) < 9 ? 4.2 : 1) - (i % 2) * 1.2;
      p.place(u * dir, v, Math.atan2(-v, bx - u * dir));
    });
    m.ais[team.side].attackness = 0.9;
    m.ais[opp.side].attackness = 0.1;
  }

  // -------------------------------------------------------------------------
  // Saques ejecutados por la IA
  // -------------------------------------------------------------------------
  aiTake(sp) {
    const m = this.m, rng = m.rng, p = sp.taker, team = sp.team, dir = team.dir;
    switch (sp.type) {
      case 'KICKOFF': {
        const t = team.players.filter((q) => !q.isGK && q !== p && LINE_OF[q.role] === 'MID')
          .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
        Act.pass(m, p, { target: t || undefined, power: 0.2 });
        break;
      }
      case 'THROW_IN': {
        let best = null, bs = -1e9;
        for (const t of team.players) {
          if (t === p || t.isGK) continue;
          const d = Math.hypot(t.x - p.x, t.z - p.z);
          if (d < 3 || d > 22) continue;
          const s = Act.nearestOpponentDist(team, t.x, t.z) * 0.25 - d * 0.06 + (t.x - p.x) * dir * 0.03 + rng.next() * 0.5;
          if (s > bs) { bs = s; best = t; }
        }
        Act.throwIn(m, p, { target: best || undefined, long: best && Math.hypot(best.x - p.x, best.z - p.z) > 17 });
        break;
      }
      case 'GOAL_KICK':
        m.gks[team.side].distribute(true);
        break;
      case 'CORNER': {
        if (rng.chance(0.14)) {
          const t = this.nearestOutfield(team, p.x, p.z, (q) => q !== p);
          Act.pass(m, p, { target: t, power: 0.3 });
        } else {
          const zone = rng.pick(['near', 'spot', 'spot', 'far']);
          const side = Math.sign(p.z * dir);
          Act.cross(m, p, { zone, curl: (rng.chance(0.5) ? 1 : -1) * side * 0.4 });
        }
        break;
      }
      case 'PENALTY': {
        const z = (rng.chance(0.5) ? 1 : -1) * (1.6 + rng.next() * 1.6);
        Act.shoot(m, p, { power: 0.45 + rng.next() * 0.25, aimZ: z, aimY: 0.2 + rng.next() * 1.5, sigmaMul: 0.75 });
        break;
      }
      default: {
        // FREE_KICK
        const b = m.ball;
        if (sp.direct) {
          const gk = team.opponent.gk;
          const z = (gk.z > 0 ? -1 : 1) * (2.4 + rng.next() * 0.8);
          Act.shoot(m, p, { power: 0.36 + rng.next() * 0.12, aimZ: z, aimY: 1.5 + rng.next() * 0.7, curl: -Math.sign(z) * dir * 0.35, sigmaMul: 0.9 });
          this.wallJump(team.opponent);
        } else if (b.x * dir > HL - 34 && Math.abs(b.z) > 12) {
          Act.cross(m, p, { zone: rng.pick(['near', 'spot', 'far']) });
        } else {
          const act = decide(m, p, m.ais[team.side], 0);
          if (act.type === 'pass') Act.pass(m, p, { target: act.t, power: 0.3 });
          else if (act.type === 'lob') Act.lob(m, p, { target: act.t });
          else if (act.type === 'through') Act.throughPass(m, p, { plan: act.plan });
          else if (act.type === 'cross') Act.cross(m, p, { zone: act.zone });
          else {
            const t = this.nearestOutfield(team, p.x, p.z, (q) => q !== p && Math.hypot(q.x - p.x, q.z - p.z) > 5);
            if (b.x * dir < -15 && rng.chance(0.5)) Act.lob(m, p, { dirx: dir, dirz: 0, power: 0.8 });
            else Act.pass(m, p, { target: t || undefined, power: 0.3 });
          }
        }
      }
    }
  }
}
