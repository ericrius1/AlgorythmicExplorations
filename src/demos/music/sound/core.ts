// Audio plumbing for the sound figures (Living Music parts 1 and 3). Raw Web
// Audio nodes made from Tone's context, so they share the page's master bus
// (and its limiter) with everything else, without Tone's 100 ms look-ahead:
// a pluck sounds when you pluck.

import { Tone, masterBus, unlockAudio, audioOn, frameGuard } from "../../../lib/audio";

export { unlockAudio, audioOn };

export function ctx(): Tone.BaseContext {
  return Tone.getContext();
}

// AudioContext time, a hair in the future so ramps start cleanly.
export function now(): number {
  return Tone.getContext().currentTime + 0.005;
}

// Where every figure's sound goes: the shared master bus.
export function dest(): AudioNode {
  return masterBus().input as unknown as AudioNode;
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

// ---- silence when out of sight -------------------------------------------------

// Demos keep drawing while they're within a few hundred pixels of the screen
// (so they're warm when you arrive), but their sound should stop the moment
// they leave it. This calls `silence` when the element has been fully off
// screen for a quarter second, and also when its frames stop (tab hidden).
export function guardSound(el: HTMLElement, silence: () => void): { pulse(): void; visible(): number } {
  let ratio = 1;
  let timer = 0;
  // watch the picture, not the whole figure: once the canvas is gone (under
  // the fixed nav counts as gone) the sound goes too
  const target = el.querySelector<HTMLElement>(".ms-stage") ?? el;
  if (typeof IntersectionObserver !== "undefined") {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          ratio = e.isIntersecting ? e.intersectionRatio : 0;
          window.clearTimeout(timer);
          if (!e.isIntersecting) timer = window.setTimeout(silence, 250);
        }
      },
      { threshold: [0, 0.1, 0.25, 0.4, 0.6, 0.8, 1], rootMargin: "-52px 0px 0px 0px" },
    );
    io.observe(target);
  }
  const fg = frameGuard(silence);
  return { pulse: () => fg.pulse(), visible: () => ratio };
}

// ---- sustained partial banks ------------------------------------------------

// A bank of sine partials, one oscillator each, summed into one output gain.
// Frequencies and amplitudes glide smoothly while sounding. Oscillators only
// exist while the bank is audible; stop() fades out and frees them.
//
// With `phases`, each partial is a one-harmonic PeriodicWave at that phase.
// All oscillators start on the same sample and their frequencies always move
// together (n·f), so the relative phases hold for as long as the bank plays.
export class Partials {
  readonly n: number;
  readonly out: GainNode;
  readonly freqs: Float64Array;
  readonly amps: Float64Array;
  readonly phases: Float64Array;
  level: number;
  private oscs: OscillatorNode[] = [];
  private gains: GainNode[] = [];
  private live = false;
  private killTimer = 0;
  private usePhase: boolean;

  constructor(n: number, opts: { level?: number; phases?: boolean; to?: AudioNode } = {}) {
    this.n = n;
    this.level = opts.level ?? 0.2;
    this.usePhase = opts.phases ?? false;
    this.freqs = new Float64Array(n).fill(220);
    this.amps = new Float64Array(n);
    this.phases = new Float64Array(n);
    this.out = ctx().createGain();
    this.out.gain.value = 0;
    this.out.connect(opts.to ?? dest());
  }

  get playing(): boolean {
    return this.live;
  }

  private wave(phase: number): PeriodicWave {
    // sin(ωt + φ) = cos φ · sin ωt + sin φ · cos ωt
    return ctx().createPeriodicWave(new Float32Array([0, Math.sin(phase)]), new Float32Array([0, Math.cos(phase)]));
  }

  start(fade = 0.08): void {
    window.clearTimeout(this.killTimer);
    const t = now();
    // still fading out from a stop()? keep those oscillators and turn back up
    if (this.oscs.length === 0) {
      for (let i = 0; i < this.n; i++) {
        const o = ctx().createOscillator();
        if (this.usePhase) o.setPeriodicWave(this.wave(this.phases[i]));
        o.frequency.value = this.freqs[i];
        const g = ctx().createGain();
        g.gain.value = this.amps[i];
        o.connect(g).connect(this.out);
        this.oscs.push(o);
        this.gains.push(g);
      }
      for (const o of this.oscs) o.start(t);
    } else {
      for (let i = 0; i < this.n; i++) {
        this.setParam(this.oscs[i].frequency, this.freqs[i], t, 0.01);
        this.setParam(this.gains[i].gain, this.amps[i], t, 0.01);
      }
    }
    this.live = true;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(this.level, t, fade / 3);
  }

