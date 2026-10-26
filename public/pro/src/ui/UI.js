// Menús del juego: portada, menú principal, selección de equipos, formación y
// tácticas, ajustes del partido, pausa, descanso y final. Todo se maneja con
// teclado (flechas / WASD, Enter, Esc) o con el ratón.

import { TEAMS, POS_LABEL, ATTR_KEYS, ATTR_LABELS } from '../data/TeamsData.js';
import { FORMATIONS, FORMATION_NAMES, pickLineup } from '../data/Formations.js';
import { MENTALITIES, SLIDERS, DIFFICULTIES, DIFFICULTY_ORDER, tacticsFromStyle, presetForMentality } from '../match/Tactics.js';
import { CONTROLS_HELP } from '../core/Input.js';
import { CAMERA_STYLES } from '../render/Camera.js';
import { crestURL } from '../render/Crests.js';
import { clamp } from '../core/MathUtils.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DURATIONS = [2, 3, 5, 8, 10];
const QUALITIES = [['baja', 'BAJA'], ['media', 'MEDIA'], ['alta', 'ALTA']];

function bar(label, value) {
  return `<div class="stat"><span class="stat-l">${label}</span><span class="stat-b"><i style="width:${value}%"></i></span><span class="stat-v">${value}</span></div>`;
}

function kitSwatch(k) {
  const pat = {
    stripes: `repeating-linear-gradient(90deg, ${k.shirt} 0 14%, ${k.accent} 14% 28%)`,
    pinstripes: `repeating-linear-gradient(90deg, ${k.shirt} 0 12%, ${k.accent} 12% 15%)`,
    hoops: `repeating-linear-gradient(180deg, ${k.shirt} 0 16%, ${k.accent} 16% 32%)`,
    halves: `linear-gradient(90deg, ${k.shirt} 50%, ${k.accent} 50%)`,
    sash: `linear-gradient(125deg, ${k.shirt} 40%, ${k.accent} 40% 60%, ${k.shirt} 60%)`,
    band: `linear-gradient(180deg, ${k.shirt} 35%, ${k.accent} 35% 55%, ${k.shirt} 55%)`,
  }[k.pattern] || k.shirt;
  const sleeve = k.pattern === 'sleeves' ? k.accent : k.shirt;
  return `<span class="kit"><i class="kit-sl" style="background:${sleeve}"></i><i class="kit-body" style="background:${pat}"></i><i class="kit-sl" style="background:${sleeve}"></i><i class="kit-sh" style="background:${k.shorts}"></i></span>`;
}

