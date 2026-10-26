(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const W = 1000, H = 640;
  canvas.width = W;
  canvas.height = H;

  function fit() {
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H) * 0.97;
    canvas.style.width = (W * scale) + 'px';
    canvas.style.height = (H * scale) + 'px';
  }
  window.addEventListener('resize', fit);
  fit();

  // ---- constantes ----
  const P_R = 16, B_R = 8;
  const GOAL_HALF = 100;
  const GOAL_Y = H / 2;
  const FRICTION = 0.90;
  const ACC = 0.55;
  const MAX_SPEED = 6.5;
  const BALL_FRICTION = 0.985;
  const KICK_POWER = 13;
  const KICK_CD = 22;
  const MATCH_TIME = 120; // segundos

  function freshState() {
    return {
      ball: { x: W / 2, y: H / 2, vx: 0, vy: 0 },
      a: { x: W / 2 - 200, y: H / 2, vx: 0, vy: 0, kickCd: 0, dir: { x: 1, y: 0 } },
      b: { x: W / 2 + 200, y: H / 2, vx: 0, vy: 0, kickCd: 0, dir: { x: -1, y: 0 } },
      score: { a: 0, b: 0 },
      time: MATCH_TIME,
      countdown: 3,
      started: false,
      over: false,
      winner: null,
    };
  }

  let state = freshState();
  let remoteState = null;   // para el guest
  let remoteInput = null;   // input del guest en el host
  let mode = 'local';       // 'local' | 'online' | 'cpu'
  let role = null;          // 'host' | 'guest'
  let socket = null;
  let roomCode = null;
  let reported = false;

  // ---- config carrera / vs CPU ----
  const qs = new URLSearchParams(location.search);
  const CAREER = qs.get('mode') === 'career' || qs.get('mode') === 'cpu';
  const myName = qs.get('me') || 'Azul';
  const myColor = qs.get('meColor') || '#4dabf7';
  const oppName = qs.get('opp') || 'Rojo';
  const oppColor = qs.get('oppColor') || '#ff6b6b';
  const oppId = qs.get('oppId') || null;

  const keys = {};

  // ---- elementos UI ----
  const lobby = document.getElementById('lobby');
  const codeEl = document.getElementById('code');
  const statusEl = document.getElementById('status');
  const btnStart = document.getElementById('btnStart');
  const hud = document.getElementById('hud');
  const hint = document.getElementById('hint');
  const scoreA = document.getElementById('scoreA');
  const scoreB = document.getElementById('scoreB');
  const clock = document.getElementById('clock');

  // ---- inputs ----
  function inputA() {
    let x = 0, y = 0;
    if (keys['w'] || keys['W']) y -= 1;
    if (keys['s'] || keys['S']) y += 1;
    if (keys['a'] || keys['A']) x -= 1;
    if (keys['d'] || keys['D']) x += 1;
    const kick = !!(keys[' '] || keys['f'] || keys['F']);
    return { x, y, kick };
  }
  function inputB() {
    let x = 0, y = 0;
    if (keys['ArrowUp']) y -= 1;
    if (keys['ArrowDown']) y += 1;
    if (keys['ArrowLeft']) x -= 1;
    if (keys['ArrowRight']) x += 1;
    const kick = !!(keys['Enter'] || keys['/'] || keys['m'] || keys['M']);
    return { x, y, kick };
  }

  function norm(x, y) {
    const l = Math.hypot(x, y);
    if (l === 0) return { x: 0, y: 0 };
    return { x: x / l, y: y / l };
  }

  function applyInput(p, inp) {
    const d = norm(inp.x, inp.y);
    if (d.x !== 0 || d.y !== 0) p.dir = { x: d.x, y: d.y };
    p.vx += d.x * ACC;
    p.vy += d.y * ACC;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > MAX_SPEED) { p.vx = p.vx / sp * MAX_SPEED; p.vy = p.vy / sp * MAX_SPEED; }
  }

  function cpuInput() {
    const p = state.b, ball = state.ball;
    const dx = ball.x - p.x, dy = ball.y - p.y;
    const dist = Math.hypot(dx, dy);
    let x = 0, y = 0;
    if (Math.abs(dx) > 2) x = Math.sign(dx);
    if (Math.abs(dy) > 2) y = Math.sign(dy);
    return { x, y, kick: dist < P_R + B_R + 6 };
  }

  function kickBall(p) {
    if (p.kickCd > 0) return;
    const dx = state.ball.x - p.x, dy = state.ball.y - p.y;
    if (Math.hypot(dx, dy) > P_R + B_R + 9) return;
    p.kickCd = KICK_CD;
    let ax = p.dir.x, ay = p.dir.y;
    if (Math.hypot(ax, ay) < 0.01) {
      const goalX = (p.x < W / 2) ? W : 0;
      const g = norm(goalX - p.x, H / 2 - p.y);
      ax = g.x; ay = g.y;
    }
    state.ball.vx = ax * KICK_POWER + p.vx * 0.3;
    state.ball.vy = ay * KICK_POWER + p.vy * 0.3;
  }

  function resetKickoff() {
    state.ball = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
    state.a.x = W / 2 - 200; state.a.y = H / 2; state.a.vx = 0; state.a.vy = 0; state.a.kickCd = 0;
    state.b.x = W / 2 + 200; state.b.y = H / 2; state.b.vx = 0; state.b.vy = 0; state.b.kickCd = 0;
  }

  function physics() {
    const ball = state.ball;
    ball.x += ball.vx;
    ball.y += ball.vy;
    ball.vx *= BALL_FRICTION;
    ball.vy *= BALL_FRICTION;

    if (ball.y < B_R) { ball.y = B_R; ball.vy = -ball.vy * 0.8; }
    if (ball.y > H - B_R) { ball.y = H - B_R; ball.vy = -ball.vy * 0.8; }

    const inMouth = Math.abs(ball.y - GOAL_Y) < GOAL_HALF;
    if (!inMouth) {
      if (ball.x < B_R) { ball.x = B_R; ball.vx = -ball.vx * 0.8; }
      if (ball.x > W - B_R) { ball.x = W - B_R; ball.vx = -ball.vx * 0.8; }
    }

    [state.a, state.b].forEach(p => {
      p.x += p.vx; p.y += p.vy;
      p.vx *= FRICTION; p.vy *= FRICTION;
      if (Math.hypot(p.vx, p.vy) < 0.05) { p.vx = 0; p.vy = 0; }
      p.x = Math.max(P_R, Math.min(W - P_R, p.x));
      p.y = Math.max(P_R, Math.min(H - P_R, p.y));
      if (p.kickCd > 0) p.kickCd--;
    });

    [state.a, state.b].forEach(p => {
      const dx = ball.x - p.x, dy = ball.y - p.y;
      const d = Math.hypot(dx, dy);
      const min = P_R + B_R;
      if (d < min && d > 0.001) {
        const nx = dx / d, ny = dy / d;
        ball.x = p.x + nx * min;
        ball.y = p.y + ny * min;
        const rel = Math.max(0, p.vx * nx + p.vy * ny);
        ball.vx += nx * rel * 0.9 + nx * 1.2;
        ball.vy += ny * rel * 0.9 + ny * 1.2;
      }
    });

    if (ball.x < 0 && inMouth) goal('b');
    if (ball.x > W && inMouth) goal('a');
  }

  function goal(team) {
    state.score[team]++;
    resetKickoff();
    state.countdown = 1.2;
  }

  function step() {
    if (!state.started || state.over) return;

    if (state.countdown > 0) {
      state.countdown -= 1 / 60;
      if (state.countdown <= 0) state.countdown = 0;
      return;
    }

    if (mode === 'local') {
      applyInput(state.a, inputA());
      applyInput(state.b, inputB());
      if (inputA().kick) kickBall(state.a);
      if (inputB().kick) kickBall(state.b);
    } else if (mode === 'cpu') {
      applyInput(state.a, inputA());
      if (inputA().kick) kickBall(state.a);
      const ai = cpuInput();
      applyInput(state.b, ai);
      if (ai.kick) {
        state.b.dir = norm(0 - state.b.x, H / 2 - state.b.y);
        kickBall(state.b);
      }
    } else if (mode === 'online' && role === 'host') {
      applyInput(state.a, inputA());
      if (inputA().kick) kickBall(state.a);
      if (remoteInput) {
        applyInput(state.b, remoteInput);
        if (remoteInput.kick) kickBall(state.b);
      }
    }

    physics();

    if (state.time > 0) state.time -= 1 / 60;
    if (state.time <= 0) {
      state.time = 0;
      state.over = true;
      state.winner = state.score.a === state.score.b ? 'draw'
        : (state.score.a > state.score.b ? 'a' : 'b');
    }
  }

  function serialize() {
    return JSON.parse(JSON.stringify(state));
  }

  function applyRemote(s) {
    remoteState = s;
    // guest: render desde el estado del host
  }

  // ---- render ----
  function draw() {
    const s = (mode === 'online' && role === 'guest' && remoteState) ? remoteState : state;
    if (!s) return;

    ctx.clearRect(0, 0, W, H);

    // pasto
    ctx.fillStyle = '#2d6a2d';
    ctx.fillRect(0, 0, W, H);
    // rayas de pasto
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    for (let i = 0; i < W; i += 40) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, H); ctx.stroke();
    }

    // lineas del campo
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, W - 20, H - 20);
    ctx.beginPath(); ctx.moveTo(W / 2, 10); ctx.lineTo(W / 2, H - 10); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 70, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill();

    // áreas + arcos
    drawBox(60, 180);
    drawBox(W - 60, 180);

    // arcos (boca)
    ctx.fillStyle = '#222';
    ctx.fillRect(-6, GOAL_Y - GOAL_HALF, 14, GOAL_HALF * 2);
    ctx.fillRect(W - 8, GOAL_Y - GOAL_HALF, 14, GOAL_HALF * 2);

    // jugadores
    drawPlayer(s.a, myColor, mode === 'cpu' ? myName : 'A');
    drawPlayer(s.b, oppColor, mode === 'cpu' ? oppName : 'B');

    // pelota
    ctx.beginPath();
    ctx.arc(s.ball.x, s.ball.y, B_R, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();

    // countdown / over
    if (s.countdown > 0) {
      overlay(Math.ceil(s.countdown));
    } else if (s.over) {
      overlay(s.winner === 'draw' ? 'EMPATE' : (s.winner === 'a' ? 'GANÓ AZUL' : 'GANÓ ROJO'));
    }

    // HUD
    scoreA.textContent = (mode === 'cpu' ? myName + ' ' : '') + s.score.a;
    scoreB.textContent = s.score.b + (mode === 'cpu' ? ' ' + oppName : '');
    const t = Math.ceil(s.time);
    clock.textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }

  function drawBox(x, h) {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.strokeRect(x, GOAL_Y - h / 2, 80, h);
    ctx.strokeRect(x, GOAL_Y - h / 4, 30, h / 2);
  }

  function drawPlayer(p, color, label) {
    // sombra
    ctx.beginPath(); ctx.arc(p.x + 2, p.y + 2, P_R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
    // cuerpo
    ctx.beginPath(); ctx.arc(p.x, p.y, P_R, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.stroke();
    // dirección
    const a = Math.atan2(p.dir.y, p.dir.x);
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(a) * P_R, p.y + Math.sin(a) * P_R);
    ctx.lineTo(p.x + Math.cos(a) * (P_R + 8), p.y + Math.sin(a) * (P_R + 8));
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
    // etiqueta
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, p.x, p.y);
  }

  function overlay(txt) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 72px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, W / 2, H / 2);
  }

  // ---- loop ----
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (mode === 'local' || mode === 'cpu' || (mode === 'online' && role === 'host')) {
      step();
      if (mode === 'online' && role === 'host' && socket) {
        socket.emit('state', serialize());
      }
    }
    if (mode === 'cpu' && CAREER && state.over && !reported) {
      reported = true;
      localStorage.setItem('fafo_career_pending', JSON.stringify({ myGoals: state.score.a, oppGoals: state.score.b, oppId: oppId }));
      const h = document.getElementById('hint');
      h.innerHTML = '<a href="/career.html" style="color:#3fb950;font-weight:700;text-decoration:underline;font-size:15px">← Volver al Modo Carrera</a>';
      h.style.pointerEvents = 'auto';
    }
    draw();
    requestAnimationFrame(loop);
  }

  // ---- lobby / modo ----
  function startLocal() {
    mode = 'local';
    role = null;
    state = freshState();
    state.started = true;
    state.countdown = 3;
    hideLobby();
    hint.textContent = 'Azul: W A S D + Espacio (patear)  ·  Rojo: Flechas + Enter (patear)';
    hint.style.display = 'block';
  }

  function createRoom() {
    socket = io();
    socket.on('connect', () => {
      socket.emit('create', (res) => {
        roomCode = res.code;
        mode = 'online';
        role = 'host';
        codeEl.innerHTML = 'Tu sala:<br>' + roomCode;
        statusEl.textContent = 'Esperando rival… compartile este código';
        btnStart.style.display = 'block';
        wireOnline();
      });
    });
  }

  function joinRoom() {
    const code = document.getElementById('joinCode').value.trim().toUpperCase();
    if (code.length < 4) { statusEl.textContent = 'Ingresá un código válido'; return; }
    socket = io();
    socket.on('connect', () => {
      socket.emit('join', code, (res) => {
        if (!res.ok) { statusEl.textContent = 'Error: ' + res.error; socket.disconnect(); socket = null; return; }
        roomCode = res.code;
        mode = 'online';
        role = 'guest';
        statusEl.textContent = 'Conectado. Esperando que empiece el rival…';
        wireOnline();
      });
    });
  }

  function wireOnline() {
    socket.on('opponent_joined', () => {
      statusEl.textContent = '¡Rival conectado!';
      if (role === 'host') btnStart.style.display = 'block';
    });
    socket.on('opponent_left', () => {
      statusEl.textContent = 'El rival se fue.';
      if (role === 'host') btnStart.style.display = 'none';
    });
    socket.on('input', (d) => { remoteInput = d; });
    socket.on('state', (s) => { applyRemote(s); });
    socket.on('restart', () => {
      state = freshState();
      state.started = true;
      state.countdown = 3;
    });

    if (role === 'guest') {
      // enviar input 30 veces/seg
      setInterval(() => {
        if (socket && socket.connected) socket.emit('input', inputB());
      }, 33);
    }
  }

  function startOnline() {
    state = freshState();
    state.started = true;
    state.countdown = 3;
    socket.emit('restart');
    hideLobby();
    hint.textContent = role === 'host'
      ? 'Vos: Azul (W A S D + Espacio)  ·  Rival: Rojo'
      : 'Vos: Rojo (Flechas + Enter)  ·  Rival: Azul';
    hint.style.display = 'block';
  }

  function hideLobby() {
    lobby.style.display = 'none';
    hud.style.display = 'flex';
  }

  // ---- eventos UI ----
  document.getElementById('btnLocal').addEventListener('click', startLocal);
  document.getElementById('btnHost').addEventListener('click', createRoom);
  document.getElementById('btnJoin').addEventListener('click', joinRoom);
  document.getElementById('joinCode').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoom();
  });
  btnStart.addEventListener('click', startOnline);

  // ---- teclado ----
  window.addEventListener('keydown', (e) => {
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', '/'].includes(e.key)) {
      e.preventDefault();
    }
    keys[e.key] = true;
  });
  window.addEventListener('keyup', (e) => {
    keys[e.key] = false;
  });

  if (CAREER) {
    mode = 'cpu';
    role = null;
    state = freshState();
    state.started = true;
    state.countdown = 3;
    hideLobby();
    hint.textContent = 'Vos: ' + myName + ' (W A S D + Espacio)  ·  CPU: ' + oppName;
    hint.style.display = 'block';
  }

  requestAnimationFrame(loop);
})();
