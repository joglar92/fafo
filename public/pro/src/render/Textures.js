// Texturas procedurales dibujadas en canvas: césped con líneas, redes,
// vallas, asientos, balón, equipaciones con dorsal y marcador del estadio.

import { PITCH } from '../core/Config.js';
import { RNG, shade, hexToRgb } from '../core/MathUtils.js';
import { drawCrest } from './Crests.js';

const { HL, HW, BOX_D, BOX_HW, SIX_D, SIX_HW, PEN_SPOT, CIRCLE_R, MARGIN_X, MARGIN_Z, GOAL_HW } = PITCH;
const FONT = '"Barlow Condensed", "Arial Narrow", Impact, sans-serif';

const memo = new Map();
/** Las texturas fijas se dibujan una sola vez y se reutilizan entre partidos. */
function cached(key, make) {
  if (!memo.has(key)) memo.set(key, make());
  return memo.get(key);
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Césped segado a franjas con todas las líneas reglamentarias. */
export function pitchTexture(size = 4096) {
  return cached('pitch' + size, () => drawPitch(size));
}

function drawPitch(size) {
  const TW = HL * 2 + MARGIN_X * 2, TH = HW * 2 + MARGIN_Z * 2;
  const W = size, H = Math.round((size * TH) / TW);
  const c = canvas(W, H), x = c.getContext('2d');
  const s = W / TW;
  const X = (m) => (m + HL + MARGIN_X) * s, Z = (m) => (m + HW + MARGIN_Z) * s;
  x.fillStyle = '#2f7d32';
  x.fillRect(0, 0, W, H);
  // Franjas de siega
  const bands = 20, bw = (HL * 2) / bands;
  for (let i = -2; i < bands + 2; i++) {
    x.fillStyle = (i & 1) ? '#34883a' : '#2b7430';
    x.fillRect(X(-HL + i * bw), 0, bw * s + 1, H);
  }
  // Franjas transversales muy suaves
  for (let i = 0; i < 14; i++) {
    x.fillStyle = (i & 1) ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.03)';
    x.fillRect(0, Z(-HW + (i * HW * 2) / 14), W, ((HW * 2) / 14) * s);
  }
  // Grano del césped
  const rng = new RNG(12345);
  for (let i = 0; i < 70000; i++) {
    const px = rng.next() * W, py = rng.next() * H;
    x.fillStyle = rng.chance(0.5) ? 'rgba(255,255,210,0.045)' : 'rgba(0,30,0,0.06)';
    x.fillRect(px, py, 2 + rng.next() * 3, 1.5);
  }
  // Zonas gastadas delante de las porterías
  for (const k of [-1, 1]) {
    const g = x.createRadialGradient(X(k * (HL - 4)), Z(0), 0, X(k * (HL - 4)), Z(0), 9 * s);
    g.addColorStop(0, 'rgba(120,110,60,0.16)');
    g.addColorStop(1, 'rgba(120,110,60,0)');
    x.fillStyle = g;
    x.fillRect(X(k * (HL - 4)) - 10 * s, Z(-10), 20 * s, 20 * s);
  }
  // Líneas
  x.strokeStyle = 'rgba(255,255,255,0.93)';
  x.fillStyle = 'rgba(255,255,255,0.93)';
  x.lineWidth = Math.max(2.5, 0.125 * s);
  x.strokeRect(X(-HL), Z(-HW), HL * 2 * s, HW * 2 * s);
  x.beginPath(); x.moveTo(X(0), Z(-HW)); x.lineTo(X(0), Z(HW)); x.stroke();
  x.beginPath(); x.arc(X(0), Z(0), CIRCLE_R * s, 0, Math.PI * 2); x.stroke();
  x.beginPath(); x.arc(X(0), Z(0), 0.22 * s, 0, Math.PI * 2); x.fill();
  for (const k of [-1, 1]) {
    const gx = k * HL;
    x.strokeRect(Math.min(X(gx), X(gx - k * BOX_D)), Z(-BOX_HW), BOX_D * s, BOX_HW * 2 * s);
    x.strokeRect(Math.min(X(gx), X(gx - k * SIX_D)), Z(-SIX_HW), SIX_D * s, SIX_HW * 2 * s);
    const px = gx - k * PEN_SPOT;
    x.beginPath(); x.arc(X(px), Z(0), 0.2 * s, 0, Math.PI * 2); x.fill();
    // Semicírculo del área
    const a = Math.acos((BOX_D - PEN_SPOT) / CIRCLE_R);
    x.beginPath();
    if (k > 0) x.arc(X(px), Z(0), CIRCLE_R * s, Math.PI - a, Math.PI + a);
    else x.arc(X(px), Z(0), CIRCLE_R * s, -a, a);
    x.stroke();
    // Esquinas
    for (const kz of [-1, 1]) {
      x.beginPath();
      const cx = X(gx), cz = Z(kz * HW);
      const a0 = k > 0 ? (kz > 0 ? Math.PI : Math.PI / 2) : (kz > 0 ? -Math.PI / 2 : 0);
      x.arc(cx, cz, 1 * s, a0, a0 + Math.PI / 2);
      x.stroke();
    }
    // Línea de gol entre los postes, algo más marcada
    x.beginPath(); x.moveTo(X(gx), Z(-GOAL_HW)); x.lineTo(X(gx), Z(GOAL_HW)); x.stroke();
  }
  // Área técnica (banda lejana)
  x.setLineDash([0.6 * s, 0.5 * s]);
  x.lineWidth = Math.max(1.5, 0.07 * s);
  for (const k of [-1, 1]) x.strokeRect(X(k * 14 - 6), Z(-HW - 3.6), 12 * s, 2.6 * s);
  x.setLineDash([]);
  return c;
}

