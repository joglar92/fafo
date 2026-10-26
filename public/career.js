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
  let currentTab = 'home';

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

  // ---- progresión ----
  function xpForLevel(l) { return l * 100; }
  function addXP(n) {
    state.xp += n;
    while (state.xp >= xpForLevel(state.level)) {
      state.xp -= xpForLevel(state.level);
      state.level++;
      state.gems += 5; // recompensa por subir de nivel
    }
  }
  function addCoins(n) { state.coins += n; }
  function addGems(n) { state.gems += n; }
  function addMoney(m) { state.budget = Math.round((state.budget + m) * 10) / 10; }

  // ---- simulación de partido ----
  function simMatch(a, b) {
    const diff = a - b;
    const ag = Math.max(0, Math.round(1.4 + diff * 0.06 + (Math.random() * 2 - 1) * 1.5));
    const bg = Math.max(0, Math.round(1.4 - diff * 0.06 + (Math.random() * 2 - 1) * 1.5));
    return [ag, bg];
  }

  // ---- liga (round-robin) ----
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

  function playRound(myGoals, oppGoals) {
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
    if (myGoals > oppGoals) { addMoney(5); addXP(80); addCoins(300); }
    else if (myGoals === oppGoals) { addMoney(2); addXP(40); addCoins(150); }
    else { addMoney(0.5); addXP(15); addCoins(50); }
    state.season.round++;
    save(); render();
  }

  // ---- copa (eliminación directa) ----
  function newCup() {
    const ids = ['me', ...teams.map(t => t.id)].sort(() => Math.random() - 0.5);
    return { teams: ids, champion: null, results: [] };
  }

  function cupPairs() {
    const p = [];
    for (let i = 0; i < state.cup.teams.length; i += 2) p.push([state.cup.teams[i], state.cup.teams[i + 1]]);
    return p;
  }

  function currentCupOpponent() {
    if (!state.cup || state.cup.champion) return null;
    if (!state.cup.teams.includes('me')) return null;
    const pair = cupPairs().find(([a, b]) => a === 'me' || b === 'me');
    return pair ? (pair[0] === 'me' ? pair[1] : pair[0]) : null;
  }

  function playCupRound(myGoals, oppGoals) {
    const winners = [];
    let iWon = false;
    cupPairs().forEach(([a, b]) => {
      let g1, g2;
      if (a === 'me' || b === 'me') {
        const mine = a === 'me' ? myGoals : oppGoals;
        const theirs = a === 'me' ? oppGoals : myGoals;
        g1 = a === 'me' ? mine : theirs;
        g2 = a === 'me' ? theirs : mine;
      } else {
        [g1, g2] = simMatch(strength(a), strength(b));
      }
      let winner;
      if (g1 > g2) winner = a;
      else if (g1 < g2) winner = b;
      else winner = Math.random() < 0.5 ? a : b; // penales
      state.cup.results.push({ a, b, g1, g2, winner });
      winners.push(winner);
      if (winner === 'me') iWon = true;
    });
    state.cup.teams = winners;
    addXP(100); addCoins(500);
    if (iWon) addGems(5);
    if (winners.length === 1) {
      state.cup.champion = winners[0];
      if (winners[0] === 'me') { addGems(30); addCoins(2000); }
    }
    save(); render();
  }

  // ---- guardar/cargar ----
  function save() { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); }
  function load() { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); }

  function newSeason() {
    const ids = ['me', ...teams.map(t => t.id)];
    return { round: 0, rounds: roundRobin(ids), standings: initStandings() };
  }

  // ---- helpers render ----
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

  function matchCard(comp, opp, label) {
    return `
      <div class="match-card">
        <h4>${label}</h4>
        <div class="vs"><span style="color:${state.clubColor}">${state.clubName}</span> vs <span style="color:${opp.color}">${opp.name}</span></div>
        <div class="match-actions">
          <button class="btn primary" data-play="${comp}">▶ Jugar</button>
          <button class="btn secondary" data-sim="${comp}">Simular</button>
        </div>
      </div>`;
  }

  // ---- render de tabs ----
  function renderHome() {
    const overall = teamRating();
    const st = state.season.standings['me'];
    const leagueOppId = currentOpponent();
    const cupOppId = currentCupOpponent();
    const leagueDone = state.season.round >= state.season.rounds.length;
    const cupDone = !state.cup || !!state.cup.champion;

    let html = `
      <div class="overall-card">
        <div class="big-rating" style="color:${ratingColor(overall)}">${overall}</div>
        <div class="home-name">${state.clubName}</div>
        <div class="record">${st.w} G · ${st.d} E · ${st.l} P</div>
        ${!leagueDone && leagueOppId ? `<button class="play-big" data-play="league">▶ JUGAR</button>` : ''}
      </div>`;

    if (!leagueDone && leagueOppId) {
      html += matchCard('league', teamsById[leagueOppId], 'Liga · Fecha ' + (state.season.round + 1) + '/' + state.season.rounds.length);
    }
    if (!cupDone && cupOppId) {
      html += matchCard('cup', teamsById[cupOppId], 'Copa · ' + (state.cup.teams.length > 2 ? 'Eliminatoria' : 'Final'));
    }
    if (leagueDone && cupDone) {
      html += `<div class="season-done"><h2>🏆 Temporada completa</h2>
        <p style="color:var(--muted);margin-top:6px">Campeón de liga: <b>${Object.values(state.season.standings).sort((a,b)=>b.pts-a.pts)[0].name}</b><br>
        ${state.cup && state.cup.champion ? 'Campeón de copa: <b>' + (state.cup.champion === 'me' ? state.clubName : teamsById[state.cup.champion].name) + '</b>' : ''}</p>
        <button class="btn primary" id="btnReset" style="margin-top:14px">Nueva temporada</button></div>`;
    }

    $('#content').innerHTML = html;
    wireMatchActions();
    if (leagueDone && cupDone) $('#btnReset').addEventListener('click', () => {
      state.season = newSeason();
      state.cup = newCup();
      save(); render();
    });
  }

  function renderTeam() {
    const sorted = state.squad.map(id => playersById[id]).sort((a, b) => b.rating - a.rating);
    const overall = teamRating();
    $('#content').innerHTML = `
      <p class="overall">Plantel: ${state.squad.length} jugadores · Media titular: <b style="color:${ratingColor(overall)}">${overall}</b></p>
      <div class="player-list">
        ${sorted.map(p => `
          <div class="player">
            <div class="rating-badge" style="background:${ratingColor(p.rating)}">${p.rating}</div>
            <div class="info">
              <div class="name">${p.name} ${posTag(p)}</div>
              <div class="meta">${p.nation} · ${p.age} años · $${playerValue(p)}M</div>
            </div>
            <button class="btn sell" data-sell="${p.id}">Vender</button>
          </div>`).join('')}
      </div>`;
    $('#content').querySelectorAll('[data-sell]').forEach(b => b.addEventListener('click', () => sellPlayer(b.dataset.sell)));
  }

  function renderMarket() {
    const inSquad = new Set(state.squad);
    const market = players.filter(p => !inSquad.has(p.id)).sort((a, b) => b.rating - a.rating);
    $('#content').innerHTML = `
      <p class="overall">Presupuesto: <b>$${state.budget}M</b> · ${market.length} jugadores disponibles</p>
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
            <div style="font-weight:700;margin-right:8px">$${v}M</div>
            <button class="btn buy" data-buy="${p.id}" ${can ? '' : 'disabled'}>Fichar</button>
          </div>`;
        }).join('')}
      </div>`;
    $('#content').querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => buyPlayer(b.dataset.buy)));
  }

  function renderLeague() {
    const rows = Object.values(state.season.standings).sort((a, b) => b.pts - a.pts || (b.gf - b.gc) - (a.gf - a.gc));
    $('#content').innerHTML = `
      <p class="overall">Liga · ${Math.min(state.season.round, state.season.rounds.length)}/${state.season.rounds.length} fechas jugadas</p>
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
  }

  function renderCup() {
    if (!state.cup) state.cup = newCup();
    let html = '';
    if (state.cup.champion) {
      const champ = state.cup.champion === 'me' ? state.clubName : teamsById[state.cup.champion].name;
      html += `<div class="season-done"><h2>🥇 Copa terminada</h2><p style="color:var(--muted);margin-top:6px">Campeón: <b>${champ}</b></p></div>`;
    } else if (state.cup.teams.includes('me')) {
      html += `<p class="overall">${state.cup.teams.length} equipos en carrera</p>`;
      html += `<div class="bracket">` + cupPairs().map(([a, b]) => {
        const na = a === 'me' ? state.clubName : teamsById[a].name;
        const nb = b === 'me' ? state.clubName : teamsById[b].name;
        const ca = a === 'me' ? state.clubColor : teamsById[a].color;
        const cb = b === 'me' ? state.clubColor : teamsById[b].color;
        return `<div class="tie"><span style="color:${ca}">${na}</span><span>vs</span><span style="color:${cb}">${nb}</span></div>`;
      }).join('') + `</div>`;
      if (state.cup.teams.length === 2) html += `<p class="overall" style="margin-top:8px">⚡ Final de la copa</p>`;
    } else {
      html += `<div class="season-done"><h2>Eliminado de la Copa</h2><p style="color:var(--muted);margin-top:6px">La copa sigue sin vos. Mejor suerte la próxima.</p></div>`;
    }
    $('#content').innerHTML = html;
  }

  function wireMatchActions() {
    $('#content').querySelectorAll('[data-play]').forEach(b => b.addEventListener('click', () => startMatch(b.dataset.play)));
    $('#content').querySelectorAll('[data-sim]').forEach(b => b.addEventListener('click', () => simClick(b.dataset.sim)));
  }

  function simClick(comp) {
    if (comp === 'cup') {
      const opp = teamsById[currentCupOpponent()];
      const [g1, g2] = simMatch(strength('me'), opp.strength);
      playCupRound(g1, g2);
    } else {
      const opp = teamsById[currentOpponent()];
      const [g1, g2] = simMatch(strength('me'), opp.strength);
      playRound(g1, g2);
    }
  }

  function render() {
    $('#badge').textContent = state.clubName.charAt(0).toUpperCase();
    $('#badge').style.background = state.clubColor;
    $('#clubTitle').textContent = state.clubName;
    $('#level').textContent = state.level;
    $('#xpFill').style.width = Math.min(100, Math.round(state.xp / xpForLevel(state.level) * 100)) + '%';
    $('#coins').textContent = state.coins;
    $('#gems').textContent = state.gems;
    switch (currentTab) {
      case 'team': renderTeam(); break;
      case 'market': renderMarket(); break;
      case 'league': renderLeague(); break;
      case 'cup': renderCup(); break;
      default: renderHome();
    }
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
    const v = playerValue(playersById[id]);
    state.squad = state.squad.filter(x => x !== id);
    addMoney(v);
    save(); render();
  }

  function startMatch(comp) {
    const oppId = comp === 'cup' ? currentCupOpponent() : currentOpponent();
    const opp = teamsById[oppId];
    const star = state.squad.map(id => playersById[id]).sort((a, b) => b.rating - a.rating)[0];
    const params = new URLSearchParams({
      mode: 'career', me: state.clubName, meColor: state.clubColor,
      opp: opp.name, oppColor: opp.color, oppId: opp.id, comp: comp,
      p1: star.name
    });
    window.location.href = '/game/fafo.html?' + params.toString();
  }

  function applyPending() {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw || !state) return;
    localStorage.removeItem(PENDING_KEY);
    const pend = JSON.parse(raw);
    if (pend.comp === 'cup') {
      if (currentCupOpponent() && pend.oppId === currentCupOpponent()) playCupRound(pend.myGoals, pend.oppGoals);
      else render();
    } else {
      if (state.season.round < state.season.rounds.length && pend.oppId === currentOpponent()) playRound(pend.myGoals, pend.oppGoals);
      else render();
    }
  }

  // ---- setup ----
  function showSetup() { $('#setup').style.display = 'flex'; $('#dash').style.display = 'none'; }
  function showDash() { $('#setup').style.display = 'none'; $('#dash').style.display = 'flex'; }

  function createClub() {
    const name = $('#clubName').value.trim();
    const color = selectedColor;
    if (!name) { alert('Poné un nombre'); return; }
    state = {
      clubName: name, clubColor: color,
      budget: START_BUDGET,
      level: 1, xp: 0, coins: 500, gems: 10,
      squad: INITIAL_SQUAD.slice(),
      season: null, cup: null
    };
    state.season = newSeason();
    state.cup = newCup();
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

    $('#colors').innerHTML = PALETTE.map(c =>
      `<div class="swatch${c === selectedColor ? ' sel' : ''}" data-c="${c}" style="background:${c}"></div>`).join('');
    $('#colors').querySelectorAll('.swatch').forEach(s => s.addEventListener('click', () => {
      selectedColor = s.dataset.c;
      $('#colors').querySelectorAll('.swatch').forEach(x => x.classList.toggle('sel', x === s));
    }));

    $('#btnCreate').addEventListener('click', createClub);
    $('#clubName').addEventListener('keydown', e => { if (e.key === 'Enter') createClub(); });

    document.querySelectorAll('.navbar button').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.navbar button').forEach(x => x.classList.toggle('active', x === b));
      currentTab = b.dataset.tab;
      render();
    }));

    state = load();
    if (state) {
      // migración: si falta campo de la versión anterior
      if (state.cup === undefined) state.cup = newCup();
      if (state.level === undefined) { state.level = 1; state.xp = 0; state.coins = 500; state.gems = 10; }
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
