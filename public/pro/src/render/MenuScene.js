// Escena de fondo del menú: jugadores entrenando en el estadio (un rondo en
// el círculo central y un par de futbolistas calentando por la banda).

import { FRAME_SIZE, HEADER, STRIDE } from '../match/Replay.js';
import { pickLineup } from '../data/Formations.js';

const RONDO = 5;

/** Datos de vista para el menú: los once de cada club con su equipación. */
export function menuSetup(home, away, night, quality) {
  const mk = (team, kit, gkKit) => pickLineup(team.squad, team.style.formation).map((e) => ({
    data: e.player, kit: e.slot.role === 'GK' ? gkKit : kit, isGK: false,
  }));
  const bib = { shirt: '#f6d21a', accent: '#1a1a1a', pattern: 'solid', shorts: home.home.shorts, socks: home.home.socks, num: '#1a1a1a' };
  return {
    home, away, awayKit: away.home, night, quality,
    roster: [...mk(home, home.home, home.home), ...mk(home, bib, bib)],
  };
}

export class MenuScene {
  constructor() {
    this.a = new Float32Array(FRAME_SIZE);
    this.b = new Float32Array(FRAME_SIZE);
    this.t = 0;
    this.from = 0;
    this.to = 2;
    this.passT = 0;
    this.passDur = 0.6;
    this.wait = 0.5;
    this.ball = { x: 0, z: 0 };
    this.chaser = { x: 0, z: 0, f: 0, ph: 0 };
    this.kickT = [0, 0, 0, 0, 0];
    this.jog = [{ a: 0.4, ph: 0 }, { a: 0.55, ph: 1.5 }, { a: 3.6, ph: 0.7 }];
    this.pos = [];
    for (let i = 0; i < RONDO; i++) {
      const an = (i / RONDO) * Math.PI * 2 + 0.3;
      this.pos.push({ x: Math.cos(an) * 6.2, z: Math.sin(an) * 6.2 });
    }
    this.ball.x = this.pos[0].x; this.ball.z = this.pos[0].z;
    this.write(this.b);
    this.a.set(this.b);
  }

  update(dt) {
    this.t += dt;
    const P = this.pos;
    for (let i = 0; i < RONDO; i++) if (this.kickT[i] > 0) this.kickT[i] -= dt;
    if (this.wait > 0) {
      this.wait -= dt;
      if (this.wait <= 0) {
        // Nuevo pase a un compañero que no sea el vecino tapado por el del medio
        let next;
        do { next = Math.floor(Math.random() * RONDO); } while (next === this.from);
        this.to = next;
        this.passT = 0;
        this.passDur = Math.hypot(P[this.to].x - P[this.from].x, P[this.to].z - P[this.from].z) / 13;
        this.kickT[this.from] = 0.3;
      }
    } else {
      this.passT += dt;
      if (this.passT >= this.passDur) {
        this.from = this.to;
        this.wait = 0.35 + Math.random() * 0.6;
      }
    }
    const k = this.wait > 0 ? 0 : Math.min(1, this.passT / this.passDur);
    const A = P[this.from], B = this.wait > 0 ? A : P[this.to];
    const toC = Math.hypot(A.x, A.z) || 1;
    // El balón reposa algo por dentro del círculo, delante del jugador
    const ax = A.x - (A.x / toC) * 0.6, az = A.z - (A.z / toC) * 0.6;
    const bx = B.x - (B.x / (Math.hypot(B.x, B.z) || 1)) * 0.6, bz = B.z - (B.z / (Math.hypot(B.x, B.z) || 1)) * 0.6;
    this.ball.x = ax + (bx - ax) * k;
    this.ball.z = az + (bz - az) * k;
    // El del medio persigue el balón
    const c = this.chaser;
    const dx = this.ball.x - c.x, dz = this.ball.z - c.z, d = Math.hypot(dx, dz);
    const sp = d > 0.8 ? 4.6 : 0;
    if (d > 0.01) { c.x += (dx / d) * sp * dt; c.z += (dz / d) * sp * dt; c.f = Math.atan2(dz, dx); }
    c.sp = sp;
    c.ph += (sp * dt * Math.PI) / (0.75 + 0.11 * sp);
    for (const j of this.jog) { j.a += dt * 0.085; j.ph += (3.6 * dt * Math.PI) / 1.15; }
    const t = this.a; this.a = this.b; this.b = t;
    this.write(this.b);
  }

  write(f) {
    f.fill(0);
    for (let e = 0; e < 25; e++) f[HEADER + e * STRIDE + 6] = -1;
    f[0] = this.ball.x; f[1] = 0.11; f[2] = this.ball.z;
    const put = (e, x, z, facing, speed, phase, state, prog, aux) => {
      const k = HEADER + e * STRIDE;
      f[k] = x; f[k + 1] = 0; f[k + 2] = z; f[k + 3] = facing; f[k + 4] = speed; f[k + 5] = phase;
      f[k + 6] = state; f[k + 7] = prog; f[k + 8] = aux + 2;
    };
    for (let i = 0; i < RONDO; i++) {
      const p = this.pos[i];
      const face = Math.atan2(this.ball.z - p.z, this.ball.x - p.x);
      if (this.kickT[i] > 0) put(i + 1, p.x, p.z, face, 0, 0, 1, 1 - this.kickT[i] / 0.3, 0);
      else put(i + 1, p.x, p.z, face, 0, 0, 0, this.t, 0);
    }
    const c = this.chaser;
    put(12, c.x, c.z, c.f, c.sp || 0, c.ph, 0, this.t, 0);
    this.jog.forEach((j, i) => {
      const x = Math.cos(j.a) * 36, z = Math.sin(j.a) * 24;
      put(7 + i, x, z, Math.atan2(Math.cos(j.a) * 24, -Math.sin(j.a) * 36), 3.6, j.ph, 0, this.t, 0);
    });
  }
}
