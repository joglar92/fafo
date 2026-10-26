// Vista 3D del partido: monta la escena (estadio, figuras, balón, marcas) y
// la dibuja a partir de "fotogramas" de simulación, ya sean en directo o de
// una repetición. No contiene reglas ni lógica de juego.

import { lerp, lerpAngle, hexToRgb } from '../core/MathUtils.js';
import { BALL } from '../core/Config.js';
import { REFEREE_KIT } from '../data/TeamsData.js';
import { FRAME_SIZE, HEADER, STRIDE, ENTITIES } from '../match/Replay.js';
import * as M from './Mat4.js';
import { Scene, Camera } from './GL.js';
import { unitSphere, groundQuad, billboardQuad } from './Geo.js';
import { ballTexture, blobTexture, markersTexture, kitAtlas, drawScoreboard } from './Textures.js';
import { buildStadium, environment, updateGlow } from './Stadium.js';
import { Figures, makeLook } from './PlayerModel.js';
import { CameraDirector } from './Camera.js';

const T = M.create(), Q = M.create();
const BALL_VIS = BALL.R * 1.18;

/** Datos que necesita la vista a partir de un partido. */
export function viewSetup(match, night, quality) {
  const roster = match.roster.map((p) => ({
    data: p.data,
    kit: p.isGK ? p.team.gkKit : p.team.kit,
    isGK: p.isGK,
  }));
  return {
    home: match.teams[0].data, away: match.teams[1].data,
    awayKit: match.teams[1].kit,
    roster, night, quality,
  };
}

export class MatchView {
  constructor(renderer, setup) {
    const r = renderer;
    this.r = r;
    this.setup = setup;
    this.scene = new Scene();
    this.cam = new Camera();
    this.director = new CameraDirector(this.cam);
    this.env = environment(setup.night);
    this.stadium = buildStadium(r, this.scene, {
      home: setup.home, away: setup.away, night: setup.night, quality: setup.quality ?? 1,
      awayColor: setup.awayKit ? setup.awayKit.shirt : undefined, awayKit: setup.awayKit,
    });

    // Camisetas: 22 jugadores + árbitro + 2 asistentes
    const entries = setup.roster.map((e) => ({ kit: e.kit, number: e.data.number, name: e.data.short }));
    for (let i = 0; i < 3; i++) entries.push({ kit: REFEREE_KIT, number: '' });
    const atlas = kitAtlas(entries, (setup.quality ?? 1) >= 1 ? 256 : 128);
    this.atlasTex = r.texture(atlas.canvas, { aniso: 4 });
    this.figures = new Figures(r, this.scene, this.atlasTex, ENTITIES + 2);
    this.looks = setup.roster.map((e, i) => makeLook(e.data, e.kit, atlas.rects[i], e.isGK, i));
    const refData = { height: 1, skin: '#d9a57e', hair: '#22201c', hairStyle: 0, number: 0 };
    for (let i = 0; i < 3; i++) {
      const look = makeLook({ ...refData, hairStyle: i === 1 ? 1 : 0 }, REFEREE_KIT, atlas.rects[setup.roster.length + i], false, i + 3);
      look.boots = [0.08, 0.08, 0.09];
      if (i > 0) look.flag = i === 1 ? [0.95, 0.85, 0.1] : [0.95, 0.3, 0.1];
      this.looks.push(look);
    }

    // Balón
    this.ballGeo = r.geometry(unitSphere(20, 14));
    this.ballBatch = r.batch(this.ballGeo, 4);
    this.scene.add({ geo: this.ballGeo, batch: this.ballBatch, mat: { map: r.texture(ballTexture(), { aniso: 4 }), spec: 0.25 }, castShadow: true });
    this.ballQ = [0, 0, 0, 1];
    this.ballLast = null;

    // Sombras de contacto y marcas sobre el césped
    this.quadGeo = r.geometry(groundQuad());
    this.blobs = r.batch(this.quadGeo, ENTITIES + 4);
    this.scene.add({ geo: this.quadGeo, batch: this.blobs, mat: { map: r.texture(blobTexture()), blend: 'alpha', unlit: true, noShadow: true, offset: true } });
    this.marks = r.batch(this.quadGeo, 12);
    this.markTex = r.texture(markersTexture());
    this.scene.add({ geo: this.quadGeo, batch: this.marks, mat: { map: this.markTex, blend: 'alpha', unlit: true, noShadow: true, offset: true } });
    this.billGeo = r.geometry(billboardQuad());
    this.bills = r.batch(this.billGeo, 6);
    this.scene.add({ geo: this.billGeo, batch: this.bills, mat: { map: this.markTex, blend: 'alpha', unlit: true, noShadow: true, doubleSided: true, noDepth: true } });

    this.prev = new Float32Array(FRAME_SIZE);
    this.cur = new Float32Array(FRAME_SIZE);
    this.f = new Float32Array(FRAME_SIZE);
    this.hasPrev = false;
    this.exciteTarget = [0.02, 0.02];
    this.exciteNow = [0.02, 0.02];
    this.focus = { x: 0, y: 0, z: 0 };
    this.focusOverride = null;
    this.sbInfo = null;
    this.sbKey = '';
    this.colors = {
      home: hexToRgb(setup.home.home.shirt),
      mark: [1, 0.86, 0.2],
    };
  }

