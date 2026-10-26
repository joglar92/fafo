// Equipos, equipaciones, escudos y plantillas. Todo es ficticio y original.
// Las plantillas se generan de forma determinista a partir de una semilla por equipo.

import { RNG, hashString, clamp } from '../core/MathUtils.js';

const NAMES = {
  es: {
    first: ['Iker', 'Adrià', 'Unai', 'Marc', 'Hugo', 'Álvaro', 'Pol', 'Aitor', 'Rubén', 'Nil', 'Dani', 'Joel', 'Gael', 'Izan', 'Biel', 'Enzo'],
    last: ['Valcárcel', 'Arrieta', 'Montoro', 'Belmonte', 'Carrasquer', 'Ibarrola', 'Sarrià', 'Quintanar', 'Roselló', 'Aldecoa', 'Peñalver', 'Ferrús', 'Olmedilla', 'Cabanes', 'Zubieta', 'Larrinaga', 'Villalta', 'Tordera', 'Benavent', 'Escrivà', 'Urquijo', 'Solanas'],
  },
  en: {
    first: ['Callum', 'Alfie', 'Ollie', 'Tyler', 'Nathan', 'Rhys', 'Ewan', 'Toby', 'Lewis', 'Finley', 'Archie', 'Miles', 'Corey', 'Dexter', 'Elliot', 'Jonah'],
    last: ['Whitlock', 'Ashdown', 'Harrow', 'Pembry', 'Thorne', 'Wexford', 'Holloway', 'Braddock', 'Fenwick', 'Marlowe', 'Kingsley', 'Oakes', 'Garside', 'Loxley', 'Ellwood', 'Tarrant', 'Meadows', 'Dunmore', 'Hartwell', 'Redfern', 'Calloway', 'Stroud'],
  },
  it: {
    first: ['Matteo', 'Luca', 'Davide', 'Simone', 'Nicolò', 'Tommaso', 'Pietro', 'Elia', 'Giacomo', 'Samuele', 'Riccardo', 'Edoardo', 'Filippo', 'Mattia', 'Alessio', 'Cesare'],
    last: ['Bellandi', 'Corvini', 'Rastelli', 'Montefiori', 'Zanardo', 'Graziosi', 'Tavani', 'Fabrizzi', 'Lorenzon', 'Calderoni', 'Serafino', 'Bruschi', 'Venturoli', 'Marchetto', 'Pagliari', 'Arduini', 'Dellacasa', 'Ferrante', 'Olivari', 'Vannucci', 'Brambati', 'Scarpelli'],
  },
  fr: {
    first: ['Lucas', 'Théo', 'Mathis', 'Noah', 'Jules', 'Rayan', 'Yanis', 'Bastien', 'Loïc', 'Maël', 'Titouan', 'Gaspard', 'Axel', 'Sacha', 'Côme', 'Élie'],
    last: ['Beaumont', 'Marchand', 'Roussel', 'Vasseur', 'Lemaître', 'Charpentier', 'Duvivier', 'Montreuil', 'Fontenay', 'Clairmont', 'Bellerose', 'Aubert', 'Tessier', 'Perrault', 'Lavigne', 'Morvan', 'Renaud', 'Sabatier', 'Delorme', 'Chastain', 'Verdier', 'Hautcoeur'],
  },
  de: {
    first: ['Jonas', 'Lukas', 'Felix', 'Max', 'Leon', 'Niklas', 'Finn', 'Moritz', 'Jannik', 'Tobias', 'Fabian', 'Henrik', 'Paul', 'Emil', 'Linus', 'Kilian'],
    last: ['Brandner', 'Hollweg', 'Steinbach', 'Riedmann', 'Falkenrath', 'Osterloh', 'Wiesinger', 'Kaltenbach', 'Dornfeld', 'Lindemann', 'Aschenbrenner', 'Reuther', 'Volkmar', 'Hagedorn', 'Bachmeier', 'Eberhardt', 'Tiedemann', 'Wolfram', 'Kronberg', 'Seidler', 'Hauschild', 'Merkle'],
  },
  pt: {
    first: ['Tiago', 'Rúben', 'Rafael', 'Gonçalo', 'Duarte', 'Tomás', 'Martim', 'Afonso', 'Vasco', 'Simão', 'Henrique', 'Lourenço', 'Xavier', 'Caio', 'Salvador', 'Dinis'],
    last: ['Vasconcelos', 'Albuquerque', 'Meirinho', 'Carvalhal', 'Bettencourt', 'Quintela', 'Salgueiro', 'Portela', 'Nogueira', 'Amarante', 'Pimentel', 'Louro', 'Teles', 'Barroso', 'Cordeiro', 'Magalhães', 'Azeredo', 'Falcato', 'Rebelo', 'Sarmento', 'Travassos', 'Brandão'],
  },
  nl: {
    first: ['Daan', 'Sem', 'Luuk', 'Bram', 'Jesse', 'Thijs', 'Ruben', 'Stijn', 'Lars', 'Milan', 'Sven', 'Jasper', 'Niels', 'Floris', 'Koen', 'Teun'],
    last: ['van Aerden', 'de Ruyter', 'Hoogland', 'Verbeek', 'van Doorn', 'Kuipers', 'Brouwer', 'ter Horst', 'Vermeulen', 'Schouten', 'van Rijn', 'Dekkers', 'Molenaar', 'Hendriks', 'Postma', 'de Wilde', 'Bosveld', 'van Leeuwen', 'Zijlstra', 'Kloosterman', 'Smeets', 'Lammers'],
  },
};
const FLAVORS = Object.keys(NAMES);

