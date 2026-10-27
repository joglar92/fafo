(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const SAVE_KEY = 'fafo_career';

  // ---- estado y datos ----
  let state = null;
  let playersById = {};
  let clubOvr = null;

  function xpForLevel(l) { return l * 100; }

  function teamRating() {
    if (!state || !state.squad) return null;
    const rs = state.squad
      .map((id) => (playersById[id] ? playersById[id].rating : 0))
      .filter((r) => r > 0)
      .sort((a, b) => b - a)
      .slice(0, 11);
    if (!rs.length) return null;
    return Math.round(rs.reduce((s, r) => s + r, 0) / rs.length);
  }

  function render() {
    const has = !!state;
    const name = has ? (state.playerName || state.clubName || 'FAFO') : 'CREÁ TU CLUB';
    const level = has ? (state.level || 1) : 1;
    const xp = has ? (state.xp || 0) : 0;
    const xpMax = xpForLevel(level);
    const coins = has ? (state.coins || 0) : 0;
    const gems = has ? (state.gems || 0) : 0;
    clubOvr = teamRating();

    $('#pName').textContent = name;
    $('#pLevel').textContent = level;
    $('#xpFill').style.width = Math.min(100, (xp / xpMax) * 100) + '%';
    $('#pCoins').textContent = coins.toLocaleString('es-AR');
    $('#pGems').textContent = gems;
    $('#clubOvr').textContent = clubOvr != null ? clubOvr : '--';
    const color = has ? (state.clubColor || '#1f6feb') : '#1f6feb';
    $('#clubCrest').style.setProperty('--club-color', color);
    $('#clubCrest').textContent = has ? (state.clubName || 'F').slice(0, 1).toUpperCase() : '⚽';
  }

  function load() {
    try { state = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { state = null; }
    render();
    fetch('/data/players.json')
      .then((r) => r.json())
      .then((ps) => { ps.forEach((p) => { playersById[p.id] = p; }); render(); })
      .catch(() => {});
  }

  // ---- toast y modal ----
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }

  function openModal(title, bodyHTML) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHTML;
    $('#modal').hidden = false;
    $('#modalBody').querySelectorAll('[data-go]').forEach((b) => {
      b.addEventListener('click', () => { location.href = b.dataset.go; });
    });
    $('#modalBody').querySelectorAll('[data-todo]').forEach((b) => {
      b.addEventListener('click', () => { toast(b.dataset.todo); });
    });
    $('#modalBody').querySelectorAll('[data-fullscreen]').forEach((b) => {
      b.addEventListener('click', () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {});
      });
    });
    $('#modalBody').querySelectorAll('[data-reset]').forEach((b) => {
      b.addEventListener('click', () => {
        if (confirm('¿Borrar tu club y empezar de cero?')) {
          localStorage.removeItem(SAVE_KEY);
          localStorage.removeItem('fafo_career_pending');
          location.reload();
        }
      });
    });
  }
  $('#modalClose').addEventListener('click', () => { $('#modal').hidden = true; });
  $('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) $('#modal').hidden = true; });

  // ---- modales concretos ----
  function openSettings() {
    const rows = `
      <div class="modal-row"><span>Pantalla completa</span><button data-fullscreen>Activar</button></div>
      <div class="modal-row"><span>Modo Carrera</span><button data-go="/career.html">Entrar</button></div>
      <div class="modal-row"><span>Partido 3D</span><button data-go="/pro/">Jugar</button></div>
      <div class="modal-row"><span>1v1 online</span><button data-go="/game/fafo.html">Jugar</button></div>
      <div class="modal-row"><span>Reiniciar club</span><button class="danger" data-reset>Borrar</button></div>
    `;
    openModal('AJUSTES', rows);
  }

  function openPlay() {
    const rows = `
      <div class="modal-row"><span>🎮 Partido 3D completo</span><button data-go="/pro/">Jugar</button></div>
      <div class="modal-row"><span>🏆 Modo Carrera</span><button data-go="/career.html">Entrar</button></div>
      <div class="modal-row"><span>🌐 1v1 online</span><button data-go="/game/fafo.html">Jugar</button></div>
    `;
    openModal('ELEGÍ MODO', rows);
  }

  // ---- navegación ----
  function wireNav() {
    $('#btnProfile').addEventListener('click', () => { state ? (location.href = '/career.html') : toast('Creá tu club primero'); });
    $('#btnClub').addEventListener('click', () => { location.href = '/career.html'; });
    $('#btnPlay').addEventListener('click', openPlay);
    $('#btnSettings').addEventListener('click', openSettings);

    $('#btnAdd').addEventListener('click', () => toast('Próximamente: compras de recursos'));
    $('#btnFriends').addEventListener('click', () => toast('Próximamente: amigos'));
    $('#btnMsg').addEventListener('click', () => toast('Próximamente: mensajes'));
    $('#btnNews').addEventListener('click', () => toast('Próximamente: noticias'));
    $('#btnCollection').addEventListener('click', () => toast('Próximamente: colección'));
    $('#btnEvents').addEventListener('click', () => toast('Próximamente: eventos'));

    // barra inferior
    const nav = { home: null, league: '/career.html', market: '/career.html', cup: '/career.html', store: null };
    document.querySelectorAll('#bottomnav .bn').forEach((b) => {
      b.addEventListener('click', () => {
        const k = b.dataset.nav;
        document.querySelectorAll('#bottomnav .bn').forEach((x) => x.classList.toggle('active', x === b));
        if (nav[k]) location.href = nav[k];
        else if (k === 'store') toast('Próximamente: tienda');
      });
    });
  }

  // ================= balón de fondo =================
  const ballCanvas = $('#ballbg');
  const ballCtx = ballCanvas.getContext('2d');

  function pentagon(c, x, y, r, rot) {
    c.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = rot + (i / 5) * Math.PI * 2 - Math.PI / 2;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      i === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
    }
    c.closePath();
  }

  function drawBall(w, h, t) {
    const cx = w * 0.30, cy = h * 0.52;
    const r = Math.min(w, h) * 0.46;
    const rot = t * 0.06;

    // resplandor verde ambiental
    const glow = ballCtx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 1.5);
    glow.addColorStop(0, 'rgba(63,185,80,0.20)');
    glow.addColorStop(0.5, 'rgba(46,160,67,0.10)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ballCtx.fillStyle = glow;
    ballCtx.fillRect(0, 0, w, h);

    ballCtx.save();
    ballCtx.translate(cx, cy);
    ballCtx.rotate(rot);

    // esfera base con luz verde desde arriba-izquierda
    const base = ballCtx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    base.addColorStop(0, '#f4f7f5');
    base.addColorStop(0.45, '#dfe6e2');
    base.addColorStop(0.8, '#9fb0ab');
    base.addColorStop(1, '#5c6f66');
    ballCtx.fillStyle = base;
    ballCtx.beginPath(); ballCtx.arc(0, 0, r, 0, Math.PI * 2); ballCtx.fill();

    // pentágonos negros (patrón clásico)
    const pr = r * 0.34;
    ballCtx.fillStyle = '#10151a';
    pentagon(ballCtx, 0, 0, pr, 0); ballCtx.fill();
    const d = r * 0.62;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + Math.PI / 2;
      const px = Math.cos(a) * d, py = Math.sin(a) * d;
      pentagon(ballCtx, px, py, pr * 0.72, Math.PI + a); ballCtx.fill();
    }
    // pentágonos de la periferia (parciales)
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const px = Math.cos(a) * r * 0.92, py = Math.sin(a) * r * 0.92;
      pentagon(ballCtx, px, py, pr * 0.55, a); ballCtx.fill();
    }

    // sombreado de profundidad
    const shade = ballCtx.createRadialGradient(r * 0.4, r * 0.4, r * 0.2, 0, 0, r);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(0.7, 'rgba(0,0,0,0.12)');
    shade.addColorStop(1, 'rgba(0,0,0,0.45)');
    ballCtx.fillStyle = shade;
    ballCtx.beginPath(); ballCtx.arc(0, 0, r, 0, Math.PI * 2); ballCtx.fill();

    ballCtx.restore();
  }

  // ================= cancha táctica =================
  const pitchCanvas = $('#pitch');
  const pitchCtx = pitchCanvas.getContext('2d');

  function drawPitch(w, h, t) {
    pitchCtx.clearRect(0, 0, w, h);
    const m = 16;
    const fw = w - m * 2, fh = h - m * 2;

    // césped
    const g = pitchCtx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2c6b3a');
    g.addColorStop(1, '#1f5230');
    pitchCtx.fillStyle = g;
    pitchCtx.fillRect(0, 0, w, h);
    // bandas de corte
    pitchCtx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let x = m; x < w - m; x += fw / 8) pitchCtx.fillRect(x, m, fw / 16, fh);

    // líneas
    pitchCtx.strokeStyle = 'rgba(255,255,255,0.75)';
    pitchCtx.lineWidth = 2;
    pitchCtx.strokeRect(m, m, fw, fh);
    pitchCtx.beginPath(); pitchCtx.moveTo(w / 2, m); pitchCtx.lineTo(w / 2, h - m); pitchCtx.stroke();
    pitchCtx.beginPath(); pitchCtx.arc(w / 2, h / 2, fh * 0.18, 0, Math.PI * 2); pitchCtx.stroke();
    // áreas
    const bw = fh * 0.5, bd = fw * 0.16;
    pitchCtx.strokeRect(m, h / 2 - bw / 2, bd, bw);
    pitchCtx.strokeRect(w - m - bd, h / 2 - bw / 2, bd, bw);
    const sw = fh * 0.24, sd = fw * 0.06;
    pitchCtx.strokeRect(m, h / 2 - sw / 2, sd, sw);
    pitchCtx.strokeRect(w - m - sd, h / 2 - sw / 2, sd, sw);

    // jugadores (dos equipos)
    const teamA = ['#2ea043', '#3fb950'];
    const teamB = ['#b3302f', '#ff6b6b'];
    const formations = [
      [0.18, 0.5, 0.32, 0.5, 0.32, 0.28, 0.32, 0.72, 0.5, 0.16, 0.5, 0.84, 0.68, 0.3, 0.68, 0.7, 0.8, 0.5],
      [0.15, 0.5, 0.34, 0.5, 0.34, 0.2, 0.34, 0.8, 0.52, 0.34, 0.52, 0.66, 0.7, 0.2, 0.7, 0.8, 0.8, 0.5],
      [0.2, 0.5, 0.36, 0.35, 0.36, 0.65, 0.55, 0.5, 0.55, 0.25, 0.55, 0.75, 0.72, 0.5, 0.8, 0.5, 0.9, 0.5],
    ];
    const page = Math.floor(t / 4) % formations.length;
    const form = formations[page];
    const teams = [teamA, teamB];

    // trayectorias (línea que aparece y desaparece)
    const trajActive = (t % 5) < 1.4;
    if (trajActive) {
      const from = { x: m + fw * 0.32, y: h / 2 };
      const to = { x: w - m - fw * 0.2, y: h / 2 };
      const a = (t % 1.4) / 1.4;
      pitchCtx.strokeStyle = `rgba(242,194,48,${(1 - a) * 0.8})`;
      pitchCtx.lineWidth = 2;
      pitchCtx.setLineDash([6, 6]);
      pitchCtx.beginPath(); pitchCtx.moveTo(from.x, from.y); pitchCtx.lineTo(to.x, to.y); pitchCtx.stroke();
      pitchCtx.setLineDash([]);
    }

    for (let ti = 0; ti < 2; ti++) {
      const cols = teams[ti];
      for (let i = 0; i < 9; i++) {
        let fx = form[i * 2], fy = form[i * 2 + 1];
        if (ti === 1) fx = 1 - fx;
        // deriva suave
        const drift = Math.sin(t * 1.3 + i * 1.7 + ti * 2.0) * 6;
        const x = m + fx * fw + (ti === 0 ? -drift : drift);
        const y = m + fy * fh + Math.cos(t * 1.1 + i * 2.1) * 5;
        const r = 6 + Math.sin(t * 2 + i) * 0.8;
        pitchCtx.beginPath(); pitchCtx.arc(x, y, r, 0, Math.PI * 2);
        pitchCtx.fillStyle = cols[0];
        pitchCtx.fill();
        pitchCtx.beginPath(); pitchCtx.arc(x, y, r * 0.45, 0, Math.PI * 2);
        pitchCtx.fillStyle = cols[1];
        pitchCtx.fill();
      }
    }
  }

  // ================= bucle =================
  let w0 = 0, h0 = 0, pw = 0, ph = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w0 = window.innerWidth; h0 = window.innerHeight;
    ballCanvas.width = w0 * dpr; ballCanvas.height = h0 * dpr;
    ballCanvas.style.width = w0 + 'px'; ballCanvas.style.height = h0 + 'px';

    const pr = pitchCanvas.getBoundingClientRect();
    pw = Math.max(200, pr.width); ph = Math.max(120, pr.height);
    pitchCanvas.width = pw * dpr; pitchCanvas.height = ph * dpr;
  }
  window.addEventListener('resize', resize);
  resize();

  let start = performance.now();
  function loop(now) {
    const t = (now - start) / 1000;
    ballCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ballCtx.clearRect(0, 0, w0, h0);
    drawBall(w0, h0, t);

    pitchCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPitch(pw, ph, t);

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---- arranque ----
  load();
  wireNav();
})();
