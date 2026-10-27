// Main-thread signal math for the synthesizer figures. The oscillators here
// are line-for-line copies of the ones in synth.worklet.js, so an offline FFT
// of them shows what the speaker is getting. Everything else is the analytic
// side: harmonic recipes, the ladder's response, envelope curves, Bessel
// functions for FM, and string tuning.

export const TAU = Math.PI * 2;

export function midiHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function hzMidi(f: number): number {
  return 69 + 12 * Math.log2(f / 440);
}

const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
export function noteName(m: number): string {
  const r = Math.round(m);
  return `${NAMES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`;
}

export function fmtHz(f: number): string {
  if (f >= 10000) return `${(f / 1000).toFixed(1)} kHz`;
  if (f >= 1000) return `${(f / 1000).toFixed(2)} kHz`;
  if (f >= 100) return `${Math.round(f)} Hz`;
  return `${f.toFixed(1)} Hz`;
}

export function fmtTime(s: number): string {
  if (s < 1) return `${Math.round(s * 1000)} ms`;
  return `${s.toFixed(s < 10 ? 2 : 1)} s`;
}

export const db = (a: number): number => 20 * Math.log10(Math.max(a, 1e-12));

// ---------------------------------------------------------------- oscillators

export type Wave = 0 | 1 | 2 | 3; // sine, triangle, saw, pulse
export const WAVE_NAMES = ["sine", "triangle", "saw", "pulse"];

export function polyblep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

export function polyblamp(t: number, dt: number): number {
  if (t < dt) {
    const x = 1 - t / dt;
    return (x * x * x) / 6;
  }
  if (t > 1 - dt) {
    const x = 1 + (t - 1) / dt;
    return (x * x * x) / 6;
  }
  return 0;
}

export function oscNaive(wave: number, t: number, pw: number): number {
  switch (wave) {
    case 0:
      return Math.sin(TAU * t);
    case 1:
      return t < 0.5 ? 4 * t - 1 : 3 - 4 * t;
    case 2:
      return 2 * t - 1;
    default:
      return t < pw ? 1 : -1;
  }
}

export function oscBlep(wave: number, t: number, dt: number, pw: number): number {
  switch (wave) {
    case 0:
      return Math.sin(TAU * t);
    case 1: {
      let v = t < 0.5 ? 4 * t - 1 : 3 - 4 * t;
      let t2 = t + 0.5;
      if (t2 >= 1) t2 -= 1;
      v += 8 * dt * (polyblamp(t, dt) - polyblamp(t2, dt));
      return v;
    }
    case 2:
      return 2 * t - 1 - polyblep(t, dt);
    default: {
      let v = t < pw ? 1 : -1;
      let t2 = t - pw;
      if (t2 < 0) t2 += 1;
      v += polyblep(t, dt) - polyblep(t2, dt);
      return v;
    }
  }
}

export function oscAdditive(wave: number, t: number, f: number, sr: number): number {
  const K = Math.floor((0.5 * sr) / Math.max(f, 1));
  if (wave === 0 || K < 2) return Math.sin(TAU * t);
  const th = TAU * t;
  const c2 = 2 * Math.cos(th);
  if (wave === 1) {
    let cPrev = 1;
    let c = Math.cos(th);
    let sum = 0;
    for (let k = 1; k <= K; k++) {
      if (k & 1) sum += c / (k * k);
      const n = c2 * c - cPrev;
      cPrev = c;
      c = n;
    }
    return (-8 / (Math.PI * Math.PI)) * sum;
  }
  let sPrev = 0;
  let s = Math.sin(th);
  let sum = 0;
  if (wave === 2) {
    for (let k = 1; k <= K; k++) {
      sum += s / k;
      const n = c2 * s - sPrev;
      sPrev = s;
      s = n;
    }
    return (-2 / Math.PI) * sum;
  }
  for (let k = 1; k <= K; k++) {
    if (k & 1) sum += s / k;
    const n = c2 * s - sPrev;
    sPrev = s;
    s = n;
  }
  return (4 / Math.PI) * sum;
}

