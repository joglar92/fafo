// Guardado local: ajustes, última selección de equipos y tácticas, y progreso.
// Si el navegador no permite almacenamiento, todo sigue funcionando en memoria.

const KEY = 'golpe-franco-v1';

function defaults() {
  return {
    settings: {
      master: 0.8, music: 0.6, sfx: 0.9, crowd: 0.7,
      voice: true, captions: true, radar: true,
      quality: 'alta', camera: 'tv',
      halfMinutes: 5, night: false, difficulty: 'normal',
    },
    last: { home: 'bcu', away: 'mdr', side: 0, homeKit: 'home', awayKit: null },
    tactics: {},        // por id de equipo
    progress: { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, history: [] },
    career: null,       // reservado para el modo carrera
  };
}

export class SaveSystem {
  constructor() {
    this.ok = true;
    this.data = this.load();
  }

  load() {
    const d = defaults();
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        Object.assign(d.settings, s.settings || {});
        Object.assign(d.last, s.last || {});
        Object.assign(d.progress, s.progress || {});
        d.tactics = s.tactics || {};
        d.career = s.career || null;
      }
    } catch (e) {
      this.ok = false;
    }
    return d;
  }

  save() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch (e) {
      this.ok = false;
    }
  }

  get settings() { return this.data.settings; }

  setSetting(key, value) {
    this.data.settings[key] = value;
    this.save();
  }

  saveTactics(teamId, tactics) {
    this.data.tactics[teamId] = { ...tactics };
    this.save();
  }

  /** Registra el resultado de un partido jugado por el usuario. */
  recordMatch(r) {
    const p = this.data.progress;
    p.played++;
    p.gf += r.gf; p.ga += r.ga;
    if (r.gf > r.ga) p.won++; else if (r.gf < r.ga) p.lost++; else p.drawn++;
    p.history.unshift({ ...r, date: new Date().toISOString().slice(0, 10) });
    p.history.length = Math.min(p.history.length, 20);
    this.save();
  }
}