export class UI {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.screen = null;
    this.actions = {};
    this.back = null;
    this.focusIdx = 0;
    this.state = {};
    root.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el || !this.root.contains(el)) return;
      const nav = el.closest('[data-nav]');
      if (nav) this.focus(this.navs().indexOf(nav));
      this.run(el.dataset.act, el.dataset.arg, el);
    });
    root.addEventListener('mousemove', (e) => {
      const nav = e.target.closest('[data-nav]');
      if (nav) {
        const i = this.navs().indexOf(nav);
        if (i >= 0 && i !== this.focusIdx) this.focus(i, true);
      }
    });
    root.addEventListener('input', (e) => {
      const el = e.target.closest('[data-input]');
      if (el) this.run(el.dataset.input, el.value, el);
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  get visible() {
    return !!this.screen;
  }

  navs() {
    return Array.from(this.root.querySelectorAll('[data-nav]')).filter((n) => !n.closest('[hidden]'));
  }

  focus(i, silent) {
    const list = this.navs();
    if (!list.length) return;
    this.focusIdx = clamp(i, 0, list.length - 1);
    list.forEach((n, k) => n.classList.toggle('focus', k === this.focusIdx));
    const el = list[this.focusIdx];
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    if (!silent) this.game.audio.ui('move');
  }

  run(name, arg, el) {
    const fn = this.actions[name];
    if (fn) fn(arg, el);
  }

  onKey(e) {
    if (!this.screen || e === this.skipEvent) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' && e.target.type !== 'range') return;
    const list = this.navs();
    const cur = list[this.focusIdx];
    const k = e.code;
    const up = k === 'ArrowUp' || k === 'KeyW', down = k === 'ArrowDown' || k === 'KeyS';
    const left = k === 'ArrowLeft' || k === 'KeyA', right = k === 'ArrowRight' || k === 'KeyD';
    if (this.actions.any && !e.repeat && k !== 'F11' && k !== 'F12' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); this.run('any'); return; }
    if (up || down) {
      e.preventDefault();
      if (!list.length) return;
      // Navegación espacial sencilla: el más cercano en esa dirección
      const r = cur ? cur.getBoundingClientRect() : null;
      let best = -1, bs = 1e9;
      list.forEach((n, i) => {
        if (n === cur) return;
        const q = n.getBoundingClientRect();
        const dy = (q.top + q.height / 2) - (r.top + r.height / 2);
        if ((down && dy <= 4) || (up && dy >= -4)) return;
        const dx = Math.abs((q.left + q.width / 2) - (r.left + r.width / 2));
        const s = Math.abs(dy) + dx * 0.6;
        if (s < bs) { bs = s; best = i; }
      });
      if (best >= 0) this.focus(best);
    } else if (left || right) {
      if (!cur) return;
      const adj = cur.dataset.adj;
      if (adj) { e.preventDefault(); this.run(adj, right ? 1 : -1, cur); this.game.audio.ui('move'); return; }
      // Sin ajuste: moverse en horizontal entre elementos de la misma fila
      const r = cur.getBoundingClientRect();
      let best = -1, bs = 1e9;
      list.forEach((n, i) => {
        if (n === cur) return;
        const q = n.getBoundingClientRect();
        const dx = (q.left + q.width / 2) - (r.left + r.width / 2);
        if ((right && dx <= 4) || (left && dx >= -4)) return;
        const dy = Math.abs((q.top + q.height / 2) - (r.top + r.height / 2));
        const s = Math.abs(dx) + dy * 2.5;
        if (s < bs) { bs = s; best = i; }
      });
      if (best >= 0) { e.preventDefault(); this.focus(best); }
    } else if (k === 'Enter' || k === 'Space') {
      e.preventDefault();
      if (cur && cur.dataset.act) { this.run(cur.dataset.act, cur.dataset.arg, cur); }
      else this.run('enter');
    } else if (k === 'Escape' || k === 'Backspace') {
      if (this.back) { e.preventDefault(); this.game.audio.ui('back'); this.back(); }
    }
  }

  /** Muestra una pantalla. keepFocus conserva el elemento seleccionado al redibujar. */
  render(name, html, actions, back, keepFocus) {
    const same = this.screen === name;
    this.screen = name;
    this.actions = actions || {};
    this.back = back || null;
    this.root.innerHTML = `<div class="screen s-${name}">${html}</div>`;
    this.root.hidden = false;
    const list = this.navs();
    let i = same && keepFocus ? this.focusIdx : list.findIndex((n) => n.hasAttribute('data-default'));
    if (i < 0) i = 0;
    this.focusIdx = Math.min(i, Math.max(0, list.length - 1));
    list.forEach((n, k) => n.classList.toggle('focus', k === this.focusIdx));
  }

  hide() {
    this.screen = null;
    this.actions = {};
    this.back = null;
    this.root.innerHTML = '';
    this.root.hidden = true;
  }

  hint(items) {
    return `<div class="hint">${items.map(([k, t]) => `<span><kbd>${k}</kbd>${t}</span>`).join('')}</div>`;
  }

  // ------------------------------------------------------------------ Portada
  splash() {
    this.render('splash', `
      <div class="logo">
        <div class="logo-top">FÚTBOL 3D</div>
        <h1>GOLPE<br><em>FRANCO</em></h1>
        <div class="logo-line"></div>
      </div>
      <button class="press" data-act="any">PULSA CUALQUIER TECLA PARA EMPEZAR</button>
      <p class="splash-note">Se juega con teclado. Recomendado: pantalla completa y sonido activado.</p>
    `, { any: () => this.game.enterMenu() });
  }

  // ----------------------------------------------------------- Menú principal
  main() {
    const p = this.game.save.data.progress;
    const items = [
      ['play', 'JUGAR PARTIDO', 'Elige equipos, formación y dificultad y salta al césped.'],
      ['soon', 'TORNEO', 'Próximamente: eliminatorias con los 12 clubes.', 'torneo'],
      ['career', 'MODO CARRERA', 'Temporadas, plantilla y progreso con tu club.', 'carrera'],
      ['personalizar', 'PERSONALIZAR', 'Edita tu club, colores y jugador.', 'personalizar'],
      ['settings', 'AJUSTES', 'Sonido, gráficos, cámara y controles.'],
    ];
    this.render('main', `
      <header class="brand"><span class="brand-s">FÚTBOL 3D</span><b>GOLPE <em>FRANCO</em></b></header>
      <nav class="menu">
        ${items.map(([act, label, desc, arg], i) => `
          <button class="mi${act === 'soon' ? ' mi-soon' : ''}" data-nav data-act="${act}" ${arg ? `data-arg="${arg}"` : ''} ${i === 0 ? 'data-default' : ''}>
            <span class="mi-n">${String(i + 1).padStart(2, '0')}</span>
            <span class="mi-t">${label}${act === 'soon' ? '<small>PRÓXIMAMENTE</small>' : ''}</span>
            <span class="mi-d">${desc}</span>
          </button>`).join('')}
      </nav>
      <aside class="record">
        <h3>TU HISTORIAL</h3>
        <div class="record-row"><b>${p.played}</b><span>JUGADOS</span><b>${p.won}</b><span>GANADOS</span><b>${p.drawn}</b><span>EMPATES</span><b>${p.lost}</b><span>PERDIDOS</span></div>
        <div class="record-sub">Goles ${p.gf} a favor · ${p.ga} en contra</div>
      </aside>
      ${this.hint([['↑ ↓', 'Moverse'], ['ENTER', 'Aceptar']])}
    `, {
      play: () => { this._mainIdx = 0; this.game.audio.ui('ok'); this.teams(); },
      settings: () => { this._mainIdx = this.focusIdx; this.game.audio.ui('ok'); this.settings(() => this.main()); },
      soon: (arg) => { this._mainIdx = this.focusIdx; this.game.audio.ui('ok'); this.soon(arg); },
      career: () => { location.href = '/career.html'; },
      personalizar: () => { location.href = '/career.html'; },
    });
    if (this._mainIdx) this.focus(this._mainIdx, true);
    this.game.audio.music('menu');
  }

  soon(which) {
    const info = {
      torneo: ['TORNEO', 'Una copa por eliminatorias con los 12 clubes, sorteo de cruces, prórroga y tanda de penaltis.'],
      carrera: ['MODO CARRERA', 'Temporadas completas con tu club: calendario, clasificación, plantilla, fichajes y evolución de los jugadores. El sistema de guardado ya está preparado para almacenar el progreso.'],
      personalizar: ['PERSONALIZAR', 'Editor de equipaciones, escudos, nombres de jugadores y estadio.'],
    }[which] || ['PRÓXIMAMENTE', ''];
    this.render('soon', `
      <div class="modal">
        <div class="modal-tag">PRÓXIMAMENTE</div>
        <h2>${info[0]}</h2>
        <p>${info[1]}</p>
        <p class="mute">Esta primera versión se centra en el partido: elige JUGAR PARTIDO para saltar al campo.</p>
        <button class="btn" data-nav data-act="back" data-default>VOLVER</button>
      </div>
    `, { back: () => this.main() }, () => this.main());
  }

  // ------------------------------------------------------ Selección de equipos
  teams() {
    const g = this.game, last = g.save.data.last;
    const st = this.state.teams || (this.state.teams = {
      home: Math.max(0, TEAMS.findIndex((t) => t.id === last.home)),
      away: Math.max(0, TEAMS.findIndex((t) => t.id === last.away)),
      side: last.side === 1 ? 1 : last.side === null ? null : 0,
      homeKit: 'home', awayKit: 'auto',
    });
    if (st.home === st.away) st.away = (st.away + 1) % TEAMS.length;
    const panel = (which, idx) => {
      const t = TEAMS[idx];
      const mine = st.side === (which === 'home' ? 0 : 1);
      const kitSel = which === 'home' ? st.homeKit : st.awayKit;
      const kits = which === 'home' ? [['home', '1ª'], ['away', '2ª']] : [['auto', 'AUTO'], ['home', '1ª'], ['away', '2ª']];
      return `
      <section class="team t-${which}${mine ? ' mine' : ''}" style="--tc:${t.home.shirt};--ta:${t.home.accent}">
        <div class="team-tag">${which === 'home' ? 'LOCAL' : 'VISITANTE'}${mine ? '<b>TÚ</b>' : st.side === null ? '' : '<i>IA</i>'}</div>
        <div class="team-pick" data-nav data-adj="${which}" ${which === 'home' ? 'data-default' : ''}>
          <button class="arrow" data-act="${which}" data-arg="-1" aria-label="Equipo anterior">◀</button>
          <div class="team-id">
            <img class="crest" src="${crestURL(t, 200)}" alt="">
            <h2>${esc(t.name)}</h2>
            <p>${esc(t.tagline)}</p>
          </div>
          <button class="arrow" data-act="${which}" data-arg="1" aria-label="Equipo siguiente">▶</button>
        </div>
        <div class="team-ovr"><b>${t.ovr}</b><span>MEDIA</span></div>
        <div class="stats">${bar('ATAQUE', t.att)}${bar('MEDIO', t.mid)}${bar('DEFENSA', t.def)}</div>
        <div class="row" data-nav data-adj="${which}Kit">
          <span class="row-l">EQUIPACIÓN</span>
          <span class="row-v">${kits
            .map(([id, lb]) => `<button class="chip${kitSel === id ? ' on' : ''}" data-act="${which}KitSet" data-arg="${id}">${lb}${id !== 'auto' ? kitSwatch(t[id]) : ''}</button>`).join('')}</span>
        </div>
        <div class="style">
          <span>${t.style.formation}</span>
          <span>${MENTALITIES.find((m) => m.id === t.style.mentality).name}</span>
        </div>
      </section>`;
    };
    const sideName = st.side === 0 ? 'LOCAL' : st.side === 1 ? 'VISITANTE' : 'ESPECTADOR (IA vs IA)';
    const redraw = () => this.teams();
    const cyc = (key, d) => {
      const other = key === 'home' ? 'away' : 'home';
      do { st[key] = (st[key] + Number(d) + TEAMS.length) % TEAMS.length; } while (st[key] === st[other]);
      redraw();
    };
    this.render('teams', `
      <header class="head"><span class="head-step">1 / 3</span><h1>ELIGE EQUIPOS</h1></header>
      <div class="vs-wrap">
        ${panel('home', st.home)}
        <div class="vs">VS</div>
        ${panel('away', st.away)}
      </div>
      <div class="foot">
        <div class="row row-wide" data-nav data-adj="side">
          <span class="row-l">JUEGAS CON</span>
          <span class="row-v"><button class="arrow sm" data-act="side" data-arg="-1">◀</button><b>${sideName}</b><button class="arrow sm" data-act="side" data-arg="1">▶</button></span>
        </div>
        <button class="btn go" data-nav data-act="next">CONTINUAR ▶</button>
      </div>
      ${this.hint([['← →', 'Cambiar'], ['↑ ↓', 'Moverse'], ['ENTER', 'Continuar'], ['ESC', 'Volver']])}
    `, {
      home: (d) => cyc('home', d), away: (d) => cyc('away', d),
      homeKit: () => { st.homeKit = st.homeKit === 'home' ? 'away' : 'home'; redraw(); },
      awayKit: (d) => { const o = ['auto', 'home', 'away']; st.awayKit = o[(o.indexOf(st.awayKit) + Number(d) + 3) % 3]; redraw(); },
      homeKitSet: (id) => { st.homeKit = id; redraw(); },
      awayKitSet: (id) => { st.awayKit = id; redraw(); },
      side: (d) => { const o = [0, 1, null]; st.side = o[(o.indexOf(st.side) + Number(d) + 3) % 3]; redraw(); },
      next: () => { this.game.audio.ui('ok'); this.state.tactics = null; this.tactics(); },
      enter: () => { this.game.audio.ui('ok'); this.state.tactics = null; this.tactics(); },
    }, () => { this.main(); }, true);
    this.game.audio.music('select');
  }

  /** Táctica de trabajo para el equipo indicado (guardada o la propia del club). */
  tacticsFor(team) {
    const saved = this.game.save.data.tactics[team.id];
    return saved && FORMATIONS[saved.formation] ? { ...tacticsFromStyle(team.style), ...saved } : tacticsFromStyle(team.style);
  }

  pitchHTML(team, formation) {
    const lineup = pickLineup(team.squad, formation);
    const k = team.home;
    return `<div class="pitch"><div class="pitch-in">
      <i class="pl-mid"></i><i class="pl-circle"></i><i class="pl-box a"></i><i class="pl-box b"></i>
      ${lineup.map((e) => {
        const gk = e.slot.role === 'GK';
        const y = gk ? 93 : 82 - e.slot.d * 68;
        const x = 50 + e.slot.w * 40;
        return `<div class="tok${gk ? ' gk' : ''}" style="left:${x}%;top:${y}%;--c:${gk ? '#f2e94e' : k.shirt};--n:${gk ? '#1a1a1a' : k.num}">
          <b>${e.player.number}</b><span>${esc(e.player.short)}</span><em>${POS_LABEL[e.slot.role]} · ${e.player.ovr}</em></div>`;
      }).join('')}
    </div></div>`;
  }

  // ------------------------------------------------------ Formación y táctica
  tactics(inMatch, ret) {
    const g = this.game;
    if (ret) this._tacRet = ret;
    const leave = () => (this._tacRet ? this._tacRet() : this.pause());
    const sel = this.state.teams;
    let team, tac;
    if (inMatch) {
      team = g.match.userTeam.data;
      tac = g.match.userTeam.tactics;
    } else {
      const side = sel.side === null ? 0 : sel.side;
      team = TEAMS[side === 0 ? sel.home : sel.away];
      tac = this.state.tactics || (this.state.tactics = this.tacticsFor(team));
    }
    const redraw = () => this.tactics(inMatch);
    const done = () => {
      g.save.saveTactics(team.id, tac);
      if (inMatch) leave(); else { g.audio.ui('ok'); this.matchSetup(); }
    };
    const setFormation = (f) => {
      if (inMatch) g.match.userTeam.setFormation(f); else tac.formation = f;
      redraw();
    };
    const ment = MENTALITIES.find((m) => m.id === tac.mentality);
    this.render('tactics', `
      <header class="head"><span class="head-step">${inMatch ? 'PAUSA' : '2 / 3'}</span><h1>FORMACIÓN Y TÁCTICA</h1>
        <div class="head-team"><img src="${crestURL(team, 96)}" alt=""><b>${esc(team.name)}</b></div></header>
      <div class="tac">
        <div class="tac-forms">
          <h3>FORMACIÓN</h3>
          ${FORMATION_NAMES.map((f) => `<button class="opt${f === tac.formation ? ' on' : ''}" data-nav data-act="form" data-arg="${f}" ${f === tac.formation ? 'data-default' : ''}>${f}</button>`).join('')}
        </div>
        ${this.pitchHTML(team, tac.formation)}
        <div class="tac-side">
          <h3>MENTALIDAD</h3>
          <div class="row" data-nav data-adj="ment">
            <span class="row-v full"><button class="arrow sm" data-act="ment" data-arg="-1">◀</button><b>${ment.name}</b><button class="arrow sm" data-act="ment" data-arg="1">▶</button></span>
          </div>
          <p class="mute sm">${ment.desc}</p>
          <h3>AJUSTES</h3>
          ${SLIDERS.map((s) => `
            <div class="slider" data-nav data-adj="sl:${s.key}">
              <span class="slider-l">${s.name}</span>
              <span class="slider-t"><i style="width:${Math.round(tac[s.key] * 100)}%"></i></span>
              <span class="slider-e"><em>${s.lo}</em><em>${s.hi}</em></span>
            </div>`).join('')}
          <button class="btn go" data-nav data-act="done">${inMatch ? 'APLICAR Y VOLVER' : 'CONTINUAR ▶'}</button>
        </div>
      </div>
      ${this.hint([['↑ ↓', 'Moverse'], ['← →', 'Ajustar'], ['ENTER', 'Elegir'], ['ESC', 'Volver']])}
    `, {
      form: (f) => setFormation(f),
      ment: (d) => {
        tac.mentality = clamp(tac.mentality + Number(d), -2, 2);
        Object.assign(tac, presetForMentality(tac.mentality));
        for (const s of SLIDERS) tac[s.key] = clamp(tac[s.key], 0, 1);
        redraw();
      },
      done,
      ...Object.fromEntries(SLIDERS.map((s) => [`sl:${s.key}`, (d) => { tac[s.key] = clamp(Math.round((tac[s.key] + Number(d) * 0.1) * 10) / 10, 0, 1); redraw(); }])),
    }, () => { if (inMatch) leave(); else this.teams(); }, true);
  }

  // -------------------------------------------------------- Ajustes de partido
  matchSetup() {
    const g = this.game, s = g.save.settings;
    const redraw = () => this.matchSetup();
    const set = (k, v) => { g.save.setSetting(k, v); redraw(); };
    const cyc = (list, cur, d) => list[(list.indexOf(cur) + Number(d) + list.length) % list.length];
    const diff = DIFFICULTIES[s.difficulty] || DIFFICULTIES.normal;
    const camIds = Object.keys(CAMERA_STYLES);
    this.render('setup', `
      <header class="head"><span class="head-step">3 / 3</span><h1>DIFICULTAD Y PARTIDO</h1></header>
      <div class="setup">
        <div class="diffs">
          ${DIFFICULTY_ORDER.map((id, i) => {
            const d = DIFFICULTIES[id];
            return `<button class="diff${id === s.difficulty ? ' on' : ''}" data-nav data-act="diff" data-arg="${id}" ${id === s.difficulty ? 'data-default' : ''}>
              <span class="diff-n">${'●'.repeat(i + 1)}${'○'.repeat(3 - i)}</span><b>${d.name}</b><span>${d.desc}</span></button>`;
          }).join('')}
        </div>
        <div class="opts">
          <div class="row" data-nav data-adj="dur"><span class="row-l">DURACIÓN</span><span class="row-v"><button class="arrow sm" data-act="dur" data-arg="-1">◀</button><b>${s.halfMinutes} MIN POR PARTE</b><button class="arrow sm" data-act="dur" data-arg="1">▶</button></span></div>
          <div class="row" data-nav data-adj="night"><span class="row-l">HORARIO</span><span class="row-v"><button class="arrow sm" data-act="night" data-arg="-1">◀</button><b>${s.night ? 'NOCHE' : 'DÍA'}</b><button class="arrow sm" data-act="night" data-arg="1">▶</button></span></div>
          <div class="row" data-nav data-adj="cam"><span class="row-l">CÁMARA</span><span class="row-v"><button class="arrow sm" data-act="cam" data-arg="-1">◀</button><b>${CAMERA_STYLES[s.camera] ? CAMERA_STYLES[s.camera].name : 'RETRANSMISIÓN'}</b><button class="arrow sm" data-act="cam" data-arg="1">▶</button></span></div>
          <button class="btn go big" data-nav data-act="play">¡AL CAMPO! ▶</button>
        </div>
      </div>
      ${this.hint([['↑ ↓', 'Moverse'], ['← →', 'Cambiar'], ['ENTER', 'Elegir'], ['ESC', 'Volver']])}
    `, {
      diff: (id) => set('difficulty', id),
      dur: (d) => set('halfMinutes', cyc(DURATIONS, s.halfMinutes, d)),
      night: () => set('night', !s.night),
      cam: (d) => set('camera', cyc(camIds, s.camera, d)),
      play: () => { g.audio.ui('ok'); this.launch(); },
    }, () => this.tactics(), true);
    void diff;
  }

  launch() {
    const g = this.game, sel = this.state.teams, s = g.save.settings;
    const home = TEAMS[sel.home], away = TEAMS[sel.away];
    const userTeam = sel.side === 1 ? away : home;
    const userTac = this.state.tactics || this.tacticsFor(userTeam);
    g.save.data.last = { home: home.id, away: away.id, side: sel.side, homeKit: sel.homeKit, awayKit: sel.awayKit };
    g.save.save();
    const tacOf = (t) => (sel.side !== null && t === userTeam ? userTac : tacticsFromStyle(t.style));
    this.render('loading', `<div class="loading"><div class="load-vs">
        <img src="${crestURL(home, 200)}" alt=""><b>VS</b><img src="${crestURL(away, 200)}" alt=""></div>
        <h2>${esc(home.name)} — ${esc(away.name)}</h2><p>Preparando el estadio…</p></div>`, {});
    setTimeout(() => g.startMatch({
      home, away, homeTactics: tacOf(home), awayTactics: tacOf(away),
      homeKit: sel.homeKit, awayKit: sel.awayKit === 'auto' ? undefined : sel.awayKit,
      difficulty: s.difficulty, halfMinutes: s.halfMinutes, userSide: sel.side, night: s.night,
    }), 60);
  }

  // ---------------------------------------------------------------- Ajustes
  settings(onBack) {
    const g = this.game, s = g.save.settings;
    this._settingsBack = onBack || this._settingsBack;
    const back = () => this._settingsBack();
    const redraw = () => this.settings();
    const vol = (key, label) => `
      <div class="slider" data-nav data-adj="v:${key}">
        <span class="slider-l">${label}</span>
        <span class="slider-t"><i style="width:${Math.round(s[key] * 100)}%"></i></span>
        <span class="slider-n">${Math.round(s[key] * 100)}</span>
      </div>`;
    const toggle = (key, label, on = 'SÍ', off = 'NO') => `
      <div class="row" data-nav data-adj="t:${key}" data-act="t:${key}"><span class="row-l">${label}</span><span class="row-v"><b>${s[key] ? on : off}</b></span></div>`;
    const qi = Math.max(0, QUALITIES.findIndex((q) => q[0] === s.quality));
    const camIds = Object.keys(CAMERA_STYLES);
    const acts = {
      back,
      controls: () => this.controls(() => this.settings()),
      fs: () => g.toggleFullscreen(),
      'q': (d) => { g.save.setSetting('quality', QUALITIES[(qi + Number(d) + 3) % 3][0]); g.applySettings(); redraw(); },
      'cam': (d) => { g.save.setSetting('camera', camIds[(camIds.indexOf(s.camera) + Number(d) + camIds.length) % camIds.length]); g.applySettings(); redraw(); },
    };
    for (const k of ['master', 'music', 'sfx', 'crowd']) {
      acts[`v:${k}`] = (d) => { g.save.setSetting(k, clamp(Math.round((s[k] + Number(d) * 0.1) * 10) / 10, 0, 1)); g.applySettings(); g.audio.ui('move'); redraw(); };
    }
    for (const k of ['voice', 'captions', 'radar']) acts[`t:${k}`] = () => { g.save.setSetting(k, !s[k]); g.applySettings(); redraw(); };
    this.render('settings', `
      <header class="head"><h1>AJUSTES</h1></header>
      <div class="cols">
        <div class="col">
          <h3>SONIDO</h3>
          ${vol('master', 'VOLUMEN GENERAL')}${vol('music', 'MÚSICA')}${vol('sfx', 'EFECTOS')}${vol('crowd', 'PÚBLICO')}
          ${toggle('voice', 'VOZ DEL COMENTARISTA')}
          ${toggle('captions', 'SUBTÍTULOS DEL COMENTARISTA')}
          ${g.commentary.hasVoice ? '' : '<p class="mute sm">Este navegador no ofrece una voz en español: el comentarista aparecerá solo como texto.</p>'}
        </div>
        <div class="col">
          <h3>IMAGEN</h3>
          <div class="row" data-nav data-adj="q"><span class="row-l">CALIDAD GRÁFICA</span><span class="row-v"><button class="arrow sm" data-act="q" data-arg="-1">◀</button><b>${QUALITIES[qi][1]}</b><button class="arrow sm" data-act="q" data-arg="1">▶</button></span></div>
          <div class="row" data-nav data-adj="cam"><span class="row-l">CÁMARA</span><span class="row-v"><button class="arrow sm" data-act="cam" data-arg="-1">◀</button><b>${CAMERA_STYLES[s.camera] ? CAMERA_STYLES[s.camera].name : 'RETRANSMISIÓN'}</b><button class="arrow sm" data-act="cam" data-arg="1">▶</button></span></div>
          ${toggle('radar', 'RADAR')}
          <p class="mute sm">La calidad gráfica se aplica por completo al empezar el siguiente partido.</p>
          <button class="btn" data-nav data-act="fs">PANTALLA COMPLETA</button>
          <button class="btn" data-nav data-act="controls">VER CONTROLES</button>
          <button class="btn go" data-nav data-act="back" data-default>VOLVER</button>
        </div>
      </div>
      ${this.hint([['↑ ↓', 'Moverse'], ['← →', 'Ajustar'], ['ESC', 'Volver']])}
    `, acts, back, true);
  }

  controls(onBack) {
    const col = (title, rows) => `<div class="col"><h3>${title}</h3><table class="keys">${rows.map(([k, t]) => `<tr><td><kbd>${k}</kbd></td><td>${t}</td></tr>`).join('')}</table></div>`;
    this.render('controls', `
      <header class="head"><h1>CONTROLES</h1></header>
      <div class="cols">${col('CON BALÓN', CONTROLS_HELP.ataque)}${col('SIN BALÓN', CONTROLS_HELP.defensa)}
        <div class="col"><h3>SAQUES</h3><table class="keys">
          <tr><td><kbd>W A S D</kbd></td><td>Apuntar</td></tr>
          <tr><td><kbd>ESPACIO</kbd></td><td>Saque en corto</td></tr>
          <tr><td><kbd>R</kbd></td><td>Saque largo / centro (mantener = más lejos)</td></tr>
          <tr><td><kbd>E</kbd></td><td>Tiro directo en faltas y penaltis</td></tr>
          <tr><td><kbd>W / S</kbd></td><td>Penalti: elegir lado. Como portero, lado de la estirada</td></tr>
        </table>
        <button class="btn go" data-nav data-act="back" data-default>VOLVER</button></div>
      </div>
    `, { back: onBack }, onBack);
  }

  // ------------------------------------------------------------------ Pausa
  pause() {
    const g = this.game, m = g.match;
    const user = !!m.userTeam;
    this.render('pause', `
      <div class="pause">
        <div class="pause-score">${this.scoreLine(m)}</div>
        <h1>PAUSA</h1>
        <nav class="menu compact">
          <button class="mi" data-nav data-act="resume" data-default><span class="mi-t">REANUDAR</span></button>
          ${user ? '<button class="mi" data-nav data-act="tactics"><span class="mi-t">FORMACIÓN Y TÁCTICA</span></button>' : ''}
          ${user ? '<button class="mi" data-nav data-act="subs"><span class="mi-t">CAMBIOS</span></button>' : ''}
          <button class="mi" data-nav data-act="controls"><span class="mi-t">CONTROLES</span></button>
          <button class="mi" data-nav data-act="settings"><span class="mi-t">AJUSTES</span></button>
          <button class="mi" data-nav data-act="restart"><span class="mi-t">REINICIAR PARTIDO</span></button>
          <button class="mi" data-nav data-act="quit"><span class="mi-t">SALIR AL MENÚ</span></button>
        </nav>
      </div>
    `, {
      resume: () => g.resume(),
      tactics: () => this.tactics(true, () => this.pause()),
      subs: () => this.subs(),
      controls: () => this.controls(() => this.pause()),
      settings: () => this.settings(() => this.pause()),
      restart: () => g.restartMatch(),
      quit: () => g.quitToMenu(),
    }, () => g.resume());
  }

  subs() {
    const g = this.game, m = g.match;
    const team = m.userTeam;
    if (!team) return this.pause();
    this._subOut = null;
    const redraw = () => this.subs();
    const row = (name, pos, number, ovr, act, idx, sel) => `
      <button data-act="${act}" data-arg="${idx}" style="display:flex;align-items:center;gap:10px;width:100%;padding:9px 12px;border:1px solid ${sel ? '#f2c230' : 'rgba(255,255,255,.12)'};border-radius:10px;background:${sel ? 'rgba(242,194,48,.14)' : 'transparent'};color:inherit;font:inherit;cursor:pointer;text-align:left;margin-bottom:6px">
        <span style="width:36px;opacity:.55;font-size:12px">${pos}</span>
        <b style="width:26px">${number}</b>
        <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(name)}</span>
        <b style="color:#3fb950">${ovr}</b>
      </button>`;
    const starters = team.players.map((p, i) => row(p.data.name, p.isGK ? 'POR' : (POS_LABEL[p.role] || p.role), p.data.number, p.data.ovr, 'subOut', i, this._subOut === i)).join('');
    const bench = team.bench.map((b, i) => b.pos === 'GK' ? '' : row(b.name, POS_LABEL[b.pos] || b.pos, b.number, b.ovr, 'subIn', i, false)).join('');
    this.render('subs', `
      <div style="padding:26px;max-width:780px;margin:0 auto">
        <header style="text-align:center;margin-bottom:18px"><h1 style="margin:0">CAMBIOS</h1><span style="opacity:.6;font-size:13px">${esc(team.name)}</span></header>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
          <div><h2 style="font-size:13px;opacity:.7;margin:0 0 10px">TITULARES</h2>${starters}</div>
          <div><h2 style="font-size:13px;opacity:.7;margin:0 0 10px">SUPLENTES</h2>${bench}</div>
        </div>
        <p style="text-align:center;opacity:.75;margin:16px 0 0">${this._subOut != null ? 'Ahora elegí un suplente para meter' : 'Elegí un titular para sacar · ESC para volver'}</p>
      </div>
    `, {
      subOut: (i) => { this._subOut = Number(i); this.game.audio.ui('move'); redraw(); },
      subIn: (i) => {
        if (this._subOut == null) return;
        const ok = m.substitute(team, this._subOut, Number(i));
        this._subOut = null;
        if (ok) this.game.audio.ui('ok');
        redraw();
      },
    }, () => this.pause());
  }

  scoreLine(m) {
    const [h, a] = m.teams;
    return `<span class="sl-team"><img src="${crestURL(h.data, 96)}" alt="">${esc(h.name)}</span>
      <b class="sl-score">${h.score} - ${a.score}</b>
      <span class="sl-team r">${esc(a.name)}<img src="${crestURL(a.data, 96)}" alt=""></span>`;
  }

  statsTable(m) {
    const [h, a] = m.teams;
    const poss = m.possessionPct();
    const pct = (t) => (t.stats.passes ? Math.round((Math.min(t.stats.passesOk, t.stats.passes) / t.stats.passes) * 100) : 0);
    const rows = [
      ['POSESIÓN', poss[0] + '%', poss[1] + '%', poss[0], poss[1]],
      ['TIROS', h.stats.shots, a.stats.shots],
      ['TIROS A PUERTA', h.stats.onTarget, a.stats.onTarget],
      ['PASES', h.stats.passes, a.stats.passes],
      ['PRECISIÓN DE PASE', pct(h) + '%', pct(a) + '%', pct(h), pct(a)],
      ['ENTRADAS GANADAS', h.stats.tackles, a.stats.tackles],
      ['FALTAS', h.stats.fouls, a.stats.fouls],
      ['CÓRNERS', h.stats.corners, a.stats.corners],
      ['FUERAS DE JUEGO', h.stats.offsides, a.stats.offsides],
      ['TARJETAS', `${h.stats.yellow} / ${h.stats.red}`, `${a.stats.yellow} / ${a.stats.red}`, h.stats.yellow + h.stats.red * 2, a.stats.yellow + a.stats.red * 2],
    ];
    return `<div class="stt" style="--hc:${h.kit.shirt};--ac:${a.kit.shirt}">${rows.map(([label, hv, av, hn, an]) => {
      const x = Number(hn ?? hv) || 0, y = Number(an ?? av) || 0;
      const tot = x + y || 1;
      return `<div class="stt-r"><b>${hv}</b><div class="stt-m"><span>${label}</span><div class="stt-b"><i style="width:${(x / tot) * 100}%"></i><u style="width:${(y / tot) * 100}%"></u></div></div><b>${av}</b></div>`;
    }).join('')}</div>`;
  }

  scorers(m) {
    const side = (t) => m.scorers.filter((s) => s.team === t).map((s) => `<span>${esc(s.scorer.data.short)} ${s.minute}'${s.own ? ' (p.p.)' : ''}</span>`).join('');
    return `<div class="scorers"><div>${side(m.teams[0])}</div><i class="dot"></i><div>${side(m.teams[1])}</div></div>`;
  }

  halfTime() {
    const g = this.game, m = g.match;
    this.render('half', `
      <div class="report">
        <div class="report-tag">DESCANSO</div>
        <div class="pause-score big">${this.scoreLine(m)}</div>
        ${this.scorers(m)}
        ${this.statsTable(m)}
        <div class="report-btns">
          ${m.userTeam ? '<button class="btn" data-nav data-act="tactics">FORMACIÓN Y TÁCTICA</button>' : ''}
          <button class="btn go" data-nav data-act="go" data-default>SEGUNDA PARTE ▶</button>
        </div>
      </div>
    `, {
      go: () => g.secondHalf(),
      tactics: () => this.tactics(true, () => this.halfTime()),
    });
  }

  fullTime() {
    const g = this.game, m = g.match;
    const [h, a] = m.teams;
    let verdict = 'FINAL DEL PARTIDO';
    if (m.userTeam) {
      const u = m.userTeam, o = u.opponent;
      verdict = u.score > o.score ? '¡VICTORIA!' : u.score < o.score ? 'DERROTA' : 'EMPATE';
    } else if (h.score !== a.score) verdict = `GANA ${(h.score > a.score ? h : a).name.toUpperCase()}`;
    this.render('full', `
      <div class="report">
        <div class="report-tag">FINAL DEL PARTIDO</div>
        <h1 class="verdict">${esc(verdict)}</h1>
        <div class="pause-score big">${this.scoreLine(m)}</div>
        ${this.scorers(m)}
        ${this.statsTable(m)}
        <div class="report-btns">
          <button class="btn" data-nav data-act="again">REVANCHA</button>
          <button class="btn go" data-nav data-act="menu" data-default>VOLVER AL MENÚ</button>
        </div>
      </div>
    `, { again: () => g.restartMatch(), menu: () => g.quitToMenu() });
  }

  attrsHTML(p) {
    return ATTR_KEYS.map((k) => `<span>${ATTR_LABELS[k]} <b>${p.attrs[k]}</b></span>`).join('');
  }
}