export function netTexture() {
  const c = canvas(64, 64), x = c.getContext('2d');
  x.clearRect(0, 0, 64, 64);
  x.strokeStyle = 'rgba(255,255,255,0.85)';
  x.lineWidth = 3;
  x.beginPath();
  x.moveTo(0, 1.5); x.lineTo(64, 1.5);
  x.moveTo(1.5, 0); x.lineTo(1.5, 64);
  x.stroke();
  return c;
}

export function seatsTexture() {
  const c = canvas(64, 64), x = c.getContext('2d');
  x.fillStyle = '#5a5d63';
  x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#ffffff';
  x.beginPath();
  x.roundRect(9, 8, 46, 30, 6);
  x.fill();
  x.fillStyle = '#d9d9d9';
  x.fillRect(9, 40, 46, 10);
  x.fillStyle = 'rgba(0,0,0,0.25)';
  x.fillRect(0, 56, 64, 8);
  return c;
}

const SPONSORS = [
  ['NORTEK', '#0b1e3a', '#ffffff'], ['VALORA BANK', '#f2f2f2', '#0a3d2a'], ['AEROLUX', '#b3122f', '#ffffff'],
  ['KUMO ENERGY', '#111111', '#f6d21a'], ['ZENIT COLA', '#0d6efd', '#ffffff'], ['PIXELA', '#f26b3a', '#1c1c1c'],
  ['ORBIT MOBILE', '#3a2360', '#e8b93c'], ['LUMEN TV', '#ffffff', '#c8102e'], ['TERRA SPORT', '#0d8a4f', '#ffffff'],
  ['GOLPE FRANCO', '#15151a', '#ffd23f'],
];

/** Tira de vallas publicitarias con marcas ficticias. */
export function adsTexture() {
  return cached('ads', drawAds);
}

function drawAds() {
  const n = SPONSORS.length, pw = 256, h = 64;
  const c = canvas(pw * n, h), x = c.getContext('2d');
  SPONSORS.forEach(([name, bg, fg], i) => {
    x.fillStyle = bg;
    x.fillRect(i * pw, 0, pw, h);
    x.fillStyle = fg;
    x.font = `800 38px ${FONT}`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(name, i * pw + pw / 2, h / 2 + 2, pw - 24);
    x.fillStyle = 'rgba(0,0,0,0.25)';
    x.fillRect(i * pw + pw - 2, 0, 2, h);
  });
  return { canvas: c, panels: n };
}

/** Balón de diseño propio: paneles oscuros y trazos de color para ver el giro. */
export function ballTexture() {
  return cached('ball', drawBall);
}

