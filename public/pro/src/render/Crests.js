// Escudos originales generados por código. Se dibujan sobre un canvas 2D y
// sirven tanto para la interfaz como para el marcador del estadio.

import { shade, hexToRgb } from '../core/MathUtils.js';

function shapePath(ctx, shape, s) {
  const r = s / 2;
  ctx.beginPath();
  switch (shape) {
    case 'round':
      ctx.arc(0, 0, r * 0.94, 0, Math.PI * 2);
      break;
    case 'diamond':
      ctx.moveTo(0, -r); ctx.lineTo(r * 0.82, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.82, 0);
      break;
    case 'hex':
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.98);
      }
      break;
    case 'pennant':
      ctx.moveTo(-r * 0.8, -r * 0.92);
      ctx.lineTo(r * 0.8, -r * 0.92);
      ctx.lineTo(r * 0.8, -r * 0.1);
      ctx.lineTo(0, r);
      ctx.lineTo(-r * 0.8, -r * 0.1);
      break;
    default: // shield
      ctx.moveTo(-r * 0.82, -r * 0.9);
      ctx.quadraticCurveTo(0, -r * 1.06, r * 0.82, -r * 0.9);
      ctx.lineTo(r * 0.82, r * 0.05);
      ctx.quadraticCurveTo(r * 0.8, r * 0.7, 0, r);
      ctx.quadraticCurveTo(-r * 0.8, r * 0.7, -r * 0.82, r * 0.05);
  }
  ctx.closePath();
}

function star(ctx, x, y, r, n = 5) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function emblem(ctx, kind, s, color) {
  const u = s / 100;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 5 * u;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const y = -10 * u;
  switch (kind) {
    case 'star': star(ctx, 0, y, 17 * u); break;
    case 'stars':
      star(ctx, -17 * u, y + 3 * u, 9 * u); star(ctx, 0, y - 7 * u, 11 * u); star(ctx, 17 * u, y + 3 * u, 9 * u);
      break;
    case 'crown':
      ctx.beginPath();
      ctx.moveTo(-18 * u, y + 10 * u); ctx.lineTo(-20 * u, y - 10 * u); ctx.lineTo(-9 * u, y);
      ctx.lineTo(0, y - 15 * u); ctx.lineTo(9 * u, y); ctx.lineTo(20 * u, y - 10 * u); ctx.lineTo(18 * u, y + 10 * u);
      ctx.closePath(); ctx.fill();
      break;
    case 'wings':
      for (const k of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, y + 8 * u);
        ctx.quadraticCurveTo(k * 14 * u, y - 16 * u, k * 26 * u, y - 10 * u);
        ctx.quadraticCurveTo(k * 16 * u, y - 4 * u, k * 20 * u, y + 2 * u);
        ctx.quadraticCurveTo(k * 10 * u, y, 0, y + 8 * u);
        ctx.fill();
      }
      break;
    case 'tower':
      ctx.fillRect(-11 * u, y - 6 * u, 22 * u, 18 * u);
      for (const k of [-11, -3, 5]) ctx.fillRect(k * u, y - 14 * u, 6 * u, 9 * u);
      break;
    case 'bolt':
      ctx.beginPath();
      ctx.moveTo(6 * u, y - 18 * u); ctx.lineTo(-10 * u, y + 2 * u); ctx.lineTo(-1 * u, y + 2 * u);
      ctx.lineTo(-6 * u, y + 18 * u); ctx.lineTo(10 * u, y - 3 * u); ctx.lineTo(1 * u, y - 3 * u);
      ctx.closePath(); ctx.fill();
      break;
    case 'wave':
      for (const k of [-6, 6]) {
        ctx.beginPath();
        ctx.moveTo(-20 * u, y + k * u);
        ctx.bezierCurveTo(-10 * u, y + (k - 12) * u, -4 * u, y + (k + 12) * u, 6 * u, y + k * u);
        ctx.bezierCurveTo(12 * u, y + (k - 8) * u, 16 * u, y + (k - 4) * u, 20 * u, y + k * u);
        ctx.stroke();
      }
      break;
    case 'ball':
      ctx.beginPath(); ctx.arc(0, y, 15 * u, 0, Math.PI * 2); ctx.stroke();
      star(ctx, 0, y, 8 * u, 5);
      break;
    case 'chevrons':
      for (const k of [-8, 4]) {
        ctx.beginPath();
        ctx.moveTo(-17 * u, y + (k + 8) * u); ctx.lineTo(0, y + (k - 6) * u); ctx.lineTo(17 * u, y + (k + 8) * u);
        ctx.stroke();
      }
      break;
    case 'cross':
      ctx.fillRect(-5 * u, y - 17 * u, 10 * u, 34 * u);
      ctx.fillRect(-17 * u, y - 5 * u, 34 * u, 10 * u);
      break;
    default:
      ctx.beginPath(); ctx.arc(0, y, 12 * u, 0, Math.PI * 2); ctx.fill();
  }
}

