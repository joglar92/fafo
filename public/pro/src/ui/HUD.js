// Interfaz durante el partido: marcador, reloj, jugador seleccionado, barra de
// potencia, avisos de jugada, subtítulos del comentarista, radar y repetición.

import { PITCH } from '../core/Config.js';
import { crestURL } from '../render/Crests.js';
import { POS_LABEL } from '../data/TeamsData.js';

const { HL, HW } = PITCH;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SET_PIECE_HELP = {
  KICKOFF: 'ESPACIO: sacar de centro',
  THROW_IN: 'ESPACIO: saque corto · R: saque largo · WASD: apuntar',
  GOAL_KICK: 'ESPACIO: en corto · R: en largo · WASD: apuntar',
  CORNER: 'R: centro (mantén: 1.er palo → penalti → 2.º palo) · ESPACIO: en corto',
  FREE_KICK: 'E: tiro · R: centro / balón largo · ESPACIO: pase · WASD: apuntar',
  PENALTY: 'W / S: lado · E: disparar (mantén = más alto y fuerte)',
};

const QUICK_HELP = 'WASD mover · SHIFT sprint · ESPACIO pase / entrada · ALT o V al hueco · R elevado / centro · E tiro / deslizante · F vaselina · Q cambiar jugador · ESC pausa';