// Plantilla tipo: posición natural y dorsal. 11 titulares + 7 suplentes.
const SQUAD_TEMPLATE = [
  ['GK', 1], ['RB', 2], ['CB', 4], ['CB', 5], ['LB', 3], ['CDM', 6], ['CM', 8], ['CAM', 10], ['RW', 7], ['ST', 9], ['LW', 11],
  ['GK', 13], ['CB', 15], ['LB', 12], ['CM', 14], ['CDM', 16], ['RM', 17], ['ST', 18],
];

export const ATTR_KEYS = ['ritmo', 'aceleracion', 'tiro', 'pase', 'regate', 'defensa', 'fisico', 'resistencia', 'control', 'fuerza'];
export const ATTR_LABELS = {
  ritmo: 'Ritmo', aceleracion: 'Aceleración', tiro: 'Tiro', pase: 'Pase', regate: 'Regate',
  defensa: 'Defensa', fisico: 'Físico', resistencia: 'Resistencia', control: 'Control', fuerza: 'Fuerza',
};

// Perfil de atributos por posición (desviación respecto a la media de su línea).
const PROFILE = {
  GK: { ritmo: -26, aceleracion: -22, tiro: -45, pase: -14, regate: -36, defensa: -40, fisico: 0, resistencia: -10, control: -24, fuerza: 2 },
  CB: { ritmo: -8, aceleracion: -10, tiro: -28, pase: -9, regate: -18, defensa: 4, fisico: 4, resistencia: -2, control: -9, fuerza: 6 },
  LB: { ritmo: 3, aceleracion: 3, tiro: -22, pase: -4, regate: -6, defensa: 0, fisico: -2, resistencia: 5, control: -5, fuerza: -4 },
  RB: { ritmo: 3, aceleracion: 3, tiro: -22, pase: -4, regate: -6, defensa: 0, fisico: -2, resistencia: 5, control: -5, fuerza: -4 },
  CDM: { ritmo: -6, aceleracion: -6, tiro: -14, pase: 2, regate: -6, defensa: 2, fisico: 3, resistencia: 5, control: 0, fuerza: 4 },
  CM: { ritmo: -3, aceleracion: -2, tiro: -8, pase: 5, regate: 1, defensa: -10, fisico: 0, resistencia: 6, control: 4, fuerza: -2 },
  CAM: { ritmo: 0, aceleracion: 2, tiro: -1, pase: 6, regate: 6, defensa: -30, fisico: -6, resistencia: 0, control: 6, fuerza: -10 },
  LW: { ritmo: 6, aceleracion: 7, tiro: -3, pase: 0, regate: 6, defensa: -32, fisico: -6, resistencia: 2, control: 3, fuerza: -12 },
  RW: { ritmo: 6, aceleracion: 7, tiro: -3, pase: 0, regate: 6, defensa: -32, fisico: -6, resistencia: 2, control: 3, fuerza: -12 },
  LM: { ritmo: 5, aceleracion: 5, tiro: -6, pase: 2, regate: 4, defensa: -24, fisico: -4, resistencia: 5, control: 2, fuerza: -9 },
  RM: { ritmo: 5, aceleracion: 5, tiro: -6, pase: 2, regate: 4, defensa: -24, fisico: -4, resistencia: 5, control: 2, fuerza: -9 },
  ST: { ritmo: 2, aceleracion: 2, tiro: 5, pase: -8, regate: 1, defensa: -40, fisico: 2, resistencia: -2, control: 1, fuerza: 3 },
};

