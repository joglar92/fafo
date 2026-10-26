// Entrada de teclado. Traduce teclas físicas a acciones del juego y guarda
// pulsaciones y sueltas hasta que la simulación las consume.

const KEYMAP = {
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  Space: 'pass',
  AltLeft: 'through', AltRight: 'through', KeyV: 'through',
  KeyE: 'shoot',
  KeyR: 'lob',
  KeyF: 'chip',
  KeyC: 'shield',
  KeyX: 'feint',
  KeyQ: 'switch',
  Escape: 'pause', KeyP: 'pause',
  Enter: 'confirm',
};

export const CONTROLS_HELP = {
  ataque: [
    ['W A S D', 'Moverse'],
    ['SHIFT', 'Sprint'],
    ['ESPACIO', 'Pase (mantener = más fuerte)'],
    ['ALT o V', 'Pase al hueco'],
    ['R', 'Pase elevado / centro'],
    ['E', 'Disparo (mantener = más potencia y altura)'],
    ['C + E', 'Disparo colocado'],
    ['F', 'Vaselina'],
    ['C', 'Proteger el balón'],
    ['X', 'Regate (recorte)'],
  ],
  defensa: [
    ['Q', 'Cambiar de jugador'],
    ['ESPACIO', 'Entrada'],
    ['E', 'Entrada deslizante'],
    ['R', 'Despeje'],
    ['C', 'Contención'],
    ['ALT o V', 'Presión de un compañero'],
    ['ESC', 'Pausa'],
  ],
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressedQ = new Set();
    this.releasedQ = new Set();
    this.enabled = true;
    this._move = { x: 0, z: 0 };
    this.listeners = [];
    this._down = (e) => this.onKey(e, true);
    this._up = (e) => this.onKey(e, false);
    this._blur = () => this.reset();
    window.addEventListener('keydown', this._down);
    window.addEventListener('keyup', this._up);
    window.addEventListener('blur', this._blur);
  }

  /** Escucha pulsaciones de acción (para menús, pausa, saltar repeticiones). */
  onAction(fn) {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  onKey(e, down) {
    const a = KEYMAP[e.code];
    if (!a) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    if (down) {
      if (!this.keys.has(a)) {
        this.keys.add(a);
        if (!e.repeat) {
          this.pressedQ.add(a);
          for (const fn of this.listeners.slice()) fn(a, e);
        }
      }
    } else {
      this.keys.delete(a);
      this.releasedQ.add(a);
    }
  }

  reset() {
    this.keys.clear();
    this.pressedQ.clear();
    this.releasedQ.clear();
  }

  down(a) { return this.enabled && this.keys.has(a); }
  pressed(a) { return this.enabled && this.pressedQ.has(a); }
  released(a) { return this.enabled && this.releasedQ.has(a); }

  /** Dirección de movimiento en el plano del campo (X a la derecha, Z hacia la cámara). */
  get move() {
    const m = this._move;
    if (!this.enabled) { m.x = 0; m.z = 0; return m; }
    let x = (this.keys.has('right') ? 1 : 0) - (this.keys.has('left') ? 1 : 0);
    let z = (this.keys.has('down') ? 1 : 0) - (this.keys.has('up') ? 1 : 0);
    if (x && z) { x *= Math.SQRT1_2; z *= Math.SQRT1_2; }
    m.x = x; m.z = z;
    return m;
  }

  /** Se llama al final de cada paso de simulación que ha leído la entrada. */
  endStep() {
    this.pressedQ.clear();
    this.releasedQ.clear();
  }

  dispose() {
    window.removeEventListener('keydown', this._down);
    window.removeEventListener('keyup', this._up);
    window.removeEventListener('blur', this._blur);
  }
}
