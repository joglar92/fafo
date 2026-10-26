// Control del jugador humano: convierte la entrada en movimiento y acciones
// del futbolista seleccionado, tanto en juego abierto como en los saques.

import { clamp } from '../core/MathUtils.js';
import { PITCH, STATE } from '../core/Config.js';
import * as Act from './Actions.js';

const { HL } = PITCH;
const CHARGE_TIME = 0.85;

export class UserControl {
  constructor(match, input) {
    this.m = match;
    this.input = input;
    this.charge = null;   // { type, t, finesse }
    this.idle = true;
    this.lastKind = '';
  }

  get power() {
    return this.charge ? clamp(this.charge.t / CHARGE_TIME, 0, 1) : 0;
  }

  /** Lado al que se tira el portero del usuario en un penalti (o null = decide la IA). */
  penaltySide() {
    const z = this.input.move.z;
    return Math.abs(z) > 0.3 ? Math.sign(z) : null;
  }

  canPlay(p) {
    const b = this.m.ball;
    if (b.owner === p) return true;
    if (b.owner) return false;
    return Math.hypot(b.x - p.x, b.z - p.z) < 1.35 && b.y < 1.1;
  }

  update(dt) {
    const m = this.m, inp = this.input, p = m.controlled;
    const mv = inp.move;
    this.idle = !(mv.x || mv.z);
    if (!p) { inp.endStep(); return; }
    const st = m.state, sp = m.setPiece, ball = m.ball;
    if (st === STATE.GOAL || p.state === 'celeb') { this.charge = null; inp.endStep(); return; }
    const taking = !!sp && sp.taker === p;
    const it = p.intent;

    if (inp.pressed('switch') && !taking) m.switchPlayer();

    // --- Movimiento ---
    if (taking) {
      p.stop();
      if (!this.idle) {
        p.turnToward(Math.atan2(mv.z, mv.x), 4, dt);
        if (!ball.held) {
          p.x = sp.bx - Math.cos(p.facing) * 0.42;
          p.z = sp.bz - Math.sin(p.facing) * 0.42;
        }
      }
    } else if (!this.idle) {
      it.mx = mv.x; it.mz = mv.z;
      it.speed = 1;
      it.sprint = inp.down('sprint');
      it.face = null;
    } else if (!m.assist(p) && !(p.isGK && ball.owner === p && ball.held)) {
      p.stop();
      it.face = null;
    }

    const canAct = st === STATE.PLAYING || (taking && !sp.intro && st !== STATE.INTRO);
    if (!canAct) { this.charge = null; inp.endStep(); return; }

    const has = ball.owner === p;
    const canPlay = this.canPlay(p);
    const attacking = canPlay || m.possession === p.team;

    // --- Protección del balón ---
    p.shielding = false;
    if (has && !taking && !ball.held && inp.down('shield')) {
      let near = null, nd = 4.5;
      for (const o of p.team.opponent.players) {
        const d = Math.hypot(o.x - p.x, o.z - p.z);
        if (d < nd) { nd = d; near = o; }
      }
      if (near) {
        p.shielding = true;
        p.shieldX = (p.x - near.x) / (nd || 1);
        p.shieldZ = (p.z - near.z) / (nd || 1);
        it.face = Math.atan2(p.shieldZ, p.shieldX);
      }
    }
    // --- Contención ---
    if (!attacking && inp.down('shield') && ball.owner && ball.owner.team !== p.team) {
      const c = ball.owner;
      const gx = -HL * p.team.dir;
      let gdx = gx - c.x, gdz = -c.z;
      const gl = Math.hypot(gdx, gdz) || 1;
      const tx = c.x + (gdx / gl) * 2.3 + c.vx * 0.2, tz = c.z + (gdz / gl) * 2.3 + c.vz * 0.2;
      if (this.idle) {
        const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
        if (d > 0.3) { it.mx = dx / d; it.mz = dz / d; it.speed = clamp(d / 2, 0.3, 1); it.sprint = d > 6; }
      } else it.speed = 0.8;
      it.face = Math.atan2(ball.z - p.z, ball.x - p.x);
    }
    m.ais[p.team.side].teammatePress = !attacking && inp.down('through');

    if (attacking) this.attackInput(p, taking, dt);
    else this.defenseInput(p);
    inp.endStep();
  }

  attackInput(p, taking, dt) {
    const m = this.m, inp = this.input, mv = inp.move;
    if (!this.charge) {
      for (const type of ['pass', 'lob', 'shoot']) {
        if (inp.pressed(type)) { this.charge = { type, t: 0, finesse: false }; break; }
      }
    }
    const c = this.charge;
    if (c) {
      c.t += dt;
      if (c.type === 'shoot' && inp.down('shield')) c.finesse = true;
      if (c.type === 'shoot') this.lastKind = Act.SHOT_NAMES[Act.shotKind(this.power, c.finesse)];
      if (inp.released(c.type) || !inp.down(c.type) || c.t > CHARGE_TIME + 0.2) {
        const power = this.power;
        this.charge = null;
        this.fire(p, c.type, power, c.finesse);
      }
    }
    if (inp.pressed('through')) this.fire(p, 'through', 0.5, false);
    if (inp.pressed('chip')) this.fire(p, 'chip', 0.5, false);
    if (inp.pressed('feint') && !taking) Act.feint(m, p, mv.x, mv.z);
  }