// Pesos para calcular la valoración general según la posición.
const OVR_WEIGHTS = {
  CB: { defensa: 0.36, fisico: 0.16, fuerza: 0.16, ritmo: 0.1, pase: 0.1, control: 0.06, resistencia: 0.06 },
  FB: { defensa: 0.26, ritmo: 0.2, resistencia: 0.14, pase: 0.14, regate: 0.1, control: 0.08, aceleracion: 0.08 },
  CDM: { defensa: 0.28, pase: 0.22, fisico: 0.14, control: 0.12, resistencia: 0.12, fuerza: 0.12 },
  CM: { pase: 0.3, control: 0.2, regate: 0.14, resistencia: 0.12, tiro: 0.1, defensa: 0.08, ritmo: 0.06 },
  CAM: { pase: 0.28, regate: 0.22, control: 0.2, tiro: 0.16, aceleracion: 0.08, ritmo: 0.06 },
  W: { ritmo: 0.24, regate: 0.24, aceleracion: 0.14, control: 0.12, pase: 0.12, tiro: 0.14 },
  ST: { tiro: 0.34, control: 0.14, regate: 0.12, ritmo: 0.14, fisico: 0.1, fuerza: 0.08, aceleracion: 0.08 },
};
const WEIGHT_OF = { CB: 'CB', LB: 'FB', RB: 'FB', CDM: 'CDM', CM: 'CM', CAM: 'CAM', LW: 'W', RW: 'W', LM: 'W', RM: 'W', ST: 'ST' };

export const LINE_OF = {
  GK: 'GK', CB: 'DEF', LB: 'DEF', RB: 'DEF', LWB: 'DEF', RWB: 'DEF',
  CDM: 'MID', CM: 'MID', CAM: 'MID', LM: 'MID', RM: 'MID',
  LW: 'ATT', RW: 'ATT', ST: 'ATT',
};

export const POS_LABEL = {
  GK: 'POR', CB: 'DFC', LB: 'LI', RB: 'LD', LWB: 'CAI', RWB: 'CAD', CDM: 'MCD', CM: 'MC', CAM: 'MCO',
  LM: 'MI', RM: 'MD', LW: 'EI', RW: 'ED', ST: 'DC',
};

const kit = (shirt, accent, pattern, shorts, socks, num) => ({ shirt, accent, pattern, shorts, socks, num });