  /** Guarda el estado actual de la simulación como fotograma más reciente. */
  capture(match) {
    const t = this.prev;
    this.prev = this.cur;
    this.cur = t;
    match.writeFrame(this.cur, 0);
    if (!this.hasPrev) { this.prev.set(this.cur); this.hasPrev = true; }
  }

  /** Fotogramas arbitrarios (repeticiones, escena del menú). */
  setFrames(a, aOff, b, bOff) {
    this.prev.set(a.subarray(aOff, aOff + FRAME_SIZE));
    this.cur.set(b.subarray(bOff, bOff + FRAME_SIZE));
    this.hasPrev = true;
  }

  /** Reacción del público: valores 0..1 para afición local y visitante. */
  excite(home, away, hold = 0) {
    this.exciteTarget[0] = home;
    this.exciteTarget[1] = away;
    this.exciteHold = hold;
  }

  setScoreboard(info) {
    const key = `${info.score[0]}-${info.score[1]}-${info.clock}-${info.banner || ''}`;
    if (key === this.sbKey) return;
    this.sbKey = key;
    drawScoreboard(this.stadium.scoreboard.canvas, info);
    this.r.updateTexture(this.stadium.scoreboard.tex, this.stadium.scoreboard.canvas);
  }

  /** Cambio: actualiza el aspecto del jugador en la posición `index` del roster. */
  replacePlayer(index, player) {
    const e = this.setup.roster[index];
    e.data = player.data;
    e.kit = player.isGK ? player.team.gkKit : player.team.kit;
    e.isGK = player.isGK;
    const entries = this.setup.roster.map((x) => ({ kit: x.kit, number: x.data.number, name: x.data.short }));
    for (let i = 0; i < 3; i++) entries.push({ kit: REFEREE_KIT, number: '' });
    const atlas = kitAtlas(entries, (this.setup.quality ?? 1) >= 1 ? 256 : 128);
    this.r.updateTexture(this.atlasTex, atlas.canvas);
    this.looks = this.setup.roster.map((x, i) => makeLook(x.data, x.kit, atlas.rects[i], x.isGK, i));
    const refData = { height: 1, skin: '#d9a57e', hair: '#22201c', hairStyle: 0, number: 0 };
    for (let i = 0; i < 3; i++) {
      const look = makeLook({ ...refData, hairStyle: i === 1 ? 1 : 0 }, REFEREE_KIT, atlas.rects[this.setup.roster.length + i], false, i + 3);
      look.boots = [0.08, 0.08, 0.09];
      if (i > 0) look.flag = i === 1 ? [0.95, 0.85, 0.1] : [0.95, 0.3, 0.1];
      this.looks.push(look);
    }
  }

