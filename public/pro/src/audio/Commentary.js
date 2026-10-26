// Comentarista: reacciona a los eventos del partido con frases propias.
// Usa la síntesis de voz del navegador (voz generada, sin imitar a nadie) y
// muestra siempre el texto en pantalla por si no hay voz disponible.

const LINES = {
  MATCH_START: [
    '¡Arranca el partido! {h} recibe a {a}.',
    'Rueda el balón. {h} contra {a}, que lo disfruten.',
    'Comienza el encuentro en un estadio lleno hasta la bandera.',
    '¡Empezamos! Noventa minutos por delante entre {h} y {a}.',
  ],
  SECOND_HALF: [
    'Arranca la segunda parte.',
    'Vuelve a rodar el balón. Segundo tiempo.',
    'Ya estamos de nuevo en juego, con todo por decidir.',
  ],
  BIG_CHANCE: [
    '¡Ocasión clarísima para {t}!',
    '¡Qué oportunidad! {p} la tuvo.',
    '¡Uy! Ahí pudo llegar el gol de {t}.',
    '¡Peligro, mucho peligro en el área!',
  ],
  SHOT: [
    'Dispara {p}.',
    '{p} prueba fortuna.',
    'Lo intenta {p} desde ahí.',
    '¡Chuta {p}!',
  ],
  SHOT_WIDE: [
    'Fuera. Se marcha desviado el disparo de {p}.',
    'No encuentra portería {p}.',
    'Se va alto el intento de {p}.',
    'Ha perdonado {p}. Saque de puerta.',
  ],
  SAVE: [
    '¡Paradón de {g}!',
    '¡Qué mano saca {g}!',
    'Responde {g} con una gran intervención.',
    'Ahí estaba {g}, muy seguro.',
    '¡Se luce el portero de {gt}!',
  ],
  CATCH: [
    'Bloca {g} sin problemas.',
    'Atrapa {g}. Tranquilidad para {gt}.',
    'A las manos de {g}.',
  ],
  POST: [
    '¡Al palo! ¡La madera salva a {r}!',
    '¡El poste! No se puede tener peor suerte.',
    '¡Larguero! Tiembla la portería.',
  ],
  CORNER: [
    'Córner para {t}.',
    'Saque de esquina. Ojo al balón parado.',
    'Lo manda a córner la defensa de {r}.',
  ],
  FOUL: [
    'Falta de {p}.',
    'El árbitro señala falta de {p}.',
    'Entrada de {p}, y el colegiado lo ve claro.',
    'Para el juego el árbitro. Falta.',
  ],
  PENALTY: [
    '¡Penalti! ¡Penalti a favor de {r}!',
    '¡Señala el punto de penalti el árbitro!',
    '¡Pena máxima! Derriba {p} dentro del área.',
  ],
  YELLOW: [
    'Tarjeta amarilla para {p}.',
    'Amonestado {p}. Tendrá que andarse con cuidado.',
    'Amarilla. {p} ve la cartulina.',
  ],
  RED: [
    '¡Tarjeta roja! {p} se va a la calle.',
    '¡Expulsado {p}! {t} se queda con uno menos.',
    '¡Roja directa! Durísimo golpe para {t}.',
  ],
  OFFSIDE: [
    'Fuera de juego de {p}.',
    'Levanta el banderín el asistente. Posición adelantada.',
    'Estaba adelantado {p}. Fuera de juego.',
  ],
  GOAL: [
    '¡GOOOL de {t}! ¡Marca {p}!',
    '¡GOL, GOL, GOL de {p}! ¡{s}!',
    '¡Golazo de {p}! ¡Estalla el estadio!',
    '¡La manda a guardar {p}! ¡Gol de {t}!',
    '¡GOOOL! ¡{p} no perdona! {s}.',
  ],
  OWN_GOAL: [
    '¡Gol en propia puerta! Qué mala suerte la de {p}.',
    '¡Se la mete en su portería {p}! Gol para {t}.',
  ],
  GOAL_EQUAL: ['¡Empata {t}! Esto vuelve a empezar.', '¡Tablas en el marcador! {s}.'],
  GOAL_LEAD: ['{t} se pone por delante. {s}.', 'Golpea primero {t}.'],
  HALF_TIME: [
    'Final de la primera parte. {s}.',
    'Nos vamos al descanso con {s} en el marcador.',
    'Señala el camino de los vestuarios el árbitro. {s}.',
  ],
  FULL_TIME_WIN: [
    '¡Final del partido! Victoria de {t}. {s}.',
    '¡Se acabó! {t} se lleva el triunfo. {s}.',
    'Pita el final el árbitro. Gana {t}.',
  ],
  FULL_TIME_DRAW: [
    '¡Final! Reparto de puntos. {s}.',
    'Se acabó, y nadie consigue imponerse. {s}.',
  ],
  TACKLE: ['Gran robo de {p}.', 'Se anticipa {p}. Muy atento.', 'Corta {p} con limpieza.'],
  THROUGH: ['¡Qué pase de {p}!', 'Balón al espacio de {p}...', 'Filtra {p} entre líneas.'],
  CROSS: ['Centro al área de {p}...', 'La pone {p}...', 'Cuelga el balón {p}.'],
  FILLER: [
    'Mueve el balón {t} con paciencia.',
    'Partido de mucho ritmo.',
    '{t} busca huecos en la defensa rival.',
    'Aprieta la grada.',
    'Minuto {m}. {s}.',
    'Bien plantado {t} sobre el campo.',
  ],
};

