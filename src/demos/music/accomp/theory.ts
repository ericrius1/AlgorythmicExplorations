// Music theory for the accompanist: key profiles, the 24 keys, triads as
// pitch-class templates, Roman numerals, and note spelling that follows the
// key signature (B♭ in F major, A♯ in B major).

export const pcOf = (m: number): number => ((m % 12) + 12) % 12;

// Krumhansl & Kessler (1982), probe-tone ratings on a 1–7 scale, averaged over
// several key-defining contexts. Index 0 is the tonic.
export const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
export const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
export const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

// Circle-of-fifths order of pitch classes, C at the top.
export const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

const SHARPS = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLATS = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
// Major keys whose signatures use flats: F B♭ E♭ A♭ D♭ (F♯ gets sharps).
const FLAT_MAJOR = new Set([5, 10, 3, 8, 1]);
const MAJOR_KEY_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const MINOR_KEY_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"];

// A key is root*2 + (minor ? 1 : 0), so 24 keys fit in 0..23.
export interface Key {
  root: number;
  minor: boolean;
}
export const keyIndex = (k: Key): number => k.root * 2 + (k.minor ? 1 : 0);
export const keyOf = (i: number): Key => ({ root: i >> 1, minor: (i & 1) === 1 });

export function keyName(k: Key): string {
  return k.minor ? `${MINOR_KEY_NAMES[k.root]} minor` : `${MAJOR_KEY_NAMES[k.root]} major`;
}
export function keyShort(k: Key): string {
  return k.minor ? `${MINOR_KEY_NAMES[k.root]}m` : MAJOR_KEY_NAMES[k.root];
}

// Spell a pitch class the way the key's signature would. Notes outside the
// key are spelled the way they usually function: lowered degrees (♭II, ♭III,
// ♭VI, ♭VII) with flats, everything else with sharps.
export function spell(pc: number, k: Key | null): string {
  const p = pcOf(pc);
  if (!k) return FLATS[p].replace("G♭", "F♯").replace("D♭", "C♯");
  if (scaleOf(k).includes(p)) {
    const majorRoot = k.minor ? (k.root + 3) % 12 : k.root;
    return (FLAT_MAJOR.has(majorRoot) ? FLATS : SHARPS)[p];
  }
  const d = (p - k.root + 12) % 12;
  return ([1, 3, 8, 10].includes(d) ? FLATS : SHARPS)[p];
}

export function scaleOf(k: Key): number[] {
  return (k.minor ? MINOR_SCALE : MAJOR_SCALE).map((s) => (s + k.root) % 12);
}

// Pearson correlation between a 12-bin histogram and a profile rotated so its
// tonic sits on pitch class `root`.
export function correlate(hist: ArrayLike<number>, profile: number[], root: number): number {
  let mh = 0;
  let mp = 0;
  for (let i = 0; i < 12; i++) {
    mh += hist[i];
    mp += profile[i];
  }
  mh /= 12;
  mp /= 12;
  let num = 0;
  let dh = 0;
  let dp = 0;
  for (let pc = 0; pc < 12; pc++) {
    const x = hist[pc] - mh;
    const y = profile[(pc - root + 12) % 12] - mp;
    num += x * y;
    dh += x * x;
    dp += y * y;
  }
  return dh > 1e-9 && dp > 1e-9 ? num / Math.sqrt(dh * dp) : 0;
}

// All 24 correlations, indexed like keyIndex().
export function keyScores(hist: ArrayLike<number>, out = new Float32Array(24)): Float32Array {
  for (let r = 0; r < 12; r++) {
    out[r * 2] = correlate(hist, KK_MAJOR, r);
    out[r * 2 + 1] = correlate(hist, KK_MINOR, r);
  }
  return out;
}

// ---- chords --------------------------------------------------------------

export type Quality = "maj" | "min" | "dim";
export const QUALITIES: Quality[] = ["maj", "min", "dim"];
const QUAL_STEPS: Record<Quality, [number, number]> = { maj: [4, 7], min: [3, 7], dim: [3, 6] };

export interface Chord {
  root: number;
  q: Quality;
}
export const chordId = (c: Chord): number => c.root * 3 + QUALITIES.indexOf(c.q);
export const chordOf = (id: number): Chord => ({ root: Math.floor(id / 3), q: QUALITIES[id % 3] });
export const sameChord = (a: Chord | null, b: Chord | null): boolean =>
  !!a && !!b && a.root === b.root && a.q === b.q;

export function triadPcs(c: Chord): [number, number, number] {
  const [t, f] = QUAL_STEPS[c.q];
  return [c.root, (c.root + t) % 12, (c.root + f) % 12];
}

