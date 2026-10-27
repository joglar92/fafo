// Constantes globales del juego. Unidades: metros, segundos.
// Ejes: X a lo largo del campo, Z a lo ancho, Y hacia arriba.

export const PITCH = {
  L: 105, W: 68, HL: 52.5, HW: 34,
  GOAL_HW: 3.66, GOAL_H: 2.44, GOAL_D: 2.2, POST_R: 0.06,
  BOX_D: 16.5, BOX_HW: 20.16,
  SIX_D: 5.5, SIX_HW: 9.16,
  PEN_SPOT: 11, CIRCLE_R: 9.15,
  MARGIN_X: 7, MARGIN_Z: 5.5, // césped hasta las vallas
};

export const BALL = {
  R: 0.11,
  G: 9.81,
  DRAG: 0.0075,       // resistencia del aire (cuadrática)
  REST: 0.6,          // rebote vertical
  BOUNCE_FRICTION: 0.78,
  ROLL_A: 1.5,        // frenada constante al rodar
  ROLL_K: 0.13,       // frenada proporcional a la velocidad
  MAGNUS: 0.3,        // efecto lateral
  LIFT: 0.2,          // sustentación por efecto hacia atrás
  SPIN_DECAY: 0.55,
};

export const SIM_DT = 1 / 60;

export const STATE = {
  INTRO: 'INTRO',
  KICKOFF: 'KICKOFF',
  PLAYING: 'PLAYING',
  BALL_OUT: 'BALL_OUT',
  THROW_IN: 'THROW_IN',
  GOAL_KICK: 'GOAL_KICK',
  CORNER: 'CORNER',
  FREE_KICK: 'FREE_KICK',
  PENALTY: 'PENALTY',
  OFFSIDE: 'OFFSIDE',
  FOUL: 'FOUL',
  GOAL: 'GOAL',
  HALF_TIME: 'HALF_TIME',
  FULL_TIME: 'FULL_TIME',
  SHOOTOUT: 'SHOOTOUT',
};

/** Estados en los que hay un lanzador esperando para poner el balón en juego. */
export const SET_PIECES = new Set(['KICKOFF', 'THROW_IN', 'GOAL_KICK', 'CORNER', 'FREE_KICK', 'PENALTY']);

export const VERSION = '0.1.0';
