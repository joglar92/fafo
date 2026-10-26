// Árbitro principal y dos asistentes. Se mueven siguiendo el juego y hacen
// gestos (señalar, tarjeta, banderín). Las decisiones las toma MatchRules.

import { clamp, angDiff } from '../core/MathUtils.js';
import { PITCH } from '../core/Config.js';

const { HL, HW } = PITCH;

export const GESTURE = { point: 1, yellow: 2, red: 3, whistle: 4, flag: 5 };

class Official {
  constructor(kind) {
    this.kind = kind;
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vz = 0;
    this.facing = 0;
    this.runPhase = 0;
    this.state = 'free';
    this.stateT = 0;
    this.stateDur = 0;
    this.aux = 0;
    this.tx = 0; this.tz = 0;
    this.max = 6.4;
    this.look = null;
  }
  get speed() { return Math.hypot(this.vx, this.vz); }
  gesture(code, dur) {
    this.state = 'gesture';
    this.stateT = 0;
    this.stateDur = dur;
    this.aux = code;
  }
  update(dt) {
    this.stateT += dt;
    if (this.state === 'gesture' && this.stateT >= this.stateDur) { this.state = 'free'; this.aux = 0; }
    const dx = this.tx - this.x, dz = this.tz - this.z;
    const d = Math.hypot(dx, dz);
    let wx = 0, wz = 0;
    if (d > 0.6 && this.state !== 'gesture') {
      const sp = Math.min(this.max, d * 1.4);
      wx = (dx / d) * sp; wz = (dz / d) * sp;
    }
    const ax = wx - this.vx, az = wz - this.vz;
    const al = Math.hypot(ax, az);
    if (al > 1e-4) {
      const s = Math.min(al, 9 * dt);
      this.vx += (ax / al) * s; this.vz += (az / al) * s;
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const sp = this.speed;
    this.runPhase += (sp * dt * Math.PI) / (0.75 + 0.11 * sp);
    let want = null;
    if (this.look !== null && (sp < 2.5 || this.kind === 'line')) want = this.look;
    else if (sp > 0.5) want = Math.atan2(this.vz, this.vx);
    if (want !== null) {
      const dd = angDiff(this.facing, want);
      this.facing += clamp(dd, -8 * dt, 8 * dt);
    }
  }
}

export class Referee {
  constructor(match) {
    this.m = match;
    this.ref = new Official('ref');
    this.lines = [new Official('line'), new Official('line')];
    this.ref.x = 4; this.ref.z = -6;
    this.lines[0].z = -(HW + 1.4); this.lines[0].x = -20;
    this.lines[1].z = HW + 1.4; this.lines[1].x = 20;
    this.side = 1;
  }

  /** El árbitro corre hacia un punto y hace un gesto al llegar. */
  signal(code, dur = 1.6) {
    this.ref.gesture(code, dur);
  }

  flag(x) {
    // El asistente de la mitad correspondiente levanta el banderín
    const l = x < 0 ? this.lines[0] : this.lines[1];
    l.gesture(GESTURE.flag, 2);
  }

  update(dt) {
    const m = this.m, b = m.ball, r = this.ref;
    // Sistema diagonal: a unos 10 m del balón, sin estorbar
    if (Math.abs(b.z) > 12) this.side = b.z > 0 ? -1 : 1;
    let tx = clamp(b.x - Math.sign(b.vx || 0.01) * 5, -HL + 8, HL - 8);
    let tz = clamp(b.z + this.side * 9, -HW + 6, HW - 6);
    const dx = tx - b.x, dz = tz - b.z;
    const d = Math.hypot(dx, dz);
    if (d < 7) {
      tx = b.x + (dx / (d || 1)) * 7;
      tz = b.z + (dz / (d || 1)) * 7;
    }
    if (m.refSpot) { tx = m.refSpot.x; tz = m.refSpot.z; }
    r.tx = tx; r.tz = tz;
    r.look = Math.atan2(b.z - r.z, b.x - r.x);
    r.update(dt);

    // Asistentes: a la altura del penúltimo defensor de su mitad
    for (let i = 0; i < 2; i++) {
      const l = this.lines[i];
      const half = i === 0 ? -1 : 1;
      const team = m.teams[0].dir === -half ? m.teams[0] : m.teams[1]; // equipo que defiende esa mitad
      let a = 99, c = 99;
      for (const p of team.players) {
        const u = p.x * half; // cuanto mayor, más cerca de su línea de fondo
        const k = HL - u;
        if (k < a) { c = a; a = k; } else if (k < c) c = k;
      }
      let x = (HL - c) * half;
      const bu = b.x * half;
      if (bu > x * half) x = b.x;
      x = half > 0 ? clamp(x, 0, HL) : clamp(x, -HL, 0);
      l.tx = x;
      l.tz = l.z;
      l.look = i === 0 ? Math.PI / 2 : -Math.PI / 2;
      l.max = 7;
      l.update(dt);
    }
  }
}