export class HUD {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="sb">
        <div class="sb-team h"><img class="sb-crest" alt=""><span class="sb-name"></span></div>
        <div class="sb-score"><b class="sb-h">0</b><i>-</i><b class="sb-a">0</b></div>
        <div class="sb-team a"><span class="sb-name"></span><img class="sb-crest" alt=""></div>
        <div class="sb-clock"><span class="sb-time">00:00</span><em class="sb-half">1ª</em></div>
      </div>
      <div class="banner" hidden><div class="banner-in"><b></b><span></span></div></div>
      <div class="goal" hidden><div class="goal-word">¡GOL!</div><div class="goal-who"></div></div>
      <div class="replay" hidden><b>REPETICIÓN</b><span>ESPACIO para saltar</span></div>
      <div class="caption" hidden></div>
      <div class="me" hidden>
        <div class="me-num"></div>
        <div class="me-info"><b class="me-name"></b><span class="me-pos"></span>
          <div class="me-bars"><div class="me-st"><i></i></div></div></div>
      </div>
      <div class="power" hidden><span class="power-l"></span><div class="power-b"><i></i></div></div>
      <div class="help" hidden></div>
      <canvas class="radar" width="260" height="170" hidden></canvas>
      <div class="cards"></div>
    `;
    const q = (s) => root.querySelector(s);
    this.el = {
      crestH: q('.sb-team.h .sb-crest'), crestA: q('.sb-team.a .sb-crest'),
      nameH: q('.sb-team.h .sb-name'), nameA: q('.sb-team.a .sb-name'),
      scoreH: q('.sb-h'), scoreA: q('.sb-a'), time: q('.sb-time'), half: q('.sb-half'),
      banner: q('.banner'), bannerT: q('.banner b'), bannerS: q('.banner span'),
      goal: q('.goal'), goalWho: q('.goal-who'),
      replay: q('.replay'), caption: q('.caption'),
      me: q('.me'), meNum: q('.me-num'), meName: q('.me-name'), mePos: q('.me-pos'), meSt: q('.me-st i'),
      power: q('.power'), powerB: q('.power-b i'), powerL: q('.power-l'),
      help: q('.help'), radar: q('.radar'), cards: q('.cards'), sb: q('.sb'),
    };
    this.rctx = this.el.radar.getContext('2d');
    this.bannerT = 0;
    this.captionT = 0;
    this.last = {};
    this.showRadar = true;
    this.showCaptions = true;
  }

  setMatch(m) {
    const [h, a] = m.teams, e = this.el;
    e.crestH.src = crestURL(h.data, 96);
    e.crestA.src = crestURL(a.data, 96);
    e.nameH.textContent = h.short;
    e.nameA.textContent = a.short;
    this.root.style.setProperty('--hc', h.kit.shirt);
    this.root.style.setProperty('--ac', a.kit.shirt);
    this.colors = [h.kit.shirt, a.kit.shirt];
    this.last = {};
    e.cards.innerHTML = '';
    e.goal.hidden = true; e.banner.hidden = true; e.replay.hidden = true; e.caption.hidden = true;
  }

  banner(title, sub = '', dur = 2.2, kind = '') {
    const e = this.el;
    e.bannerT.textContent = title;
    e.bannerS.textContent = sub;
    e.banner.className = 'banner ' + kind;
    e.banner.hidden = false;
    // Reinicia la animación de entrada
    e.banner.firstElementChild.style.animation = 'none';
    void e.banner.offsetWidth;
    e.banner.firstElementChild.style.animation = '';
    this.bannerT = dur;
  }

  goal(info) {
    const e = this.el;
    e.goalWho.innerHTML = `<b>${esc(info.scorer.data.short)}</b> ${info.minute}'${info.own ? ' (en propia puerta)' : ''} · ${esc(info.team.name)}`;
    e.goal.hidden = false;
    e.goal.style.setProperty('--gc', info.team.kit.shirt);
    this.goalT = 4.2;
  }

  card(player, card) {
    const d = document.createElement('div');
    d.className = 'card-pop ' + (card === 'yellow' ? 'y' : 'r');
    d.innerHTML = `<i></i><span>${esc(player.data.short)}</span>`;
    this.el.cards.appendChild(d);
    setTimeout(() => d.remove(), 4000);
  }

  caption(text, dur) {
    if (!this.showCaptions) return;
    const e = this.el.caption;
    e.textContent = text;
    e.hidden = false;
    this.captionT = dur + 0.8;
  }

  replay(on, label) {
    this.el.replay.hidden = !on;
    if (on) { this.el.goal.hidden = true; this.goalT = 0; this.el.banner.hidden = true; this.bannerT = 0; }
    if (on && label) this.el.replay.firstElementChild.textContent = label;
  }

  setVisible(v) {
    this.root.hidden = !v;
  }

  update(dt, m, user, inReplay) {
    const e = this.el, L = this.last;
    const [h, a] = m.teams;
    if (L.sh !== h.score) { L.sh = h.score; e.scoreH.textContent = h.score; }
    if (L.sa !== a.score) { L.sa = a.score; e.scoreA.textContent = a.score; }
    const clock = m.clockText();
    if (L.clock !== clock) { L.clock = clock; e.time.textContent = clock; }
    if (L.half !== m.half) { L.half = m.half; e.half.textContent = m.half === 1 ? '1ª' : '2ª'; }
    const extra = m.time >= m.halfLen;
    if (L.extra !== extra) { L.extra = extra; e.time.classList.toggle('extra', extra); }

    if (this.bannerT > 0 && (this.bannerT -= dt) <= 0) e.banner.hidden = true;
    if (this.captionT > 0 && (this.captionT -= dt) <= 0) e.caption.hidden = true;
    if (this.goalT > 0 && (this.goalT -= dt) <= 0) e.goal.hidden = true;

    // Jugador controlado
    const p = m.controlled;
    const showMe = !!p && !inReplay && m.state !== 'GOAL' && m.state !== 'HALF_TIME' && m.state !== 'FULL_TIME' && m.state !== 'INTRO';
    if (e.me.hidden === showMe) e.me.hidden = !showMe;
    if (showMe) {
      if (L.p !== p) {
        L.p = p;
        e.meNum.textContent = p.data.number;
        e.meName.textContent = p.data.name;
        e.mePos.textContent = `${POS_LABEL[p.role] || p.role} · ${p.data.ovr}`;
      }
      const st = Math.round(p.stamina * 100);
      if (L.st !== st) { L.st = st; e.meSt.style.width = st + '%'; e.meSt.className = st < 25 ? 'low' : ''; }
    }
    // Barra de potencia
    const ch = user && user.charge;
    if (e.power.hidden === !!ch) e.power.hidden = !ch;
    if (ch) {
      e.powerB.style.width = Math.round(user.power * 100) + '%';
      const label = ch.type === 'shoot' ? `DISPARO ${user.lastKind || ''}` : ch.type === 'lob' ? 'ELEVADO / CENTRO' : 'PASE';
      if (L.pl !== label) { L.pl = label; e.powerL.textContent = label; }
      e.powerB.className = user.power > 0.86 && ch.type === 'shoot' ? 'hot' : '';
    }
    // Ayuda contextual en los saques
    const sp = m.setPiece;
    let help = sp && !sp.intro && m.userTeam === sp.team && !inReplay ? SET_PIECE_HELP[sp.type] : '';
    if (m.state === 'INTRO' && m.userTeam) help = QUICK_HELP;
    else if (!help && p && p.isGK && m.ball.owner === p && m.ball.held && !inReplay) help = 'ESPACIO: sacar en corto · R: sacar en largo';
    if (L.help !== help) { L.help = help; e.help.textContent = help || ''; e.help.hidden = !help; }

    // Radar
    const showRadar = this.showRadar && !inReplay && m.state !== 'GOAL' && m.state !== 'INTRO';
    if (e.radar.hidden === showRadar) e.radar.hidden = !showRadar;
    if (showRadar) this.drawRadar(m);
  }

  drawRadar(m) {
    const c = this.rctx, W = 260, H = 170;
    const X = (x) => 10 + ((x + HL) / (HL * 2)) * (W - 20), Y = (z) => 8 + ((z + HW) / (HW * 2)) * (H - 16);
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(8,14,24,0.55)';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(255,255,255,0.45)';
    c.lineWidth = 1;
    c.strokeRect(X(-HL), Y(-HW), X(HL) - X(-HL), Y(HW) - Y(-HW));
    c.beginPath(); c.moveTo(X(0), Y(-HW)); c.lineTo(X(0), Y(HW)); c.stroke();
    c.beginPath(); c.arc(X(0), Y(0), 14, 0, Math.PI * 2); c.stroke();
    for (const k of [-1, 1]) {
      const bw = (16.5 / (HL * 2)) * (W - 20);
      c.strokeRect(k > 0 ? X(HL) - bw : X(-HL), Y(-20.16), bw, Y(20.16) - Y(-20.16));
    }
    for (let t = 0; t < 2; t++) {
      const team = m.teams[t];
      c.fillStyle = this.colors[t];
      c.strokeStyle = 'rgba(255,255,255,0.9)';
      for (const p of team.players) {
        c.beginPath();
        c.arc(X(p.x), Y(p.z), p === m.controlled ? 5 : 3.6, 0, Math.PI * 2);
        c.fill();
        c.lineWidth = p === m.controlled ? 2 : 0.8;
        if (p === m.controlled) c.strokeStyle = '#ffd23f'; else c.strokeStyle = 'rgba(255,255,255,0.75)';
        c.stroke();
      }
    }
    const b = m.ball;
    c.fillStyle = '#ffffff';
    c.beginPath(); c.arc(X(b.x), Y(b.z), 2.6, 0, Math.PI * 2); c.fill();
  }
}