const PRIORITY = {
  GOAL: 10, OWN_GOAL: 10, PENALTY: 9, RED: 9, FULL_TIME_WIN: 9, FULL_TIME_DRAW: 9, HALF_TIME: 8, MATCH_START: 8,
  SECOND_HALF: 7, POST: 7, SAVE: 6, BIG_CHANCE: 6, YELLOW: 6, OFFSIDE: 5, FOUL: 5, CORNER: 4, SHOT_WIDE: 4,
  CATCH: 3, SHOT: 3, THROUGH: 2, CROSS: 2, TACKLE: 2, FILLER: 1,
};

export class Commentary {
  constructor() {
    this.enabled = true;
    this.voiceOn = true;
    this.volume = 0.9;
    this.onCaption = null;      // (texto) => {}
    this.last = {};
    this.busyUntil = 0;
    this.curPriority = 0;
    this.voice = null;
    this.match = null;
    this.unsub = [];
    this.fillerT = 20;
    this.synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
    if (this.synth) {
      const pick = () => {
        const vs = this.synth.getVoices();
        this.voice = vs.find((v) => /^es[-_]ES/i.test(v.lang)) || vs.find((v) => /^es/i.test(v.lang)) || null;
      };
      pick();
      try { this.synth.addEventListener('voiceschanged', pick); } catch (e) { /* no disponible */ }
    }
  }

  get hasVoice() {
    return !!(this.synth && this.voice);
  }

  now() {
    return performance.now() / 1000;
  }

  fill(tpl, d) {
    const m = this.match;
    const [h, a] = m.teams;
    const lead = h.score === a.score
      ? (h.score === 0 ? 'empate a cero' : `empate a ${h.score}`)
      : (h.score > a.score ? `${h.name} ${h.score}, ${a.name} ${a.score}` : `${a.name} ${a.score}, ${h.name} ${h.score}`);
    const team = d.team || (d.player && d.player.team) || null;
    return tpl
      .replace(/\{p\}/g, d.player ? d.player.data.short : 'el jugador')
      .replace(/\{t\}/g, team ? team.name : 'el equipo')
      .replace(/\{r\}/g, team ? team.opponent.name : 'el rival')
      .replace(/\{g\}/g, d.gk ? d.gk.data.short : 'el portero')
      .replace(/\{gt\}/g, d.gk ? d.gk.team.name : 'su equipo')
      .replace(/\{h\}/g, h.name).replace(/\{a\}/g, a.name)
      .replace(/\{s\}/g, lead)
      .replace(/\{m\}/g, String(m.minute()));
  }