  stop(fade = 0.12): void {
    if (!this.live) return;
    this.live = false;
    const t = now();
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, fade / 3);
    window.clearTimeout(this.killTimer);
    this.killTimer = window.setTimeout(() => {
      if (!this.live) this.teardown();
    }, fade * 1000 * 2.5 + 60);
  }

  private teardown(): void {
    for (const o of this.oscs) {
      try {
        o.stop();
      } catch {
        /* never started */
      }
      o.disconnect();
    }
    for (const g of this.gains) g.disconnect();
    this.oscs = [];
    this.gains = [];
  }

  // The live gain of partial i (null while silent), for custom envelopes.
  gainParam(i: number): AudioParam | null {
    return this.live && this.gains[i] ? this.gains[i].gain : null;
  }

  setLevel(v: number, glide = 0.05): void {
    this.level = v;
    if (this.live) this.out.gain.setTargetAtTime(v, now(), glide / 3);
  }

  // Update stored values; ramps the live oscillators if sounding.
  set(freqs: ArrayLike<number> | null, amps: ArrayLike<number> | null, glide = 0.03): void {
    const t = now();
    for (let i = 0; i < this.n; i++) {
      if (freqs) this.freqs[i] = freqs[i];
      if (amps) this.amps[i] = amps[i];
      if (this.live && this.oscs[i]) {
        if (freqs) this.setParam(this.oscs[i].frequency, this.freqs[i], t, glide);
        if (amps) this.setParam(this.gains[i].gain, this.amps[i], t, glide);
      }
    }
  }

  // Same, but lands exactly at an AudioContext time (for sequenced notes).
  setAt(time: number, freqs: ArrayLike<number> | null, amps: ArrayLike<number> | null): void {
    for (let i = 0; i < this.n; i++) {
      if (freqs) this.freqs[i] = freqs[i];
      if (amps) this.amps[i] = amps[i];
      if (this.live && this.oscs[i]) {
        if (freqs) this.oscs[i].frequency.setValueAtTime(this.freqs[i], time);
        if (amps) this.gains[i].gain.setTargetAtTime(this.amps[i], time, 0.004);
      }
    }
  }

  // Envelope on the bank's output, for sequenced notes.
  envAt(time: number, peak: number, attack: number, hold: number, release: number): void {
    const g = this.out.gain;
    g.cancelScheduledValues(time);
    g.setTargetAtTime(peak, time, attack / 3);
    g.setTargetAtTime(0, time + hold, release / 3);
  }

  // New phases: dip the output, swap each oscillator's wave, come back up.
  setPhases(phases: ArrayLike<number>): void {
    for (let i = 0; i < this.n; i++) this.phases[i] = phases[i];
    if (!this.live || !this.usePhase) return;
    const t = now();
    const g = this.out.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0, t, 0.006);
    window.setTimeout(() => {
      if (!this.live) return;
      // restart every oscillator on one shared sample so the new phases hold
      const t2 = now() + 0.01;
      const old = this.oscs;
      this.oscs = [];
      old.forEach((o, i) => {
        const fresh = ctx().createOscillator();
        fresh.setPeriodicWave(this.wave(this.phases[i]));
        fresh.frequency.value = this.freqs[i];
        fresh.connect(this.gains[i]);
        fresh.start(t2);
        o.stop(t2);
        this.oscs.push(fresh);
      });
      g.setTargetAtTime(this.level, t2 + 0.005, 0.01);
    }, 40);
  }

  private setParam(p: AudioParam, v: number, t: number, glide: number): void {
    p.cancelScheduledValues(t);
    if (glide <= 0) p.setValueAtTime(v, t);
    else p.setTargetAtTime(v, t, glide / 3);
  }

  dispose(): void {
    this.stop(0.05);
  }
}

// ---- struck / plucked one-shots ---------------------------------------------

export interface Mode {
  f: number; // Hz
  a: number; // peak amplitude (sign allowed)
  tau: number; // decay time constant, s (amplitude falls by e each tau)
}

const strikes = new Set<{ out: GainNode; until: number }>();

// Modal synthesis: one decaying sine per mode, all starting on one sample.
// Returns the time the strike started.
export function strike(modes: Mode[], opts: { when?: number; gain?: number; attack?: number; to?: AudioNode } = {}): number {
  const c = ctx();
  const t = opts.when ?? now();
  const att = opts.attack ?? 0.004;
  const out = c.createGain();
  out.gain.value = opts.gain ?? 1;
  out.connect(opts.to ?? dest());
  let until = t;
  for (const m of modes) {
    if (m.f <= 20 || m.f >= 16000 || Math.abs(m.a) < 1e-5) continue;
    const o = c.createOscillator();
    o.frequency.value = m.f;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(m.a, t + att);
    g.gain.setTargetAtTime(0, t + att, m.tau);
    o.connect(g).connect(out);
    const end = t + att + m.tau * 8;
    o.start(t);
    o.stop(end);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
    until = Math.max(until, end);
  }
  const rec = { out, until };
  strikes.add(rec);
  window.setTimeout(
    () => {
      strikes.delete(rec);
      out.disconnect();
    },
    (until - Tone.getContext().currentTime) * 1000 + 300,
  );
  return t;
}

