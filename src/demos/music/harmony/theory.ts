// Music theory for the chords and jukebox articles: pitch classes, triads,
// minimum-motion voice leading, the Tonnetz and its P/L/R moves, Lerdahl's
// chord distance, chord roughness, Bjorklund's algorithm, and a seeded RNG.
// Pure functions, no audio, so the figures and the band share one source.

import { pairRoughness } from "../../../lib/audio";

export const mod12 = (n: number): number => ((n % 12) + 12) % 12;

// Spellings that read naturally in chord names (major roots lean flat,
// minor roots lean sharp, the way lead sheets usually write them).
const MAJOR_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const MINOR_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"];
export const PC_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

const SHARPS = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLATS = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

// Does this key's signature use flats? (by its relative major)
export function keyUsesFlats(tonic: number, mode: "major" | "minor" | "dorian" | "mixolydian"): boolean {
  const shift = { major: 0, minor: 3, dorian: 10, mixolydian: 5 }[mode];
  const rel = mod12(tonic + shift);
  return [5, 10, 3, 8, 1].includes(rel);
}

// A note name spelled to suit the key.
export function spell(pc: number, flats: boolean): string {
  return (flats ? FLATS : SHARPS)[mod12(pc)];
}

export function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function noteName(midi: number): string {
  return `${PC_NAMES[mod12(midi)]}${Math.floor(midi / 12) - 1}`;
}

// ---- triads -------------------------------------------------------------------

export interface Triad {
  root: number; // pitch class
  minor: boolean;
}

export const triadPcs = (t: Triad): number[] => [t.root, mod12(t.root + (t.minor ? 3 : 4)), mod12(t.root + 7)];

export const triadName = (t: Triad): string => (t.minor ? `${MINOR_NAMES[t.root]}m` : MAJOR_NAMES[t.root]);

export const triadKey = (t: Triad): number => t.root + (t.minor ? 12 : 0);

export const sameTriad = (a: Triad, b: Triad): boolean => a.root === b.root && a.minor === b.minor;

// The three neo-Riemannian moves. Each keeps two notes and moves the third
// by a semitone (P, L) or a whole tone (R).
export type PLR = "P" | "L" | "R";

export function applyPLR(t: Triad, op: PLR): Triad {
  if (op === "P") return { root: t.root, minor: !t.minor }; // C ↔ Cm
  if (op === "R") return t.minor ? { root: mod12(t.root + 3), minor: false } : { root: mod12(t.root + 9), minor: true }; // C ↔ Am
  return t.minor ? { root: mod12(t.root + 8), minor: false } : { root: mod12(t.root + 4), minor: true }; // C ↔ Em
}

export const PLR_TEXT: Record<PLR, string> = {
  P: "Parallel: the third moves a semitone",
  L: "Leading-tone: one note moves a semitone",
  R: "Relative: one note moves a whole tone",
};

// ---- Tonnetz ------------------------------------------------------------------
// Lattice node (i, j) holds pitch class 7i + 4j: i runs along perfect fifths,
// j along major thirds, so the third axis (down-right) is minor thirds.
// Up-pointing triangle at (i, j) = {(i,j), (i+1,j), (i,j+1)} = major triad
// rooted at pc(i, j). Down-pointing at (i, j) = {(i+1,j), (i,j+1), (i+1,j+1)}
// = minor triad rooted at pc(i, j) + 4.

export const SQRT3_2 = Math.sqrt(3) / 2;

export const latticePc = (i: number, j: number): number => mod12(7 * i + 4 * j);

export const latticeXY = (i: number, j: number): [number, number] => [i + j * 0.5, j * SQRT3_2];

export interface Cell {
  i: number;
  j: number;
  up: boolean; // up = major, down = minor
}

export function cellVerts(c: Cell): [number, number][] {
  return c.up
    ? [
        [c.i, c.j],
        [c.i + 1, c.j],
        [c.i, c.j + 1],
      ]
    : [
        [c.i + 1, c.j],
        [c.i, c.j + 1],
        [c.i + 1, c.j + 1],
      ];
}

export function cellTriad(c: Cell): Triad {
  return c.up ? { root: latticePc(c.i, c.j), minor: false } : { root: mod12(latticePc(c.i, c.j) + 4), minor: true };
}