  /** Lanza una frase de la categoría si no pisa a otra más importante. */
  say(cat, d = {}, delay = 0) {
    if (!this.enabled || !this.match) return;
    const pr = PRIORITY[cat] || 1;
    const t = this.now();
    if (t < this.busyUntil && pr <= this.curPriority) return;
    if (t < this.busyUntil - 0.2 && pr < 6 && this.curPriority >= 3) return;
    const list = LINES[cat];
    if (!list) return;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === this.last[cat]) i = (i + 1) % list.length;
    this.last[cat] = i;
    const text = this.fill(list[i], d);
    const dur = 1.2 + text.length * 0.06;
    this.busyUntil = t + delay + dur;
    this.curPriority = pr;
    this.fillerT = 16 + Math.random() * 14;
    const fire = () => {
      if (this.onCaption) this.onCaption(text, dur);
      this.speak(text, pr);
    };
    if (delay > 0) setTimeout(fire, delay * 1000); else fire();
  }

  speak(text, pr) {
    if (!this.voiceOn || !this.synth || !this.voice) return;
    try {
      if (pr >= 6) this.synth.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/GOOOL/g, 'Goooool').replace(/GOL, GOL, GOL/g, 'Gol, gol, gol'));
      u.voice = this.voice;
      u.lang = this.voice.lang;
      u.rate = pr >= 9 ? 1.12 : 1.05;
      u.pitch = pr >= 9 ? 1.15 : 1;
      u.volume = this.volume;
      this.synth.speak(u);
    } catch (e) { /* sin voz: quedan los subtítulos */ }
  }

  stop() {
    try { if (this.synth) this.synth.cancel(); } catch (e) { /* nada */ }
    this.busyUntil = 0;
  }

  detach() {
    this.unsub.forEach((f) => f());
    this.unsub = [];
    this.match = null;
    this.stop();
  }

  /** Conecta el comentarista a los eventos de un partido. */
  attach(match) {
    this.detach();
    this.match = match;
    const on = (type, fn) => this.unsub.push(match.on(type, fn));
    let pendingShot = null;
    on('matchStart', () => this.say('MATCH_START'));
    on('secondHalf', () => this.say('SECOND_HALF'));
    on('shot', (d) => {
      pendingShot = { ...d, t: match.clock };
      if (d.xg > 0.33) this.say('BIG_CHANCE', d);
      else if (Math.random() < 0.5) this.say('SHOT', d);
    });
    on('save', (d) => {
      pendingShot = null;
      if (d.claim) return;
      this.say(d.catch && d.speed < 20 ? 'CATCH' : 'SAVE', { gk: d.gk, player: d.shooter }, 0.15);
    });
    on('post', (d) => { if (d.speed > 6 && pendingShot) { this.say('POST', { team: pendingShot.team, player: pendingShot.player }); pendingShot = null; } });
    on('out', (d) => {
      if (d.kind === 'CORNER') this.say('CORNER', { team: d.team });
      else if (d.kind === 'GOAL_KICK' && pendingShot && match.clock - pendingShot.t < 4) this.say('SHOT_WIDE', pendingShot);
      pendingShot = null;
    });
    on('foul', (d) => this.say(d.penalty ? 'PENALTY' : 'FOUL', { player: d.offender, team: d.offender.team }));
    on('card', (d) => this.say(d.card === 'yellow' ? 'YELLOW' : 'RED', { player: d.player, team: d.team }));
    on('offside', (d) => this.say('OFFSIDE', d));
    on('goal', (d) => {
      pendingShot = null;
      this.say(d.own ? 'OWN_GOAL' : 'GOAL', { player: d.scorer, team: d.team });
      const [h, a] = match.teams;
      if (h.score === a.score) this.say('GOAL_EQUAL', { team: d.team }, 4.2);
      else if (Math.abs(h.score - a.score) === 1 && d.team.score > d.team.opponent.score) this.say('GOAL_LEAD', { team: d.team }, 4.2);
    });
    on('halfTime', () => this.say('HALF_TIME', {}, 0.6));
    on('fullTime', (d) => this.say(d.winner ? 'FULL_TIME_WIN' : 'FULL_TIME_DRAW', { team: d.winner }, 0.8));
    on('tackle', (d) => { if (d.clean && Math.random() < 0.18) this.say('TACKLE', d); });
    on('kick', (d) => {
      if (d.type === 'through' && Math.random() < 0.3) this.say('THROUGH', d);
      else if (d.type === 'cross' && Math.random() < 0.3) this.say('CROSS', d);
    });
  }

  /** Comentarios de relleno muy espaciados. Llamar una vez por fotograma. */
  tick(dt) {
    const m = this.match;
    if (!m || !this.enabled || m.state !== 'PLAYING') return;
    this.fillerT -= dt;
    if (this.fillerT <= 0 && m.possession) {
      this.say('FILLER', { team: m.possession });
      this.fillerT = 22 + Math.random() * 18;
    }
  }
}
