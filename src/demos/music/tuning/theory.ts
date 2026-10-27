// Tuning arithmetic shared by the part 4 and part 5 figures. Everything is in
// cents (1200 per octave) so tunings can be compared by subtraction.

export const cents = (ratio: number): number => 1200 * Math.log2(ratio);
export const ratioOf = (c: number): number => Math.pow(2, c / 1200);
export const mod = (x: number, m: number): number => ((x % m) + m) % m;

export const FIFTH = cents(3 / 2); // 701.955
export const FOURTH = cents(4 / 3); // 498.045
export const MAJ3 = cents(5 / 4); // 386.314
export const MIN3 = cents(6 / 5); // 315.641
export const HARM7 = cents(7 / 4); // 968.826
export const PYTH_COMMA = 12 * FIFTH - 8400; // 23.460
export const SYNTONIC = cents(81 / 80); // 21.506
export const SCHISMA = PYTH_COMMA - SYNTONIC; // 1.954

export const C4 = 261.6256; // equal-tempered middle C, A4 = 440

// ---- note names along the chain of fifths ------------------------------------

const LETTERS = "FCGDAEB";

// The note k fifths above C (negative = below), spelled the way the chain
// spells it: C G D A E B F♯ C♯ … B♯ F𝄪, and F B♭ E♭ … downward.
export function fifthName(k: number): string {
  const i = k + 1; // F is index 0
  const letter = LETTERS[mod(i, 7)];
  const acc = Math.floor(i / 7);
  return letter + accidental(acc);
}

export function accidental(n: number): string {
  if (n === 0) return "";
  if (n > 0) return "𝄪".repeat(Math.floor(n / 2)) + (n % 2 ? "♯" : "");
  const f = -n;
  return "♭".repeat(f);
}

// Equal-tempered pitch-class names, flats where a key signature would use them.
export const PC_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

// ---- the pitch spiral -----------------------------------------------------------

// Pitch (cents above the start) of the k-th stacked fifth, unfolded.
export const stacked = (k: number, fifth = FIFTH): number => k * fifth;
// Same note folded into one octave.
export const folded = (k: number, fifth = FIFTH): number => mod(k * fifth, 1200);

// Step sizes of the scale made by the first n notes of a chain of fifths,
// folded into an octave. Returns the sorted pitches and the gaps.
export function chainScale(n: number, fifth = FIFTH): { pitches: number[]; gaps: number[] } {
  const pitches = Array.from({ length: n }, (_, k) => folded(k, fifth)).sort((a, b) => a - b);
  const gaps = pitches.map((p, i) => (i + 1 < pitches.length ? pitches[i + 1] : 1200) - p);
  return { pitches, gaps };
}

// Distinct step sizes (to 0.05¢) with how many times each occurs.
export function stepKinds(gaps: number[]): { size: number; count: number }[] {
  const out: { size: number; count: number }[] = [];
  for (const g of gaps) {
    const hit = out.find((o) => Math.abs(o.size - g) < 0.05);
    if (hit) hit.count++;
    else out.push({ size: g, count: 1 });
  }
  return out.sort((a, b) => b.size - a.size);
}

// ---- circulating temperaments ---------------------------------------------------

// Keys around the circle of fifths, starting at C. Index i's fifth goes from
// CIRCLE[i] to CIRCLE[i + 1]. G♯ and E♭ are spelled the way a meantone or
// Pythagorean keyboard has them: the wolf sits between them.
export const CIRCLE = ["C", "G", "D", "A", "E", "B", "F♯", "C♯", "G♯", "E♭", "B♭", "F"];

export interface Temperament {
  id: string;
  name: string;
  short: string;
  year: string;
  // deviation of each of the 12 fifths from pure, in cents (negative = narrow)
  temper: number[];
}

const fill = (v: number): number[] => Array(12).fill(v);
const withAt = (base: number, at: Record<number, number>): number[] =>
  fill(base).map((v, i) => (i in at ? at[i] : v));

