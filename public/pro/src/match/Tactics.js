// Tácticas de equipo y perfiles de dificultad de la IA.

export const MENTALITIES = [
  { id: -2, name: 'MUY DEFENSIVA', desc: 'Bloque muy bajo. Todos por detrás del balón.' },
  { id: -1, name: 'DEFENSIVA', desc: 'Equipo replegado, laterales contenidos y bloque compacto.' },
  { id: 0, name: 'EQUILIBRADA', desc: 'Reparto equilibrado entre ataque y defensa.' },
  { id: 1, name: 'OFENSIVA', desc: 'Laterales arriba, extremos al ataque y defensa adelantada.' },
  { id: 2, name: 'MUY OFENSIVA', desc: 'Riesgo máximo: mucha gente por delante del balón.' },
];

export const SLIDERS = [
  { key: 'width', name: 'ANCHURA', lo: 'Estrecho', hi: 'Abierto' },
  { key: 'depth', name: 'PROFUNDIDAD', lo: 'Juntos', hi: 'Estirados' },
  { key: 'pressing', name: 'PRESIÓN', lo: 'Esperar', hi: 'Asfixiar' },
  { key: 'tempo', name: 'RITMO', lo: 'Pausado', hi: 'Vertical' },
  { key: 'line', name: 'ALTURA DE DEFENSA', lo: 'Atrás', hi: 'Adelantada' },
];

/** Táctica inicial a partir del estilo propio de un equipo. */
export function tacticsFromStyle(style) {
  return {
    formation: style.formation,
    mentality: style.mentality,
    width: style.width,
    depth: style.depth,
    pressing: style.pressing,
    tempo: style.tempo,
    line: style.line,
  };
}

/** Valores recomendados de los deslizadores para una mentalidad. */
export function presetForMentality(m) {
  return {
    width: 0.5 + m * 0.08,
    depth: 0.5 + m * 0.06,
    pressing: 0.5 + m * 0.17,
    tempo: 0.55 + m * 0.1,
    line: 0.5 + m * 0.17,
  };
}

/**
 * Perfiles de dificultad. No cambian la velocidad ni los atributos: cambian
 * la calidad de las decisiones, el posicionamiento y la coordinación.
 */
export const DIFFICULTIES = {
  facil: {
    id: 'facil', name: 'FÁCIL', desc: 'La IA comete errores, se coloca mal y decide tarde.',
    decisionNoise: 0.34, decisionInterval: 0.5, reaction: 0.5,
    passError: 2.1, shotError: 1.9, vision: 0.55,
    positioning: 0.45, anchorNoise: 5, marking: 0.3, trackRunners: 0.25,
    pressers: 1, cover: false, laneBlock: false, tackleSkill: 0.6, tackleRate: 0.6,
    runs: 0.5, offsideDiscipline: 0.6, support: 0.5,
    gkReaction: 0.2, gkPosError: 1.3, gkReach: 0.84,
  },
  normal: {
    id: 'normal', name: 'NORMAL', desc: 'Comportamiento equilibrado.',
    decisionNoise: 0.2, decisionInterval: 0.34, reaction: 0.32,
    passError: 1.4, shotError: 1.35, vision: 0.78,
    positioning: 0.72, anchorNoise: 2.2, marking: 0.6, trackRunners: 0.6,
    pressers: 1, cover: true, laneBlock: false, tackleSkill: 0.82, tackleRate: 0.9,
    runs: 0.8, offsideDiscipline: 0.82, support: 0.75,
    gkReaction: 0.1, gkPosError: 0.6, gkReach: 0.93,
  },
  dificil: {
    id: 'dificil', name: 'DIFÍCIL', desc: 'Mejor colocación, mejores decisiones y menos errores.',
    decisionNoise: 0.11, decisionInterval: 0.24, reaction: 0.22,
    passError: 1.05, shotError: 1.05, vision: 0.92,
    positioning: 0.9, anchorNoise: 1, marking: 0.82, trackRunners: 0.85,
    pressers: 2, cover: true, laneBlock: true, tackleSkill: 0.95, tackleRate: 1.15,
    runs: 1, offsideDiscipline: 0.93, support: 0.92,
    gkReaction: 0.04, gkPosError: 0.3, gkReach: 0.98,
  },
  experto: {
    id: 'experto', name: 'EXPERTO', desc: 'Presión coordinada, coberturas y lectura total del espacio.',
    decisionNoise: 0.05, decisionInterval: 0.17, reaction: 0.14,
    passError: 0.85, shotError: 0.88, vision: 1,
    positioning: 1, anchorNoise: 0.3, marking: 1, trackRunners: 1,
    pressers: 2, cover: true, laneBlock: true, tackleSkill: 1.05, tackleRate: 1.35,
    runs: 1.2, offsideDiscipline: 0.99, support: 1,
    gkReaction: 0, gkPosError: 0.12, gkReach: 1.02,
  },
};

export const DIFFICULTY_ORDER = ['facil', 'normal', 'dificil', 'experto'];

/** Perfil usado por los compañeros del usuario (IA de apoyo competente). */
export const TEAMMATE_PROFILE = { ...DIFFICULTIES.dificil, id: 'aliado', pressers: 1 };