// Definición de los 12 clubes ficticios.
const TEAM_DEFS = [
  {
    id: 'bcu', name: 'Barcelona United', short: 'BCU', flavor: 'es', att: 87, mid: 85, def: 82,
    home: kit('#0f6b8f', '#f26b3a', 'sash', '#0b3d54', '#f26b3a', '#ffffff'),
    away: kit('#f4e9c8', '#0f6b8f', 'pinstripes', '#f4e9c8', '#0f6b8f', '#0b3d54'),
    crest: { shape: 'shield', emblem: 'wave', mono: 'BU' },
    style: { formation: '4-3-3', mentality: 1, width: 0.7, depth: 0.4, pressing: 0.8, tempo: 0.45, line: 0.75 },
    tagline: 'Posesión y presión alta',
  },
  {
    id: 'mdr', name: 'Madrid Royals', short: 'MDR', flavor: 'es', att: 88, mid: 86, def: 84,
    home: kit('#f5f5f7', '#6b3fa0', 'sleeves', '#f5f5f7', '#6b3fa0', '#4a2a75'),
    away: kit('#3a2360', '#d9b44a', 'band', '#3a2360', '#d9b44a', '#d9b44a'),
    crest: { shape: 'round', emblem: 'crown', mono: 'MR' },
    style: { formation: '4-3-3', mentality: 0, width: 0.6, depth: 0.6, pressing: 0.55, tempo: 0.75, line: 0.55 },
    tagline: 'Transiciones rápidas',
  },
  {
    id: 'mnr', name: 'Manchester Reds', short: 'MNR', flavor: 'en', att: 85, mid: 83, def: 82,
    home: kit('#c8102e', '#1c1c1c', 'solid', '#1c1c1c', '#c8102e', '#ffffff'),
    away: kit('#e9e4d8', '#c8102e', 'sash', '#1c1c1c', '#e9e4d8', '#c8102e'),
    crest: { shape: 'shield', emblem: 'chevrons', mono: 'MR' },
    style: { formation: '4-2-3-1', mentality: 1, width: 0.65, depth: 0.6, pressing: 0.6, tempo: 0.8, line: 0.6 },
    tagline: 'Juego directo y vertical',
  },
  {
    id: 'lnb', name: 'London Blues', short: 'LNB', flavor: 'en', att: 83, mid: 84, def: 83,
    home: kit('#1846b8', '#b8e045', 'halves', '#1846b8', '#ffffff', '#ffffff'),
    away: kit('#111a2e', '#b8e045', 'pinstripes', '#111a2e', '#b8e045', '#b8e045'),
    crest: { shape: 'hex', emblem: 'tower', mono: 'LB' },
    style: { formation: '4-2-3-1', mentality: 0, width: 0.55, depth: 0.5, pressing: 0.5, tempo: 0.55, line: 0.5 },
    tagline: 'Equilibrio en todas las líneas',
  },
  {
    id: 'mlb', name: 'Milan Black', short: 'MLB', flavor: 'it', att: 82, mid: 81, def: 86,
    home: kit('#15151a', '#2fd6a8', 'pinstripes', '#15151a', '#15151a', '#2fd6a8'),
    away: kit('#e8f7f1', '#15151a', 'band', '#e8f7f1', '#15151a', '#15151a'),
    crest: { shape: 'diamond', emblem: 'star', mono: 'MB' },
    style: { formation: '5-3-2', mentality: -1, width: 0.4, depth: 0.35, pressing: 0.3, tempo: 0.5, line: 0.3 },
    tagline: 'Muro defensivo y contragolpe',
  },
  {
    id: 'prs', name: 'Paris Stars', short: 'PRS', flavor: 'fr', att: 89, mid: 83, def: 80,
    home: kit('#141c4a', '#e8b93c', 'band', '#141c4a', '#141c4a', '#e8b93c'),
    away: kit('#f3ecdf', '#141c4a', 'sleeves', '#f3ecdf', '#141c4a', '#141c4a'),
    crest: { shape: 'round', emblem: 'stars', mono: 'PS' },
    style: { formation: '4-3-3', mentality: 2, width: 0.8, depth: 0.7, pressing: 0.65, tempo: 0.85, line: 0.7 },
    tagline: 'Ataque total',
  },
  {
    id: 'mun', name: 'Munich FC', short: 'MUN', flavor: 'de', att: 86, mid: 86, def: 83,
    home: kit('#0d8a4f', '#ffffff', 'hoops', '#ffffff', '#0d8a4f', '#ffffff'),
    away: kit('#f2f2f2', '#0d8a4f', 'sash', '#0d8a4f', '#f2f2f2', '#0d8a4f'),
    crest: { shape: 'shield', emblem: 'cross', mono: 'MF' },
    style: { formation: '4-2-3-1', mentality: 1, width: 0.6, depth: 0.45, pressing: 0.9, tempo: 0.7, line: 0.8 },
    tagline: 'Presión asfixiante',
  },
  {
    id: 'lis', name: 'Lisbon Eagles', short: 'LIS', flavor: 'pt', att: 81, mid: 80, def: 79,
    home: kit('#e08a1e', '#6e1423', 'sleeves', '#6e1423', '#e08a1e', '#6e1423'),
    away: kit('#6e1423', '#e08a1e', 'solid', '#6e1423', '#6e1423', '#e08a1e'),
    crest: { shape: 'shield', emblem: 'wings', mono: 'LE' },
    style: { formation: '4-4-2', mentality: 1, width: 0.85, depth: 0.6, pressing: 0.5, tempo: 0.65, line: 0.55 },
    tagline: 'Bandas y centros',
  },
  {
    id: 'ams', name: 'Amsterdam FC', short: 'AMS', flavor: 'nl', att: 80, mid: 82, def: 77,
    home: kit('#ffffff', '#19b5b0', 'halves', '#19b5b0', '#ffffff', '#0d5f5c'),
    away: kit('#0d3b47', '#19b5b0', 'hoops', '#0d3b47', '#19b5b0', '#ffffff'),
    crest: { shape: 'pennant', emblem: 'ball', mono: 'AF' },
    style: { formation: '4-3-3', mentality: 0, width: 0.75, depth: 0.4, pressing: 0.7, tempo: 0.4, line: 0.7 },
    tagline: 'Toque y juventud',
  },
  {
    id: 'dor', name: 'Dortmund Yellow', short: 'DOR', flavor: 'de', att: 84, mid: 81, def: 78,
    home: kit('#f6d21a', '#1b2a52', 'sash', '#1b2a52', '#f6d21a', '#1b2a52'),
    away: kit('#1b2a52', '#f6d21a', 'pinstripes', '#1b2a52', '#1b2a52', '#f6d21a'),
    crest: { shape: 'round', emblem: 'bolt', mono: 'DY' },
    style: { formation: '4-2-3-1', mentality: 1, width: 0.6, depth: 0.7, pressing: 0.85, tempo: 0.9, line: 0.65 },
    tagline: 'Velocidad y vértigo',
  },
  {
    id: 'tur', name: 'Turin FC', short: 'TUR', flavor: 'it', att: 80, mid: 82, def: 85,
    home: kit('#8a8f98', '#a3122a', 'stripes', '#2a2d33', '#2a2d33', '#ffffff'),
    away: kit('#f0f0f0', '#a3122a', 'band', '#f0f0f0', '#a3122a', '#a3122a'),
    crest: { shape: 'hex', emblem: 'chevrons', mono: 'TF' },
    style: { formation: '3-5-2', mentality: -1, width: 0.45, depth: 0.35, pressing: 0.4, tempo: 0.45, line: 0.35 },
    tagline: 'Orden táctico',
  },
  {
    id: 'lnr', name: 'London Royals', short: 'LNR', flavor: 'en', att: 82, mid: 80, def: 81,
    home: kit('#7a1632', '#f2c230', 'band', '#7a1632', '#f2c230', '#f2c230'),
    away: kit('#f7f1dc', '#7a1632', 'pinstripes', '#f7f1dc', '#7a1632', '#7a1632'),
    crest: { shape: 'shield', emblem: 'crown', mono: 'LR' },
    style: { formation: '4-4-2', mentality: -1, width: 0.5, depth: 0.75, pressing: 0.35, tempo: 0.85, line: 0.4 },
    tagline: 'Repliegue y contraataque',
  },
];