export const TEMPERAMENTS: Temperament[] = [
  {
    id: "pyth",
    name: "Pythagorean",
    short: "Pythagorean",
    year: "medieval",
    temper: withAt(0, { 8: -PYTH_COMMA }),
  },
  {
    id: "mean",
    name: "quarter-comma meantone",
    short: "¼-comma meantone",
    year: "1523",
    temper: withAt(-SYNTONIC / 4, { 8: (11 * SYNTONIC) / 4 - PYTH_COMMA }),
  },
  {
    id: "werck",
    name: "Werckmeister III",
    short: "Werckmeister III",
    year: "1691",
    temper: withAt(0, { 0: -PYTH_COMMA / 4, 1: -PYTH_COMMA / 4, 2: -PYTH_COMMA / 4, 5: -PYTH_COMMA / 4 }),
  },
  {
    id: "kirn",
    name: "Kirnberger III",
    short: "Kirnberger III",
    year: "1779",
    temper: withAt(0, {
      0: -SYNTONIC / 4,
      1: -SYNTONIC / 4,
      2: -SYNTONIC / 4,
      3: -SYNTONIC / 4,
      6: -SCHISMA,
    }),
  },
  {
    id: "vall",
    name: "Vallotti",
    short: "Vallotti",
    year: "c. 1750",
    temper: withAt(0, {
      11: -PYTH_COMMA / 6,
      0: -PYTH_COMMA / 6,
      1: -PYTH_COMMA / 6,
      2: -PYTH_COMMA / 6,
      3: -PYTH_COMMA / 6,
      4: -PYTH_COMMA / 6,
    }),
  },
  {
    id: "equal",
    name: "equal temperament",
    short: "equal",
    year: "19th c.",
    temper: fill(-PYTH_COMMA / 12),
  },
];

// Pitch of each circle position in cents above C (0..1200), plus the size
// of every fifth and every major third.
export function temperamentTable(t: Temperament): {
  pitch: number[];
  fifth: number[];
  third: number[];
} {
  const fifth = t.temper.map((d) => FIFTH + d);
  const pitch: number[] = [];
  let acc = 0;
  for (let i = 0; i < 12; i++) {
    pitch.push(mod(acc, 1200));
    acc += fifth[i];
  }
  // the major third above key i is four fifths up, two octaves down
  const third = Array.from({ length: 12 }, (_, i) => {
    let s = 0;
    for (let j = 0; j < 4; j++) s += fifth[(i + j) % 12];
    return s - 2400;
  });
  return { pitch, fifth, third };
}

// ---- equal divisions --------------------------------------------------------------

// Nearest step of an n-step division of `period` cents to `target`, and the
// signed error (positive = the step is sharp).
export function nearestStep(n: number, target: number, period = 1200): { step: number; cents: number; err: number } {
  const size = period / n;
  const step = Math.round(target / size);
  return { step, cents: step * size, err: step * size - target };
}

// Continued-fraction convergents of x (for log2(3/2) these are 1/1, 1/2,
// 3/5, 7/12, 24/41, 31/53, 179/306 …).
export function convergents(x: number, count: number): [number, number][] {
  const out: [number, number][] = [];
  let [h0, h1] = [0, 1];
  let [k0, k1] = [1, 0];
  let r = x;
  for (let i = 0; i < count; i++) {
    const a = Math.floor(r);
    [h0, h1] = [h1, a * h1 + h0];
    [k0, k1] = [k1, a * k1 + k0];
    out.push([h1, k1]);
    const frac = r - a;
    if (frac < 1e-12) break;
    r = 1 / frac;
  }
  return out;
}

// ---- generated (meantone-family) scales ----------------------------------------

