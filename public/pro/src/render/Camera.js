// Dirección de cámaras: retransmisión (TV), cercana, repeticiones desde varios
// ángulos, cámara de gol, presentación y fondo del menú.

import { clamp } from '../core/MathUtils.js';
import { PITCH } from '../core/Config.js';

const { HL, HW } = PITCH;
const DEG = Math.PI / 180;

export const CAMERA_STYLES = {
  tv: { name: 'RETRANSMISIÓN', h: 26, d: 58, fov: 24 },
  cercana: { name: 'CERCANA', h: 15, d: 41, fov: 30 },
  panoramica: { name: 'PANORÁMICA', h: 36, d: 70, fov: 25 },
};

export const REPLAY_ANGLES = ['tvzoom', 'behind', 'lateral', 'close'];

export class CameraDirector {
  constructor(cam) {
    this.cam = cam;
    this.mode = 'tv';
    this.style = CAMERA_STYLES.tv;
    this.t = 0;
    this.snap = true;
    this.px = 0; this.py = 30; this.pz = 66;
    this.tx = 0; this.ty = 0; this.tz = 0;
    this.fov = 24;
    this.params = {};
  }

  setStyle(id) {
    this.style = CAMERA_STYLES[id] || CAMERA_STYLES.tv;
  }

  /** Cambia de plano. Con cut=true no hay transición suave. */
  setMode(mode, params = {}, cut = true) {
    this.mode = mode;
    this.params = params;
    this.t = 0;
    if (cut) this.snap = true;
  }

  /**
   * focus: { x, y, z } (normalmente el balón). dt en segundos reales.
   */
  update(dt, focus) {
    this.t += dt;
    const p = this.params;
    let px, py, pz, tx, ty, tz, fov, rate = 4;
    const fx = focus.x, fy = focus.y, fz = focus.z;
    switch (this.mode) {
      case 'intro': {
        const a = -Math.PI / 2 + 0.5 + this.t * 0.22;
        px = Math.cos(a) * 60; pz = Math.sin(a) * 42; py = 20 - Math.min(8, this.t * 1.1);
        tx = 0; ty = 2; tz = 0; fov = 40;
        rate = 50;
        break;
      }
      case 'menu': {
        const a = this.t * 0.06 + 0.6;
        px = Math.cos(a) * 46; pz = Math.sin(a) * 30; py = 7.5 + Math.sin(this.t * 0.11) * 2.5;
        tx = Math.cos(a + 2.4) * 10; ty = 2.5; tz = Math.sin(a + 2.4) * 6; fov = 42;
        rate = 50;
        break;
      }
      case 'goal': {
        // Órbita cercana alrededor del goleador
        const a = 1.1 + this.t * 0.35;
        px = fx + Math.cos(a) * 7.5; pz = Math.min(HW + 3, fz + Math.sin(a) * 7.5 + 2); py = 2.6;
        tx = fx; ty = 1.3; tz = fz; fov = 34;
        rate = 5;
        break;
      }
      case 'replay': {
        const k = p.angle;
        const side = p.goalSide || (fx >= 0 ? 1 : -1);
        if (k === 'behind') {
          px = side * (HL + 8.5); py = 4.2; pz = clamp(fz * 0.35, -6, 6);
          tx = fx; ty = fy * 0.6 + 0.8; tz = fz; fov = 36;
        } else if (k === 'lateral') {
          px = clamp(fx - side * 5, -HL, HL); py = 2.0; pz = HW + 4.6;
          tx = fx; ty = fy * 0.6 + 0.9; tz = fz; fov = 32;
        } else if (k === 'close') {
          px = fx - side * 11; py = 4; pz = fz + 7;
          tx = fx + side * 2; ty = fy * 0.5 + 1; tz = fz; fov = 32;
        } else {
          px = clamp(fx, -46, 46) * 0.8; py = 26; pz = 62;
          tx = fx; ty = 1; tz = fz; fov = 13;
        }
        rate = 6;
        break;
      }
      case 'penalty': {
        const side = p.side || 1;
        px = side * (HL - 30); py = 6; pz = 9;
        tx = side * (HL - 4); ty = 1.2; tz = 0; fov = 30;
        rate = 5;
        break;
      }
      default: {
        // Retransmisión: lateral elevada que acompaña al balón
        const s = this.style;
        const cx = clamp(fx, -47, 47);
        tx = cx; ty = 0.5; tz = clamp(fz, -HW, HW) * (p.zk ?? 0.6) - 1.5;
        px = cx * 0.82; py = s.h; pz = s.d + clamp(fz, -HW, HW) * 0.12;
        fov = s.fov - (fz < -15 ? 1.2 : 0) + (p.zoom || 0);
        rate = 3.6;
      }
    }
    if (this.snap) {
      this.px = px; this.py = py; this.pz = pz; this.tx = tx; this.ty = ty; this.tz = tz; this.fov = fov;
      this.snap = false;
    } else {
      const k = 1 - Math.exp(-rate * dt);
      this.px += (px - this.px) * k; this.py += (py - this.py) * k; this.pz += (pz - this.pz) * k;
      this.tx += (tx - this.tx) * k; this.ty += (ty - this.ty) * k; this.tz += (tz - this.tz) * k;
      this.fov += (fov - this.fov) * Math.min(1, k * 0.7);
    }
    const c = this.cam;
    c.pos[0] = this.px; c.pos[1] = this.py; c.pos[2] = this.pz;
    c.target[0] = this.tx; c.target[1] = this.ty; c.target[2] = this.tz;
    c.fov = this.fov * DEG;
    c.update();
  }
}
