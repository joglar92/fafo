// Formaciones. Cada hueco tiene un rol, una profundidad d (0 = línea de centrales,
// 1 = delantero más adelantado) y una anchura w (-1 = banda izquierda, +1 = banda derecha).

const back4 = [
  { role: 'LB', d: 0.06, w: -0.78 }, { role: 'CB', d: 0, w: -0.27 },
  { role: 'CB', d: 0, w: 0.27 }, { role: 'RB', d: 0.06, w: 0.78 },
];
const back3 = [
  { role: 'CB', d: 0.02, w: -0.44 }, { role: 'CB', d: -0.02, w: 0 }, { role: 'CB', d: 0.02, w: 0.44 },
];

export const FORMATIONS = {
  '4-3-3': [
    ...back4,
    { role: 'CDM', d: 0.3, w: 0 }, { role: 'CM', d: 0.47, w: -0.38 }, { role: 'CM', d: 0.47, w: 0.38 },
    { role: 'LW', d: 0.86, w: -0.8 }, { role: 'ST', d: 1, w: 0 }, { role: 'RW', d: 0.86, w: 0.8 },
  ],
  '4-4-2': [
    ...back4,
    { role: 'LM', d: 0.5, w: -0.82 }, { role: 'CM', d: 0.42, w: -0.26 }, { role: 'CM', d: 0.42, w: 0.26 }, { role: 'RM', d: 0.5, w: 0.82 },
    { role: 'ST', d: 1, w: -0.2 }, { role: 'ST', d: 0.94, w: 0.2 },
  ],
  '4-2-3-1': [
    ...back4,
    { role: 'CDM', d: 0.3, w: -0.24 }, { role: 'CDM', d: 0.3, w: 0.24 },
    { role: 'LM', d: 0.7, w: -0.78 }, { role: 'CAM', d: 0.7, w: 0 }, { role: 'RM', d: 0.7, w: 0.78 },
    { role: 'ST', d: 1, w: 0 },
  ],
  '4-3-2-1': [
    ...back4,
    { role: 'CM', d: 0.38, w: -0.42 }, { role: 'CDM', d: 0.32, w: 0 }, { role: 'CM', d: 0.38, w: 0.42 },
    { role: 'CAM', d: 0.74, w: -0.32 }, { role: 'CAM', d: 0.74, w: 0.32 },
    { role: 'ST', d: 1, w: 0 },
  ],
  '4-1-4-1': [
    ...back4,
    { role: 'CDM', d: 0.26, w: 0 },
    { role: 'LM', d: 0.56, w: -0.82 }, { role: 'CM', d: 0.5, w: -0.28 }, { role: 'CM', d: 0.5, w: 0.28 }, { role: 'RM', d: 0.56, w: 0.82 },
    { role: 'ST', d: 1, w: 0 },
  ],
  '3-5-2': [
    ...back3,
    { role: 'LWB', d: 0.4, w: -0.88 }, { role: 'CM', d: 0.48, w: -0.34 }, { role: 'CDM', d: 0.3, w: 0 },
    { role: 'CM', d: 0.48, w: 0.34 }, { role: 'RWB', d: 0.4, w: 0.88 },
    { role: 'ST', d: 1, w: -0.2 }, { role: 'ST', d: 0.94, w: 0.2 },
  ],
  '3-4-3': [
    ...back3,
    { role: 'LM', d: 0.42, w: -0.86 }, { role: 'CM', d: 0.38, w: -0.26 }, { role: 'CM', d: 0.38, w: 0.26 }, { role: 'RM', d: 0.42, w: 0.86 },
    { role: 'LW', d: 0.88, w: -0.7 }, { role: 'ST', d: 1, w: 0 }, { role: 'RW', d: 0.88, w: 0.7 },
  ],
  '5-3-2': [
    { role: 'LWB', d: 0.14, w: -0.88 }, { role: 'CB', d: 0.02, w: -0.44 }, { role: 'CB', d: -0.02, w: 0 },
    { role: 'CB', d: 0.02, w: 0.44 }, { role: 'RWB', d: 0.14, w: 0.88 },
    { role: 'CM', d: 0.44, w: -0.4 }, { role: 'CDM', d: 0.36, w: 0 }, { role: 'CM', d: 0.44, w: 0.4 },
    { role: 'ST', d: 1, w: -0.2 }, { role: 'ST', d: 0.94, w: 0.2 },
  ],
};

export const FORMATION_NAMES = Object.keys(FORMATIONS);

// Qué posiciones naturales pueden ocupar cada rol, por orden de preferencia.
const COMPAT = {
  GK: ['GK'],
  CB: ['CB', 'CDM', 'RB', 'LB'],
  LB: ['LB', 'RB', 'LM', 'CB'],
  RB: ['RB', 'LB', 'RM', 'CB'],
  LWB: ['LB', 'LM', 'LW', 'RB'],
  RWB: ['RB', 'RM', 'RW', 'LB'],
  CDM: ['CDM', 'CM', 'CB'],
  CM: ['CM', 'CDM', 'CAM'],
  CAM: ['CAM', 'CM', 'ST', 'LW', 'RW'],
  LM: ['LM', 'LW', 'RM', 'RW', 'CAM', 'LB'],
  RM: ['RM', 'RW', 'LM', 'LW', 'CAM', 'RB'],
  LW: ['LW', 'LM', 'RW', 'RM', 'ST'],
  RW: ['RW', 'RM', 'LW', 'LM', 'ST'],
  ST: ['ST', 'CAM', 'LW', 'RW'],
};

/**
 * Elige el once titular para una formación.
 * Devuelve una lista de 11 entradas { slot, player }; la primera es el portero.
 */
export function pickLineup(squad, formationName) {
  const slots = [{ role: 'GK', d: -0.5, w: 0 }, ...FORMATIONS[formationName]];
  // Con expulsados hay menos jugadores que huecos: se sacrifican los más adelantados.
  while (slots.length > squad.length) slots.pop();
  const taken = new Set();
  const out = new Array(slots.length).fill(null);
  for (let level = 0; level < 6; level++) {
    slots.forEach((slot, i) => {
      if (out[i]) return;
      const want = COMPAT[slot.role][level];
      if (!want) return;
      let best = null;
      for (const p of squad) {
        if (taken.has(p.id) || p.pos !== want) continue;
        if (!best || p.ovr > best.ovr) best = p;
      }
      if (best) {
        taken.add(best.id);
        out[i] = { slot, player: best };
      }
    });
  }
  // Huecos sin candidato natural: el mejor jugador de campo disponible.
  slots.forEach((slot, i) => {
    if (out[i]) return;
    let best = null;
    for (const p of squad) {
      if (taken.has(p.id) || (p.pos === 'GK') !== (slot.role === 'GK')) continue;
      if (!best || p.ovr > best.ovr) best = p;
    }
    if (!best) best = squad.find((p) => !taken.has(p.id));
    taken.add(best.id);
    out[i] = { slot, player: best };
  });
  return out;
}
