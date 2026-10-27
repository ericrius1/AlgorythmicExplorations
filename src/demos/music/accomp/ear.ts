// The accompanist's ears. Two fading pitch-class memories: a slow one for the
// key (a sense of key survives a whole phrase) and a fast one for the chord
// (harmony lives in the last beat or two). Notes add weight for as long as
// they sound, the way Krumhansl and Schmuckler weighted notes by duration.

import {
  type Chord,
  type Key,
  chordId,
  chordOf,
  diatonicChords,
  keyOf,
  keyScores,
  pcOf,
  sameChord,
  triadPcs,
} from "./theory";

export const ONSET_WEIGHT = 0.5; // added when a note starts
export const HOLD_WEIGHT = 0.45; // added per second while it's held

export class KeyEar {
  readonly hist = new Float32Array(12); // slow memory: the key
  readonly fast = new Float32Array(12); // fast memory: the chord
  readonly scores = new Float32Array(24);
  readonly held = new Map<number, number>(); // midi → onset (performance.now ms)
  halfLife = 5; // seconds
  fastHalfLife = 0.9;
  // hysteresis: a challenger must beat the current key by `margin` for `patience` seconds
  margin = 0.05;
  patience = 1.5;

  key: Key | null = null;
  keyIdx = -1;
  private challenger = -1;
  private challengerTime = 0;
  bestIdx = -1; // raw winner, before hysteresis
  changedAt = 0; // performance.now() of the last key change

  noteOn(m: number): void {
    if (this.held.has(m)) return;
    this.held.set(m, performance.now());
    const pc = pcOf(m);
    this.hist[pc] += ONSET_WEIGHT;
    this.fast[pc] += 1;
  }

  noteOff(m: number): void {
    this.held.delete(m);
  }

  total(): number {
    let t = 0;
    for (let i = 0; i < 12; i++) t += this.hist[i];
    return t;
  }

  reset(): void {
    this.hist.fill(0);
    this.fast.fill(0);
    this.scores.fill(0);
    this.key = null;
    this.keyIdx = -1;
    this.bestIdx = -1;
    this.challenger = -1;
  }

  // dt in seconds
  update(dt: number): void {
    const ks = Math.pow(2, -dt / this.halfLife);
    const kf = Math.pow(2, -dt / this.fastHalfLife);
    for (let i = 0; i < 12; i++) {
      this.hist[i] *= ks;
      this.fast[i] *= kf;
    }
    for (const m of this.held.keys()) {
      const pc = pcOf(m);
      this.hist[pc] += HOLD_WEIGHT * dt;
      this.fast[pc] += 0.6 * dt;
    }
    if (this.total() < 1.2) {
      // too little evidence to say anything; keep the last key but don't score
      this.scores.fill(0);
      this.bestIdx = -1;
      return;
    }
    keyScores(this.hist, this.scores);
    let best = 0;
    for (let i = 1; i < 24; i++) if (this.scores[i] > this.scores[best]) best = i;
    this.bestIdx = best;
    // a flat histogram (a chromatic run) matches every key equally badly
    if (this.scores[best] < 0.3) return;
    if (this.keyIdx < 0) {
      this.setKey(best);
      return;
    }
    // The current key keeps its seat until something has beaten it clearly
    // for `patience` seconds. It doesn't have to be the same challenger the
    // whole time: on the way from C major to E♭ major, C minor and G minor
    // take turns in front before E♭ major does.
    if (best !== this.keyIdx && this.scores[best] > this.scores[this.keyIdx] + this.margin) {
      this.challenger = best;
      this.challengerTime += dt;
      if (this.challengerTime >= this.patience) this.setKey(best);
    } else {
      this.challenger = -1;
      this.challengerTime = Math.max(0, this.challengerTime - dt * 2);
    }
  }

  // 0..1, how far the current challenger is through its waiting time
  challengeProgress(): { idx: number; t: number } {
    return { idx: this.challenger, t: this.challenger < 0 ? 0 : Math.min(1, this.challengerTime / this.patience) };
  }

  conf(): number {
    return this.keyIdx < 0 ? 0 : this.scores[this.keyIdx];
  }

  private setKey(i: number): void {
    this.keyIdx = i;
    this.key = keyOf(i);
    this.challenger = -1;
    this.challengerTime = 0;
    this.changedAt = performance.now();
  }
}

// ---- chords ----------------------------------------------------------------

export interface ChordOpts {
  useKey: boolean; // apply the key prior
  inertia: number; // bonus for staying put
}

export interface ChordScore {
  id: number;
  score: number;
  fit: number; // evidence part alone
}

// Evidence for the chord: the fast memory plus whatever is held right now.
export function chordEvidence(ear: KeyEar, out = new Float32Array(12)): Float32Array {
  for (let i = 0; i < 12; i++) out[i] = ear.fast[i];
  for (const m of ear.held.keys()) out[pcOf(m)] += 1.2;
  return out;
}

const W_ROOT = 1.1;
const W_THIRD = 1.0;
const W_FIFTH = 0.75;

// Score all 36 triads (12 roots × major, minor, diminished).
export function scoreChords(
  ev: Float32Array,
  key: Key | null,
  current: Chord | null,
  opts: ChordOpts,
  out: ChordScore[] = [],
): ChordScore[] {
  let total = 0;
  for (let i = 0; i < 12; i++) total += ev[i];
  out.length = 0;
  const diatonic = key ? diatonicChords(key) : [];
  for (let id = 0; id < 36; id++) {
    const c = chordOf(id);
    const [r, t, f] = triadPcs(c);
    let fit = 0;
    if (total > 1e-6) {
      const inside = ev[r] * W_ROOT + ev[t] * W_THIRD + ev[f] * W_FIFTH;
      const outside = total - ev[r] - ev[t] - ev[f];
      fit = (inside - 0.6 * outside) / total;
    }
    let s = fit;
    if (opts.useKey && key) {
      const inKey = diatonic.some((d) => sameChord(d, c));
      const deg = (c.root - key.root + 12) % 12;
      if (inKey) {
        s += 0.1;
        if (deg === 0 || deg === 5 || deg === 7) s += 0.04; // tonic, subdominant, dominant
        if (c.q === "dim") s -= 0.08;
      } else if (c.q === "dim") s -= 0.12;
      if (current) {
        if (sameChord(current, c)) s += opts.inertia;
        // the root falling a fifth (V→I, ii→V) is the strongest move in tonal music
        if ((current.root - c.root + 12) % 12 === 7) s += 0.03;
      }
    } else if (current && sameChord(current, c)) s += opts.inertia;
    if (c.q === "dim" && !opts.useKey) s -= 0.05;
    out.push({ id, score: s, fit });
  }
  return out;
}

export function bestChord(scores: ChordScore[]): Chord {
  let b = scores[0];
  for (const s of scores) if (s.score > b.score) b = s;
  return chordOf(b.id);
}

export { chordId };