function drawBall() {
  const W = 512, H = 256;
  const c = canvas(W, H), x = c.getContext('2d');
  x.fillStyle = '#f7f7f4';
  x.fillRect(0, 0, W, H);
  // 12 vértices de un icosaedro proyectados a coordenadas equirectangulares
  const phi = (1 + Math.sqrt(5)) / 2;
  const vs = [];
  for (const a of [-1, 1]) for (const b of [-phi, phi]) { vs.push([0, a, b], [a, b, 0], [b, 0, a]); }
  vs.forEach((v, i) => {
    const l = Math.hypot(v[0], v[1], v[2]);
    const lat = Math.asin(v[1] / l), lon = Math.atan2(v[2], v[0]);
    const px = ((lon + Math.PI) / (Math.PI * 2)) * W, py = (0.5 - lat / Math.PI) * H;
    const stretch = 1 / Math.max(0.35, Math.cos(lat));
    for (const off of [-W, 0, W]) {
      x.fillStyle = i % 3 === 0 ? '#1b9aaa' : '#1a1c22';
      x.beginPath();
      x.ellipse(px + off, py, 26 * stretch, 26, 0, 0, Math.PI * 2);
      x.fill();
    }
  });
  x.strokeStyle = '#e4572e';
  x.lineWidth = 7;
  x.beginPath();
  for (let i = 0; i <= W; i += 8) {
    const y = H / 2 + Math.sin((i / W) * Math.PI * 4) * 48;
    x[i ? 'lineTo' : 'moveTo'](i, y);
  }
  x.stroke();
  return c;
}

export function blobTexture() {
  const c = canvas(64, 64), x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return c;
}

export function glowTexture() {
  const c = canvas(128, 128), x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 2, 64, 64, 63);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.15, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return c;
}

/** Atlas de marcadores de césped: anillo de selección, flecha, anillo fino y triángulo. */
export function markersTexture() {
  const c = canvas(512, 128), x = c.getContext('2d');
  x.clearRect(0, 0, 512, 128);
  // 0: anillo grueso
  x.strokeStyle = '#ffffff';
  x.lineWidth = 12;
  x.beginPath(); x.arc(64, 64, 48, 0, Math.PI * 2); x.stroke();
  // 1: flecha de dirección
  x.fillStyle = '#ffffff';
  x.beginPath();
  x.moveTo(128 + 110, 64); x.lineTo(128 + 62, 26); x.lineTo(128 + 62, 50); x.lineTo(128 + 14, 50);
  x.lineTo(128 + 14, 78); x.lineTo(128 + 62, 78); x.lineTo(128 + 62, 102);
  x.closePath(); x.fill();
  // 2: anillo fino
  x.lineWidth = 6;
  x.beginPath(); x.arc(256 + 64, 64, 52, 0, Math.PI * 2); x.stroke();
  // 3: triángulo (indicador sobre la cabeza)
  x.beginPath();
  x.moveTo(384 + 14, 22); x.lineTo(384 + 114, 22); x.lineTo(384 + 64, 108);
  x.closePath(); x.fill();
  return c;
}

function pattern(x, k, ox, oy, S) {
  const { shirt, accent } = k;
  x.fillStyle = shirt;
  x.fillRect(ox, oy, S, S);
  x.fillStyle = accent;
  switch (k.pattern) {
    case 'stripes':
      for (let i = 0; i < 8; i++) x.fillRect(ox + (i * S) / 8, oy, S / 16, S);
      break;
    case 'pinstripes':
      for (let i = 0; i < 20; i++) x.fillRect(ox + (i * S) / 20, oy, Math.max(1.5, S / 110), S);
      break;
    case 'hoops':
      for (let i = 0; i < 4; i++) x.fillRect(ox, oy + S * (0.1 + i * 0.24), S, S * 0.12);
      break;
    case 'halves':
      x.fillRect(ox + S * 0.75, oy, S * 0.25, S);
      x.fillRect(ox, oy, S * 0.25, S);
      break;
    case 'band':
      x.fillRect(ox, oy + S * 0.34, S, S * 0.15);
      break;
    case 'sash': {
      x.save();
      x.beginPath(); x.rect(ox + S * 0.5, oy, S * 0.5, S); x.clip();
      x.beginPath();
      x.moveTo(ox + S * 0.52, oy); x.lineTo(ox + S * 0.66, oy);
      x.lineTo(ox + S * 0.98, oy + S); x.lineTo(ox + S * 0.84, oy + S);
      x.closePath(); x.fill();
      x.restore();
      break;
    }
    default:
      break;
  }
  // Cuello y sombreado lateral
  x.fillStyle = k.pattern === 'solid' || k.pattern === 'sleeves' ? accent : shade(shirt, -0.35);
  x.fillRect(ox, oy, S, S * 0.045);
  const g = x.createLinearGradient(0, oy, 0, oy + S);
  g.addColorStop(0, 'rgba(255,255,255,0.10)');
  g.addColorStop(1, 'rgba(0,0,0,0.16)');
  x.fillStyle = g;
  x.fillRect(ox, oy, S, S);
}