/** Render `n` samples of one oscillator at a fixed or swept frequency. */
export function renderOsc(
  wave: number,
  aa: number,
  freq: (i: number) => number,
  n: number,
  sr: number,
  pw = 0.5,
): Float32Array {
  const out = new Float32Array(n);
  let t = 0;
  for (let i = 0; i < n; i++) {
    const f = freq(i);
    const dt = Math.min(f / sr, 0.49);
    t += dt;
    if (t >= 1) t -= 1;
    out[i] = aa === 0 ? oscNaive(wave, t, pw) : aa === 2 ? oscAdditive(wave, t, f, sr) : oscBlep(wave, t, dt, pw);
  }
  return out;
}

/**
 * Amplitude of harmonic n of an ideal shape whose peak is ±1. Pulses with
 * duty d lose every harmonic where sin(πnd) = 0: with d = 1/3, every third.
 */
export function harmonicAmp(wave: number, n: number, pw = 0.5): number {
  switch (wave) {
    case 0:
      return n === 1 ? 1 : 0;
    case 1:
      return n & 1 ? 8 / (Math.PI * Math.PI * n * n) : 0;
    case 2:
      return 2 / (Math.PI * n);
    default:
      return Math.abs((4 / (Math.PI * n)) * Math.sin(Math.PI * n * pw));
  }
}

// ---------------------------------------------------------------- FFT

export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const br = re[b] * cr - im[b] * ci;
        const bi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - br;
        im[b] = im[a] - bi;
        re[a] += br;
        im[a] += bi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

const windows = new Map<number, Float64Array>();
function blackmanHarris(n: number): Float64Array {
  let w = windows.get(n);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      w[i] =
        0.35875 - 0.48829 * Math.cos(TAU * t) + 0.14128 * Math.cos(2 * TAU * t) - 0.01168 * Math.cos(3 * TAU * t);
    }
    windows.set(n, w);
  }
  return w;
}

/**
 * Blackman–Harris magnitude spectrum, scaled so a sine of amplitude A peaks
 * at A. Sidelobes sit near −92 dB, far below any alias worth showing.
 */
