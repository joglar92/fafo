// Jugador: estado físico, locomoción con inercia, cansancio y estados de acción.
// Las decisiones vienen de fuera (IA o usuario) a través de player.intent.

import { clamp, angDiff } from '../core/MathUtils.js';
import { PITCH } from '../core/Config.js';
import { resolveTackle } from './Actions.js';

export const PSTATE = {
  free: 0, kick: 1, tackle: 2, slide: 3, down: 4, jump: 5, dive: 6,
  hold: 7, throw: 8, celeb: 9, stun: 10, gesture: 11,
};

export class Player {
  constructor(team, entry, index) {
    this.team = team;
    this.data = entry.player;
    this.a = entry.player.attrs;
    this.slot = entry.slot;
    this.role = entry.slot.role;
    this.isGK = this.role === 'GK';
    this.index = index;
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vz = 0;
    this.facing = team.dir > 0 ? 0 : Math.PI;
    this.stamina = 1;
    this.fatigue = 0;
    this.state = 'free';
    this.stateT = 0;
    this.stateDur = 0;
    this.aux = 0;               // dato extra para la animación
    this.runPhase = 0;
    this.intent = { mx: 0, mz: 0, speed: 0, sprint: false, face: null };
    this.cooldownControl = 0;
    this.cooldownTackle = 0;
    this.cooldownFeint = 0;
    this.feintT = 0;
    this.shielding = false;
    this.pending = null;        // golpeo pendiente de soltar
    this.kickAngle = 0;
    this.tackleDir = 0;
    this.tackleResolved = true;
    this.queued = null;         // acción en cola para rematar de primeras
    this.yellow = 0;
    this.sentOff = false;
    this.fixed = false;         // colocado para un saque: no se desplaza
    this.holdHigh = false;
    this.dive = null;
    this.jumpH = 0;
    this.ai = { decT: 0, holdT: 0, runMode: 'rest', runT: Math.random() * 3, icept: { x: 0, z: 0, t: 0 }, eta: 9, au: 0, av: 0, supT: 0 };
    this.dist = 0;              // distancia recorrida (estadística)
  }

  get dirX() { return Math.cos(this.facing); }
  get dirZ() { return Math.sin(this.facing); }
  get speed() { return Math.hypot(this.vx, this.vz); }
  get u() { return this.x * this.team.dir; }
  get v() { return this.z * this.team.dir; }

  /** Velocidad punta actual (el cansancio la reduce). */
  topSpeed() {
    const base = 4.8 + (4.0 * this.a.ritmo) / 100;
    return base * (0.8 + 0.2 * Math.pow(this.stamina, 0.6)) * (1 - 0.1 * this.fatigue);
  }

  accel() {
    return 7 + (8 * this.a.aceleracion) / 100;
  }

  setState(state, dur = 0, aux = 0) {
    this.state = state;
    this.stateT = 0;
    this.stateDur = dur;
    this.aux = aux;
    if (state !== 'kick' && state !== 'throw') this.pending = null;
  }

  place(x, z, facing) {
    this.x = x; this.z = z; this.y = 0;
    this.vx = 0; this.vz = 0;
    if (facing !== undefined) this.facing = facing;
    this.intent.mx = 0; this.intent.mz = 0; this.intent.speed = 0; this.intent.sprint = false; this.intent.face = null;
    if (this.state !== 'free') this.setState('free');
    this.pending = null;
    this.queued = null;
    this.shielding = false;
    this.holdHigh = false;
  }

  stop() {
    const it = this.intent;
    it.mx = 0; it.mz = 0; it.speed = 0; it.sprint = false;
  }

  /** Movimiento con aceleración, frenada e inercia en los giros. */
  locomote(dt, limit, hasBall) {
    const it = this.intent;
    let mx = it.mx, mz = it.mz, target = 0;
    const len = Math.hypot(mx, mz);
    let sprinting = false;
    if (len > 1e-3 && !this.fixed) {
      mx /= len; mz /= len;
      const top = this.topSpeed();
      sprinting = it.sprint && this.stamina > 0.04;
      target = (sprinting ? top : top * 0.7) * clamp(it.speed, 0, 1) * limit;
      if (hasBall) target *= 0.86 + (0.08 * this.a.regate) / 100;
      if (this.shielding) target = Math.min(target, 2.3);
    }
    const dvx = mx * target - this.vx, dvz = mz * target - this.vz;
    const dv = Math.hypot(dvx, dvz);
    if (dv > 1e-5) {
      const braking = this.vx * dvx + this.vz * dvz < 0;
      const a = braking ? 11 + (7 * this.a.aceleracion) / 100 : this.accel();
      const step = Math.min(dv, a * dt);
      this.vx += (dvx / dv) * step;
      this.vz += (dvz / dv) * step;
    }
    const sp = this.speed;
    // Cansancio a corto plazo (sprint) y a largo plazo (fatiga del partido)
    if (sprinting && sp > 5) {
      this.stamina = Math.max(0, this.stamina - dt * (0.075 - (0.045 * this.a.resistencia) / 100));
    } else {
      this.stamina = Math.min(1, this.stamina + dt * (sp < 2 ? 0.05 : 0.026) * (1 - 0.4 * this.fatigue));
    }
    // Orientación del cuerpo
    let want = null;
    if (it.face !== null) want = it.face;
    else if (sp > 0.6) want = Math.atan2(this.vz, this.vx);
    if (want !== null) this.turnToward(want, sp > 5 ? 7 : 10, dt);
  }