// A diatonic-family note as a position on the chain of fifths relative to
// its tonic: 0 = tonic, 1 = fifth, 2 = second, 3 = sixth, 4 = third,
// 5 = seventh, −1 = fourth, −2 = ♭7, −3 = ♭3, −4 = ♭6, −5 = ♭2, 6 = ♯4.
// Any tuning with a single fifth size f puts chain position q at q·f cents
// (folded into the octave), so these scales can be heard in Pythagorean,
// meantone, 12-, 19- or 31-equal just by changing f.
export interface ChainScale {
  id: string;
  name: string;
  q: number[]; // chain positions in scale order
  degrees: string[];
}

export const CHAIN_SCALES: ChainScale[] = [
  { id: "lydian", name: "Lydian", q: [0, 2, 4, 6, 1, 3, 5], degrees: ["1", "2", "3", "♯4", "5", "6", "7"] },
  { id: "ionian", name: "Ionian (major)", q: [0, 2, 4, -1, 1, 3, 5], degrees: ["1", "2", "3", "4", "5", "6", "7"] },
  { id: "mixolydian", name: "Mixolydian", q: [0, 2, 4, -1, 1, 3, -2], degrees: ["1", "2", "3", "4", "5", "6", "♭7"] },
  { id: "dorian", name: "Dorian", q: [0, 2, -3, -1, 1, 3, -2], degrees: ["1", "2", "♭3", "4", "5", "6", "♭7"] },
  { id: "aeolian", name: "Aeolian (minor)", q: [0, 2, -3, -1, 1, -4, -2], degrees: ["1", "2", "♭3", "4", "5", "♭6", "♭7"] },
  { id: "phrygian", name: "Phrygian", q: [0, -5, -3, -1, 1, -4, -2], degrees: ["1", "♭2", "♭3", "4", "5", "♭6", "♭7"] },
  { id: "locrian", name: "Locrian", q: [0, -5, -3, -1, -6, -4, -2], degrees: ["1", "♭2", "♭3", "4", "♭5", "♭6", "♭7"] },
  { id: "harmonic", name: "harmonic minor", q: [0, 2, -3, -1, 1, -4, 5], degrees: ["1", "2", "♭3", "4", "5", "♭6", "7"] },
  { id: "penta", name: "major pentatonic", q: [0, 2, 4, 1, 3], degrees: ["1", "2", "3", "5", "6"] },
  { id: "minpenta", name: "minor pentatonic", q: [0, -3, -1, 1, -2], degrees: ["1", "♭3", "4", "5", "♭7"] },
];

// Tonics on the chain: C = 0, G = 1 … F = −1, B♭ = −2 …
export const TONICS: { name: string; q: number }[] = [
  { name: "C", q: 0 },
  { name: "G", q: 1 },
  { name: "D", q: 2 },
  { name: "A", q: 3 },
  { name: "E", q: 4 },
  { name: "B", q: 5 },
  { name: "F♯", q: 6 },
  { name: "D♭", q: -5 },
  { name: "A♭", q: -4 },
  { name: "E♭", q: -3 },
  { name: "B♭", q: -2 },
  { name: "F", q: -1 },
];

// ---- 12-note pitch-class sets ------------------------------------------------

export function intervalVector(pcs: number[]): number[] {
  const v = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < pcs.length; i++) {
    for (let j = i + 1; j < pcs.length; j++) {
      const d = mod(pcs[j] - pcs[i], 12);
      const ic = Math.min(d, 12 - d);
      if (ic > 0) v[ic - 1]++;
    }
  }
  return v;
}

// Clough–Douthett maximally even set: k of 12, spread as evenly as the
// semitone grid allows.
export function maximallyEven(k: number): number[] {
  return Array.from({ length: k }, (_, i) => Math.floor((12 * i) / k));
}

// Total of all pairwise chord lengths on a unit circle: largest when the
// points are spread out. Used as an "evenness" score.
export function spread(pcs: number[]): number {
  let s = 0;
  for (let i = 0; i < pcs.length; i++) {
    for (let j = i + 1; j < pcs.length; j++) {
      s += 2 * Math.sin((Math.PI * mod(pcs[j] - pcs[i], 12)) / 12);
    }
  }
  return s;
}