export function cellCenter(c: Cell): [number, number] {
  const v = cellVerts(c).map(([i, j]) => latticeXY(i, j));
  return [(v[0][0] + v[1][0] + v[2][0]) / 3, (v[0][1] + v[1][1] + v[2][1]) / 3];
}

// The neighbouring cell across the edge shared with the PLR partner.
export function cellPLR(c: Cell, op: PLR): Cell {
  if (c.up) {
    if (op === "P") return { i: c.i, j: c.j - 1, up: false }; // across the root–fifth edge
    if (op === "R") return { i: c.i - 1, j: c.j, up: false }; // across the root–third edge
    return { i: c.i, j: c.j, up: false }; // L: across the third–fifth edge
  }
  // down cell (i,j) is the minor triad (i,j+1) root, (i+1,j) third, (i+1,j+1) fifth
  if (op === "P") return { i: c.i, j: c.j + 1, up: true };
  if (op === "R") return { i: c.i + 1, j: c.j, up: true };
  return { i: c.i, j: c.j, up: true };
}

// Which cell of the plane contains point (x, y) in lattice units.
export function cellAt(x: number, y: number): Cell {
  const fj = y / SQRT3_2;
  const fi = x - fj * 0.5; // undo the shear
  const i = Math.floor(fi);
  const j = Math.floor(fj);
  // inside the parallelogram (i..i+1, j..j+1) the diagonal splits up from down
  return { i, j, up: fi - i + (fj - j) < 1 };
}

// ---- voice leading --------------------------------------------------------------

// Assign each voice (a MIDI note) to a pitch class of the next chord so the
// total motion is smallest, with every chord tone covered at least once.
// Voices land at the nearest octave of their pitch class, inside [lo, hi].
// Small penalties discourage unisons and voice crossings.
export function voiceLead(prev: number[], pcs: number[], lo = 52, hi = 79): number[] {
  const n = prev.length;
  const m = pcs.length;
  let best: number[] = prev.slice();
  let bestCost = Infinity;
  const total = Math.pow(m, n);
  for (let code = 0; code < total; code++) {
    let c = code;
    const pick: number[] = [];
    for (let v = 0; v < n; v++) {
      pick.push(c % m);
      c = Math.floor(c / m);
    }
    // every chord tone must be present when there are enough voices
    if (n >= m) {
      let ok = true;
      for (let k = 0; k < m; k++) if (!pick.includes(k)) ok = false;
      if (!ok) continue;
    }
    const cand = prev.map((p, v) => {
      const pc = pcs[pick[v]];
      let x = pc + 12 * Math.round((p - pc) / 12);
      while (x < lo) x += 12;
      while (x > hi) x -= 12;
      return x;
    });
    let cost = 0;
    for (let v = 0; v < n; v++) cost += Math.abs(cand[v] - prev[v]);
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        if (cand[a] === cand[b]) cost += 6;
        if ((prev[a] - prev[b]) * (cand[a] - cand[b]) < 0) cost += 3; // crossing
      }
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = cand;
    }
  }
  return best;
}

// A compact close-position voicing of pitch classes around a centre note.
export function closeVoicing(pcs: number[], centre = 64): number[] {
  const out = pcs.map((pc) => pc + 12 * Math.round((centre - pc) / 12));
  return out.sort((a, b) => a - b);
}

// ---- Lerdahl's chord distance (Tonal Pitch Space, 2001) -------------------------
// δ(x→y) = i + j + k. Inside one key i = 0; j counts steps between the roots on
// the key's diatonic circle of fifths; k counts pitch classes in y's basic
// space (root, fifth, triad levels; the diatonic and chromatic levels are
// shared) that aren't in x's at the same level.

const DIATONIC_FIFTHS = [0, 7, 2, 9, 4, 11, 5]; // C G D A E B F (C major)

