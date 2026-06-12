// The eagle's voice. A bird's voice box is not our larynx — it is the
// syrinx, at the fork where the windpipe splits into the two lungs, and it
// has *two* sound sources, one per branch, that can sound independently.
// Even a bird that doesn't sing carries the dual hardware: an eagle's call
// stacks both voices a few hertz apart, which is where the metallic shimmer
// in a raptor scream comes from. The grammar below strings together the
// gestures real bald-eagle calls are built from — the long descending scream,
// the staccato kik-kik-kik series, the fast chitter — out of the same four
// primitives the songbirds use.
//
// The sound math is borrowed wholesale from the Living Music series; this
// file only adds the grammar and the two-voice wiring.

import { Tone, masterBus, unlockAudio } from "../audio";

export type Gesture = "whistle" | "sweep" | "trill" | "buzz" | "rest";

export interface Syllable {
  gesture: Gesture;
  dur: number; // seconds
  f0: number; // start frequency (Hz)
  f1: number; // end frequency (Hz) — for sweeps
  trillRate?: number; // Hz, for trills/buzzes
  voice: 0 | 1; // which half of the syrinx
  stack?: boolean; // play together with the previous syllable (both voices at once)
}

// Eagle calls sit lower than songbird song — roughly 1 to 3.5 kHz — and move
// slower: long gestures, deliberate gaps.
const HI = 3300, LO = 1150;
const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// A phrase: usually an opening klee or two, then either the scream (a long
// downward sweep) or a kik series (a slowish trill, each pulse a separate
// note), with the occasional chitter. Both voices get work — often stacked
// on the scream, alternating on the series.
export function generatePhrase(seed: number): Syllable[] {
  const out: Syllable[] = [];
  let k = seed * 13.37;
  const rnd = (): number => hash(k++);

  const klee = (): Syllable => ({
    gesture: "sweep",
    dur: 0.13 + rnd() * 0.1,
    f0: 2300 + rnd() * 700,
    f1: 1900 + rnd() * 400,
    voice: rnd() < 0.5 ? 0 : 1,
  });
  const scream = (): Syllable => ({
    gesture: "sweep",
    dur: 0.5 + rnd() * 0.45,
    f0: 2500 + rnd() * (HI - 2500),
    f1: LO + 250 + rnd() * 350,
    voice: rnd() < 0.5 ? 0 : 1,
  });
  const kikSeries = (): Syllable => ({
    gesture: "trill",
    dur: 0.4 + rnd() * 0.5,
    f0: 2400 + rnd() * 700,
    f1: 2100 + rnd() * 500,
    trillRate: 9 + rnd() * 5,
    voice: rnd() < 0.5 ? 0 : 1,
  });
  const chitter = (): Syllable => ({
    gesture: "buzz",
    dur: 0.18 + rnd() * 0.16,
    f0: 2000 + rnd() * 800,
    f1: 2000 + rnd() * 800,
    trillRate: 24 + rnd() * 16,
    voice: rnd() < 0.5 ? 0 : 1,
  });
  const rest = (): Syllable => ({ gesture: "rest", dur: 0.1 + rnd() * 0.18, f0: LO, f1: LO, voice: 0 });

  const opens = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < opens; i++) { out.push(klee()); out.push(rest()); }
  if (rnd() < 0.55) {
    out.push(scream());
    // the second voice doubles the scream a few hertz off — the shimmer
    const double = { ...out[out.length - 1] };
    double.voice = double.voice === 0 ? 1 : 0;
    double.f0 *= 1.006;
    double.f1 *= 1.006;
    double.stack = true;
    out.push(double);
  } else {
    out.push(kikSeries());
    if (rnd() < 0.5) { out.push(rest()); out.push(kikSeries()); }
  }
  if (rnd() < 0.4) { out.push(rest()); out.push(chitter()); }
  return out;
}

// Two voices, each an oscillator → gain, summed into the shared master bus so
// the music series' analysers see it too. Tone schedules everything ahead of
// the clock, so a whole phrase is queued in one call and plays itself.
export class Syrinx {
  private voices: { osc: Tone.Oscillator; amp: Tone.Gain }[] = [];
  private ready = false;

  async ensure(): Promise<void> {
    if (this.ready) return;
    await unlockAudio();
    const bus = masterBus();
    for (let v = 0; v < 2; v++) {
      const amp = new Tone.Gain(0).connect(bus);
      const osc = new Tone.Oscillator(LO, v === 0 ? "sine" : "triangle").connect(amp);
      // a hair of detune between the halves gives the voice its living shimmer
      osc.detune.value = v === 0 ? -6 : 6;
      osc.start();
      this.voices.push({ osc, amp });
    }
    this.ready = true;
  }

  // Schedule a phrase starting `at` seconds from now (Tone time). Returns its
  // total duration so the caller can time the beak and the next phrase.
  async sing(phrase: Syllable[], gap = 0.012): Promise<number> {
    await this.ensure();
    const t0 = Tone.now() + 0.05;
    let t = t0;
    let prevDur = 0;
    for (const syl of phrase) {
      if (syl.stack) t -= prevDur + gap; // ride on top of the previous syllable
      const { osc, amp } = this.voices[syl.voice];
      if (syl.gesture === "rest") { t += syl.dur; prevDur = 0; continue; }

      if (syl.trillRate) {
        // trill/buzz: amplitude-modulate the voice on and off fast
        const cycles = Math.max(1, Math.round(syl.dur * syl.trillRate));
        const cyc = syl.dur / cycles;
        osc.frequency.setValueAtTime(syl.f0, t);
        osc.frequency.linearRampToValueAtTime(syl.f1, t + syl.dur);
        for (let c = 0; c < cycles; c++) {
          const ct = t + c * cyc;
          amp.gain.setValueAtTime(0.0001, ct);
          amp.gain.linearRampToValueAtTime(0.22, ct + cyc * 0.3);
          amp.gain.linearRampToValueAtTime(0.0001, ct + cyc * 0.9);
        }
      } else {
        // whistle / sweep: a single grain with a soft envelope and a pitch glide
        osc.frequency.setValueAtTime(syl.f0, t);
        osc.frequency.exponentialRampToValueAtTime(Math.max(50, syl.f1), t + syl.dur);
        amp.gain.setValueAtTime(0.0001, t);
        amp.gain.linearRampToValueAtTime(0.26, t + Math.min(0.012, syl.dur * 0.3));
        amp.gain.linearRampToValueAtTime(0.0001, t + syl.dur);
      }
      t += syl.dur + gap;
      prevDur = syl.dur;
    }
    return t - t0;
  }

  dispose(): void {
    for (const { osc, amp } of this.voices) { osc.dispose(); amp.dispose(); }
    this.voices = [];
    this.ready = false;
  }
}
