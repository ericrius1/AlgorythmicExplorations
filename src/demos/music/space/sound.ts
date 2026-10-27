// Sounds for the room figures, synthesized in code: a hand clap, a click, a
// short mallet phrase, and a vowel-ish voice. Plus a safe output chain and a
// helper that plays a dry sound through an impulse response.

import { Tone, masterBus } from "../../../lib/audio";

let out: Tone.Gain | null = null;

// Everything from these figures goes through a compressor and a limiter.
export function spaceOut(): Tone.Gain {
  if (!out) {
    const limiter = new Tone.Limiter(-2).connect(masterBus());
    const comp = new Tone.Compressor({ threshold: -18, ratio: 3, attack: 0.005, release: 0.25 }).connect(limiter);
    out = new Tone.Gain(0.9).connect(comp);
  }
  return out;
}

export function rawCtx(): AudioContext {
  return Tone.getContext().rawContext as AudioContext;
}

export function sampleRate(): number {
  return rawCtx().sampleRate;
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

function onePoleHP(x: Float32Array, fc: number, fs: number): void {
  const a = Math.exp((-2 * Math.PI * fc) / fs);
  let prevX = 0;
  let prevY = 0;
  for (let i = 0; i < x.length; i++) {
    const y = a * (prevY + x[i] - prevX);
    prevX = x[i];
    prevY = y;
    x[i] = y;
  }
}

function resonate(x: Float32Array, f: number, bw: number, fs: number): Float32Array {
  // two-pole resonator
  const r = Math.exp((-Math.PI * bw) / fs);
  const c = 2 * r * Math.cos((2 * Math.PI * f) / fs);
  const y = new Float32Array(x.length);
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i] * (1 - r) + c * y1 - r * r * y2;
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

function normalize(x: Float32Array, peak: number): Float32Array {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m;
  return x;
}

// A clap: a few quick bursts of noise (fingers meeting at slightly different
// times), coloured by the cupped hands' resonance around 1 kHz.
export function clapSamples(fs: number, seed = 3): Float32Array {
  const n = Math.floor(fs * 0.18);
  const x = new Float32Array(n);
  const rnd = rng(seed);
  const bursts = [0, 0.0045, 0.0095];
  for (const [k, t0] of bursts.entries()) {
    const s0 = Math.floor(t0 * fs);
    const amp = k === bursts.length - 1 ? 1 : 0.55;
    const tau = k === bursts.length - 1 ? 0.022 : 0.003;
    for (let i = s0; i < n; i++) x[i] += amp * rnd() * Math.exp(-(i - s0) / fs / tau);
  }
  const body = resonate(x, 1100, 900, fs);
  for (let i = 0; i < n; i++) x[i] = 0.5 * x[i] + 3 * body[i];
  onePoleHP(x, 300, fs);
  return normalize(x, 0.7);
}

export function clickSamples(fs: number): Float32Array {
  const n = Math.floor(fs * 0.01);
  const x = new Float32Array(n);
  const rnd = rng(9);
  for (let i = 0; i < n; i++) x[i] = rnd() * Math.exp(-i / (fs * 0.0012));
  onePoleHP(x, 200, fs);
  return normalize(x, 0.6);
}

// A short mallet phrase: each note is a tuned bar (fundamental plus the
// overtone two octaves up), dying away on its own.
export function malletPhrase(fs: number, notes: [number, number][] = [[72, 0], [76, 0.28], [79, 0.56], [84, 0.84], [79, 1.4], [76, 1.68], [72, 1.96]]): Float32Array {
  const end = notes[notes.length - 1][1] + 1.2;
  const x = new Float32Array(Math.floor(end * fs));
  for (const [m, t] of notes) {
    const f = 440 * Math.pow(2, (m - 69) / 12);
    const s0 = Math.floor(t * fs);
    for (let i = 0; i < x.length - s0; i++) {
      const tt = i / fs;
      const att = Math.min(1, tt / 0.002);
      const v =
        Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt / 0.45) +
        0.35 * Math.sin(2 * Math.PI * f * 4 * tt) * Math.exp(-tt / 0.08);
      x[s0 + i] += att * v * 0.5;
    }
  }
  return normalize(x, 0.6);
}

