// Sonido generado por código (Web Audio): ambiente de estadio, efectos de
// juego y música original. No se usa ningún archivo de audio externo.

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.vol = { master: 0.8, music: 0.6, sfx: 0.9, crowd: 0.7 };
    this.track = null;
    this.timer = null;
    this.crowdLevel = 0;
    this.crowdOn = false;
    this.chantT = 0;
  }

  /** Debe llamarse tras un gesto del usuario (los navegadores lo exigen). */
  init(external) {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC && !external) return;
    const ctx = external || new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -9; comp.ratio.value = 3; comp.attack.value = 0.012; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.crowdBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.crowdBus.connect(this.master);
    // Ruido blanco reutilizable
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Ruido marrón (grave) para el murmullo
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    this.applyVolumes();
    if (this.pending) { const p = this.pending; this.pending = null; this.music(p); }
  }

  setVolumes(v) {
    Object.assign(this.vol, v);
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music * 1.5, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx * 1.8, t, 0.05);
    this.crowdBus.gain.setTargetAtTime(this.vol.crowd * 1.7, t, 0.05);
  }

  // ---------------------------------------------------------------- utilidades
  noiseSrc(buf = this.noise, loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = loop;
    if (loop) s.loopStart = Math.random();
    return s;
  }

  env(g, t, a, peak, d) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  burst(bus, { freq = 1000, q = 1, type = 'bandpass', a = 0.01, d = 0.2, peak = 0.5, f2, delay = 0, buf }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const s = this.noiseSrc(buf || this.noise);
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (f2) f.frequency.exponentialRampToValueAtTime(f2, t + a + d);
    const g = ctx.createGain();
    this.env(g, t, a, peak, d);
    s.connect(f).connect(g).connect(bus);
    s.start(t, Math.random());
    s.stop(t + a + d + 0.05);
  }

  tone(bus, { freq, f2, type = 'sine', a = 0.005, d = 0.2, peak = 0.4, delay = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + d);
    const g = ctx.createGain();
    this.env(g, t, a, peak, d);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + a + d + 0.05);
  }

  // ------------------------------------------------------------------ efectos
  kick(power = 0.5, soft = false) {
    if (!this.ctx) return;
    const p = Math.min(1, Math.max(0.15, power));
    this.tone(this.sfxBus, { freq: 150 + p * 60, f2: 48, d: 0.11, peak: (soft ? 0.35 : 0.75) * p + 0.1 });
    this.burst(this.sfxBus, { freq: 2600, q: 0.8, d: 0.035, peak: 0.25 * p, type: 'highpass' });
  }

  bounce(v = 3) {
    if (!this.ctx) return;
    const p = Math.min(1, v / 12);
    this.tone(this.sfxBus, { freq: 120, f2: 60, d: 0.07, peak: 0.25 * p + 0.03 });
  }

  post(speed = 15) {
    if (!this.ctx) return;
    const p = Math.min(1, speed / 22) * 0.5 + 0.2;
    for (const [f, d] of [[820, 0.5], [1310, 0.38], [2090, 0.25], [3120, 0.16]]) {
      this.tone(this.sfxBus, { freq: f, d, peak: p * 0.3, type: 'triangle' });
    }
    this.burst(this.sfxBus, { freq: 3000, type: 'highpass', d: 0.03, peak: 0.4 });
  }

  net() {
    this.burst(this.sfxBus, { freq: 5200, f2: 1800, q: 0.6, a: 0.02, d: 0.32, peak: 0.3 });
  }

  tackle(slide) {
    this.burst(this.sfxBus, { freq: 420, q: 0.7, d: slide ? 0.3 : 0.12, peak: 0.4, type: 'lowpass', buf: this.brown });
    this.tone(this.sfxBus, { freq: 95, f2: 55, d: 0.1, peak: 0.35 });
  }

  whistle(kind = 'short') {
    if (!this.ctx) return;
    const blasts = {
      short: [[0, 0.28]], long: [[0, 0.7]], goal: [[0, 0.55]],
      half: [[0, 0.35], [0.5, 0.7]], full: [[0, 0.32], [0.45, 0.32], [0.9, 1.0]],
    }[kind] || [[0, 0.3]];
    const ctx = this.ctx;
    for (const [off, dur] of blasts) {
      const t = ctx.currentTime + off;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.1, t + 0.02);
      g.gain.setValueAtTime(0.1, t + dur - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 2950; bp.Q.value = 6;
      // Trino de la bolita del silbato
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 31;
      const lg = ctx.createGain();
      lg.gain.value = 0.35;
      const trem = ctx.createGain();
      trem.gain.value = 0.7;
      lfo.connect(lg).connect(trem.gain);
      for (const f of [2860, 2985]) {
        const o = ctx.createOscillator();
        o.type = 'square'; o.frequency.value = f;
        o.connect(bp);
        o.start(t); o.stop(t + dur + 0.05);
      }
      bp.connect(trem).connect(g).connect(this.sfxBus);
      lfo.start(t); lfo.stop(t + dur + 0.05);
    }
  }

  ui(kind = 'move') {
    if (!this.ctx) return;
    if (kind === 'move') this.tone(this.sfxBus, { freq: 660, d: 0.05, peak: 0.12, type: 'triangle' });
    else if (kind === 'ok') {
      this.tone(this.sfxBus, { freq: 520, d: 0.07, peak: 0.16, type: 'triangle' });
      this.tone(this.sfxBus, { freq: 780, d: 0.12, peak: 0.16, type: 'triangle', delay: 0.06 });
    } else this.tone(this.sfxBus, { freq: 330, f2: 220, d: 0.1, peak: 0.14, type: 'triangle' });
  }

  // ------------------------------------------------------------------ público
  crowdStart() {
    if (!this.ctx || this.crowdOn) return;
    const ctx = this.ctx;
    this.crowdOn = true;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0.0001;
    this.crowdGain.connect(this.crowdBus);
    // Murmullo grave
    const a = this.noiseSrc(this.brown, true);
    const lf = ctx.createBiquadFilter();
    lf.type = 'lowpass'; lf.frequency.value = 520;
    const ga = ctx.createGain(); ga.gain.value = 0.9;
    a.connect(lf).connect(ga).connect(this.crowdGain);
    // Voces: ruido filtrado en la zona media con vaivén lento
    const b = this.noiseSrc(this.noise, true);
    this.crowdBP = ctx.createBiquadFilter();
    this.crowdBP.type = 'bandpass'; this.crowdBP.frequency.value = 900; this.crowdBP.Q.value = 0.6;
    const gb = ctx.createGain(); gb.gain.value = 0.16;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.17;
    const lg = ctx.createGain(); lg.gain.value = 0.05;
    lfo.connect(lg).connect(gb.gain);
    b.connect(this.crowdBP).connect(gb).connect(this.crowdGain);
    a.start(); b.start(); lfo.start();
    this.crowdNodes = [a, b, lfo];
    this.crowdSet(0.35);
  }

  crowdStop() {
    if (!this.crowdOn) return;
    this.crowdOn = false;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.setTargetAtTime(0.0001, t, 0.3);
    const nodes = this.crowdNodes;
    setTimeout(() => nodes.forEach((n) => { try { n.stop(); } catch (e) { /* ya parado */ } }), 1500);
  }

  /** Nivel de ambiente continuo (0 = casi silencio, 1 = estadio encendido). */
  crowdSet(level) {
    if (!this.crowdOn) return;
    this.crowdLevel = level;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.setTargetAtTime(0.12 + level * 0.5, t, 0.6);
    this.crowdBP.frequency.setTargetAtTime(750 + level * 700, t, 0.6);
  }

  /** Rugido: gol (intensity 1), ocasión (0.4)... */
  cheer(intensity = 1, dur = 4) {
    if (!this.ctx) return;
    const p = 0.25 + intensity * 0.55;
    this.burst(this.crowdBus, { freq: 700, f2: 1500, q: 0.5, a: 0.12, d: dur, peak: p });
    this.burst(this.crowdBus, { freq: 2400, f2: 1800, q: 0.7, a: 0.2, d: dur * 0.8, peak: p * 0.35 });
    this.burst(this.crowdBus, { freq: 300, q: 0.6, a: 0.15, d: dur * 1.1, peak: p * 0.9, type: 'lowpass', buf: this.brown });
  }

  ooh(intensity = 0.6) {
    if (!this.ctx) return;
    this.burst(this.crowdBus, { freq: 620, f2: 330, q: 1.2, a: 0.08, d: 1.1, peak: 0.25 + intensity * 0.3 });
  }

  boo(intensity = 0.6) {
    if (!this.ctx) return;
    this.burst(this.crowdBus, { freq: 260, f2: 200, q: 1.5, a: 0.2, d: 1.8, peak: 0.6 + intensity * 0.6 });
    for (let i = 0; i < 5; i++) {
      const f = 2100 + Math.random() * 1300;
      this.tone(this.crowdBus, { freq: f, f2: f * (0.9 + Math.random() * 0.25), a: 0.05, d: 0.5 + Math.random() * 0.7, peak: 0.05 + intensity * 0.05, delay: Math.random() * 0.7 });
    }
  }

  /** Palmas rítmicas de la grada. */
  clapPattern() {
    if (!this.ctx) return;
    const steps = [0, 0.42, 0.84, 1.05, 1.26, 1.9, 2.1, 2.3, 2.5, 2.92, 3.34];
    for (const s of steps) {
      this.burst(this.crowdBus, { freq: 1700, q: 0.9, d: 0.06, peak: 0.28 + this.crowdLevel * 0.25, delay: s });
      this.burst(this.crowdBus, { freq: 1100, q: 1.2, d: 0.05, peak: 0.2, delay: s + 0.012 });
    }
  }

  /** Llamar cada fotograma durante el partido para los cánticos espontáneos. */
  crowdTick(dt, playing) {
    if (!this.crowdOn || !playing) return;
    this.chantT -= dt;
    if (this.chantT <= 0) {
      this.chantT = 14 + Math.random() * 22;
      this.clapPattern();
    }
  }

  // ------------------------------------------------------------------- música
  /** track: 'menu' | 'select' | 'win' | 'lose' | 'draw' | null */
  music(track) {
    if (!this.ctx) { this.pending = track; return; }
    if (this.track === track) return;
    this.track = track;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (!this.ctx || !track) return;
    const song = SONGS[track];
    if (!song) return;
    const ctx = this.ctx;
    let step = 0;
    let next = ctx.currentTime + 0.1;
    const sixteenth = 60 / song.bpm / 4;
    this.timer = setInterval(() => {
      while (next < ctx.currentTime + 0.25) {
        this.playStep(song, step, next, sixteenth);
        step++;
        next += sixteenth;
      }
    }, 60);
  }

  playStep(song, step, t, dur) {
    const bar = Math.floor(step / 16) % song.chords.length;
    const pos = step % 16;
    const chord = song.chords[bar];
    const loop = Math.floor(step / (16 * song.chords.length));
    // Colchón armónico
    if (pos === 0) for (const n of chord) this.pad(NOTE(n), t, dur * 16, song.pad);
    // Bajo
    const bassHit = song.bass[pos];
    if (bassHit) this.bass(NOTE(chord[0] - 12 + (bassHit === 2 ? 12 : 0)), t, dur * 1.8);
    // Arpegio
    const ar = song.arp[pos];
    if (ar !== undefined && ar !== null && (loop > 0 || song.arpIntro)) {
      const n = chord[ar % chord.length] + 12 * Math.floor(ar / chord.length);
      this.pluck(NOTE(n + 12), t, dur * 1.5, song.arpVol);
    }
    // Melodía
    if (song.lead && loop % 2 === 1) {
      const ln = song.lead[(Math.floor(step / 16) % (song.lead.length / 16 | 0)) * 16 + pos];
      if (ln) this.lead(NOTE(ln), t, dur * 3, 0.12);
    }
    // Percusión
    if (song.drums && (loop > 0 || song.drumsIntro)) {
      if (song.drums.kick[pos]) this.drumKick(t);
      if (song.drums.snare[pos]) this.drumSnare(t);
      if (song.drums.hat[pos]) this.drumHat(t, song.drums.hat[pos] === 2);
    }
  }

  pad(freq, t, dur, vol = 0.05) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.25);
    g.gain.linearRampToValueAtTime(vol * 0.7, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.08);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1100; f.Q.value = 0.4;
    for (const det of [-7, 0, 8]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = det;
      o.connect(f);
      o.start(t); o.stop(t + dur * 1.1);
    }
    f.connect(g).connect(this.musicBus);
  }

  bass(freq, t, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), o2 = ctx.createOscillator();
    o.type = 'sawtooth'; o2.type = 'sine';
    o.frequency.value = freq; o2.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(140, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); o2.connect(f); f.connect(g).connect(this.musicBus);
    o.start(t); o2.start(t); o.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
  }

  pluck(freq, t, dur, vol = 0.07) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle'; o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'square'; o2.frequency.value = freq; o2.detune.value = 5;
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); o2.connect(g2).connect(g); g.connect(this.musicBus);
    o.start(t); o2.start(t); o.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
  }

  lead(freq, t, dur, vol) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(vol * 0.6, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 2400;
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = det;
      o.connect(f);
      o.start(t); o.stop(t + dur + 0.02);
    }
    f.connect(g).connect(this.musicBus);
  }

  drumKick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(this.musicBus);
    o.start(t); o.stop(t + 0.22);
  }

  drumSnare(t) {
    const ctx = this.ctx;
    const s = this.noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    s.connect(f).connect(g).connect(this.musicBus);
    s.start(t, Math.random()); s.stop(t + 0.16);
  }

  drumHat(t, open) {
    const ctx = this.ctx;
    const s = this.noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(open ? 0.09 : 0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (open ? 0.16 : 0.04));
    s.connect(f).connect(g).connect(this.musicBus);
    s.start(t, Math.random()); s.stop(t + 0.2);
  }
}

