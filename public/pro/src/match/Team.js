// Equipo en el campo: once titular, táctica, equipación y estadísticas.

import { pickLineup, FORMATIONS } from '../data/Formations.js';
import { Player } from './Player.js';

export function emptyStats() {
  return {
    shots: 0, onTarget: 0, passes: 0, passesOk: 0, fouls: 0, corners: 0, offsides: 0,
    yellow: 0, red: 0, saves: 0, tackles: 0, possT: 0,
  };
}

export class Team {
  /**
   * @param data datos del club (TeamsData)
   * @param side 0 = local, 1 = visitante
   * @param tactics { formation, mentality, width, depth, pressing, tempo, line }
   * @param kit equipación de campo, gkKit equipación del portero
   * @param profile perfil de IA (dificultad)
   */
  constructor(data, side, tactics, kit, gkKit, profile) {
    this.data = data;
    this.side = side;
    this.dir = side === 0 ? 1 : -1; // sentido de ataque en el eje X
    this.tactics = { ...tactics };
    this.kit = kit;
    this.gkKit = gkKit;
    this.profile = profile;
    this.isUser = false;
    this.opponent = null;
    this.score = 0;
    this.stats = emptyStats();
    this.dismissed = [];
    const lineup = pickLineup(data.squad, this.tactics.formation);
    this.players = lineup.map((e, i) => new Player(this, e, i));
    this.gk = this.players[0];
    this.bench = data.squad.filter((p) => !lineup.some((e) => e.player.id === p.id));
  }

  get name() { return this.data.name; }
  get short() { return this.data.short; }

  /** Cambia la formación en pleno partido recolocando a los mismos jugadores. */
  setFormation(name) {
    if (!FORMATIONS[name]) return;
    this.tactics.formation = name;
    const current = this.players.map((p) => p.data);
    const lineup = pickLineup(current, name);
    let i = 0;
    for (const e of lineup) {
      const p = this.players.find((q) => q.data.id === e.player.id);
      if (!p) continue;
      p.slot = e.slot;
      p.role = e.slot.role;
      p.isGK = p.role === 'GK';
      i++;
    }
    this.gk = this.players.find((p) => p.isGK) || this.gk;
    return i;
  }

  remove(player) {
    const i = this.players.indexOf(player);
    if (i >= 0) {
      this.players.splice(i, 1);
      this.dismissed.push(player);
    }
  }

  /** Mejor lanzador según una función de puntuación. */
  best(scoreFn, exclude) {
    let best = null, bs = -1e9;
    for (const p of this.players) {
      if (p.isGK || p === exclude) continue;
      const s = scoreFn(p);
      if (s > bs) { bs = s; best = p; }
    }
    return best;
  }
}