  interpolate(alpha) {
    const a = this.prev, b = this.cur, f = this.f;
    f[0] = lerp(a[0], b[0], alpha); f[1] = lerp(a[1], b[1], alpha); f[2] = lerp(a[2], b[2], alpha);
    for (let e = 0, k = HEADER; e < ENTITIES; e++, k += STRIDE) {
      const sa = a[k + 6], sb = b[k + 6];
      f[k + 6] = sb;
      if (sb < 0) continue;
      const jump = sa < 0 || Math.abs(b[k] - a[k]) > 3 || Math.abs(b[k + 2] - a[k + 2]) > 3; // recolocación
      const t = jump ? 1 : alpha;
      f[k] = lerp(a[k], b[k], t);
      f[k + 1] = lerp(a[k + 1], b[k + 1], t);
      f[k + 2] = lerp(a[k + 2], b[k + 2], t);
      f[k + 3] = lerpAngle(a[k + 3], b[k + 3], t);
      f[k + 4] = lerp(a[k + 4], b[k + 4], t);
      f[k + 5] = lerp(a[k + 5], b[k + 5], t);
      f[k + 7] = sa === sb && b[k + 7] >= a[k + 7] ? lerp(a[k + 7], b[k + 7], t) : b[k + 7];
      f[k + 8] = b[k + 8];
    }
    return f;
  }

  /**
   * Dibuja un fotograma.
   * overlay: { controlled, target, aim: { x, z, angle, power }, hideMarks }
   */
  draw(alpha, dt, time, overlay = {}) {
    const f = this.interpolate(alpha);
    const fig = this.figures;
    fig.begin();
    this.blobs.reset();
    this.marks.reset();
    this.bills.reset();
    const night = this.env.night;
    const blobA = night ? 0.85 : 0.5;

    for (let e = 0, k = HEADER; e < ENTITIES; e++, k += STRIDE) {
      const st = f[k + 6];
      if (st < 0) continue;
      const x = f[k], y = f[k + 1], z = f[k + 2];
      fig.emit(this.looks[e], x, y, z, f[k + 3], f[k + 4], f[k + 5], st, f[k + 7], f[k + 8], time);
      M.fromTranslation(T, x, 0.012, z);
      const s = st === 3 || st === 4 || st === 6 ? 1.5 : 0.95;
      M.scale(T, T, s, 1, s);
      this.blobs.push(T, 1, 1, 1, blobA * Math.max(0.3, 1 - y * 0.5));
    }

    // Balón: rueda según lo que se desplaza
    const bx = f[0], by = f[1], bz = f[2];
    this.rollBall(bx, by, bz);
    M.fromTranslation(T, bx, by + (BALL_VIS - BALL.R), bz);
    M.multiply(T, T, this.quatMatrix());
    M.scale(T, T, BALL_VIS, BALL_VIS, BALL_VIS);
    this.ballBatch.reset();
    this.ballBatch.push(T, 1, 1, 1, 1);
    M.fromTranslation(T, bx, 0.014, bz);
    const bs = 0.36 + by * 0.12;
    M.scale(T, T, bs, 1, bs);
    this.blobs.push(T, 1, 1, 1, Math.max(0.25, 0.95 - by * 0.07));

    // Marcas del jugador controlado
    if (!overlay.hideMarks) {
      const mc = this.colors.mark;
      if (overlay.controlled !== undefined && overlay.controlled >= 0) {
        const k = HEADER + overlay.controlled * STRIDE;
        if (f[k + 6] >= 0) {
          const x = f[k], z = f[k + 2];
          M.fromTranslation(T, x, 0.02, z);
          M.scale(T, T, 1.5, 1, 1.5);
          this.marks.push(T, mc[0], mc[1], mc[2], 0.95, 0, 0, 0.25, 1);
          // Triángulo sobre la cabeza, siempre de cara a la cámara
          this.billboard(T, x, f[k + 1] + 2.25, z, 0.42);
          this.bills.push(T, mc[0], mc[1], mc[2], 0.95, 0.75, 0, 0.25, 1);
        }
      }
      if (overlay.target !== undefined && overlay.target >= 0) {
        const k = HEADER + overlay.target * STRIDE;
        M.fromTranslation(T, f[k], 0.02, f[k + 2]);
        M.scale(T, T, 1.3, 1, 1.3);
        this.marks.push(T, 1, 1, 1, 0.5, 0.5, 0, 0.25, 1);
      }
      if (overlay.aim) {
        const a = overlay.aim;
        const len = 2.2 + (a.power || 0) * 4.5;
        M.fromTranslation(T, a.x + Math.cos(a.angle) * (len / 2 + 0.7), 0.025, a.z + Math.sin(a.angle) * (len / 2 + 0.7));
        M.rotateY(T, T, -a.angle);
        M.scale(T, T, len, 1, 1.1);
        this.marks.push(T, mc[0], mc[1], mc[2], 0.85, 0.25, 0, 0.25, 1);
      }
    }

    // Cámara
    const fo = this.focusOverride;
    this.focus.x = fo ? fo.x : bx; this.focus.y = fo ? fo.y : by; this.focus.z = fo ? fo.z : bz;
    this.cam.aspect = this.r.canvas.width / this.r.canvas.height;
    this.director.update(dt, this.focus);
    const nearVisible = this.cam.pos[2] < 47;
    for (const it of this.stadium.near) it.visible = nearVisible;
    updateGlow(this.stadium, this.cam);

    // Ambiente
    const ex = this.exciteNow, et = this.exciteTarget;
    for (let i = 0; i < 2; i++) ex[i] += (et[i] - ex[i]) * Math.min(1, dt * 3);
    if (this.exciteHold > 0) this.exciteHold -= dt;
    else { et[0] += (0.02 - et[0]) * Math.min(1, dt * 0.6); et[1] += (0.02 - et[1]) * Math.min(1, dt * 0.6); }
    this.env.excite = ex;
    this.env.shadowFocus[0] = this.focus.x * 0.8;
    this.env.shadowFocus[1] = this.focus.z * 0.6;
    this.r.render(this.scene, this.cam, this.env, time);
  }