const SKIN = ['#f2c9a6', '#e6b38c', '#d19a73', '#b77c55', '#8f5a3a', '#6b4129', '#f5d3b5'];
const HAIR = ['#1b1512', '#2d2018', '#4a3020', '#6e4a2a', '#b08a4e', '#d9c07a', '#111111', '#8a3b1e'];

function makeAttrs(pos, base, rng) {
  const prof = PROFILE[pos];
  const a = {};
  for (const k of ATTR_KEYS) a[k] = Math.round(clamp(base + prof[k] + rng.gauss() * 3.2, 30, 99));
  return a;
}

function overall(pos, a, gkRating) {
  if (pos === 'GK') return gkRating;
  const w = OVR_WEIGHTS[WEIGHT_OF[pos]];
  let s = 0;
  for (const k in w) s += a[k] * w[k];
  return Math.round(clamp(s, 40, 99));
}

function buildSquad(def) {
  const rng = new RNG(hashString(def.id + '-squad-v1'));
  const used = new Set();
  const players = [];
  SQUAD_TEMPLATE.forEach(([pos, number], i) => {
    const starter = i < 11;
    const flavor = rng.chance(0.68) ? def.flavor : rng.pick(FLAVORS);
    let first, last, tries = 0;
    do {
      first = rng.pick(NAMES[flavor].first);
      last = rng.pick(NAMES[flavor].last);
      tries++;
    } while (used.has(last) && tries < 30);
    used.add(last);
    const line = LINE_OF[pos];
    const lineRating = line === 'ATT' ? def.att : line === 'MID' ? def.mid : def.def;
    // Las estrellas (dorsales 9, 10 y 7) rinden algo por encima de la media.
    const star = number === 10 || number === 9 || number === 7 ? 2.5 : 0;
    const base = lineRating + (starter ? rng.range(-1, 2.5) : rng.range(-7, -3)) + star;
    const attrs = makeAttrs(pos, base, rng);
    const gkRating = Math.round(clamp(base + rng.gauss() * 2, 50, 96));
    if (pos === 'GK') attrs.porteria = gkRating;
    players.push({
      id: `${def.id}-${number}`,
      name: `${first} ${last}`,
      short: last,
      initial: `${first[0]}. ${last}`,
      number, pos,
      age: rng.int(18, 34),
      attrs,
      ovr: overall(pos, attrs, gkRating),
      skin: rng.pick(SKIN),
      hair: rng.pick(HAIR),
      hairStyle: rng.int(0, 3),
      height: rng.range(0.94, 1.06) + (pos === 'GK' || pos === 'CB' ? 0.03 : 0),
    });
  });
  return players;
}