export function magSpectrum(x: ArrayLike<number>, start: number, n: number, out?: Float32Array): Float32Array {
  const w = blackmanHarris(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let ws = 0;
  for (let i = 0; i < n; i++) {
    re[i] = (x[start + i] ?? 0) * w[i];
    ws += w[i];
  }
  fft(re, im);
  const mag = out ?? new Float32Array(n >> 1);
  for (let k = 0; k < n >> 1; k++) mag[k] = (2 * Math.hypot(re[k], im[k])) / ws;
  return mag;
}

// ---------------------------------------------------------------- the ladder

/**
 * Small-signal magnitude response of the engine's 4-pole ladder, tapped after
 * `poles` stages, at frequency f. The zero-delay-feedback filter is exactly
 * the bilinear transform of the analog ladder with the cutoff prewarped, so
 * each stage is 1 / (1 + j·tan(πf/fs)/tan(πfc/fs)).
 */
export function ladderMag(f: number, fc: number, k: number, poles: number, sr: number): number {
  const g = Math.tan((Math.PI * Math.min(fc, sr * 0.46)) / sr);
  const t = Math.tan((Math.PI * Math.min(f, sr * 0.4999)) / sr);
  const x = t / g;
  // G = 1/(1 + jx) = (1 − jx)/(1 + x²)
  const d = 1 + x * x;
  const Gr = 1 / d;
  const Gi = -x / d;
  let pr = 1;
  let pi = 0;
  let qr = 1;
  let qi = 0;
  for (let i = 0; i < 4; i++) {
    const nr = qr * Gr - qi * Gi;
    qi = qr * Gi + qi * Gr;
    qr = nr;
    if (i < poles) {
      const mr = pr * Gr - pi * Gi;
      pi = pr * Gi + pi * Gr;
      pr = mr;
    }
  }
  const Dr = 1 + k * qr;
  const Di = k * qi;
  return (Math.hypot(pr, pi) / Math.hypot(Dr, Di)) * (1 + 0.5 * k);
}

// ---------------------------------------------------------------- envelopes

export interface Adsr {
  a: number;
  d: number;
  s: number;
  r: number;
}

/** Level of the engine's envelope `t` seconds into a stage (from `from`). */
export function attackLevel(t: number, a: number, from = 0): number {
  const tau = Math.max(a, 0.0005) / Math.log(3);
  return Math.min(1, 1.5 - (1.5 - from) * Math.exp(-t / tau));
}
export function decayLevel(t: number, d: number, s: number, from = 1): number {
  return s + (from - s) * Math.exp((-Math.log(1000) * t) / Math.max(d, 0.001));
}
export function releaseLevel(t: number, r: number, from: number): number {
  return from * Math.exp((-Math.log(1000) * t) / Math.max(r, 0.002));
}

// ---------------------------------------------------------------- FM

/** Bessel function of the first kind, J_n(x), by Bessel's integral. */
export function besselJ(n: number, x: number): number {
  const M = 256;
  let s = 0;
  for (let i = 0; i <= M; i++) {
    const t = (Math.PI * i) / M;
    const w = i === 0 || i === M ? 0.5 : 1;
    s += w * Math.cos(n * t - x * Math.sin(t));
  }
  return s / M;
}

export interface FmLine {
  f: number; // Hz, ≥ 0
  amp: number; // signed: components that land together add
  n: number; // sideband order of the strongest contributor
  reflected: boolean;
}

/**
 * The line spectrum of sin(2π·fc·t + I·sin(2π·fm·t)) = Σ J_n(I)·sin(2π(fc + n·fm)t).
 * Negative frequencies fold back with their sign flipped, and anything that
 * lands on the same frequency adds.
 */
export function fmLines(fc: number, fm: number, I: number, maxN = 30): FmLine[] {
  const map = new Map<number, FmLine>();
  for (let n = -maxN; n <= maxN; n++) {
    let f = fc + n * fm;
    let a = besselJ(n, I);
    let refl = false;
    if (f < 0) {
      f = -f;
      a = -a;
      refl = true;
    }
    if (f < 1e-6) continue; // sin(0·t) = 0: a component at DC carries nothing
    const key = Math.round(f * 100);
    const prev = map.get(key);
    if (prev) {
      prev.amp += a;
      if (Math.abs(a) > Math.abs(prev.amp - a)) {
        prev.n = n;
        prev.reflected = refl;
      }
    } else map.set(key, { f, amp: a, n, reflected: refl });
  }
  return [...map.values()].sort((p, q) => p.f - q.f);
}

// ---------------------------------------------------------------- strings

export interface StringTune {
  D: number; // ideal loop length, samples
  N: number; // integer delay
  P1: number; // loop filter phase delay at f0
  frac: number; // allpass delay at f0
  C: number; // allpass coefficient
  errCents: number; // tuning error with integer delay only
  rho: number; // loop gain for the requested decay
}

/** Same arithmetic as tuneString() in the worklet. */
export function tuneString(f: number, sr: number, stretch: number, frac: boolean, decay = 30): StringTune {
  const w = 1 / (2 * Math.max(1, stretch));
  const D = sr / f;
  const om = (TAU * f) / sr;
  const P1 = Math.atan2(w * Math.sin(om), 1 - w + w * Math.cos(om)) / om;
  const g1 = Math.hypot(1 - w + w * Math.cos(om), w * Math.sin(om));
  const rho = decay >= 30 ? 1 : Math.min(1, Math.pow(0.001, 1 / (decay * f)) / g1);
  if (frac) {
    const N = Math.max(2, Math.floor(D - P1 - 0.1));
    const d = D - P1 - N;
    const C = Math.sin((om * (1 - d)) / 2) / Math.sin((om * (1 + d)) / 2);
    return { D, N, P1, frac: d, C, errCents: 0, rho };
  }
  const N = Math.max(2, Math.round(D - P1));
  return { D, N, P1, frac: 0, C: 0, errCents: 1200 * Math.log2(D / (N + P1)), rho };
}

/** Seconds for harmonic n of the string to fall 60 dB. */
export function stringT60(f: number, n: number, sr: number, stretch: number, rho: number): number {
  const w = 1 / (2 * Math.max(1, stretch));
  const om = (TAU * f * n) / sr;
  const g = rho * Math.sqrt((1 - w) * (1 - w) + w * w + 2 * w * (1 - w) * Math.cos(om));
  if (g >= 1) return Infinity;
  const periods = Math.log(0.001) / Math.log(g);
  return periods / f;
}

// ---------------------------------------------------------------- misc

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Map a frequency to [0,1] on a log axis. */
export function logX(f: number, lo: number, hi: number): number {
  return Math.log(f / lo) / Math.log(hi / lo);
}
export function logF(x: number, lo: number, hi: number): number {
  return lo * Math.pow(hi / lo, x);
}

// ---------------------------------------------------------------- scopes

/** Phase φ of the f0 component, with x[i] ≈ A·cos(2π·f0·i/sr + φ). */
export function fundamentalPhase(x: ArrayLike<number>, sr: number, f0: number, start: number, len: number): number {
  let re = 0;
  let im = 0;
  const w = (TAU * f0) / sr;
  for (let i = 0; i < len; i++) {
    const v = x[start + i];
    re += v * Math.cos(w * i);
    im -= v * Math.sin(w * i);
  }
  return Math.atan2(im, re);
}

/**
 * Resample `cycles` periods of a live buffer into `out`, starting where the
 * fundamental's phase equals `phaseRef` (the ideal shape's), so a live trace
 * lands on top of the drawn one. Returns false if the buffer is too short.
 */
export function alignPeriods(x: Float32Array, sr: number, f0: number, cycles: number, phaseRef: number, out: Float32Array): boolean {
  const P = sr / f0;
  const span = cycles * P;
  const n = x.length;
  if (span + 2 > n) return false;
  // measure the phase over a whole number of periods at the end of the buffer
  const periods = Math.max(1, Math.floor((n - 1) / P));
  const len = Math.floor(periods * P);
  const st = n - len;
  const phi = fundamentalPhase(x, sr, f0, st, len);
  let frac = (phaseRef - phi) / TAU;
  frac -= Math.floor(frac);
  let s = st + frac * P; // the fundamental's phase here equals phaseRef
  const sEnd = n - span - 2;
  if (s > sEnd) s -= Math.ceil((s - sEnd) / P) * P;
  else s += Math.floor((sEnd - s) / P) * P;
  if (s < 0) return false;
  const m = out.length;
  for (let i = 0; i < m; i++) {
    const p = s + (i / (m - 1)) * span;
    const i0 = Math.floor(p);
    const f = p - i0;
    out[i] = x[i0] * (1 - f) + x[i0 + 1] * f;
  }
  return true;
}

/** Phase of an ideal shape's fundamental, in the same convention. */
export function shapePhase(shape: (t: number) => number): number {
  const N = 512;
  let re = 0;
  let im = 0;
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const v = shape(t);
    re += v * Math.cos(TAU * t);
    im -= v * Math.sin(TAU * t);
  }
  return Math.atan2(im, re);
}

/** dB at frequency f from analyser data (max over ±w bins). */
export function binDb(data: Float32Array, f: number, binHz: number, w = 2): number {
  const b = Math.round(f / binHz);
  let m = -200;
  for (let k = Math.max(0, b - w); k <= Math.min(data.length - 1, b + w); k++) if (data[k] > m) m = data[k];
  return m;
}
