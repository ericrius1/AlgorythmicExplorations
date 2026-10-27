// Call and response. When the player finishes a phrase and leaves a gap, the
// band answers with a phrase of its own built from the call: the same rhythm,
// with the pitches echoed, mirrored, moved up the scale, or improvised from a
// little Markov chain of the player's own melodic habits (in the spirit of
// Pachet's Continuator). Pitches move in scale steps, so every answer stays in
// the key, and the answer ends on a chord tone.

import { type Chord, type Key, pcOf, scaleOf, triadPcs } from "./theory";

export type AnswerMode = "echo" | "mirror" | "sequence" | "riff";
export const ANSWER_MODES: AnswerMode[] = ["echo", "mirror", "sequence", "riff"];

export interface CallNote {
  midi: number;
  step: number; // onset, in (fractional) clock steps
  dur: number; // in steps
}

export interface AnswerNote {
  midi: number;
  offset: number; // steps after the answer's start
  dur: number;
}

// A note as a position on the key's scale: 7 positions per octave, plus a
// chromatic alteration for notes outside the scale.
interface Deg {
  d: number;
  alt: number;
}

function toDeg(m: number, scale: number[]): Deg {
  const sorted = scaleSortedFromC(scale);
  const oct = Math.floor(m / 12);
  const pc = pcOf(m);
  // the scale degree at or just below the note
  for (let i = 6; i >= 0; i--) {
    if (sorted[i] <= pc) return { d: oct * 7 + i, alt: pc - sorted[i] };
  }
  return { d: (oct - 1) * 7 + 6, alt: pc + 12 - sorted[6] };
}

function scaleSortedFromC(scale: number[]): number[] {
  return [...scale].sort((a, b) => a - b);
}

function fromDeg(g: Deg, scale: number[]): number {
  const sorted = scaleSortedFromC(scale);
  const oct = Math.floor(g.d / 7);
  const i = ((g.d % 7) + 7) % 7;
  return oct * 12 + sorted[i] + g.alt;
}

function nearestChordTone(m: number, chord: Chord, below = 5, above = 5): number {
  const pcs = triadPcs(chord);
  let best = m;
  let bestD = 99;
  for (let x = m - below; x <= m + above; x++) {
    if (!pcs.includes(pcOf(x))) continue;
    const d = Math.abs(x - m) + (x === m ? -0.5 : 0);
    if (d < bestD) {
      bestD = d;
      best = x;
    }
  }
  return best;
}

// First-order Markov chain over scale-step intervals.
export class IntervalHabits {
  private counts = new Map<number, Map<number, number>>();
  private last: number | null = null;
  private lastDeg: number | null = null;
  total = 0;

  observe(m: number, key: Key | null, newPhrase: boolean): void {
    if (!key) return;
    const d = toDeg(m, scaleOf(key)).d;
    if (newPhrase || this.lastDeg === null) {
      this.lastDeg = d;
      this.last = null;
      return;
    }
    const step = Math.max(-7, Math.min(7, d - this.lastDeg));
    this.lastDeg = d;
    if (this.last !== null) {
      let row = this.counts.get(this.last);
      if (!row) this.counts.set(this.last, (row = new Map()));
      row.set(step, (row.get(step) ?? 0) + 1);
      this.total++;
    }
    this.last = step;
  }

  next(prev: number, rand: () => number): number {
    const row = this.counts.get(prev);
    if (row && row.size) {
      let sum = 0;
      for (const c of row.values()) sum += c;
      let r = rand() * sum;
      for (const [s, c] of row) {
        r -= c;
        if (r <= 0) return s;
      }
    }
    // not enough data yet: a small random walk that prefers steps
    const opts = [-2, -1, -1, 1, 1, 2, 0, -3, 3];
    return opts[Math.floor(rand() * opts.length)];
  }
}

export function makeAnswer(
  call: CallNote[],
  key: Key,
  chord: Chord,
  mode: AnswerMode,
  habits: IntervalHabits,
  rand: () => number = Math.random,
): AnswerNote[] {
  if (call.length === 0) return [];
  const scale = scaleOf(key);
  const t0 = Math.round(call[0].step / 2) * 2;
  // rhythm: the call's onsets on the eighth-note grid, at most one bar long
  const rhythm: { offset: number; dur: number }[] = [];
  for (const n of call) {
    const off = Math.max(0, Math.round(n.step / 2) * 2 - t0);
    if (off >= 16) break;
    if (rhythm.length && rhythm[rhythm.length - 1].offset === off) continue;
    rhythm.push({ offset: off, dur: Math.max(2, Math.min(8, Math.round(n.dur / 2) * 2)) });
  }
  for (let i = 0; i < rhythm.length - 1; i++) {
    rhythm[i].dur = Math.min(rhythm[i].dur, rhythm[i + 1].offset - rhythm[i].offset);
  }
  const notes = call.slice(0, rhythm.length).map((n) => toDeg(n.midi, scale));

  let degs: Deg[];
  if (mode === "echo") {
    // move the whole phrase so it starts on a tone of the current chord
    const first = fromDeg(notes[0], scale);
    const shift = toDeg(nearestChordTone(first, chord), scale).d - notes[0].d;
    degs = notes.map((g) => ({ d: g.d + shift, alt: g.alt }));
  } else if (mode === "sequence") {
    // the same phrase two scale steps (a third) higher
    degs = notes.map((g) => ({ d: g.d + 2, alt: 0 }));
  } else if (mode === "mirror") {
    // turn the contour upside down around the first note
    const pivot = notes[0].d;
    degs = notes.map((g) => ({ d: 2 * pivot - g.d, alt: 0 }));
  } else {
    // riff: start near where the call ended, then follow the player's habits
    const lastCall = call[Math.min(call.length, rhythm.length) - 1].midi;
    let d = toDeg(nearestChordTone(lastCall, chord), scale).d;
    let prev = 0;
    degs = [];
    const lo = notes.reduce((a, g) => Math.min(a, g.d), 999) - 3;
    const hi = notes.reduce((a, g) => Math.max(a, g.d), -999) + 3;
    for (let i = 0; i < rhythm.length; i++) {
      if (i > 0) {
        prev = habits.next(prev, rand);
        d += prev;
        if (d < lo || d > hi) {
          d -= 2 * prev;
          prev = -prev;
        }
      }
      degs.push({ d, alt: 0 });
    }
  }

  const out: AnswerNote[] = rhythm.map((r, i) => ({ midi: fromDeg(degs[i], scale), offset: r.offset, dur: r.dur }));
  // strong beats land on chord tones; the last note resolves and rings
  for (let i = 0; i < out.length; i++) {
    const n = out[i];
    const last = i === out.length - 1;
    if (last || n.offset % 4 === 0) n.midi = nearestChordTone(n.midi, chord, last ? 4 : 2, last ? 4 : 2);
  }
  const lastNote = out[out.length - 1];
  lastNote.dur = Math.max(lastNote.dur, 6);
  // keep it in a comfortable register for the vibraphone
  const mean = out.reduce((a, n) => a + n.midi, 0) / out.length;
  const lift = mean < 60 ? 12 : mean > 84 ? -12 : 0;
  for (const n of out) n.midi += lift;
  return out;
}