// A vowel-ish voice: a buzzy pulse train at speaking pitch through three
// formant resonances that move from vowel to vowel. Not words, but it has the
// broad, shifting spectrum of speech, which is what a room colours.
const VOWELS: Record<string, [number, number, number]> = {
  a: [730, 1090, 2440],
  e: [530, 1840, 2480],
  i: [270, 2290, 3010],
  o: [570, 840, 2410],
  u: [300, 870, 2240],
  ae: [660, 1720, 2410],
  er: [490, 1350, 1690],
};

export function voiceSamples(fs: number, syllables: [string, number, number][]): Float32Array {
  // [vowel, start s, duration s]
  const end = syllables.reduce((a, s) => Math.max(a, s[1] + s[2]), 0) + 0.3;
  const n = Math.floor(end * fs);
  const src = new Float32Array(n);
  const env = new Float32Array(n);
  const F = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  // pitch drifts down over the phrase like a spoken sentence
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const f0 = 128 - 22 * (t / end) + 4 * Math.sin(t * 5);
    phase += f0 / fs;
    if (phase >= 1) phase -= 1;
    src[i] = phase < 0.4 ? Math.sin((phase / 0.4) * Math.PI) : 0; // rounded glottal pulse
  }
  for (let k = 0; k < syllables.length; k++) {
    const [v, s, d] = syllables[k];
    const next = syllables[k + 1];
    const fNow = VOWELS[v];
    const fNext = next ? VOWELS[next[0]] : fNow;
    const a = Math.floor(s * fs);
    const b = Math.min(n, Math.floor((s + d) * fs));
    for (let i = a; i < b; i++) {
      const u = (i - a) / (b - a);
      env[i] = Math.min(1, u / 0.12) * Math.min(1, (1 - u) / 0.25);
      const glide = Math.max(0, (u - 0.6) / 0.4);
      for (let j = 0; j < 3; j++) F[j][i] = fNow[j] + (fNext[j] - fNow[j]) * glide * 0.5;
    }
  }
  // time-varying formant filter, updated every 64 samples
  const outp = new Float32Array(n);
  const bws = [80, 100, 140];
  const gains = [1, 0.6, 0.3];
  for (let j = 0; j < 3; j++) {
    let y1 = 0;
    let y2 = 0;
    let r = 0;
    let c = 0;
    for (let i = 0; i < n; i++) {
      if (i % 64 === 0) {
        const f = F[j][i] || 500;
        r = Math.exp((-Math.PI * bws[j]) / fs);
        c = 2 * r * Math.cos((2 * Math.PI * f) / fs);
      }
      const v = src[i] * env[i] * (1 - r) + c * y1 - r * r * y2;
      y2 = y1;
      y1 = v;
      outp[i] += v * gains[j];
    }
  }
  onePoleHP(outp, 90, fs);
  return normalize(outp, 0.6);
}

// "I am sitting in a room": seven syllables, as vowels only.
export function sittingVoice(fs: number): Float32Array {
  return voiceSamples(fs, [
    ["a", 0.05, 0.3],
    ["ae", 0.4, 0.22],
    ["i", 0.68, 0.2],
    ["i", 0.92, 0.22],
    ["i", 1.2, 0.2],
    ["er", 1.45, 0.16],
    ["u", 1.66, 0.55],
  ]);
}

export function toBuffer(ch: Float32Array[], fs: number): AudioBuffer {
  const b = rawCtx().createBuffer(ch.length, ch[0].length, fs);
  ch.forEach((c, i) => b.copyToChannel(c, i));
  return b;
}

// Play a dry sound through an impulse response, once. Returns a stop function.
export function playThrough(dry: AudioBuffer, ir: AudioBuffer | null, dest: Tone.Gain, gain = 1, when = 0): () => void {
  const ctx = rawCtx();
  const src = ctx.createBufferSource();
  src.buffer = dry;
  const g = ctx.createGain();
  g.gain.value = gain;
  let conv: ConvolverNode | null = null;
  if (ir) {
    conv = ctx.createConvolver();
    conv.normalize = false;
    conv.buffer = ir;
    src.connect(conv);
    conv.connect(g);
  } else src.connect(g);
  Tone.connect(g, dest);
  const t = Math.max(ctx.currentTime + 0.01, when);
  src.start(t);
  const tail = (ir ? ir.duration : 0) + dry.duration + 0.2;
  const timer = window.setTimeout(() => {
    g.disconnect();
    conv?.disconnect();
  }, tail * 1000);
  return () => {
    clearTimeout(timer);
    g.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    window.setTimeout(() => {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
      g.disconnect();
      conv?.disconnect();
    }, 200);
  };
}
