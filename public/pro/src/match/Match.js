// El partido: máquina de estados, bucle de simulación y conexión entre
// balón, jugadores, IA, porteros, árbitro y reglamento.

import { RNG, clamp, colorDistance } from '../core/MathUtils.js';
import { PITCH, STATE, SET_PIECES } from '../core/Config.js';
import { EventBus } from '../core/EventBus.js';
import { GK_KITS } from '../data/TeamsData.js';
import { DIFFICULTIES, TEAMMATE_PROFILE } from './Tactics.js';
import { Ball } from './Ball.js';
import { Team } from './Team.js';
import { TeamAI } from './TeamAI.js';
import { GoalkeeperAI } from './Goalkeeper.js';
import { Referee, GESTURE } from './Referee.js';
import { MatchRules } from './MatchRules.js';
import { Replay, HEADER, STRIDE } from './Replay.js';
import { PSTATE, Player } from './Player.js';
import * as Act from './Actions.js';

const { HL, HW } = PITCH;
const PASS_TYPES = new Set(['pass', 'through', 'lob', 'cross', 'throw', 'header']);

/** Decide qué equipación viste cada equipo evitando que se confundan. */
export function resolveKits(home, away, homeChoice, awayChoice) {
  const hk = homeChoice === 'away' ? home.away : home.home;
  let ak;
  if (awayChoice === 'home') ak = away.home;
  else if (awayChoice === 'away') ak = away.away;
  else ak = colorDistance(hk.shirt, away.home.shirt) < 0.5 ? away.away : away.home;
  if (!awayChoice && colorDistance(hk.shirt, ak.shirt) < 0.4) ak = away.home;
  const taken = [hk.shirt, ak.shirt, '#2e7d32'];
  const pickGk = () => {
    let best = GK_KITS[0], bs = -1;
    for (const k of GK_KITS) {
      let s = 9;
      for (const c of taken) s = Math.min(s, colorDistance(k.shirt, c));
      if (s > bs) { bs = s; best = k; }
    }
    taken.push(best.shirt);
    return best;
  };
  return { home: hk, away: ak, homeGk: pickGk(), awayGk: pickGk() };
}

export class Match {
  /**
   * o: { home, away, homeTactics, awayTactics, homeKit, awayKit, difficulty,
   *      halfMinutes, userSide (0, 1 o null), seed, external }
   */
  constructor(o) {
    this.opts = o;
    this.rng = new RNG(o.seed ?? ((Date.now() ^ (Math.random() * 1e9)) >>> 0));
    this.bus = new EventBus();
    this.halfLen = (o.halfMinutes ?? 5) * 60;
    this.external = !!o.external; // hay un Game que gestiona repeticiones y pausas
    const diff = DIFFICULTIES[o.difficulty] || DIFFICULTIES.normal;
    const kits = resolveKits(o.home, o.away, o.homeKit, o.awayKit);
    this.kits = kits;
    const prof = (side) => (o.profiles ? DIFFICULTIES[o.profiles[side]] : o.userSide === side ? TEAMMATE_PROFILE : diff);
    this.teams = [
      new Team(o.home, 0, o.homeTactics, kits.home, kits.homeGk, prof(0)),
      new Team(o.away, 1, o.awayTactics, kits.away, kits.awayGk, prof(1)),
    ];
    this.teams[0].opponent = this.teams[1];
    this.teams[1].opponent = this.teams[0];
    this.userTeam = o.userSide === 0 || o.userSide === 1 ? this.teams[o.userSide] : null;
    if (this.userTeam) this.userTeam.isUser = true;
    this.roster = [...this.teams[0].players, ...this.teams[1].players];
    this.active = this.roster.slice();
    this.ball = new Ball();
    this.ballPrev = { x: 0, y: 0, z: 0 };
    this.rules = new MatchRules(this);
    this.referee = new Referee(this);
    this.ais = [new TeamAI(this.teams[0], this), new TeamAI(this.teams[1], this)];
    this.gks = [new GoalkeeperAI(this.teams[0], this), new GoalkeeperAI(this.teams[1], this)];
    this.replay = new Replay(this);
    this.user = null;          // UserControl, si hay jugador humano
    this.controlled = null;
    this.possession = null;
    this.setPiece = null;
    this.next = null;
    this.deadDur = 0;
    this.live = false;
    this.tick = 0;
    this.clock = 0;            // tiempo total de simulación
    this.time = 0;             // tiempo de juego en la parte actual
    this.half = 1;
    this.scorers = [];
    this.goalInfo = null;
    this.foulInfo = null;
    this.refSpot = null;
    this.lastShooter = null;
    this.chanceFlag = null;
    this.replayRequest = null;
    this.switchT = 99;
    this.switchIdx = 0;
    this.firstKickoff = this.rng.chance(0.5) ? this.teams[0] : this.teams[1];
    this.kickoffNext = this.firstKickoff;
    this.shootout = !!o.shootout;   // si hay empate, tanda de penales
    this.so = null;                 // estado de la tanda de penales
    this.state = STATE.INTRO;
    this.stateT = 0;
    this.setPiece = this.rules.setup({ type: 'KICKOFF', team: this.firstKickoff });
    this.setPiece.intro = true;
    if (this.userTeam) this.setControlled(this.userTeam === this.firstKickoff ? this.setPiece.taker : null);
    this.bus.on('save', (d) => {
      if (!d.catch && (d.xg > 0.2 || d.speed > 20)) this.chanceFlag = { time: this.clock };
    });
  }