  defenseInput(p) {
    const m = this.m, inp = this.input, mv = inp.move;
    this.charge = null;
    if (inp.pressed('pass')) Act.startTackle(m, p, false, mv.x, mv.z);
    else if (inp.pressed('shoot')) Act.startTackle(m, p, true, mv.x, mv.z);
    // Despeje anticipado: se ejecuta en cuanto llegue al balón (o de cabeza)
    if (inp.pressed('lob')) p.queued = { type: 'lob', power: 0.6, finesse: false, x: mv.x, z: mv.z, t: 0.9 };
  }

  fire(p, type, power, finesse) {
    const m = this.m, ball = m.ball, mv = this.input.move;
    if (!this.canPlay(p)) {
      // Todavía no llega al balón: se guarda para rematar o pasar de primeras
      p.queued = { type, power, finesse, x: mv.x, z: mv.z, t: 0.7 };
      return;
    }
    if (p.state !== 'free' && p.state !== 'hold') return;
    const sp = m.setPiece;
    const o = { dirx: mv.x, dirz: mv.z, power, finesse };
    if (sp && sp.taker === p) { this.fireSetPiece(p, sp, type, o); return; }
    if (ball.owner === p && ball.held) {
      // Portero con el balón en las manos
      ball.held = false;
      if (p.state === 'hold') p.setState('free');
      ball.x = p.x + p.dirX * 0.5; ball.z = p.z + p.dirZ * 0.5;
      if (type === 'pass' || type === 'through') { ball.y = 0.11; Act.pass(m, p, o); }
      else { ball.y = 0.5; Act.lob(m, p, { ...o, power: Math.max(0.6, power) }); }
      return;
    }
    this.openPlay(p, type, o);
  }

  openPlay(p, type, o) {
    const m = this.m;
    switch (type) {
      case 'pass': return Act.pass(m, p, o);
      case 'through': return Act.throughPass(m, p, o);
      case 'lob': {
        const u = p.u, v = p.v;
        const first = m.ball.owner !== p;
        if (u > HL - 30 && Math.abs(v) > 11) return Act.cross(m, p, { power: o.power });
        if (u < -HL + 26 && (first || Act.pressure(m, p) > 0.7)) return Act.clearBall(m, p, o);
        return Act.lob(m, p, o);
      }
      case 'shoot': return Act.shoot(m, p, o);
      case 'chip': return Act.chip(m, p, o);
      default: return false;
    }
  }

  /** Acción que quedó en cola y se ejecuta al primer contacto con el balón. */
  fireQueued(p) {
    const q = p.queued;
    p.queued = null;
    if (!q || p.state !== 'free') return false;
    const mv = this.input.move;
    const has = mv.x || mv.z;
    return !!this.openPlay(p, q.type, { dirx: has ? mv.x : q.x, dirz: has ? mv.z : q.z, power: q.power, finesse: q.finesse });
  }

  fireSetPiece(p, sp, type, o) {
    const m = this.m;
    const dir = p.team.dir;
    switch (sp.type) {
      case 'THROW_IN':
        Act.throwIn(m, p, { dirx: o.dirx, dirz: o.dirz, long: type === 'lob' || type === 'shoot' });
        break;
      case 'PENALTY': {
        if (type !== 'shoot' && type !== 'chip') return;
        const z = Math.abs(o.dirz) > 0.3 ? Math.sign(o.dirz) * (2.1 + o.power * 1.1) : (m.rng.next() - 0.5) * 1.6;
        Act.shoot(m, p, { power: clamp(0.35 + o.power * 0.5, 0, 0.9), aimZ: z, aimY: 0.2 + o.power * 2.0, sigmaMul: 0.75 + o.power * 0.6 });
        break;
      }
      case 'CORNER':
        if (type === 'pass' || type === 'through') Act.pass(m, p, o);
        else {
          const side = Math.sign(p.z * dir);
          // Con dirección hacia portería el balón se cierra; si no, se abre
          const inswing = o.dirx * dir > 0.3;
          Act.cross(m, p, { power: o.power, curl: (inswing ? 1 : -1) * side * 0.42 });
        }
        break;
      case 'GOAL_KICK':
        if (type === 'pass' || type === 'through') Act.pass(m, p, o);
        else Act.lob(m, p, { ...o, power: Math.max(0.6, o.power) });
        break;
      case 'KICKOFF':
        Act.pass(m, p, o);
        break;
      default: {
        // FREE_KICK
        if (type === 'pass') Act.pass(m, p, o);
        else if (type === 'through') Act.throughPass(m, p, o);
        else if (type === 'lob') {
          if (p.u > HL - 36 && Math.abs(p.v) > 10) Act.cross(m, p, { power: o.power });
          else Act.lob(m, p, o);
        } else {
          const gk = p.team.opponent.gk;
          const z = Math.abs(o.dirz) > 0.3 ? Math.sign(o.dirz) * 2.9 : (gk && gk.z > 0 ? -2.7 : 2.7);
          Act.shoot(m, p, {
            power: 0.3 + o.power * 0.35, aimZ: z, aimY: 1.2 + o.power * 1.3,
            curl: o.finesse ? -Math.sign(z) * dir * 0.5 : -Math.sign(z) * dir * 0.2, sigmaMul: 0.9,
          });
          m.rules.wallJump(p.team.opponent);
        }
      }
    }
  }
}