  turnToward(angle, rate, dt) {
    const d = angDiff(this.facing, angle);
    const step = rate * dt;
    this.facing += clamp(d, -step, step);
  }

  update(dt, match) {
    this.stateT += dt;
    if (this.cooldownControl > 0) this.cooldownControl -= dt;
    if (this.cooldownTackle > 0) this.cooldownTackle -= dt;
    if (this.cooldownFeint > 0) this.cooldownFeint -= dt;
    if (this.feintT > 0) this.feintT -= dt;
    if (this.queued && (this.queued.t -= dt) <= 0) this.queued = null;
    const hasBall = match.ball.owner === this;
    const p = this.stateDur > 0 ? this.stateT / this.stateDur : 1;

    switch (this.state) {
      case 'free':
        this.locomote(dt, 1, hasBall);
        break;
      case 'hold':
        this.locomote(dt, 0.45, false);
        break;
      case 'celeb':
        this.locomote(dt, 0.8, false);
        break;
      case 'stun':
        this.locomote(dt, 0.35, false);
        if (p >= 1) this.setState('free');
        break;
      case 'kick':
      case 'throw': {
        const keep = this.intent.face;
        this.intent.face = this.kickAngle;
        this.locomote(dt, this.state === 'throw' ? 0 : 0.6, hasBall);
        this.intent.face = keep;
        if (this.pending && this.stateT >= this.pending.at) {
          const fn = this.pending.fn;
          this.pending = null;
          fn();
        }
        if (p >= 1 && this.state !== 'free') this.setState('free');
        break;
      }
      case 'tackle': {
        const sp = p < 0.5 ? 6.2 : 6.2 * (1 - (p - 0.5) * 1.6);
        this.vx = Math.cos(this.tackleDir) * Math.max(0.6, sp);
        this.vz = Math.sin(this.tackleDir) * Math.max(0.6, sp);
        this.facing = this.tackleDir;
        if (!this.tackleResolved && p > 0.15 && p < 0.8) resolveTackle(match, this);
        if (p >= 1) {
          this.cooldownTackle = Math.max(this.cooldownTackle, 0.35);
          this.setState('free');
        }
        break;
      }
      case 'slide': {
        const sp = 8.2 * Math.pow(Math.max(0, 1 - p), 1.15);
        this.vx = Math.cos(this.tackleDir) * sp;
        this.vz = Math.sin(this.tackleDir) * sp;
        this.facing = this.tackleDir;
        if (!this.tackleResolved && p > 0.08 && p < 0.75) resolveTackle(match, this);
        if (p >= 1) {
          this.cooldownTackle = Math.max(this.cooldownTackle, 0.5);
          this.setState('down', 0.65, 1);
        }
        break;
      }
      case 'down': {
        this.vx *= Math.max(0, 1 - 6 * dt);
        this.vz *= Math.max(0, 1 - 6 * dt);
        if (p >= 1) this.setState('free');
        break;
      }
      case 'jump': {
        this.y = 4 * this.jumpH * p * (1 - p);
        this.vx *= Math.max(0, 1 - 1.5 * dt);
        this.vz *= Math.max(0, 1 - 1.5 * dt);
        if (p >= 1) {
          this.y = 0;
          this.setState('free');
        }
        break;
      }
      case 'dive': {
        // Vuela hasta el punto de contacto (pc) y después cae
        const d = this.dive, pc = d.pc;
        let k, sp;
        if (p < pc) { k = Math.sin((p / pc) * Math.PI * 0.5); sp = 1; }
        else { const q = Math.min(1, (p - pc) / (1 - pc)); k = Math.cos(q * Math.PI * 0.5); sp = 1 - q; }
        this.vx = d.vx * sp;
        this.vz = d.vz * sp;
        this.y = d.h * k;
        if (p >= 1) {
          this.y = 0;
          this.setState('down', 0.55, d.side > 0 ? 2 : 3);
        }
        break;
      }
      case 'gesture':
        this.vx *= Math.max(0, 1 - 8 * dt);
        this.vz *= Math.max(0, 1 - 8 * dt);
        if (p >= 1) this.setState('free');
        break;
      default:
        break;
    }

    if (this.fixed) {
      this.vx = 0;
      this.vz = 0;
    }
    const sp = this.speed;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.dist += sp * dt;
    this.runPhase += (sp * dt * Math.PI) / (0.75 + 0.11 * sp);
    const lx = PITCH.HL + 4.5, lz = PITCH.HW + 3.8;
    if (this.x > lx) this.x = lx; else if (this.x < -lx) this.x = -lx;
    if (this.z > lz) this.z = lz; else if (this.z < -lz) this.z = -lz;
  }
}