  emit(type, data) {
    this.bus.emit(type, data);
  }

  on(type, fn) {
    return this.bus.on(type, fn);
  }

  // -------------------------------------------------------------------------
  // Reloj
  // -------------------------------------------------------------------------
  minute() {
    const k = Math.min(1, this.time / this.halfLen);
    return Math.floor(this.half === 1 ? k * 45 : 45 + k * 45);
  }

  clockText() {
    const total = Math.min(this.time, this.halfLen) / this.halfLen * 45 * 60 + (this.half === 2 ? 45 * 60 : 0);
    const mm = Math.floor(total / 60), ss = Math.floor(total % 60);
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  get isSetPiece() {
    return SET_PIECES.has(this.state);
  }

  // -------------------------------------------------------------------------
  // Control del usuario
  // -------------------------------------------------------------------------
  setControlled(p) {
    if (!this.userTeam) { this.controlled = null; return; }
    if (!p || p.team !== this.userTeam || p.sentOff) p = this.bestToControl(null);
    if (this.controlled !== p) {
      if (this.controlled) this.controlled.shielding = false;
      this.controlled = p;
      this.emit('controlChange', { player: p });
    }
  }

  bestToControl(exclude) {
    const b = this.ball;
    let best = null, bd = 1e9;
    for (const p of this.userTeam.players) {
      if (p === exclude || (p.isGK && b.owner !== p)) continue;
      const d = Math.hypot(p.x - b.x, p.z - b.z) + (p.state !== 'free' ? 4 : 0);
      if (d < bd) { bd = d; best = p; }
    }
    return best || this.userTeam.players[0];
  }

  /** Cambio manual de jugador (pulsaciones seguidas recorren los candidatos). */
  switchPlayer() {
    if (!this.userTeam) return;
    const b = this.ball;
    if (b.owner && b.owner.team === this.userTeam) { this.setControlled(b.owner); return; }
    const list = this.userTeam.players.filter((p) => !p.isGK)
      .sort((a, c) => a.ai.eta - c.ai.eta);
    if (this.switchT > 0.9) this.switchIdx = 0;
    this.switchT = 0;
    let pick = list[this.switchIdx % list.length];
    if (pick === this.controlled) pick = list[++this.switchIdx % list.length];
    this.switchIdx++;
    this.setControlled(pick);
  }

  /** Cambio: saca un titular y mete un suplente de campo. Devuelve el nuevo jugador. */
  substitute(team, outIdx, benchIdx) {
    const out = team.players[outIdx];
    if (!out || out.isGK || out.sentOff) return null;
    const entry = team.bench[benchIdx];
    if (!entry || entry.pos === 'GK') return null;
    const np = new Player(team, { player: entry, slot: out.slot }, outIdx);
    np.x = out.x; np.z = out.z; np.facing = out.facing;
    np.stamina = 1; np.fatigue = 0;
    team.players[outIdx] = np;
    team.bench.splice(benchIdx, 1);
    team.bench.push(out.data);
    const ri = this.roster.indexOf(out);
    if (ri >= 0) this.roster[ri] = np;
    const ai = this.active.indexOf(out);
    if (ai >= 0) this.active[ai] = np;
    if (this.controlled === out) this.controlled = np;
    this.emit('sub', { team, out, in: np, index: outIdx });
    return np;
  }

  /** ¿Debe la IA mover por un momento al jugador controlado? (recepción asistida) */
  assist(p) {
    const b = this.ball;
    return !!this.user && this.user.idle && !b.owner && b.passTarget === p && p.state === 'free';
  }

  // -------------------------------------------------------------------------
  // Posesión y control del balón
  // -------------------------------------------------------------------------
  giveBall(p, steal) {
    const b = this.ball;
    const prev = b.lastKicker, type = b.kickType;
    if (prev && prev !== p && PASS_TYPES.has(type)) {
      if (prev.team === p.team) {
        p.team.stats.passesOk++;
        p.ai.from = prev;
        this.emit('passComplete', { from: prev, to: p, type });
      } else {
        this.emit('interception', { player: p, from: prev });
      }
    }
    const changed = this.possession && this.possession !== p.team;
    b.owner = p;
    b.held = false;
    b.frozen = false;
    b.lastTouch = p;
    b.passTarget = null;
    b.kickType = null;
    b.shot = null;
    b.offside = null;
    b.vy = 0;
    b.inNet = 0;
    const ai = p.ai;
    ai.holdT = 0;
    ai.decT = p.team.profile.reaction * (0.6 + this.rng.next() * 0.8);
    ai.runTo = null;
    ai.dribX = p.team.dir; ai.dribZ = 0; ai.dribSprint = false;
    if (this.userTeam === p.team) this.setControlled(p);
    else if (this.userTeam && this.controlled && changed) {
      // Pérdida: si el jugador controlado está lejos o en el suelo, pasa al mejor situado
      const c = this.controlled;
      const best = this.bestToControl(null);
      const dc = Math.hypot(c.x - b.x, c.z - b.z), db = Math.hypot(best.x - b.x, best.z - b.z);
      if (c.state === 'down' || c.state === 'stun' || dc > db + 14) this.setControlled(best);
    }
    this.emit('control', { player: p, steal: !!steal });
  }

  updatePossession(dt) {
    const b = this.ball;
    let t = null;
    if (b.owner) t = b.owner.team;
    else if (b.passTarget) t = b.passTarget.team;
    else if (b.lastKicker && this.clock - b.kickTime < 2.5 && (b.kickType === 'shot' || b.kickType === 'cross' || b.kickType === 'lob' || b.kickType === 'through')) t = b.lastKicker.team;
    this.possession = t;
    if (this.state === STATE.PLAYING && b.owner) b.owner.team.stats.possT += dt;
  }

  /** Recepciones, controles defectuosos, rechaces y cortes con el cuerpo. */
  updateControl() {
    const b = this.ball, rng = this.rng;
    if (b.owner) {
      const o = b.owner;
      if (o.state === 'down' || o.state === 'slide' || o.sentOff) { b.owner = null; b.held = false; }
      return;
    }
    if (b.frozen || b.y > 1.45) return;
    let best = null, bd = 0.9;
    const all = this.active;
    // Cortar un balón rápido del rival es más difícil que recibir uno propio:
    // hay que estar de verdad en la trayectoria, y hace falta un instante para reaccionar.
    const kteam = b.lastKicker ? b.lastKicker.team : null;
    const bsp = Math.hypot(b.vx, b.vz);
    const fresh = this.clock - b.kickTime < 0.22;
    for (let i = 0; i < all.length; i++) {
      const p = all[i];
      if (p.cooldownControl > 0) continue;
      if (p.state !== 'free' && p.state !== 'jump') continue;
      if (p.isGK && this.gks[p.team.side].inBox(p.x, p.z)) continue;
      let d = Math.hypot(b.x - (p.x + p.dirX * 0.3), b.z - (p.z + p.dirZ * 0.3));
      if (kteam && p.team !== kteam && bsp > 7) {
        const perp = Math.abs((p.x - b.x) * b.vz - (p.z - b.z) * b.vx) / bsp;
        if (perp > (fresh ? 0.42 : 0.62)) continue;
        d += 0.12;
      }
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) return;
    const p = best;
    if (this.rules.onTouch(p)) return;
    if (p.queued && this.user && p === this.controlled && this.user.fireQueued(p)) return;
    const rel = Math.hypot(b.vx - p.vx, b.vy, b.vz - p.vz);
    let diff = rel / (10 + p.a.control * 0.22) + Act.pressure(this, p) * 0.12 + (b.y > 0.6 ? 0.2 : 0) +
      (p.speed > 6.5 ? 0.1 : 0) + rng.next() * 0.35 * (1.3 - p.a.control / 100) + p.fatigue * 0.08;
    if (b.passTarget === p) diff -= 0.15;
    const enemyShot = b.kickType === 'shot' && b.lastKicker && b.lastKicker.team !== p.team;
    if (enemyShot) diff += 0.5;
    if (diff < 1) {
      this.giveBall(p, false);
      return;
    }
    // Control largo o rechace
    const k = clamp((diff - 1) * 0.5 + 0.18, 0.18, 0.5);
    const a = Math.atan2(b.vz, b.vx) + Math.PI + rng.gauss() * 0.9;
    const sp = rel * k;
    b.vx = p.vx * 0.5 + Math.cos(a) * sp;
    b.vz = p.vz * 0.5 + Math.sin(a) * sp;
    b.vy = Math.abs(b.vy) * 0.3 + (b.y > 0.5 ? 1 : 0);
    b.spinY = 0;
    b.lastTouch = p;
    b.predTick = -1;
    p.cooldownControl = 0.3;
    if (b.passTarget && b.passTarget.team !== p.team) b.passTarget = null;
    this.emit('touch', { player: p, block: enemyShot, speed: rel });
  }

  /** Juego aéreo: saltos y cabezazos. */
  updateAerial() {
    const b = this.ball;
    if (b.owner || b.frozen) return;
    const all = this.active;
    const check = this.tick % 3 === 0 && b.y > 0.8;
    const pred = check ? b.predict(this.tick) : null;
    let win = null, ws = -1e9;
    for (let i = 0; i < all.length; i++) {
      const p = all[i];
      if (p.cooldownControl > 0) continue;
      if (p.isGK && this.gks[p.team.side].inBox(p.x, p.z)) continue;
      if (p.state !== 'free' && p.state !== 'jump') continue;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      const head = 1.78 * (p.data.height || 1) + p.y;
      if (d < 0.78 && b.y >= 1.35 && b.y <= head + 0.25 && b.vy < 4) {
        const s = (p.a.fisico + p.a.fuerza) * 0.5 + this.rng.next() * 35 + (p.state === 'jump' ? 15 : 0) - d * 30;
        if (s > ws) { ws = s; win = p; }
      } else if (pred && p.state === 'free') {
        const y = pred.y[3];
        if (y > 1.8 && y < 2.75 && Math.hypot(pred.x[3] - p.x, pred.z[3] - p.z) < 1.1) {
          p.jumpH = clamp(0.36 + p.a.fisico * 0.004, 0.4, 0.75);
          p.setState('jump', 0.62, 0);
        }
      }
    }
    if (!win) return;
    if (this.rules.onTouch(win)) return;
    let mode;
    if (win.queued && win === this.controlled) {
      mode = win.queued.type === 'shot' || win.queued.type === 'chip' ? 'shot' : win.queued.type === 'lob' ? 'clear' : 'pass';
      win.queued = null;
    } else {
      const u = win.u;
      mode = u > HL - 20 && Math.abs(win.v) < 16 ? 'shot' : u < -HL + 30 ? 'clear' : 'pass';
    }
    Act.header(this, win, mode);
    for (let i = 0; i < all.length; i++) {
      const p = all[i];
      if (p !== win && Math.hypot(b.x - p.x, b.z - p.z) < 1.2) p.cooldownControl = Math.max(p.cooldownControl, 0.3);
    }
  }

  /** Separa jugadores que se solapan; el más fuerte desplaza al otro. */
  separate() {
    const all = this.active;
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      for (let j = i + 1; j < all.length; j++) {
        const c = all[j];
        const dx = c.x - a.x, dz = c.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.42 || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = 0.65 - d;
        const fa = a.fixed || a.state === 'down' ? 0 : c.a.fuerza, fc = c.fixed || c.state === 'down' ? 0 : a.a.fuerza;
        const sum = fa + fc;
        if (sum <= 0) continue;
        const nx = dx / d, nz = dz / d;
        a.x -= nx * push * (fa / sum); a.z -= nz * push * (fa / sum);
        c.x += nx * push * (fc / sum); c.z += nz * push * (fc / sum);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Transiciones de estado
  // -------------------------------------------------------------------------
  setState(s) {
    this.state = s;
    this.stateT = 0;
    this.live = s === STATE.PLAYING;
    this.emit('state', { state: s });
  }

  /** Detiene el juego durante dur segundos y luego prepara el saque `next`. */
  deadBall(state, dur, next) {
    this.next = next;
    this.deadDur = dur;
    this.setState(state);
    if (this.chanceFlag && this.clock - this.chanceFlag.time < 8 && state === STATE.BALL_OUT) {
      this.replayRequest = { reason: 'chance' };
    }
    this.chanceFlag = null;
    for (const p of this.active) { p.queued = null; p.shielding = false; }
  }

  startSetPiece(next) {
    for (const p of this.active) p.ai.wall = false;
    this.setPiece = this.rules.setup(next);
    this.setState(next.type);
    this.refSpot = null;
    const sp = this.setPiece;
    if (this.userTeam) this.setControlled(this.userTeam === sp.team ? sp.taker : null);
    this.emit('setPiece', { type: sp.type, team: sp.team, taker: sp.taker });
  }

  setPieceTaken(p, meta) {
    const sp = this.setPiece;
    if (!sp) return;
    this.setPiece = null;
    sp.taker.fixed = false;
    this.setState(STATE.PLAYING);
    if (this.so && this.so.phase === 'shot') this.so.phase = 'ball';
    if (sp.type === 'PENALTY') {
      const defending = sp.team.opponent;
      let side = null;
      if (this.userTeam === defending && this.user) side = this.user.penaltySide();
      this.gks[defending.side].penaltyDive(side);
    }
    this.emit('restart', { type: sp.type, team: sp.team, player: p });
  }

  goal(team) {
    if (this.so && this.so.phase === 'ball') { this.soGoal(team); return; }
    const b = this.ball;
    team.score++;
    const last = b.lastTouch, ls = this.lastShooter;
    let scorer = null, own = false;
    if (last && last.team === team) scorer = last;
    else if (ls && ls.team === team && this.clock - ls.time < 4) scorer = ls.player;
    else if (last) { scorer = last; own = true; }
    else scorer = team.players[team.players.length - 1];
    const info = { team, scorer, own, minute: this.minute() + 1, score: [this.teams[0].score, this.teams[1].score] };
    this.goalInfo = info;
    this.scorers.push(info);
    this.kickoffNext = team.opponent;
    this.setState(STATE.GOAL);
    this.chanceFlag = null;
    this.replayRequested = false;
    // Celebración
    const hero = own ? null : scorer;
    const cx = Math.sign(b.x) * (HL - 8), cz = HW - 3.5;
    let i = 0;
    for (const p of team.players) {
      p.setState('celeb', 0, 0);
      p.ai.cx = cx; p.ai.cz = cz;
      p.ai.slot = i++;
    }
    for (const p of team.opponent.players) if (p.state !== 'free') p.setState('free');
    this.celebHero = hero || team.players[team.players.length - 1];
    this.referee.signal(GESTURE.point, 1.5);
    this.emit('whistle', { kind: 'goal' });
    this.emit('goal', info);
  }

  updateCelebration(dt) {
    const info = this.goalInfo, team = info.team, hero = this.celebHero;
    for (const p of team.players) {
      const it = p.intent;
      let tx, tz;
      if (p === hero) { tx = p.ai.cx; tz = p.ai.cz; }
      else if (p.isGK) { tx = p.x; tz = p.z; }
      else {
        const a = p.ai.slot * 0.9;
        tx = hero.x + Math.cos(a) * 1.7; tz = hero.z + Math.sin(a) * 1.7;
      }
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      if (d > 0.9 && this.stateT < 6) {
        it.mx = dx / d; it.mz = dz / d; it.speed = 1; it.sprint = p !== hero; it.face = null;
        p.aux = p === hero ? 1 : 0;
      } else {
        it.mx = 0; it.mz = 0; it.speed = 0;
        it.face = Math.PI / 2; // hacia la grada principal
        p.aux = 2;
      }
    }
    this.ais[team.opponent.side].update(dt);
  }

  resumeAfterGoal() {
    if (this.state !== STATE.GOAL) return;
    this.goalInfo = null;
    this.startSetPiece({ type: 'KICKOFF', team: this.kickoffNext });
  }

  // ----------------------------------------------------- Tanda de penales
  startShootout() {
    const [h, a] = this.teams;
    this.so = { score: [0, 0], taken: [0, 0], taker: 0, phase: 'shot', ballT: 0 };
    this.emit('shootout', {});
    this.startSetPiece({ type: 'PENALTY', team: h });
  }

  soGoal(team) {
    this.soAdvance(true, team);
  }

  soMiss() {
    this.soAdvance(false, this.teams[this.so.taker]);
  }

  soDecided() {
    const so = this.so;
    const [a, b] = so.score;
    if (so.taken[0] < 5 || so.taken[1] < 5) return false;   // aún en los 5 reglamentarios
    if (a === b) return false;                              // empate → muerte súbita
    return so.taken[0] === so.taken[1];                     // decidido si van parejos
  }

  soAdvance(scored, team) {
    const so = this.so;
    so.taken[team.side]++;
    if (scored) so.score[team.side]++;
    const round = Math.ceil((so.taken[0] + so.taken[1]) / 2);
    this.emit('soShot', { team, scored, score: so.score.slice(), round });
    this.ball.owner = null; this.ball.vx = 0; this.ball.vz = 0; this.ball.vy = 0; this.ball.inNet = 0;
    for (const p of this.active) { p.stop(); if (p.state !== 'free') p.setState('free'); }
    if (this.soDecided()) { this.endShootout(); return; }
    so.taker = (so.taker + 1) % 2;
    so.phase = 'shot';
    so.ballT = 0;
    this.startSetPiece({ type: 'PENALTY', team: this.teams[so.taker] });
  }

  endShootout() {
    const so = this.so;
    const [a, b] = so.score;
    const winner = a > b ? this.teams[0] : this.teams[1];
    this.so = null;
    this.setState(STATE.FULL_TIME);
    this.emit('shootoutEnd', { winner, score: [a, b] });
    this.emit('fullTime', { winner, shootout: true, score: [a, b] });
  }

  endHalf() {
    const b = this.ball;
    b.owner = null; b.held = false; b.passTarget = null; b.offside = null;
    this.setPiece = null;
    for (const p of this.active) { p.fixed = false; p.stop(); p.queued = null; if (p.state !== 'free') p.setState('free'); }
    if (this.half === 1) {
      this.setState(STATE.HALF_TIME);
      this.emit('whistle', { kind: 'half' });
      this.emit('halfTime', {});
    } else {
      const [h, a] = this.teams;
      if (this.shootout && h.score === a.score) {
        this.emit('whistle', { kind: 'full' });
        this.startShootout();
        return;
      }
      this.setState(STATE.FULL_TIME);
      this.emit('whistle', { kind: 'full' });
      this.emit('fullTime', { winner: h.score > a.score ? h : a.score > h.score ? a : null });
    }
  }

  startSecondHalf() {
    if (this.state !== STATE.HALF_TIME) return;
    this.half = 2;
    this.time = 0;
    for (const t of this.teams) {
      t.dir = -t.dir;
      for (const p of t.players) {
        p.stamina = Math.min(1, p.stamina + 0.5);
        p.fatigue *= 0.8;
      }
    }
    this.startSetPiece({ type: 'KICKOFF', team: this.firstKickoff.opponent });
    this.emit('secondHalf', {});
  }

  /** Termina la presentación y deja listo el saque inicial. */
  beginPlay() {
    if (this.state !== STATE.INTRO) return;
    this.setPiece.intro = false;
    this.setState(STATE.KICKOFF);
    this.emit('matchStart', {});
    this.emit('setPiece', { type: 'KICKOFF', team: this.setPiece.team, taker: this.setPiece.taker });
  }

  // -------------------------------------------------------------------------
  // Avisos del balón
  // -------------------------------------------------------------------------
  onBallBounce(v) {
    this.emit('bounce', { v });
  }

  onBallFrame(kind, hit) {
    const b = this.ball;
    if (kind === 3) { this.emit('net', { speed: hit }); return; }
    this.emit('post', { bar: kind === 2, speed: hit });
    if (b.kickType === 'shot' && hit > 6) this.chanceFlag = { time: this.clock };
    b.predTick = -1;
  }

  // -------------------------------------------------------------------------
  // Bucle de simulación (paso fijo)
  // -------------------------------------------------------------------------
  step(dt) {
    this.tick++;
    this.clock += dt;
    this.stateT += dt;
    this.switchT += dt;
    const st = this.state;
    const b = this.ball;

    if (st === STATE.INTRO) {
      if (!this.external && this.stateT > 1) this.beginPlay();
      this.replay.record();
      return;
    }
    if (st === STATE.FULL_TIME || st === STATE.HALF_TIME) {
      for (const p of this.active) { p.stop(); p.update(dt, this); }
      b.update(dt, this);
      this.referee.update(dt);
      this.replay.record();
      if (st === STATE.HALF_TIME && !this.external && this.stateT > 1) this.startSecondHalf();
      return;
    }

    this.ballPrev.x = b.x; this.ballPrev.y = b.y; this.ballPrev.z = b.z;
    this.updatePossession(dt);

    const sp = this.setPiece;
    if (st === STATE.GOAL) {
      this.updateCelebration(dt);
    } else if (sp) {
      // Esperando el saque: todos quietos mirando al balón
      for (const p of this.active) {
        if (p === sp.taker || p === this.controlled) continue;
        p.stop();
        if (!p.isGK) p.intent.face = Math.atan2(b.z - p.z, b.x - p.x);
      }
      this.gks[0].update(dt);
      this.gks[1].update(dt);
    } else {
      this.ais[0].update(dt);
      this.ais[1].update(dt);
      this.gks[0].update(dt);
      this.gks[1].update(dt);
    }
    if (this.user) this.user.update(dt);

    const all = this.active;
    const playing = st === STATE.PLAYING;
    const fk = dt / (2 * this.halfLen);
    for (let i = 0; i < all.length; i++) {
      const p = all[i];
      p.update(dt, this);
      if (playing) p.fatigue = Math.min(1, p.fatigue + fk * (0.4 + (0.9 * p.speed) / 8) * (1.5 - p.a.resistencia / 100));
    }
    if (this.active.length !== this.teams[0].players.length + this.teams[1].players.length) {
      this.active = [...this.teams[0].players, ...this.teams[1].players];
    }
    this.separate();
    b.update(dt, this);

    if (this.state === STATE.PLAYING) {
      this.updateControl();
      if (this.state === STATE.PLAYING) this.updateAerial();
      if (this.state === STATE.PLAYING) this.rules.checkBall();
      if (this.state === STATE.PLAYING && this.so && this.so.phase === 'ball') {
        // Tanda de penales: si el balón no entra, es fallo (por tiempo o por salir)
        this.so.ballT += dt;
        if (this.so.ballT > 3.5) this.soMiss();
      } else if (this.state === STATE.PLAYING) {
        this.time += dt;
        if (this.time >= this.halfLen) {
          const danger = Math.abs(b.x) > HL - 30;
          if (!danger || this.time >= this.halfLen + 6) this.endHalf();
        }
      }
    } else if (this.setPiece && this.state !== STATE.GOAL) {
      this.updateSetPiece(dt);
    } else if (st === STATE.GOAL) {
      if (this.stateT > 4.5 && !this.replayRequested) {
        this.replayRequested = true;
        this.replayRequest = { reason: 'goal' };
      }
      if (this.stateT > (this.external ? 12 : 5)) this.resumeAfterGoal();
    } else if (st === STATE.BALL_OUT || st === STATE.OFFSIDE || st === STATE.FOUL) {
      if (st === STATE.FOUL && this.stateT > 1.0) this.rules.showCard();
      if (this.stateT >= this.deadDur) {
        if (st === STATE.FOUL) this.rules.applyCard();
        if (this.active.length !== this.teams[0].players.length + this.teams[1].players.length) {
          this.active = [...this.teams[0].players, ...this.teams[1].players];
        }
        this.startSetPiece(this.next);
      }
    }

    this.referee.update(dt);
    this.replay.record();
  }

  updateSetPiece(dt) {
    const sp = this.setPiece, b = this.ball;
    sp.t += dt;
    // Red de seguridad: el balón de un saque pertenece siempre al lanzador
    if (b.owner !== sp.taker && sp.taker.state === 'free') {
      b.owner = sp.taker;
      b.vx = 0; b.vy = 0; b.vz = 0;
      if (sp.type !== 'THROW_IN') { b.x = sp.bx; b.z = sp.bz; b.y = 0.11; b.held = false; } else b.held = true;
    }
    // Los rivales respetan la distancia aunque el usuario intente acercarse
    for (const p of sp.team.opponent.players) {
      if (p.isGK && sp.type === 'PENALTY') continue;
      const dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz);
      if (d < sp.minDist - 0.3) {
        const k = (sp.minDist - 0.3) / (d || 1);
        p.x = b.x + dx * k; p.z = b.z + dz * k;
        p.vx = 0; p.vz = 0;
      }
    }
    const userTakes = this.userTeam === sp.team && this.user;
    const limit = userTakes ? 12 : sp.delay;
    if (sp.t >= limit && sp.taker.state === 'free' && (!sp.tried || sp.t - sp.tried > 1.5)) {
      sp.tried = sp.t;
      this.rules.aiTake(sp);
    }
  }

  // -------------------------------------------------------------------------
  // Fotograma para el render y las repeticiones
  // -------------------------------------------------------------------------
  writeFrame(arr, o) {
    const b = this.ball;
    arr[o] = b.x; arr[o + 1] = b.y; arr[o + 2] = b.z; arr[o + 3] = 0;
    let k = o + HEADER;
    for (let i = 0; i < 22; i++, k += STRIDE) {
      const p = this.roster[i];
      if (p.sentOff) { arr[k + 6] = -1; continue; }
      arr[k] = p.x; arr[k + 1] = p.y; arr[k + 2] = p.z;
      arr[k + 3] = p.facing;
      arr[k + 4] = p.speed;
      arr[k + 5] = p.runPhase;
      arr[k + 6] = PSTATE[p.state];
      arr[k + 7] = p.stateDur > 0 ? Math.min(1, p.stateT / p.stateDur) : p.stateT;
      const holds = b.owner === p && b.held ? (p.holdHigh || p.state === 'throw' ? 2 : 1) : 0;
      arr[k + 8] = p.aux + 2 + holds * 10 + (p.shielding ? 100 : 0);
    }
    const offs = [this.referee.ref, this.referee.lines[0], this.referee.lines[1]];
    for (let i = 0; i < 3; i++, k += STRIDE) {
      const p = offs[i];
      arr[k] = p.x; arr[k + 1] = 0; arr[k + 2] = p.z;
      arr[k + 3] = p.facing;
      arr[k + 4] = p.speed;
      arr[k + 5] = p.runPhase;
      arr[k + 6] = PSTATE[p.state];
      arr[k + 7] = p.stateDur > 0 ? Math.min(1, p.stateT / p.stateDur) : p.stateT;
      arr[k + 8] = p.aux + 2;
    }
  }

  possessionPct() {
    const a = this.teams[0].stats.possT, c = this.teams[1].stats.possT;
    const s = a + c;
    if (s < 1) return [50, 50];
    const h = Math.round((a / s) * 100);
    return [h, 100 - h];
  }
}