export function chordName(c: Chord, k: Key | null): string {
  return spell(c.root, k) + (c.q === "min" ? "m" : c.q === "dim" ? "°" : "");
}

// Chords that belong to the key. Minor keys get both v and V, and vii°,
// because real minor-key music borrows the leading tone (harmonic minor).
export function diatonicChords(k: Key): Chord[] {
  const r = k.root;
  const at = (s: number, q: Quality): Chord => ({ root: (r + s) % 12, q });
  return k.minor
    ? [at(0, "min"), at(2, "dim"), at(3, "maj"), at(5, "min"), at(7, "min"), at(7, "maj"), at(8, "maj"), at(10, "maj"), at(11, "dim")]
    : [at(0, "maj"), at(2, "min"), at(4, "min"), at(5, "maj"), at(7, "maj"), at(9, "min"), at(11, "dim")];
}

const ROMAN = ["I", "♭II", "II", "♭III", "III", "IV", "♯IV", "V", "♭VI", "VI", "♭VII", "VII"];
const ROMAN_MINOR_KEY = ["I", "♭II", "II", "III", "♯III", "IV", "♯IV", "V", "VI", "♯VI", "VII", "♯VII"];

export function roman(c: Chord, k: Key): string {
  const d = (c.root - k.root + 12) % 12;
  let s = (k.minor ? ROMAN_MINOR_KEY : ROMAN)[d];
  // the leading-tone chord in minor is plain vii°, not ♯vii°
  if (k.minor && d === 11) s = "VII";
  if (c.q !== "maj") s = s.toLowerCase();
  return s + (c.q === "dim" ? "°" : "");
}

// The chord's tones for the band, as pitch classes in stacking order. With
// `sevenths`, diatonic chords get their diatonic seventh, and the dominant in
// minor gets a dominant seventh.
export function chordTones(c: Chord, k: Key, sevenths: boolean): number[] {
  const tri = triadPcs(c);
  if (!sevenths) return [...tri];
  const scale = scaleOf(k);
  const dom = (c.root - k.root + 12) % 12 === 7 && c.q === "maj";
  let seventh: number | null = null;
  if (dom) seventh = (c.root + 10) % 12;
  else {
    // the scale tone a seventh above the root, if the chord is diatonic
    const inKey = tri.every((pc) => scale.includes(pc));
    if (inKey) {
      const i = scale.indexOf(c.root);
      seventh = scale[(i + 6) % 7];
    }
  }
  return seventh === null ? [...tri] : [...tri, seventh];
}

// A rootless voicing set (3rd, 5th, 7th, 9th) for comping over a bass player
// who has the root. Falls back to the full chord when the 9th would clash.
export function rootlessTones(c: Chord, k: Key): number[] {
  const tones = chordTones(c, k, true);
  if (tones.length < 4) return tones;
  const scale = scaleOf(k);
  const ninth = (c.root + 2) % 12;
  const dom = (c.root - k.root + 12) % 12 === 7 && c.q === "maj";
  if (c.q !== "dim" && (scale.includes(ninth) || dom)) return [tones[1], tones[2], tones[3], ninth];
  return tones;
}

// ---- voice leading --------------------------------------------------------

// Choose an arrangement of `pcs` (all inversions, bottom note in [lo, lo+12))
// that moves the least from `prev`. The first chord just sits near `center`.
export function voiceLead(prev: number[], pcs: number[], lo: number, center = 62): number[] {
  const n = pcs.length;
  let best: number[] = [];
  let bestCost = Infinity;
  for (let inv = 0; inv < n; inv++) {
    {
      // bottom note: the first pc of this inversion at or above lo
      const notes: number[] = [];
      let m = lo + (((pcs[inv] - lo) % 12) + 12) % 12;
      notes.push(m);
      for (let j = 1; j < n; j++) {
        const pc = pcs[(inv + j) % n];
        m = m + 1 + (((pc - (m + 1)) % 12) + 12) % 12;
        notes.push(m);
      }
      let cost: number;
      if (prev.length === n) {
        cost = 0;
        for (let j = 0; j < n; j++) cost += Math.abs(notes[j] - prev[j]);
      } else if (prev.length) {
        const mp = prev.reduce((a, b) => a + b, 0) / prev.length;
        const mn = notes.reduce((a, b) => a + b, 0) / n;
        cost = Math.abs(mp - mn) * n;
      } else {
        cost = Math.abs(notes.reduce((a, b) => a + b, 0) / n - center) * n;
      }
      // keep the top voice out of the melody's way
      if (notes[n - 1] > lo + 22) cost += (notes[n - 1] - lo - 22) * 2;
      if (cost < bestCost) {
        bestCost = cost;
        best = notes;
      }
    }
  }
  return best;
}
