// Punto de entrada: espera a las fuentes (se usan también en las texturas del
// estadio y las camisetas) y arranca el juego.
// FAFO: admite arranque directo por URL para saltar el menú e ir a un partido.
import { Game } from './core/Game.js';
import { TEAMS, getTeam } from './data/TeamsData.js';
import { tacticsFromStyle } from './match/Tactics.js';

function makeKit(shirt, accent) {
  return { shirt, accent, pattern: 'solid', shorts: shirt, socks: shirt, num: '#ffffff' };
}

// Crea un club a medida (nombre + color) reutilizando la plantilla de un club base.
function customTeam(name, color) {
  const base = TEAMS[0];
  const nm = String(name || base.name).slice(0, 18) || base.name;
  return {
    ...base,
    id: 'custom-' + Math.random().toString(36).slice(2, 7),
    name: nm,
    short: nm.slice(0, 3).toUpperCase(),
    home: makeKit(color || '#4dabf7', '#ffffff'),
    away: makeKit('#f5f5f5', color || '#4dabf7'),
    crest: { shape: 'shield', emblem: 'star', mono: nm.slice(0, 2).toUpperCase() },
  };
}

// Parámetros: home / away (ids de club) o homeName/homeColor + awayName/awayColor
// side=0|1 (qué lado controla el humano), diff=dificultad, night=1, half=minutos
function quickCfg() {
  const q = new URLSearchParams(location.search);
  if (!q.has('home') && !q.has('homeName') && !q.has('auto')) return null;
  const home = q.has('homeName')
    ? customTeam(q.get('homeName'), q.get('homeColor'))
    : getTeam(q.get('home'));
  const away = q.has('awayName')
    ? customTeam(q.get('awayName'), q.get('awayColor'))
    : getTeam(q.get('away'));
  const side = q.get('side') === '1' ? 1 : 0;
  return {
    home, away,
    homeTactics: tacticsFromStyle(home.style),
    awayTactics: tacticsFromStyle(away.style),
    difficulty: q.get('diff') || 'normal',
    halfMinutes: Number(q.get('half')) || 5,
    userSide: side,
    night: q.get('night') === '1',
  };
}

async function start() {
  const app = document.getElementById('app');
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('800 32px "Barlow Condensed"'),
        document.fonts.load('900 32px "Big Shoulders Display"'),
      ]),
      new Promise((r) => setTimeout(r, 1800)),
    ]);
  } catch (e) { /* se usarán las fuentes de reserva */ }
  try {
    const game = new Game({
      app,
      canvas: document.getElementById('gl'),
      ui: document.getElementById('ui'),
      hud: document.getElementById('hud'),
      fade: document.getElementById('fade'),
    });
    window.__game = game;
    game.boot();
    const cfg = quickCfg();
    if (cfg) {
      game.startMatch(cfg);
      // Modo carrera: al terminar, devolvemos el resultado y volvemos al dashboard.
      const q = new URLSearchParams(location.search);
      if (q.get('career') === '1') {
        game.match.on('fullTime', () => {
          const m = game.match;
          localStorage.setItem('fafo_career_pending', JSON.stringify({
            myGoals: m.teams[0].score, oppGoals: m.teams[1].score,
            oppId: q.get('oppId'), comp: q.get('comp'),
          }));
          setTimeout(() => { location.href = '/career.html'; }, 4000);
        });
      }
    }
  } catch (e) {
    console.error(e);
    const d = document.createElement('div');
    d.className = 'fatal';
    d.textContent = /WebGL2/.test(String(e && e.message))
      ? 'Este navegador no ofrece WebGL2, necesario para el 3D. Prueba con una versión reciente de Chrome, Edge o Firefox.'
      : 'No se ha podido iniciar el juego: ' + (e && e.message ? e.message : e);
    app.appendChild(d);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