export function lerdahlDistance(xRoot: number, xPcs: number[], yRoot: number, yPcs: number[], tonic = 0): number {
  const rel = (pc: number): number => mod12(pc - tonic);
  const ix = DIATONIC_FIFTHS.indexOf(rel(xRoot));
  const iy = DIATONIC_FIFTHS.indexOf(rel(yRoot));
  let j = 0;
  if (ix >= 0 && iy >= 0) {
    const d = Math.abs(ix - iy);
    j = Math.min(d, 7 - d);
  }
  const levels = (root: number, pcs: number[]): number[][] => [[root], [root, pcs[2]], pcs.slice(0, 3)];
  const lx = levels(xRoot, xPcs);
  const ly = levels(yRoot, yPcs);
  let k = 0;
  for (let l = 0; l < 3; l++) for (const pc of ly[l]) if (!lx[l].includes(pc)) k++;
  return j + k;
}

// ---- roughness ----------------------------------------------------------------------

// Sensory roughness of a set of harmonic tones (Plomp–Levelt curve in
// Sethares' parameterization): sum over every pair of partials. Partial k
// has amplitude 1/k, the same recipe the figures draw and play.
export function chordRoughness(freqs: number[], partials = 8): number {
  const fs: number[] = [];
  const as: number[] = [];
  for (const f of freqs) {
    for (let k = 1; k <= partials; k++) {
      fs.push(f * k);
      as.push(1 / k);
    }
  }
  let r = 0;
  for (let a = 0; a < fs.length; a++) {
    for (let b = a + 1; b < fs.length; b++) r += pairRoughness(fs[a], as[a], fs[b], as[b]);
  }
  return r;
}

// ---- rhythm ---------------------------------------------------------------------------

// Bjorklund's algorithm in the form Toussaint (2005) describes: start with k
// one-hit groups and n−k rests, then keep appending the leftover groups onto
// the front ones (the remainders of Euclid's GCD algorithm) until at most one
// leftover remains. Returns every intermediate stage for drawing.
export function bjorklundStages(k: number, n: number): number[][][] {
  k = Math.max(0, Math.min(n, Math.round(k)));
  let front: number[][] = Array.from({ length: k }, () => [1]);
  let back: number[][] = Array.from({ length: n - k }, () => [0]);
  const stages: number[][][] = [[...front, ...back].map((g) => g.slice())];
  if (k === 0 || k === n) return stages;
  while (back.length > 1) {
    const pairs = Math.min(front.length, back.length);
    const merged: number[][] = [];
    for (let p = 0; p < pairs; p++) merged.push([...front[p], ...back[p]]);
    const rest = front.length > pairs ? front.slice(pairs) : back.slice(pairs);
    front = merged;
    back = rest;
    stages.push([...front, ...back].map((g) => g.slice()));
  }
  return stages;
}

export function bjorklund(k: number, n: number): boolean[] {
  const st = bjorklundStages(k, n);
  return st[st.length - 1].flat().map((x) => x === 1);
}

export function rotate<T>(arr: T[], r: number): T[] {
  const n = arr.length;
  if (n === 0) return arr;
  const s = ((r % n) + n) % n;
  return arr.slice(s).concat(arr.slice(0, s));
}

// gaps between onsets, e.g. tresillo → [3, 3, 2]
export function onsetGaps(p: boolean[]): number[] {
  const on = p.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
  return on.map((v, i) => (i + 1 < on.length ? on[i + 1] - v : p.length - v + on[0]));
}

// ---- randomness ------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Pink-ish (1/f) noise by the Voss–McCartney method: several random sources,
// source k redrawn every 2^k calls, summed. Unit variance, roughly.
export class PinkNoise {
  private vals: number[];
  private n = 0;
  private rng: () => number;
  private octaves: number;
  constructor(rng: () => number, octaves = 6) {
    this.rng = rng;
    this.octaves = octaves;
    this.vals = Array.from({ length: octaves }, () => gaussian(rng));
  }
  next(): number {
    this.n++;
    for (let k = 0; k < this.octaves; k++) {
      if (this.n % (1 << k) === 0) this.vals[k] = gaussian(this.rng);
    }
    let s = 0;
    for (const v of this.vals) s += v;
    return s / Math.sqrt(this.octaves);
  }
}

export function pick<T>(rng: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length) % xs.length];
}

export function weighted<T>(rng: () => number, items: readonly [T, number][]): T {
  let total = 0;
  for (const [, w] of items) total += w;
  let r = rng() * total;
  for (const [x, w] of items) {
    r -= w;
    if (r <= 0) return x;
  }
  return items[items.length - 1][0];
}
