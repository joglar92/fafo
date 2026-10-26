(() => {
  'use strict';

  const W = 1000, H = 640;

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
  let remoteState = null;
  let remoteInput = null;
  let mode = 'local';       // 'local' | 'online' | 'cpu'
  let role = null;
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
  const comp = qs.get('comp') || 'league';
  const p1 = qs.get('p1') || null;

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
  const overlayEl = document.getElementById('overlay');

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
  }

  // ================= 3D (Three.js) =================
  let renderer = null, scene = null, camera = null;
  let meshA = null, meshB = null, ballMesh = null;
  let spriteA = null, spriteB = null;
  let spriteLabelA = '', spriteLabelB = '';

  function tx(x) { return x - W / 2; }
  function tz(y) { return y - H / 2; }

  function roundRectPath(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function makePitchTexture() {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    // pasto
    g.fillStyle = '#2d7a3d';
    g.fillRect(0, 0, W, H);
    // franjas
    g.fillStyle = 'rgba(255,255,255,0.04)';
    for (let i = 0; i < W; i += 80) g.fillRect(i, 0, 40, H);
    // líneas
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 4;
    g.strokeRect(12, 12, W - 24, H - 24);
    g.beginPath(); g.moveTo(W / 2, 12); g.lineTo(W / 2, H - 12); g.stroke();
    g.beginPath(); g.arc(W / 2, H / 2, 70, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(W / 2, H / 2, 6, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.8)'; g.fill();
    // áreas
    const box = (x) => {
      g.strokeRect(x, H / 2 - 90, 80, 180);
      g.strokeRect(x, H / 2 - 45, 30, 90);
    };
    box(12); box(W - 92);
    return new THREE.CanvasTexture(c);
  }

  function makePlayer(color) {
    const g = new THREE.Group();
    const jersey = new THREE.MeshLambertMaterial({ color: new THREE.Color(color) });
    const skin = new THREE.MeshLambertMaterial({ color: 0xe8b678 });
    const shorts = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
    const hair = new THREE.MeshLambertMaterial({ color: 0x2f2216 });

    // sombra (disco en el suelo)
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(P_R, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.6;
    g.add(shadow);

    // piernas
    const legG = new THREE.CylinderGeometry(2.6, 2.6, 12, 8);
    const legL = new THREE.Mesh(legG, skin); legL.position.set(-3.5, 6, 2); g.add(legL);
    const legR = new THREE.Mesh(legG, skin); legR.position.set(3.5, 6, 2); g.add(legR);

    // torso (camiseta)
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 8, 16, 14), jersey);
    torso.position.y = 20; g.add(torso);

    // pantalón
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(7, 6, 7, 12), shorts);
    sh.position.y = 10; g.add(sh);

    // brazos (hacia adelante = +Z)
    const armG = new THREE.CylinderGeometry(2.4, 2.4, 13, 8);
    const armL = new THREE.Mesh(armG, jersey); armL.position.set(-6.5, 21, 4); armL.rotation.x = 0.6; g.add(armL);
    const armR = new THREE.Mesh(armG, jersey); armR.position.set(6.5, 21, 4); armR.rotation.x = 0.6; g.add(armR);

    // cabeza
    const head = new THREE.Mesh(new THREE.SphereGeometry(6.4, 18, 14), skin);
    head.position.y = 32; g.add(head);

    // pelo (casquete superior)
    const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(6.5, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hair);
    hairMesh.position.y = 32; g.add(hairMesh);

    return g;
  }

  function makeNameSprite(text, color) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.font = 'bold 30px sans-serif';
    const tw = g.measureText(text).width;
    const w = Math.max(80, tw + 40), h = 44;
    const x = (256 - w) / 2, y = (64 - h) / 2;
    g.fillStyle = 'rgba(10,14,20,0.75)';
    roundRectPath(g, x, y, w, h, 20);
    g.fill();
    g.fillStyle = color;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 33);
    const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(w * 0.4, h * 0.4, 1);
    return sprite;
  }

  function init3D() {
    if (typeof THREE === 'undefined') {
      hint.textContent = 'No se pudo cargar el motor 3D (Three.js).';
      hint.style.display = 'block';
      return false;
    }
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a1a2a);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 4000);
    camera.position.set(0, 440, 520);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('stage').appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(80, 200, 120);
    scene.add(sun);

    // cancha
    const pitch = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshLambertMaterial({ map: makePitchTexture() })
    );
    pitch.rotation.x = -Math.PI / 2;
    scene.add(pitch);

    // arcos
    scene.add(makeGoal(-W / 2));
    scene.add(makeGoal(W / 2));

    // jugadores
    meshA = makePlayer(myColor);
    meshB = makePlayer(oppColor);
    scene.add(meshA);
    scene.add(meshB);

    // pelota
    ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(B_R, 20, 16),
      new THREE.MeshLambertMaterial({ color: 0xffffff })
    );
    scene.add(ballMesh);

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    return true;
  }

  function makeGoal(cx) {
    const g = new THREE.Group();
    const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const net = new THREE.MeshLambertMaterial({ color: 0xcccccc, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
    const half = GOAL_HALF, h = 45;
    const postG = new THREE.CylinderGeometry(3, 3, h, 12);
    const p1 = new THREE.Mesh(postG, white); p1.position.set(cx, h / 2, -half); g.add(p1);
    const p2 = new THREE.Mesh(postG, white); p2.position.set(cx, h / 2, half); g.add(p2);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, half * 2, 12), white);
    bar.rotation.x = Math.PI / 2; bar.position.set(cx, h, 0); g.add(bar);
    const dir = cx < 0 ? -1 : 1;
    const netBox = new THREE.Mesh(new THREE.BoxGeometry(26, h, half * 2), net);
    netBox.position.set(cx + dir * 13, h / 2, 0); g.add(netBox);
    return g;
  }

  function setPlayer(mesh, p, color, label) {
    if (!mesh) return;
    mesh.position.set(tx(p.x), 0, tz(p.y));
    mesh.rotation.y = Math.atan2(p.dir.x, p.dir.y);
    // actualizar sprite de nombre
  }

  function ensureSprites() {
    const la = mode === 'cpu' ? (p1 || myName) : 'A';
    const lb = mode === 'cpu' ? oppName : 'B';
    if (!spriteA || spriteLabelA !== la) {
      if (spriteA) scene.remove(spriteA);
      spriteA = makeNameSprite(la, myColor);
      scene.add(spriteA);
      spriteLabelA = la;
    }
    if (!spriteB || spriteLabelB !== lb) {
      if (spriteB) scene.remove(spriteB);
      spriteB = makeNameSprite(lb, oppColor);
      scene.add(spriteB);
      spriteLabelB = lb;
    }
  }

  function render3D(s) {
    if (!scene) return;
    ensureSprites();
    setPlayer(meshA, s.a, myColor);
    setPlayer(meshB, s.b, oppColor);
    spriteA.position.set(tx(s.a.x), 54, tz(s.a.y));
    spriteB.position.set(tx(s.b.x), 54, tz(s.b.y));
    ballMesh.position.set(tx(s.ball.x), B_R, tz(s.ball.y));

    // HUD
    scoreA.textContent = (mode === 'cpu' ? myName + ' ' : '') + s.score.a;
    scoreB.textContent = s.score.b + (mode === 'cpu' ? ' ' + oppName : '');
    const t = Math.ceil(s.time);
    clock.textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');

    // overlay
    if (s.countdown > 0) {
      overlayEl.textContent = String(Math.ceil(s.countdown));
      overlayEl.style.display = 'flex';
    } else if (s.over) {
      overlayEl.textContent = s.winner === 'draw' ? 'EMPATE'
        : (s.winner === 'a' ? 'GANÓ ' + (mode === 'cpu' ? myName : 'AZUL') : 'GANÓ ' + (mode === 'cpu' ? oppName : 'ROJO'));
      overlayEl.style.display = 'flex';
    } else {
      overlayEl.style.display = 'none';
    }

    renderer.render(scene, camera);
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
      localStorage.setItem('fafo_career_pending', JSON.stringify({ myGoals: state.score.a, oppGoals: state.score.b, oppId: oppId, comp: comp }));
      const h = document.getElementById('hint');
      h.innerHTML = '<a href="/career.html" style="color:#3fb950;font-weight:700;text-decoration:underline;font-size:15px">← Volver al Modo Carrera</a>';
      h.style.pointerEvents = 'auto';
    }
    const s = (mode === 'online' && role === 'guest' && remoteState) ? remoteState : state;
    render3D(s);
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

  // ---- boot ----
  init3D();

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
