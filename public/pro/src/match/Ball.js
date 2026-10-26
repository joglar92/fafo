// El balón: objeto físico independiente. Cuando un jugador lo conduce no va
// "pegado": se le empuja por delante con toques y puede perderse en los giros.

import { BALL, PITCH } from '../core/Config.js';
import { stepBall, collideGoal } from './Physics.js';

const R = BALL.R;
const PRED_N = 40;
const PRED_DT = 0.1;

export class Ball {
  constructor() {
    this.pred = { n: PRED_N, dt: PRED_DT, x: new Float32Array(PRED_N), y: new Float32Array(PRED_N), z: new Float32Array(PRED_N) };
    this.predTick = -1;
    this.kickId = 0;
    this.reset(0, 0);
  }

  reset(x, z) {
    this.x = x; this.y = R; this.z = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.spinY = 0; this.lift = 0;
    this.owner = null;          // jugador que lo controla
    this.held = false;          // en las manos (portero o saque de banda)
    this.frozen = false;        // colocado para un saque
    this.inNet = 0;
    this.entering = false;
    this.hit = 0;
    this.lastTouch = null;      // último jugador que lo tocó
    this.lastKicker = null;     // último que lo golpeó voluntariamente
    this.kickTime = -99;
    this.kickType = null;       // pass, through, lob, cross, shot, clear, header, throw, tackle...
    this.passTarget = null;     // destinatario previsto
    this.shot = null;           // datos del tiro en curso
    this.offside = null;        // jugadores en fuera de juego en el momento del pase
    this.predTick = -1;
  }

  get speed() {
    return Math.hypot(this.vx, this.vy, this.vz);
  }

  get free() {
    return !this.owner;
  }

  /** Paso de simulación. match recibe los avisos de bote / poste / red. */
  update(dt, match) {
    if (this.owner) {
      this.followOwner(dt);
      return;
    }
    if (this.frozen) {
      this.vx = this.vy = this.vz = 0;
      return;
    }
    const n = 4, h = dt / n;
    const limX = PITCH.HL + PITCH.MARGIN_X - 0.6, limZ = PITCH.HW + PITCH.MARGIN_Z - 0.6;
    for (let i = 0; i < n; i++) {
      const px = this.x, py = this.y, pz = this.z;
      const bounce = stepBall(this, h);
      if (bounce > 2.2) match.onBallBounce(bounce);
      const g = collideGoal(this, px, py, pz);
      if (g) match.onBallFrame(g, this.hit);
      // Vallas publicitarias
      if (Math.abs(this.x) > limX && this.y < 1.1 && !this.inNet) {
        this.x = Math.sign(this.x) * limX;
        this.vx *= -0.35;
      }
      if (Math.abs(this.z) > limZ && this.y < 1.1) {
        this.z = Math.sign(this.z) * limZ;
        this.vz *= -0.35;
      }
    }
  }

  /** Conducción: el balón persigue un punto por delante del pie del jugador. */
  followOwner(dt) {
    const o = this.owner;
    if (this.held) {
      const f = o.facing;
      const high = o.state === 'throw' || o.holdHigh;
      const reach = high ? 0.12 : 0.36;
      this.x = o.x + Math.cos(f) * reach;
      this.z = o.z + Math.sin(f) * reach;
      this.y = o.y + (high ? 2.02 : 1.12) * (o.data.height || 1);
      this.vx = o.vx; this.vy = 0; this.vz = o.vz;
      return;
    }
    const sp = o.speed;
    const touch = 0.5 + 0.5 * Math.sin(o.runPhase * 2);
    let tx, tz;
    if (o.shielding && o.shieldX !== undefined) {
      tx = o.x + o.shieldX * 0.5;
      tz = o.z + o.shieldZ * 0.5;
    } else {
      const lead = 0.42 + sp * 0.085 + touch * sp * 0.05;
      tx = o.x + Math.cos(o.facing) * lead;
      tz = o.z + Math.sin(o.facing) * lead;
    }
    const k = Math.min(1, (11 + o.a.regate * 0.13) * dt);
    const nx = this.x + (tx - this.x) * k, nz = this.z + (tz - this.z) * k;
    this.vx = (nx - this.x) / dt;
    this.vz = (nz - this.z) / dt;
    this.x = nx; this.z = nz;
    this.y = R; this.vy = 0;
    this.spinY = 0; this.lift = 0;
  }

  /** Trayectoria prevista del balón libre (muestras cada 0,1 s). Se cachea por tick. */
  predict(tick) {
    const p = this.pred;
    if (this.predTick === tick) return p;
    this.predTick = tick;
    const s = { x: this.x, y: this.y, z: this.z, vx: this.vx, vy: this.vy, vz: this.vz, spinY: this.spinY, lift: this.lift };
    const sub = 5, h = PRED_DT / sub;
    for (let i = 0; i < PRED_N; i++) {
      p.x[i] = s.x; p.y[i] = s.y; p.z[i] = s.z;
      for (let k = 0; k < sub; k++) stepBall(s, h);
    }
    return p;
  }
}