  billboard(o, x, y, z, s) {
    const v = this.cam.view;
    o[0] = v[0] * s; o[1] = v[4] * s; o[2] = v[8] * s; o[3] = 0;
    o[4] = v[1] * s; o[5] = v[5] * s; o[6] = v[9] * s; o[7] = 0;
    o[8] = v[2]; o[9] = v[6]; o[10] = v[10]; o[11] = 0;
    o[12] = x; o[13] = y; o[14] = z; o[15] = 1;
  }

  rollBall(x, y, z) {
    const l = this.ballLast;
    if (!l) { this.ballLast = [x, y, z]; return; }
    const dx = x - l[0], dz = z - l[2];
    l[0] = x; l[1] = y; l[2] = z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-5 || d > 3) return;
    // Eje de giro: vertical x dirección de avance
    const ax = dz / d, az = -dx / d;
    const half = (d / BALL.R) * 0.5;
    const s = Math.sin(half), c = Math.cos(half);
    const q = this.ballQ;
    const rx = ax * s, ry = 0, rz = az * s, rw = c;
    const nx = rw * q[0] + rx * q[3] + ry * q[2] - rz * q[1];
    const ny = rw * q[1] - rx * q[2] + ry * q[3] + rz * q[0];
    const nz = rw * q[2] + rx * q[1] - ry * q[0] + rz * q[3];
    const nw = rw * q[3] - rx * q[0] - ry * q[1] - rz * q[2];
    const n = Math.hypot(nx, ny, nz, nw) || 1;
    q[0] = nx / n; q[1] = ny / n; q[2] = nz / n; q[3] = nw / n;
  }

  quatMatrix() {
    const [x, y, z, w] = this.ballQ;
    const o = Q;
    o[0] = 1 - 2 * (y * y + z * z); o[1] = 2 * (x * y + z * w); o[2] = 2 * (x * z - y * w); o[3] = 0;
    o[4] = 2 * (x * y - z * w); o[5] = 1 - 2 * (x * x + z * z); o[6] = 2 * (y * z + x * w); o[7] = 0;
    o[8] = 2 * (x * z + y * w); o[9] = 2 * (y * z - x * w); o[10] = 1 - 2 * (x * x + y * y); o[11] = 0;
    o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
    return o;
  }
}