// Damp every ringing strike quickly (scrolled away, or a "stop" button).
export function damp(fade = 0.08): void {
  const t = now();
  for (const s of strikes) {
    s.out.gain.cancelScheduledValues(t);
    s.out.gain.setTargetAtTime(0, t, fade / 3);
  }
}

// ---- small math helpers ------------------------------------------------------

export const NOTE = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

// Nearest equal-tempered note and cent offset, e.g. { name: "G5", cents: -31 }.
export function nearestNote(f: number): { midi: number; name: string; cents: number } {
  const m = 69 + 12 * Math.log2(f / 440);
  const midi = Math.round(m);
  const name = `${NOTE[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  return { midi, name, cents: Math.round((m - midi) * 100) };
}

export function noteLabel(f: number): string {
  const n = nearestNote(f);
  if (n.cents === 0) return n.name;
  return `${n.name} ${n.cents > 0 ? "+" : "−"}${Math.abs(n.cents)}¢`;
}

export function fmtHz(f: number): string {
  return f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 1 : 2)} kHz` : `${f < 100 ? f.toFixed(1) : Math.round(f)} Hz`;
}

// Plomp–Levelt roughness of two partials, in Sethares' parameterization
// (the constants and the min-amplitude weighting from his dissmeasure code).
export function roughness(f1: number, a1: number, f2: number, a2: number): number {
  const lo = Math.min(f1, f2);
  const s = 0.24 / (0.0207 * lo + 18.96);
  const x = s * Math.abs(f2 - f1);
  return Math.min(a1, a2) * (Math.exp(-3.51 * x) - Math.exp(-5.75 * x));
}

// Total roughness between two tones given as partial lists (the within-tone
// pairs are left out: they don't change with the interval).
export function dyadRoughness(fa: ArrayLike<number>, aa: ArrayLike<number>, fb: ArrayLike<number>, ab: ArrayLike<number>): number {
  let r = 0;
  for (let i = 0; i < fa.length; i++) {
    for (let j = 0; j < fb.length; j++) r += roughness(fa[i], aa[i], fb[j], ab[j]);
  }
  return r;
}

// Best small-integer ratio p/q (q ≤ maxQ) within `tolCents`, or null.
export function simpleRatio(r: number, maxQ = 16, tolCents = 6): { p: number; q: number; off: number } | null {
  let best: { p: number; q: number; off: number } | null = null;
  for (let q = 1; q <= maxQ; q++) {
    const p = Math.round(r * q);
    if (p < 1) continue;
    const off = 1200 * Math.log2(r / (p / q));
    if (Math.abs(off) <= tolCents && (!best || p + q < best.p + best.q)) best = { p, q, off };
  }
  if (best) {
    const g = gcd(best.p, best.q);
    best.p /= g;
    best.q /= g;
  }
  return best;
}

export function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

// ---- interval names -------------------------------------------------------------

export const JUST: { p: number; q: number; name: string }[] = [
  { p: 1, q: 1, name: "unison" },
  { p: 16, q: 15, name: "minor second" },
  { p: 9, q: 8, name: "major second" },
  { p: 7, q: 6, name: "septimal minor third" },
  { p: 6, q: 5, name: "minor third" },
  { p: 5, q: 4, name: "major third" },
  { p: 4, q: 3, name: "perfect fourth" },
  { p: 7, q: 5, name: "septimal tritone" },
  { p: 45, q: 32, name: "tritone" },
  { p: 3, q: 2, name: "perfect fifth" },
  { p: 8, q: 5, name: "minor sixth" },
  { p: 5, q: 3, name: "major sixth" },
  { p: 7, q: 4, name: "harmonic seventh" },
  { p: 9, q: 5, name: "minor seventh" },
  { p: 15, q: 8, name: "major seventh" },
  { p: 2, q: 1, name: "octave" },
];

const ET_NAMES = [
  "unison",
  "minor second",
  "major second",
  "minor third",
  "major third",
  "perfect fourth",
  "tritone",
  "perfect fifth",
  "minor sixth",
  "major sixth",
  "minor seventh",
  "major seventh",
  "octave",
];

// The just interval within `tol` cents of a ratio, if there is one.
export function justNear(r: number, tol = 8): { p: number; q: number; name: string; off: number } | null {
  let best: { p: number; q: number; name: string; off: number } | null = null;
  for (const j of JUST) {
    const off = 1200 * Math.log2(r / (j.p / j.q));
    if (Math.abs(off) <= tol && (!best || Math.abs(off) < Math.abs(best.off))) best = { ...j, off };
  }
  return best;
}

// "a fifth", "an octave"
export function withArticle(name: string): string {
  return `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
}

// Nearest equal-tempered interval name and the cents away from it.
export function etNear(r: number): { semis: number; name: string; off: number } {
  const c = 1200 * Math.log2(r);
  const semis = Math.round(c / 100);
  return { semis, name: ET_NAMES[Math.max(0, Math.min(12, semis))] ?? `${semis} semitones`, off: c - semis * 100 };
}