/**
 * Atlas de camisetas: una celda por jugador con el dibujo de la equipación,
 * el dorsal grande a la espalda, el nombre y el dorsal pequeño en el pecho.
 * entries: [{ kit, number, name }]
 */
export function kitAtlas(entries, cell = 256) {
  const cols = 8, rows = Math.ceil(entries.length / cols);
  const c = canvas(cols * cell, rows * cell), x = c.getContext('2d');
  const rects = [];
  entries.forEach((e, i) => {
    const ox = (i % cols) * cell, oy = Math.floor(i / cols) * cell;
    const S = cell;
    x.save();
    x.beginPath(); x.rect(ox, oy, S, S); x.clip();
    pattern(x, e.kit, ox, oy, S);
    const num = String(e.number ?? '');
    const light = hexToRgb(e.kit.num).reduce((a, b) => a + b, 0) > 1.5;
    // Las letras se dibujan estrechas porque la textura se estira al rodear el torso
    const squeeze = 0.52;
    if (num) {
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      // Espalda (u = 0.25)
      x.save();
      x.translate(ox + S * 0.25, oy + S * 0.52);
      x.scale(squeeze, 1);
      x.font = `800 ${S * 0.46}px ${FONT}`;
      x.lineWidth = S * 0.035;
      x.strokeStyle = light ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.6)';
      x.strokeText(num, 0, 0);
      x.fillStyle = e.kit.num;
      x.fillText(num, 0, 0);
      if (e.name) {
        x.font = `700 ${S * 0.1}px ${FONT}`;
        x.fillText(e.name.toUpperCase(), 0, -S * 0.3, S * 0.8);
      }
      x.restore();
      // Pecho (u = 0.75): dorsal pequeño y escudo simplificado
      x.save();
      x.translate(ox + S * 0.69, oy + S * 0.3);
      x.scale(squeeze, 1);
      x.font = `800 ${S * 0.15}px ${FONT}`;
      x.fillStyle = e.kit.num;
      x.fillText(num, 0, 0);
      x.restore();
      x.fillStyle = e.kit.accent;
      x.beginPath();
      x.ellipse(ox + S * 0.81, oy + S * 0.28, S * 0.022, S * 0.04, 0, 0, Math.PI * 2);
      x.fill();
      x.strokeStyle = 'rgba(255,255,255,0.8)';
      x.lineWidth = 1.5;
      x.stroke();
    }
    x.restore();
    // Rectángulo UV con un pequeño margen interior
    const m = 1.5 / (cols * cell), mv = 1.5 / (rows * cell);
    rects.push([
      (i % cols) / cols + m, 1 - (Math.floor(i / cols) + 1) / rows + mv,
      1 / cols - 2 * m, 1 / rows - 2 * mv,
    ]);
  });
  return { canvas: c, rects };
}

/** Pantalla del marcador del estadio. */
export function drawScoreboard(c, info) {
  const x = c.getContext('2d'), W = c.width, H = c.height;
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0b1020');
  g.addColorStop(1, '#131b33');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(255,255,255,0.06)';
  for (let i = 0; i < H; i += 6) x.fillRect(0, i, W, 2);
  drawCrest(x, info.home, W * 0.17, H * 0.42, H * 0.5);
  drawCrest(x, info.away, W * 0.83, H * 0.42, H * 0.5);
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillStyle = '#ffffff';
  x.font = `800 ${H * 0.46}px ${FONT}`;
  x.fillText(`${info.score[0]}  -  ${info.score[1]}`, W / 2, H * 0.4);
  x.font = `700 ${H * 0.11}px ${FONT}`;
  x.fillStyle = '#ffd54a';
  x.fillText(info.clock, W / 2, H * 0.74);
  x.fillStyle = '#c9d4ff';
  x.font = `700 ${H * 0.1}px ${FONT}`;
  x.fillText(info.home.name.toUpperCase(), W * 0.17, H * 0.82, W * 0.3);
  x.fillText(info.away.name.toUpperCase(), W * 0.83, H * 0.82, W * 0.3);
  if (info.banner) {
    x.fillStyle = 'rgba(255,213,74,0.95)';
    x.fillRect(0, H * 0.88, W, H * 0.12);
    x.fillStyle = '#10131c';
    x.font = `800 ${H * 0.09}px ${FONT}`;
    x.fillText(info.banner, W / 2, H * 0.945, W * 0.94);
  }
}
