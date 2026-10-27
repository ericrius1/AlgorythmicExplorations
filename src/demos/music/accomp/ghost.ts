// A stand-in player for the figures, so they have something to listen to before
// you play. It plays two-bar phrases, rests two bars for the band's answer, and
// every two phrases moves to a neighbouring key: down to the relative minor,
// then up a fifth, so over a few minutes it walks all the way around the
// circle of fifths. The phrases are short tunes I wrote in scale degrees.

import type { Accompanist } from "./band";
import { type Key, MAJOR_SCALE, MINOR_SCALE } from "./theory";

// [scale degree (0 = tonic, 7 = octave), length in eighth notes]
// Each one was checked to point the key finder at its own key, major and minor.
const MOTIFS: [number, number][][] = [
  [[0, 2], [2, 2], [4, 2], [7, 2], [6, 1], [5, 1], [3, 2], [2, 2], [0, 2]],
  [[4, 1], [3, 1], [2, 2], [4, 2], [0, 2], [5, 2], [6, 2], [7, 4]],
  [[2, 2], [1, 1], [0, 1], [1, 2], [4, 2], [3, 2], [2, 2], [0, 4]],
  [[7, 2], [6, 2], [5, 2], [4, 2], [3, 2], [2, 1], [1, 1], [0, 4]],
  [[0, 3], [2, 1], [3, 2], [5, 2], [4, 2], [3, 2], [2, 2], [0, 2]],
  [[3, 2], [5, 2], [4, 1], [3, 1], [2, 2], [1, 2], [-1, 2], [0, 4]],
  [[0, 1], [1, 1], [2, 2], [2, 2], [3, 1], [2, 1], [1, 2], [3, 2], [-1, 2], [0, 2]],
  [[4, 2], [2, 1], [0, 1], [3, 4], [2, 2], [1, 2], [0, 4]],
];

export class Ghost {
  enabled = true;
  key: Key = { root: 0, minor: false };
  private yieldUntil = 0;
  private phrase = 0;
  private queue: { step: number; midi: number; len: number; vel: number }[] = [];

  constructor(private band: Accompanist) {}

  // you're playing: wait for ten seconds of quiet before taking over again
  yieldToPlayer(now: number): void {
    this.yieldUntil = now + 10;
    this.queue.length = 0;
  }

  get active(): boolean {
    return this.enabled && performance.now() / 1000 > this.yieldUntil;
  }

  onStep(step: number, t: number): void {
    if (!this.active) return;
    // phrases start every four bars; the second pair of bars is for the answer
    if (step % 64 === 0) this.plan(step);
    while (this.queue.length && this.queue[0].step <= step) {
      const n = this.queue.shift()!;
      if (n.step < step) continue;
      const dt = this.band.clock.stepDur;
      this.band.ghostNote(n.midi, t + this.band.clock.swingOf(step), n.len * dt * 0.92, n.vel);
    }
  }

  private plan(step: number): void {
    if (this.phrase > 0 && this.phrase % 2 === 0) this.modulate();
    this.phrase++;
    const motif = MOTIFS[Math.floor(Math.random() * MOTIFS.length)];
    const scale = this.key.minor ? MINOR_SCALE : MAJOR_SCALE;
    // tonic between C4 and B4
    const tonic = 60 + this.key.root;
    let s = step;
    motif.forEach(([deg, len], i) => {
      const oct = Math.floor(deg / 7);
      const idx = ((deg % 7) + 7) % 7;
      let m = tonic + oct * 12 + scale[idx];
      // in minor, the seventh is raised (harmonic minor), as most minor-key tunes do
      if (this.key.minor && idx === 6) m += 1;
      const vel = (s % 16 === 0 ? 0.78 : s % 4 === 0 ? 0.68 : 0.56) + (i === motif.length - 1 ? 0.04 : 0);
      this.queue.push({ step: s, midi: m, len: len * 2, vel });
      s += len * 2;
    });
  }

  private modulate(): void {
    // major → its relative minor; minor → the major key a fifth above the old major
    this.key = this.key.minor
      ? { root: (this.key.root + 3 + 7) % 12, minor: false }
      : { root: (this.key.root + 9) % 12, minor: true };
  }
}