export const TEAMS = TEAM_DEFS.map((def) => {
  const squad = buildSquad(def);
  return {
    ...def,
    squad,
    ovr: Math.round((def.att + def.mid + def.def) / 3),
  };
});

export function getTeam(id) {
  return TEAMS.find((t) => t.id === id) || TEAMS[0];
}

/** Colores de portero candidatos: se elige el que más contraste con ambos equipos. */
export const GK_KITS = [
  kit('#f2e94e', '#1a1a1a', 'solid', '#1a1a1a', '#f2e94e', '#1a1a1a'),
  kit('#ff7a1a', '#1a1a1a', 'solid', '#ff7a1a', '#ff7a1a', '#1a1a1a'),
  kit('#35d07f', '#0f3d26', 'solid', '#0f3d26', '#35d07f', '#0f3d26'),
  kit('#c05cf2', '#2a0f3a', 'solid', '#2a0f3a', '#c05cf2', '#ffffff'),
  kit('#5ad1f0', '#0e2b3a', 'solid', '#0e2b3a', '#5ad1f0', '#0e2b3a'),
  kit('#8c8c8c', '#111111', 'solid', '#111111', '#8c8c8c', '#ffffff'),
];

export const REFEREE_KIT = kit('#111418', '#e6ff3a', 'solid', '#111418', '#111418', '#e6ff3a');
