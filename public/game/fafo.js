(() => {
  'use strict';

  const W = 1000, H = 640;

  // ---- constantes ----
  const P_R = 14, B_R = 8;
  const GOAL_HALF = 110;
  const GOAL_Y = H / 2;
  const FRICTION = 0.90;
  const ACC = 0.5;
  const MAX_SPEED = 6.2;
  const BALL_FRICTION = 0.985;
  const KICK_POWER = 14;
  const KICK_CD = 22;
  const MATCH_TIME = 180; // segundos (3 min)

  // formación 4-3-3 (fracciones de cancha). Equipo A ataca hacia +X, B hacia -X.
  const FORM = [
    { x: 0.05, y: 0.50 },
    { x: 0.15, y: 0.13 }, { x: 0.15, y: 0.34 }, { x: 0.15, y: 0.66 }, { x: 0.15, y: 0.87 },
    { x: 0.34, y: 0.20 }, { x: 0.34, y: 0.50 }, { x: 0.34, y: 0.80 },
    { x: 0.53, y: 0.28 }, { x: 0.53, y: 0.50 }, { x: 0.53, y: 0.72 },
  ];
  const ROLES = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'FW', 'FW', 'FW'];

  function makeTeam(side) {
    return FORM.map((f, i) => ({
      x: side === 1 ? f.x * W : (1 - f.x) * W,
      y: f.y * H,
      homeX: side === 1 ? f.x * W : (1 - f.x) * W,
      homeY: f.y * H,
      vx: 0, vy: 0,
      dir: { x: side, y: 0 },
      kickCd: 0,
      role: ROLES[i],
      number: i + 1,
    }));
  }

  function freshState() {
    return {
      ball: { x: W / 2, y: H / 2, vx: 0, vy: 0 },
      teamA: makeTeam(1),
      teamB: makeTeam(-1),
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
  let mode = 'local';
  let role = null;
  let socket = null;
  let roomCode = null;
  let reported = false;

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

  function kickBall(p, goalX) {
    if (p.kickCd > 0) return;
    const dx = state.ball.x - p.x, dy = state.ball.y - p.y;
    if (Math.hypot(dx, dy) > P_R + B_R + 9) return;
    p.kickCd = KICK_CD;
    let ax = p.dir.x, ay = p.dir.y;
    if (Math.hypot(ax, ay) < 0.01) {
      const g = norm(goalX - p.x, H / 2 - p.y);
      ax = g.x; ay = g.y;
    }
    state.ball.vx = ax * KICK_POWER + p.vx * 0.3;
    state.ball.vy = ay * KICK_POWER + p.vy * 0.3;
  }

  function resetKickoff() {
    state.ball = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
    [...state.teamA, ...state.teamB].forEach(p => {
      p.x = p.homeX; p.y = p.homeY; p.vx = 0; p.vy = 0; p.kickCd = 0;
    });
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

    const all = [...state.teamA, ...state.teamB];
    all.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      p.vx *= FRICTION; p.vy *= FRICTION;
      if (Math.hypot(p.vx, p.vy) < 0.05) { p.vx = 0; p.vy = 0; }
      p.x = Math.max(P_R, Math.min(W - P_R, p.x));
      p.y = Math.max(P_R, Math.min(H - P_R, p.y));
      if (p.kickCd > 0) p.kickCd--;
    });

    all.forEach(p => {
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
    state.countdown = 1.5;
  }

  function nearestIndex(team, ball) {
    let ni = 0, nd = Infinity;
    for (let i = 0; i < team.length; i++) {
      const d = Math.hypot(ball.x - team[i].x, ball.y - team[i].y);
      if (d < nd) { nd = d; ni = i; }
    }
    return ni;
  }

  // control de un equipo: el humano manda al más cercano a la pelota; el resto, IA.
  function teamControl(team, side, human, ball) {
    const goalX = side === 1 ? W : 0;
    const nearest = nearestIndex(team, ball);
    const nd = Math.hypot(ball.x - team[nearest].x, ball.y - team[nearest].y);

    for (let i = 0; i < team.length; i++) {
      const p = team[i];

      if (human && i === nearest) {
        applyInput(p, human);
        if (human.kick) kickBall(p, goalX);
        continue;
      }

      // IA
      if (p.role === 'GK') {
        const ballClose = Math.hypot(ball.x - p.homeX, ball.y - p.homeY) < 90;
        if (ballClose) {
          const dd = norm(ball.x - p.x, ball.y - p.y);
          applyInput(p, { x: dd.x, y: dd.y, kick: false });
          if (Math.hypot(ball.x - p.x, ball.y - p.y) < P_R + B_R + 2) kickBall(p, goalX);
        } else {
          const d = norm(p.homeX - p.x, p.homeY - p.y);
          if (Math.hypot(p.homeX - p.x, p.homeY - p.y) > 5) applyInput(p, { x: d.x, y: d.y, kick: false });
        }
        continue;
      }

      if (i === nearest) {
        if (nd < P_R + B_R + 2) {
          const gd = norm(goalX - p.x, H / 2 - p.y);
          p.dir = gd;
          applyInput(p, { x: gd.x, y: gd.y, kick: false });
          if (Math.abs(goalX - p.x) < 300) kickBall(p, goalX);
        } else {
          const dd = norm(ball.x - p.x, ball.y - p.y);
          applyInput(p, { x: dd.x, y: dd.y, kick: false });
        }
      } else {
        const tx2 = p.homeX + (ball.x - W / 2) * 0.10;
        const ty2 = p.homeY + (ball.y - H / 2) * 0.06;
        const d = Math.hypot(tx2 - p.x, ty2 - p.y);
        if (d > 8) {
          const dd = norm(tx2 - p.x, ty2 - p.y);
          applyInput(p, { x: dd.x, y: dd.y, kick: false });
        }
      }
    }
  }

  function step() {
    if (!state.started || state.over) return;

    if (state.countdown > 0) {
      state.countdown -= 1 / 60;
      if (state.countdown <= 0) state.countdown = 0;
      return;
    }

    if (mode === 'local') {
      teamControl(state.teamA, 1, inputA(), state.ball);
      teamControl(state.teamB, -1, inputB(), state.ball);
    } else if (mode === 'cpu') {
      teamControl(state.teamA, 1, inputA(), state.ball);
      teamControl(state.teamB, -1, null, state.ball);
    } else if (mode === 'online' && role === 'host') {
      teamControl(state.teamA, 1, inputA(), state.ball);
      teamControl(state.teamB, -1, remoteInput, state.ball);
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

  function serialize() { return JSON.parse(JSON.stringify(state)); }
  function applyRemote(s) { remoteState = s; }

  // ================= 3D =================
  let renderer = null, scene = null, camera = null;
  const meshesA = [], meshesB = [];
  let ballMesh = null, ringMesh = null, nameSprite = null;

  const SKIN_TONES = [0xe8b678, 0xf0c8a0, 0xc68e5a, 0x9c6b43, 0x6b4a2f];
  const HAIR_COLORS = [0x1a1208, 0x3a2a1a, 0x5a4030, 0x0f0a05, 0x8a6a3a];

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
    g.fillStyle = '#2d7a3d';
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.04)';
    for (let i = 0; i < W; i += 80) g.fillRect(i, 0, 40, H);
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 4;
    g.strokeRect(12, 12, W - 24, H - 24);
    g.beginPath(); g.moveTo(W / 2, 12); g.lineTo(W / 2, H - 12); g.stroke();
    g.beginPath(); g.arc(W / 2, H / 2, 70, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(W / 2, H / 2, 6, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.8)'; g.fill();
    const box = (x) => { g.strokeRect(x, H / 2 - 100, 85, 200); g.strokeRect(x, H / 2 - 50, 32, 100); };
    box(12); box(W - 97);
    return new THREE.CanvasTexture(c);
  }

  function makeNumberTexture(n) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.font = 'bold 44px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(n), 32, 34);
    return new THREE.CanvasTexture(c);
  }

  function makePlayer(color, number) {
    const g = new THREE.Group();
    const skin = new THREE.MeshPhongMaterial({ color: SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)], shininess: 20 });
    const jersey = new THREE.MeshPhongMaterial({ color: new THREE.Color(color), shininess: 30 });
    const shorts = new THREE.MeshPhongMaterial({ color: 0xf5f5f5, shininess: 25 });
    const sock = new THREE.MeshPhongMaterial({ color: new THREE.Color(color), shininess: 15 });
    const hair = new THREE.MeshPhongMaterial({ color: HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)], shininess: 40 });
    const boot = new THREE.MeshPhongMaterial({ color: 0x111111, shininess: 60 });
    const eye = new THREE.MeshPhongMaterial({ color: 0x1a1a1a });

    const shadow = new THREE.Mesh(new THREE.CircleGeometry(P_R + 1, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.5; g.add(shadow);

    const bootG = new THREE.BoxGeometry(4, 3, 9);
    const b1 = new THREE.Mesh(bootG, boot); b1.position.set(-3, 1.5, 3); g.add(b1);
    const b2 = new THREE.Mesh(bootG, boot); b2.position.set(3, 1.5, 3); g.add(b2);

    const sockG = new THREE.CylinderGeometry(3, 3.4, 9, 8);
    const s1 = new THREE.Mesh(sockG, sock); s1.position.set(-3, 7, 2); g.add(s1);
    const s2 = new THREE.Mesh(sockG, sock); s2.position.set(3, 7, 2); g.add(s2);

    const thighG = new THREE.CylinderGeometry(3.4, 3.4, 9, 8);
    const t1 = new THREE.Mesh(thighG, skin); t1.position.set(-3, 14, 2); g.add(t1);
    const t2 = new THREE.Mesh(thighG, skin); t2.position.set(3, 14, 2); g.add(t2);

    const sh = new THREE.Mesh(new THREE.CylinderGeometry(7, 6, 8, 12), shorts);
    sh.position.y = 19; g.add(sh);

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(7, 8.5, 15, 16), jersey);
    torso.position.y = 27; g.add(torso);

    const armG = new THREE.CylinderGeometry(2.4, 2.6, 13, 8);
    const al = new THREE.Mesh(armG, jersey); al.position.set(-8, 28, 4); al.rotation.z = 0.35; g.add(al);
    const ar = new THREE.Mesh(armG, jersey); ar.position.set(8, 28, 4); ar.rotation.z = -0.35; g.add(ar);
    const handG = new THREE.SphereGeometry(2.8, 10, 8);
    const hl = new THREE.Mesh(handG, skin); hl.position.set(-10.5, 28, 5); g.add(hl);
    const hr = new THREE.Mesh(handG, skin); hr.position.set(10.5, 28, 5); g.add(hr);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3, 3, 10), skin);
    neck.position.y = 36; g.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(6.2, 20, 16), skin);
    head.position.y = 41; g.add(head);

    const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(6.3, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
    hairMesh.position.y = 41.5; hairMesh.position.z = -0.6; g.add(hairMesh);

    const eyeG = new THREE.SphereGeometry(0.9, 8, 6);
    const e1 = new THREE.Mesh(eyeG, eye); e1.position.set(-2.1, 41.5, 5.6); g.add(e1);
    const e2 = new THREE.Mesh(eyeG, eye); e2.position.set(2.1, 41.5, 5.6); g.add(e2);

    const numPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 11),
      new THREE.MeshBasicMaterial({ map: makeNumberTexture(number), transparent: true })
    );
    numPlane.position.set(0, 29, -8.8);
    numPlane.rotation.y = Math.PI;
    g.add(numPlane);

    return g;
  }

  function makeNameSprite(text) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.font = 'bold 30px sans-serif';
    const tw = g.measureText(text).width;
    const w = Math.max(80, tw + 40), h = 44;
    const x = (256 - w) / 2, y = (64 - h) / 2;
    g.fillStyle = 'rgba(10,14,20,0.78)';
    roundRectPath(g, x, y, w, h, 20);
    g.fill();
    g.fillStyle = '#7dff9a';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 33);
    const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(w * 0.38, h * 0.38, 1);
    return sprite;
  }

  function makeGoal(cx) {
    const g = new THREE.Group();
    const white = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 10 });
    const net = new THREE.MeshPhongMaterial({ color: 0xdddddd, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
    const half = GOAL_HALF, h = 55;
    const postG = new THREE.CylinderGeometry(3, 3, h, 12);
    const p1 = new THREE.Mesh(postG, white); p1.position.set(cx, h / 2, -half); g.add(p1);
    const p2 = new THREE.Mesh(postG, white); p2.position.set(cx, h / 2, half); g.add(p2);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, half * 2, 12), white);
    bar.rotation.x = Math.PI / 2; bar.position.set(cx, h, 0); g.add(bar);
    const dir = cx < 0 ? -1 : 1;
    const netBox = new THREE.Mesh(new THREE.BoxGeometry(30, h, half * 2), net);
    netBox.position.set(cx + dir * 15, h / 2, 0); g.add(netBox);
    return g;
  }

  function init3D() {
    if (typeof THREE === 'undefined') {
      hint.textContent = 'No se pudo cargar el motor 3D (Three.js).';
      hint.style.display = 'block';
      return false;
    }
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a1a2a);
    scene.fog = new THREE.Fog(0x0a1a2a, 900, 2200);

    camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 1, 4000);
    camera.position.set(0, 480, 560);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('stage').appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(120, 260, 160);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xbcd8ff, 0.4);
    fill.position.set(-100, 80, -60);
    scene.add(fill);

    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshPhongMaterial({ map: makePitchTexture() }));
    pitch.rotation.x = -Math.PI / 2;
    scene.add(pitch);

    scene.add(makeGoal(-W / 2));
    scene.add(makeGoal(W / 2));

    for (let i = 0; i < 11; i++) {
      const a = makePlayer(myColor, i + 1); scene.add(a); meshesA.push(a);
      const b = makePlayer(oppColor, i + 1); scene.add(b); meshesB.push(b);
    }

    ballMesh = new THREE.Mesh(new THREE.SphereGeometry(B_R, 22, 18), new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 40 }));
    scene.add(ballMesh);

    ringMesh = new THREE.Mesh(
      new THREE.RingGeometry(P_R + 2, P_R + 5, 24),
      new THREE.MeshBasicMaterial({ color: 0x3fff5a, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    ringMesh.rotation.x = -Math.PI / 2;
    scene.add(ringMesh);

    if (mode === 'cpu' && p1) {
      nameSprite = makeNameSprite(p1);
      scene.add(nameSprite);
    }

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    return true;
  }

  function updatePlayerMesh(mesh, p) {
    mesh.position.set(tx(p.x), 0, tz(p.y));
    mesh.rotation.y = Math.atan2(p.dir.x, p.dir.y);
  }

  function render3D(s) {
    if (!scene) return;
    for (let i = 0; i < 11; i++) {
      updatePlayerMesh(meshesA[i], s.teamA[i]);
      updatePlayerMesh(meshesB[i], s.teamB[i]);
    }
    ballMesh.position.set(tx(s.ball.x), B_R, tz(s.ball.y));

    const ca = nearestIndex(s.teamA, s.ball);
    const controlled = s.teamA[ca];
    ringMesh.position.set(tx(controlled.x), 0.7, tz(controlled.y));
    if (nameSprite) nameSprite.position.set(tx(controlled.x), 56, tz(controlled.y));

    scoreA.textContent = (mode === 'cpu' ? myName + ' ' : '') + s.score.a;
    scoreB.textContent = s.score.b + (mode === 'cpu' ? ' ' + oppName : '');
    const t = Math.ceil(s.time);
    clock.textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');

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
    hint.textContent = 'Azul: W A S D + Espacio · Rojo: Flechas + Enter (controlás al más cercano a la pelota)';
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
      ? 'Vos: Azul (W A S D + Espacio) · Rival: Rojo'
      : 'Vos: Rojo (Flechas + Enter) · Rival: Azul';
    hint.style.display = 'block';
  }

  function hideLobby() {
    lobby.style.display = 'none';
    hud.style.display = 'flex';
  }

  document.getElementById('btnLocal').addEventListener('click', startLocal);
  document.getElementById('btnHost').addEventListener('click', createRoom);
  document.getElementById('btnJoin').addEventListener('click', joinRoom);
  document.getElementById('joinCode').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoom();
  });
  btnStart.addEventListener('click', startOnline);

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
  if (CAREER) {
    mode = 'cpu';
    role = null;
    state = freshState();
    state.started = true;
    state.countdown = 3;
    hideLobby();
    hint.textContent = 'Vos: ' + myName + ' (W A S D + Espacio) · 11 vs 11 · controlás al más cercano a la pelota';
    hint.style.display = 'block';
  }

  init3D();
  requestAnimationFrame(loop);
})();
