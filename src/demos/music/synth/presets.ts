// Presets for the final instrument (Fig. "The whole instrument"). Plain data
// so they can be checked offline against the engine.

import type { DeepPartial, Patch } from "./engine";

export interface Preset {
  name: string;
  info: string;
  patch: DeepPartial<Patch>;
  fx: { chorus: number; delay: number; reverb: number };
  /** what the play button performs: [note, start s, length s] */
  riff: [number, number, number][];
}

const env = (a: number, d: number, s: number, r: number) => ({ a, d, s, r });
const op = (ratio: number, lvl: number, a: number, d: number, s: number, r: number, det = 0) => ({ ratio, det, lvl, a, d, s, r });
const chord = (notes: number[], at: number, len: number): [number, number, number][] => notes.map((n) => [n, at, len]);

export const PRESETS: Preset[] = [
  {
    name: "bass",
    info: "mono saw + square two octaves down, resonant 24 dB filter snapped open by its envelope, glide between held notes",
    patch: {
      mode: 0,
      poly: 1,
      glide: 0.06,
      o1: { wave: 2, oct: -1, lvl: 0.9 },
      o2: { wave: 3, pw: 0.5, oct: -2, lvl: 0.55, det: 0 },
      flt: { cut: 150, res: 2.6, poles: 4, env: 3.6, key: 0.4 },
      e1: env(0.003, 0.4, 0.85, 0.12),
      e2: env(0.002, 0.32, 0.1, 0.15),
      velAmt: 0.5,
      gain: 1.1,
    },
    fx: { chorus: 0, delay: 0, reverb: 0.06 },
    riff: [
      [36, 0, 0.2],
      [36, 0.3, 0.12],
      [48, 0.45, 0.2],
      [43, 0.75, 0.45],
      [46, 1.05, 0.3],
    ],
  },
  {
    name: "brass",
    info: "two saws 12 cents apart; the filter envelope's slower attack makes the note get brighter as it speaks",
    patch: {
      mode: 0,
      poly: 6,
      o1: { wave: 2, det: -6, lvl: 0.8 },
      o2: { wave: 2, det: 6, lvl: 0.8 },
      flt: { cut: 380, res: 0.8, poles: 4, env: 3, key: 0.5 },
      e1: env(0.04, 0.5, 0.8, 0.25),
      e2: env(0.09, 0.8, 0.5, 0.3),
      lfo: { wave: 0, rate: 5.5, pitch: 5 },
      gain: 0.75,
    },
    fx: { chorus: 0.15, delay: 0, reverb: 0.25 },
    riff: [...chord([55, 60, 64], 0, 0.9), ...chord([57, 62, 65], 1.0, 1.2)],
  },
  {
    name: "strings",
    info: "detuned saws, slow attack and release, a gentle filter, chorus and a lot of reverb",
    patch: {
      mode: 0,
      poly: 8,
      o1: { wave: 2, det: -9, lvl: 0.7 },
      o2: { wave: 2, det: 9, lvl: 0.7 },
      flt: { cut: 2200, res: 0.3, poles: 2, env: 0.6, key: 0.4 },
      e1: env(0.45, 1, 0.85, 1.4),
      e2: env(0.7, 1.5, 0.6, 1.4),
      lfo: { wave: 0, rate: 5, pitch: 6 },
      gain: 0.6,
    },
    fx: { chorus: 0.6, delay: 0, reverb: 0.45 },
    riff: [...chord([48, 55, 64], 0, 1.6), ...chord([53, 57, 65], 1.5, 1.8)],
  },
  {
    name: "lead",
    info: "mono pulse + saw with glide; a slow LFO sweeps the pulse width, the mod wheel adds vibrato",
    patch: {
      mode: 0,
      poly: 1,
      glide: 0.08,
      o1: { wave: 3, pw: 0.35, lvl: 0.8 },
      o2: { wave: 2, det: 8, lvl: 0.45 },
      flt: { cut: 900, res: 1.6, poles: 4, env: 2, key: 0.6 },
      e1: env(0.005, 0.3, 0.9, 0.2),
      e2: env(0.005, 0.6, 0.45, 0.3),
      lfo: { wave: 1, rate: 0.6, pw: 0.15 },
      gain: 0.85,
    },
    fx: { chorus: 0, delay: 0.25, reverb: 0.2 },
    riff: [
      [67, 0, 0.3],
      [70, 0.25, 0.3],
      [72, 0.5, 0.9],
      [70, 1.3, 0.2],
      [67, 1.5, 0.6],
    ],
  },
  {
    name: "whistle",
    info: "noise only, through a filter set just below self-oscillation; full keyboard tracking puts the ringing peak on the note",
    patch: {
      mode: 0,
      poly: 4,
      o1: { lvl: 0 },
      o2: { lvl: 0 },
      noise: 0.8,
      flt: { cut: 262, res: 3.7, poles: 4, env: 0.4, key: 1 },
      e1: env(0.18, 0.5, 0.9, 0.7),
      e2: env(0.2, 0.8, 0.3, 0.6),
      lfo: { wave: 4, rate: 3, cut: 0.04 },
      gain: 2,
    },
    fx: { chorus: 0, delay: 0.2, reverb: 0.4 },
    riff: [
      [72, 0, 0.6],
      [76, 0.6, 0.6],
      [79, 1.2, 1.1],
    ],
  },
  {
    name: "e. piano",
    info: "FM, two operator pairs: a 1:1 pair for the body and a 14:1 pair with a very short index envelope for the metallic tine",
    patch: {
      mode: 1,
      poly: 10,
      keyScale: 0.5,
      velAmt: 0.6,
      gain: 0.9,
      fm: {
        alg: 1,
        fb: 0,
        velIdx: 0.7,
        ops: [op(1, 0.75, 0.001, 4, 0, 0.5), op(1, 1.3, 0.001, 2, 0.1, 0.5), op(1, 0.3, 0.001, 1.2, 0, 0.3, 0.6), op(14, 1.6, 0.001, 0.25, 0, 0.2)],
      },
    },
    fx: { chorus: 0.35, delay: 0, reverb: 0.25 },
    riff: [...chord([52, 59, 64, 67], 0, 1.4), ...chord([50, 57, 62, 65], 1.3, 1.6)],
  },
  {
    name: "bell",
    info: "FM at 1 : 1.4, so the partials aren't harmonic; the index decays with the note, and the spectrum thins out as it rings",
    patch: {
      mode: 1,
      poly: 10,
      keyScale: 0.4,
      gain: 1.1,
      fm: { alg: 0, fb: 0, velIdx: 0.4, ops: [op(1, 0.8, 0.001, 7, 0, 3), op(1.4, 6, 0.001, 6, 0, 3), op(1, 0, 0.005, 1, 0, 0.3), op(1, 0, 0.005, 1, 0, 0.3)] },
    },
    fx: { chorus: 0, delay: 0, reverb: 0.4 },
    riff: [
      [67, 0, 0.5],
      [72, 0.5, 0.5],
      [79, 1.0, 1.5],
    ],
  },
  {
    name: "FM bass",
    info: "a three-operator stack, 3 → 2 → 1, with feedback on the top operator: a fast index decay makes the pluck",
    patch: {
      mode: 1,
      poly: 4,
      gain: 1.3,
      fm: { alg: 2, fb: 1.1, velIdx: 0.6, ops: [op(1, 0.9, 0.001, 1.2, 0.5, 0.15), op(1, 2.2, 0.001, 0.45, 0.25, 0.15), op(1, 1, 0.001, 0.3, 0, 0.15), op(1, 0, 0.005, 1, 0, 0.3)] },
    },
    fx: { chorus: 0, delay: 0, reverb: 0.05 },
    riff: [
      [36, 0, 0.2],
      [36, 0.25, 0.2],
      [39, 0.5, 0.2],
      [41, 0.75, 0.3],
      [43, 1.1, 0.4],
    ],
  },
  {
    name: "guitar",
    info: "Karplus–Strong: a noise burst in a tuned delay line, averaged a little on every trip round",
    patch: { mode: 2, poly: 8, velAmt: 0.4, gain: 1.7, e1: env(0.001, 0.1, 1, 0.9), ks: { stretch: 1, decay: 6, bright: 0.8, pick: 0.14, blend: 1, frac: 1 } },
    fx: { chorus: 0.1, delay: 0, reverb: 0.2 },
    riff: [
      [40, 0, 1.6],
      [47, 0.12, 1.5],
      [52, 0.24, 1.4],
      [55, 0.36, 1.3],
      [59, 0.48, 1.2],
      [64, 0.6, 1.1],
    ],
  },
  {
    name: "harp",
    info: "the same string with a softer pluck near the middle and a stretched decay, so the highs die slowly too",
    patch: { mode: 2, poly: 8, velAmt: 0.4, gain: 1.5, e1: env(0.001, 0.1, 1, 2.5), ks: { stretch: 2.5, decay: 4, bright: 0.35, pick: 0.45, blend: 1, frac: 1 } },
    fx: { chorus: 0, delay: 0.15, reverb: 0.4 },
    riff: [
      [60, 0, 1],
      [64, 0.2, 1],
      [67, 0.4, 1],
      [72, 0.6, 1],
      [76, 0.8, 1.5],
    ],
  },
];