/** Dibuja el escudo de un equipo centrado en (cx, cy). */
export function drawCrest(ctx, team, cx, cy, size) {
  const k = team.home, cr = team.crest;
  const c1 = k.shirt, c2 = k.accent;
  const u = size / 100;
  ctx.save();
  ctx.translate(cx, cy);
  shapePath(ctx, cr.shape, size);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = c1;
  ctx.fillRect(-size, -size, size * 2, size * 2);
  ctx.fillStyle = c2;
  switch (k.pattern) {
    case 'stripes': case 'pinstripes':
      for (let i = -3; i <= 3; i += 2) ctx.fillRect((i * 13 - 5) * u, -size, 10 * u, size * 2);
      break;
    case 'hoops':
      for (let i = -3; i <= 3; i += 2) ctx.fillRect(-size, (i * 14 - 6) * u, size * 2, 12 * u);
      break;
    case 'halves':
      ctx.fillRect(0, -size, size, size * 2);
      break;
    case 'sash':
      ctx.save(); ctx.rotate(-0.7); ctx.fillRect(-size, -12 * u, size * 2, 24 * u); ctx.restore();
      break;
    case 'band':
      ctx.fillRect(-size, 12 * u, size * 2, 20 * u);
      break;
    default:
      ctx.globalAlpha = 0.9;
      ctx.fillRect(-size, 30 * u, size * 2, size);
      ctx.globalAlpha = 1;
  }
  // Brillo suave
  const g = ctx.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.22)');
  g.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = g;
  ctx.fillRect(-size, -size, size * 2, size * 2);
  ctx.restore();
  ctx.lineWidth = 5 * u;
  ctx.strokeStyle = shade(c1, -0.6);
  ctx.stroke();
  ctx.lineWidth = 2 * u;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.stroke();
  // Emblema con sombra para que se lea sobre cualquier fondo
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 4 * u;
  const rgb = hexToRgb(c1);
  const lightBase = rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11 > 0.72;
  const ink = lightBase ? shade(c2, -0.25) : '#ffffff';
  if (lightBase) { ctx.shadowColor = 'rgba(255,255,255,0.6)'; ctx.shadowBlur = 2 * u; }
  emblem(ctx, cr.emblem, size, ink);
  ctx.font = `800 ${20 * u}px "Barlow Condensed", "Arial Narrow", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = k.pattern === 'solid' || k.pattern === 'sleeves' || k.pattern === 'band' ? '#ffffff' : ink;
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 3 * u;
  if (lightBase && ctx.fillStyle !== '#ffffff') ctx.shadowColor = 'rgba(255,255,255,0.6)';
  ctx.fillText(cr.mono, 0, 26 * u);
  ctx.restore();
}

const cache = new Map();

/** Escudo como imagen (data URL) para usar en la interfaz. */
export function crestURL(team, size = 160) {
  const key = team.id + ':' + size;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  drawCrest(c.getContext('2d'), team, size / 2, size / 2, size * 0.92);
  const url = c.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
