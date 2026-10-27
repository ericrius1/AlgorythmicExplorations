// Note names, scales and chords as plain MIDI arithmetic. Pitch classes are
// 0..11 with C = 0; MIDI 60 is middle C (C4), 69 is A4 = 440 Hz.

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
} as const satisfies Record<string, readonly number[]>;

export type ScaleName = keyof typeof SCALES;

export const CHORDS = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  dom7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  add9: [0, 4, 7, 14],
} as const satisfies Record<string, readonly number[]>;

export type ChordName = keyof typeof CHORDS;

const SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLAT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

/** Pitch class 0..11 (works for negative and fractional input; rounds to nearest). */
export function pc(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

/**
 * Name of a MIDI note: noteName(61) → "C♯4". Options: flats (D♭ instead of
 * C♯), octave (false drops the octave number), ascii (# and b instead of ♯ ♭).
 */
export function noteName(midi: number, opts: { flats?: boolean; octave?: boolean; ascii?: boolean } = {}): string {
  const m = Math.round(midi);
  let n = (opts.flats ? FLAT_NAMES : SHARP_NAMES)[pc(m)];
  if (opts.ascii) n = n.replace("♯", "#").replace("♭", "b");
  return opts.octave === false ? n : `${n}${Math.floor(m / 12) - 1}`;
}

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Parse "C4", "F#3", "Bb2", "E♭5", "c" (octave defaults to 4). Returns NaN if unparseable. */
export function parseNote(name: string): number {
  const m = /^\s*([A-Ga-g])([#♯b♭]*)(-?\d+)?\s*$/.exec(name);
  if (!m) return NaN;
  let p = LETTER[m[1].toUpperCase()];
  for (const ch of m[2]) p += ch === "#" || ch === "♯" ? 1 : -1;
  const octave = m[3] === undefined ? 4 : Number(m[3]);
  return (octave + 1) * 12 + p;
}

/** Is `midi` in the scale built on `root`? */
export function inScale(midi: number, root: number, intervals: readonly number[]): boolean {
  return intervals.includes(((pc(midi) - pc(root)) % 12 + 12) % 12);
}

/** Scale notes upward from `root` for `octaves` octaves, including the top root. */
export function scaleNotes(root: number, intervals: readonly number[], octaves = 1): number[] {
  const out: number[] = [];
  for (let o = 0; o < octaves; o++) for (const i of intervals) out.push(root + 12 * o + i);
  out.push(root + 12 * octaves);
  return out;
}

/** Chord notes on `root`; inversion n moves the lowest n notes up an octave. */
export function chordNotes(root: number, quality: ChordName | readonly number[], inversion = 0): number[] {
  const iv = typeof quality === "string" ? CHORDS[quality] : quality;
  const notes = iv.map((i) => root + i);
  for (let k = 0; k < inversion % notes.length; k++) notes.push(notes.shift()! + 12);
  return notes;
}

/** Diatonic triad (or seventh with `sevenths`) on scale degree `degree` (0-based). */
export function diatonicChord(root: number, intervals: readonly number[], degree: number, sevenths = false): number[] {
  const n = intervals.length;
  const at = (k: number): number => root + intervals[((k % n) + n) % n] + 12 * Math.floor(k / n);
  const out = [at(degree), at(degree + 2), at(degree + 4)];
  if (sevenths) out.push(at(degree + 6));
  return out;
}
