(() => {
  'use strict';

  const SAVE_KEY = 'fafo_career';
  const PENDING_KEY = 'fafo_career_pending';
  const INITIAL_SQUAD = ['p1','p2','p5','p6','p8','p10','p12','p21','p23','p24','p27','p28','p37','p39','p42','p44'];
  const START_BUDGET = 60; // millones
  const MAX_SQUAD = 25;
  const MIN_SQUAD = 11;
  const PALETTE = ['#1f6feb','#b3302f','#2ea043','#e11d48','#8b5cf6','#0ea5a5','#c77b1f','#0d9488','#db2777','#f59e0b'];

  let players = [];
  let playersById = {};
  let teams = [];
  let teamsById = {};
  let state = null;

  const $ = (s) => document.querySelector(s);

  // ---- valor de jugador (millones) ----
  function playerValue(p) {
    const posFactor = { GK: 0.7, DF: 0.9, MF: 1.0, FW: 1.2 }[p.pos] || 1;
    const ageFactor = p.age <= 23 ? 1.5 : p.age <= 28 ? 1.0 : p.age <= 32 ? 0.6 : 0.35;
    const base = Math.max(0.2, (p.rating - 60) * 0.8);
    return Math.round(base * ageFactor * posFactor * 10) / 10;
  }

  function teamRating() {
    const rs = state.squad.map(id => playersById[id].rating).sort((a, b) => b - a).slice(0, 11);
    return Math.round(rs.reduce((s, r) => s + r, 0) / rs.length);
  }

  function strength(teamId) {
    return teamId === 'me' ? teamRating() : teamsById[teamId].strength;
  }

  // ---- simulación de partido ----
  function simMatch(a, b) {
    const diff = a - b;
    const ag = Math.max(0, Math.round(1.4 + diff * 0.06 + (Math.random() * 2 - 1) * 1.5));
    const bg = Math.max(0, Math.round(1.4 - diff * 0.06 + (Math.random() * 2 - 1) * 1.5));
    return [ag, bg];
  }

  // ---- fixture round-robin ----
  function roundRobin(ids) {
    const t = ids.slice();
    const n = t.length, half = n / 2, rounds = [];
    for (let r = 0; r < n - 1; r++) {
      const round = [];
      for (let i = 0; i < half; i++) round.push([t[i], t[n - 1 - i]]);
      rounds.push(round);
      t.splice(1, 0, t.pop());
    }
    return rounds;
  }

  function initStandings() {
    const s = {};
    teams.forEach(t => s[t.id] = { name: t.name, color: t.color, pj: 0, w: 0, d: 0, l: 0, gf: 0, gc: 0, pts: 0 });
    s['me'] = { name: state.clubName, color: state.clubColor, pj: 0, w: 0, d: 0, l: 0, gf: 0, gc: 0, pts: 0 };
    return s;
  }

  function applyFixture(aId, bId, g1, g2) {
    const sa = state.season.standings[aId], sb = state.season.standings[bId];
    sa.pj++; sb.pj++;
    sa.gf += g1; sa.gc += g2; sb.gf += g2; sb.gc += g1;
    if (g1 > g2) { sa.w++; sb.l++; sa.pts += 3; }
    else if (g1 < g2) { sb.w++; sa.l++; sb.pts += 3; }
    else { sa.d++; sb.d++; sa.pts++; sb.pts++; }
  }

  function currentOpponent() {
    const round = state.season.rounds[state.season.round];
    if (!round) return null;
    const f = round.find(([a, b]) => a === 'me' || b === 'me');
    return f ? (f[0] === 'me' ? f[1] : f[0]) : null;
  }

  function addMoney(m) { state.budget = Math.round((state.budget + m) * 10) / 10; }

  // ---- resolver una fecha ----
  function playRound(myGoals, oppGoals) {
    const oppId = currentOpponent();
    const round = state.season.rounds[state.season.round];
    round.forEach(([a, b]) => {
      if (a === 'me' || b === 'me') {
        const mine = a === 'me' ? myGoals : oppGoals;
        const theirs = a === 'me' ? oppGoals : myGoals;
        applyFixture('me', a === 'me' ? b : a, mine, theirs);
      } else {
        const [g1, g2] = simMatch(strength(a), strength(b));
        applyFixture(a, b, g1, g2);
      }
    });
    if (myGoals > oppGoals) addMoney(5);
    else if (myGoals === oppGoals) addMoney(2);
    else addMoney(0.5);
    state.season.round++;
    save();
    render();
  }

  // ---- guardar/cargar ----
  function save() { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); }
  function load() { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); }

  function newSeason() {
    const ids = ['me', ...teams.map(t => t.id)];
    return { round: 0, rounds: roundRobin(ids), standings: initStandings(), history: [] };
  }

  // ---- render ----
  function ratingColor(r) {
    if (r >= 85) return '#2ea043';
    if (r >= 78) return '#1f6feb';
    if (r >= 70) return '#c77b1f';
    return '#8b949e';
  }

  function posTag(p) {
    const map = { GK: 'POR', DF: 'DEF', MF: 'MED', FW: 'DEL' };
    const colors = { GK: '#c77b1f', DF: '#1f6feb', MF: '#2ea043', FW: '#e11d48' };
    return `<span class="pos-tag" style="background:${colors[p.pos]}22;color:${colors[p.pos]}">${map[p.pos]}</span>`;
  }

  function renderTeam() {
    const el = $('#tab-team');
    const sorted = state.squad.map(id => playersById[id]).sort((a, b) => b.rating - a.rating);
    const overall = teamRating();
    el.innerHTML = `
      <p class="overall">Plantel: ${state.squad.length} jugadores · Media titular: <b style="color:${ratingColor(overall)}">${overall}</b></p>
      <div class="player-list">
        ${sorted.map(p => `
          <div class="player">
            <div class="rating-badge" style="background:${ratingColor(p.rating)}">${p.rating}</div>
            <div class="info">
              <div class="name">${p.name} ${posTag(p)}</div>
              <div class="meta">${p.nation} · ${p.age} años · $${playerValue(p)}M</div>
            </div>
            <button class="btn small sell" data-sell="${p.id}">Vender</button>
          </div>`).join('')}
      </div>`;
    el.querySelectorAll('[data-sell]').forEach(b => b.addEventListener('click', () => sellPlayer(b.dataset.sell)));
  }

  function renderMarket() {
    const el = $('#tab-market');
    const inSquad = new Set(state.squad);
    const market = players.filter(p => !inSquad.has(p.id)).sort((a, b) => b.rating - a.rating);
    el.innerHTML = `
      <p class="overall">Presupuesto: <b>$<span id="mktBudget">${state.budget}</span>M</b> · ${market.length} jugadores disponibles</p>
      <div class="player-list">
        ${market.map(p => {
          const v = playerValue(p);
          const can = state.budget >= v && state.squad.length < MAX_SQUAD;
          return `<div class="player">
            <div class="rating-badge" style="background:${ratingColor(p.rating)}">${p.rating}</div>
            <div class="info">
              <div class="name">${p.name} ${posTag(p)}</div>
              <div class="meta">${p.nation} · ${p.age} años</div>
            </div>
            <div style="font-weight:700;margin-right:10px">$${v}M</div>
            <button class="btn small buy" data-buy="${p.id}" ${can ? '' : 'disabled'}>Fichar</button>
          </div>`;
        }).join('')}
      </div>`;
    el.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => buyPlayer(b.dataset.buy)));
  }

  function renderLeague() {
    const el = $('#tab-league');
    const oppId = currentOpponent();
    const opp = oppId ? teamsById[oppId] : null;
    const rows = Object.values(state.season.standings).sort((a, b) => b.pts - a.pts || (b.gf - b.gc) - (a.gf - a.gc));

    let matchCard = '';
    if (state.season.round >= state.season.rounds.length) {
      const champ = rows[0];
      matchCard = `<div class="season-done"><h2>🏆 Temporada terminada</h2><p style="color:var(--muted);margin-top:8px">Campeón: <b>${champ.name}</b></p>
        <button class="btn primary" id="btnReset" style="width:auto;margin-top:16px">Nueva temporada</button></div>`;
    } else if (opp) {
      matchCard = `
        <div class="match-card">
          <h3>Fecha ${state.season.round + 1} de ${state.season.rounds.length}</h3>
          <div class="vs"><span style="color:${state.clubColor}">${state.clubName}</span> vs <span style="color:${opp.color}">${opp.name}</span></div>
          <div class="match-actions">
            <button class="btn primary" id="btnPlay" style="width:auto">▶ Jugar</button>
            <button class="btn" id="btnSim" style="width:auto;background:var(--accent2)">Simular</button>
          </div>
        </div>`;
    }

    el.innerHTML = matchCard + `
      <table>
        <thead><tr><th>#</th><th>Equipo</th><th class="num">PJ</th><th class="num">G</th><th class="num">E</th><th class="num">P</th><th class="num">GF</th><th class="num">GC</th><th class="num">Pts</th></tr></thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr class="${r.name === state.clubName ? 'me-row' : ''}">
              <td>${i + 1}</td>
              <td><span class="dot" style="background:${r.color}"></span>${r.name}</td>
              <td class="num">${r.pj}</td><td class="num">${r.w}</td><td class="num">${r.d}</td><td class="num">${r.l}</td>
              <td class="num">${r.gf}</td><td class="num">${r.gc}</td><td class="num"><b>${r.pts}</b></td>
            </tr>`).join('')}
        </tbody>
      </table>`;

    if (state.season.round < state.season.rounds.length) {
      $('#btnPlay').addEventListener('click', () => startMatch());
      $('#btnSim').addEventListener('click', () => {
        const [g1, g2] = simMatch(strength('me'), opp.strength);
        playRound(g1, g2);
      });
    } else {
      $('#btnReset').addEventListener('click', () => { state.season = newSeason(); save(); render(); });
    }
  }

  function render() {
    $('#badge').textContent = state.clubName.charAt(0).toUpperCase();
    $('#badge').style.background = state.clubColor;
    $('#clubTitle').textContent = state.clubName;
    $('#clubInfo').textContent = `Media: ${teamRating()} · Plantel ${state.squad.length} · Temporada ${state.season.round + 1}/${state.season.rounds.length}`;
    $('#budget').textContent = state.budget;
    renderTeam();
    renderMarket();
    renderLeague();
  }

  // ---- acciones ----
  function buyPlayer(id) {
    const p = playersById[id];
    const v = playerValue(p);
    if (state.squad.length >= MAX_SQUAD) return alert('Plantel lleno (máx ' + MAX_SQUAD + ')');
    if (state.budget < v) return alert('No te alcanza la plata');
    state.squad.push(id);
    addMoney(-v);
    save(); render();
  }

  function sellPlayer(id) {
    if (state.squad.length <= MIN_SQUAD) return alert('Necesitás al menos ' + MIN_SQUAD + ' jugadores');
    const p = playersById[id];
    const v = playerValue(p);
    state.squad = state.squad.filter(x => x !== id);
    addMoney(v);
    save(); render();
  }

  function startMatch() {
    const oppId = currentOpponent();
    const opp = teamsById[oppId];
    const params = new URLSearchParams({
      mode: 'career',
      me: state.clubName,
      meColor: state.clubColor,
      opp: opp.name,
      oppColor: opp.color,
      oppId: opp.id
    });
    window.location.href = '/game/fafo.html?' + params.toString();
  }

  function applyPending() {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw || !state) return;
    localStorage.removeItem(PENDING_KEY);
    const pend = JSON.parse(raw);
    if (state.season.round >= state.season.rounds.length) { save(); return; }
    const oppId = currentOpponent();
    if (pend.oppId && oppId && pend.oppId === oppId) {
      playRound(pend.myGoals, pend.oppGoals);
    }
  }

  // ---- setup ----
  function showSetup() { $('#setup').style.display = 'block'; $('#dash').style.display = 'none'; }
  function showDash() { $('#setup').style.display = 'none'; $('#dash').style.display = 'block'; }

  function createClub() {
    const name = $('#clubName').value.trim();
    const color = selectedColor;
    if (!name) { alert('Poné un nombre'); return; }
    state = {
      clubName: name,
      clubColor: color,
      budget: START_BUDGET,
      squad: INITIAL_SQUAD.slice(),
      season: null
    };
    state.season = newSeason();
    save();
    showDash();
    render();
  }

  let selectedColor = PALETTE[0];

  // ---- boot ----
  async function boot() {
    [players, teams] = await Promise.all([
      fetch('/data/players.json').then(r => r.json()),
      fetch('/data/teams.json').then(r => r.json())
    ]);
    playersById = Object.fromEntries(players.map(p => [p.id, p]));
    teamsById = Object.fromEntries(teams.map(t => [t.id, t]));

    // paleta
    $('#colors').innerHTML = PALETTE.map(c =>
      `<div class="swatch${c === selectedColor ? ' sel' : ''}" data-c="${c}" style="background:${c}"></div>`).join('');
    $('#colors').querySelectorAll('.swatch').forEach(s => s.addEventListener('click', () => {
      selectedColor = s.dataset.c;
      $('#colors').querySelectorAll('.swatch').forEach(x => x.classList.toggle('sel', x === s));
    }));

    $('#btnCreate').addEventListener('click', createClub);
    $('#clubName').addEventListener('keydown', e => { if (e.key === 'Enter') createClub(); });

    // tabs
    document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x === b));
      const tab = b.dataset.tab;
      $('#tab-team').style.display = tab === 'team' ? 'block' : 'none';
      $('#tab-market').style.display = tab === 'market' ? 'block' : 'none';
      $('#tab-league').style.display = tab === 'league' ? 'block' : 'none';
    }));

    state = load();
    if (state) {
      showDash();
      render();
      applyPending();
      render();
    } else {
      showSetup();
    }
  }

  boot();
})();