// Canciones originales. Acordes en notas MIDI; patrones de 16 pasos por compás.
const _ = null;
export const SONGS = {
  menu: {
    bpm: 108,
    chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62], [57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]],
    pad: 0.045, arpVol: 0.06, arpIntro: true, drumsIntro: false,
    bass: [1, 0, 0, 1, 0, 0, 2, 0, 1, 0, 0, 1, 0, 0, 2, 0],
    arp: [0, _, 1, _, 2, _, 3, _, 2, _, 1, _, 4, _, 2, _],
    lead: [
      76, 0, 0, 0, 0, 0, 74, 0, 72, 0, 0, 0, 0, 0, 0, 0, 69, 0, 0, 0, 72, 0, 0, 0, 77, 0, 0, 0, 76, 0, 0, 0,
      79, 0, 0, 0, 0, 0, 76, 0, 72, 0, 0, 0, 0, 0, 0, 0, 74, 0, 0, 0, 0, 0, 71, 0, 67, 0, 0, 0, 0, 0, 0, 0,
      76, 0, 0, 0, 0, 0, 74, 0, 72, 0, 0, 0, 0, 0, 0, 0, 69, 0, 0, 0, 72, 0, 0, 0, 77, 0, 0, 0, 81, 0, 0, 0,
      77, 0, 0, 0, 74, 0, 0, 0, 69, 0, 0, 0, 0, 0, 0, 0, 71, 0, 0, 0, 76, 0, 0, 0, 80, 0, 0, 0, 83, 0, 0, 0,
    ],
    drums: {
      kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 2, 0],
    },
  },
  select: {
    bpm: 96,
    chords: [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]],
    pad: 0.04, arpVol: 0.065, arpIntro: true, drumsIntro: true,
    bass: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 2, 0],
    arp: [0, _, _, 2, _, _, 1, _, 3, _, _, 2, _, _, 4, _],
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    },
  },
  win: {
    bpm: 124,
    chords: [[48, 52, 55], [55, 59, 62], [57, 60, 64], [53, 57, 60]],
    pad: 0.05, arpVol: 0.07, arpIntro: true, drumsIntro: true,
    bass: [1, 0, 1, 0, 0, 0, 2, 0, 1, 0, 1, 0, 0, 0, 2, 0],
    arp: [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 3, 4, 5],
    lead: [
      72, 0, 72, 0, 76, 0, 79, 0, 84, 0, 0, 0, 79, 0, 0, 0, 83, 0, 0, 0, 79, 0, 0, 0, 74, 0, 0, 0, 0, 0, 0, 0,
      76, 0, 76, 0, 81, 0, 84, 0, 88, 0, 0, 0, 84, 0, 0, 0, 81, 0, 0, 0, 77, 0, 0, 0, 84, 0, 0, 0, 0, 0, 0, 0,
    ],
    drums: {
      kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0],
      hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 2, 0],
    },
  },
  lose: {
    bpm: 72,
    chords: [[57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 55, 59]],
    pad: 0.055, arpVol: 0.06, arpIntro: true,
    bass: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    arp: [0, _, _, _, 2, _, _, _, 1, _, _, _, 3, _, _, _],
  },
  draw: {
    bpm: 92,
    chords: [[52, 55, 59], [48, 52, 55], [55, 59, 62], [50, 54, 57]],
    pad: 0.045, arpVol: 0.06, arpIntro: true, drumsIntro: true,
    bass: [1, 0, 0, 0, 0, 0, 2, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    arp: [0, _, 2, _, 1, _, 3, _, 2, _, 4, _, 3, _, 1, _],
    drums: {
      kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    },
  },
};
