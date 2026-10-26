// Grabación continua de los últimos segundos del partido para las repeticiones.
// Cada fotograma guarda el balón y la pose resumida de las 25 entidades
// (22 jugadores, árbitro y dos asistentes).

export const ENTITIES = 25;
export const STRIDE = 9;        // x, y, z, orientación, velocidad, fase de carrera, estado, progreso, aux
export const HEADER = 4;        // balón x, y, z + reservado
export const FRAME_SIZE = HEADER + ENTITIES * STRIDE;

export class Replay {
  constructor(match, seconds = 14) {
    this.m = match;
    this.cap = Math.round(seconds * 60);
    this.buf = new Float32Array(this.cap * FRAME_SIZE);
    this.head = 0;
    this.count = 0;
  }

  record() {
    this.m.writeFrame(this.buf, this.head * FRAME_SIZE);
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
  }

  /** Copia los últimos `sec` segundos en un clip independiente. */
  clip(sec) {
    const n = Math.min(this.count, Math.round(sec * 60));
    const frames = new Float32Array(n * FRAME_SIZE);
    for (let i = 0; i < n; i++) {
      const src = ((this.head - n + i + this.cap) % this.cap) * FRAME_SIZE;
      frames.set(this.buf.subarray(src, src + FRAME_SIZE), i * FRAME_SIZE);
    }
    return { frames, n, fps: 60 };
  }
}
